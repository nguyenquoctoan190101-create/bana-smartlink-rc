import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UploadReport from "./UploadReport";
import { apiJson, apiUpload } from "../lib/apiClient";

vi.mock("../lib/apiClient", () => ({
  apiJson: vi.fn(),
  apiUpload: vi.fn(),
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

const mockedApiUpload = vi.mocked(apiUpload);
const mockedApiJson = vi.mocked(apiJson);

function previewResponse() {
  const values = Object.fromEntries(
    Array.from({ length: 14 }, (_, index) => [`CT${String(index + 1).padStart(2, "0")}`, index]),
  );
  const evidence = Object.fromEntries(
    Object.entries(values).map(([code, value]) => [code, {
      raw_value: String(value),
      normalized_value: value,
      confidence: 0.91,
      source_page: 1,
      source_region: "worksheet",
      extractor: "openpyxl",
      method: "official_template",
      version: "v1",
      flags: [],
      requires_review: false,
    }]),
  );
  return {
    values,
    raw_values: values,
    flags: [],
    null_codes: [],
    filename: "bao-cao.xlsx",
    size_bytes: 128,
    source: "excel",
    checksum_sha256: "a".repeat(64),
    extractor_versions: ["openpyxl:v1"],
    extraction_review_token: "signed-review-token".repeat(3),
    evidence,
    import_metadata: {
      source_checksum: "a".repeat(64),
      source_type: "excel",
      extractor_versions: ["openpyxl:v1"],
      field_count: 14,
      requires_review_count: 0,
      template_version: "ct14-official-2026-07",
      rule_version: "2026-07-14",
      evidence: {},
      quality_summary: {
        status: "ready",
        mean_confidence: 0.91,
        blocking_flag_count: 0,
        warning_flag_count: 0,
      },
    },
  };
}

describe("UploadReport", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    mockedApiUpload.mockReset();
    mockedApiJson.mockReset();
    mockedApiJson.mockResolvedValue({
      ocr_preview_enabled: false,
      ocr_setup_status: "disabled",
    });
  });

  it("rejects image and PDF files without calling the external OCR endpoint", () => {
    const { container } = render(
      <UploadReport onDataExtracted={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, {
      target: { files: [new File(["%PDF-1.7"], "bao-cao.pdf", { type: "application/pdf" })] },
    });

    expect(screen.getByText(/Nhận dạng ảnh\/PDF hiện chưa được bật/)).toBeInTheDocument();
    expect(mockedApiUpload).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("accept", ".xlsx");
  });

  it("offers OCR only after the backend confirms the capability", async () => {
    mockedApiJson.mockResolvedValue({
      ocr_preview_enabled: true,
      ocr_setup_status: "ready",
    });
    const ocrPreview = {
      ...previewResponse(),
      filename: "bao-cao.pdf",
      source: "pdf_ocr",
      import_metadata: {
        ...previewResponse().import_metadata,
        source_type: "pdf_ocr",
      },
    };
    mockedApiUpload.mockResolvedValue(new Response(
      JSON.stringify(ocrPreview),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const { container } = render(
      <UploadReport onDataExtracted={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await waitFor(() => expect(input).toHaveAttribute("accept", ".xlsx,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.pdf"));

    fireEvent.change(input!, {
      target: { files: [new File(["%PDF-1.7"], "bao-cao.pdf", { type: "application/pdf" })] },
    });

    await waitFor(() => expect(mockedApiUpload).toHaveBeenCalledWith(
      "/reports/ocr-preview",
      expect.any(FormData),
      expect.any(Function),
    ));
    expect(await screen.findByText(/Kết quả trích xuất/)).toBeInTheDocument();
  });

  it("presents OCR evidence flags as clear Vietnamese guidance", async () => {
    mockedApiJson.mockResolvedValue({
      ocr_preview_enabled: true,
      ocr_setup_status: "ready",
    });
    const ocrPreview = previewResponse();
    ocrPreview.source = "photo_ocr";
    ocrPreview.import_metadata.source_type = "photo_ocr";
    ocrPreview.evidence.CT01.flags = [
      "AI_CONFIDENCE_UNCALIBRATED",
      "LOW_CONFIDENCE",
    ];
    ocrPreview.evidence.CT01.source_region = "data_table";
    ocrPreview.evidence.CT01.extractor = "gemini_multimodal";
    ocrPreview.evidence.CT01.version = "2.1";
    ocrPreview.extractor_versions = ["gemini_multimodal:2.1"];
    mockedApiUpload.mockResolvedValue(new Response(
      JSON.stringify(ocrPreview),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const { container } = render(
      <UploadReport onDataExtracted={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    await waitFor(() => expect(input).toHaveAttribute("accept", expect.stringContaining(".jpg")));

    fireEvent.change(input!, {
      target: { files: [new File(["image"], "bao-cao.jpg", { type: "image/jpeg" })] },
    });

    expect(await screen.findByText(/Độ tin cậy do hệ thống nhận dạng cung cấp/)).toBeInTheDocument();
    expect(screen.getByText(/Độ tin cậy nhận dạng thấp/)).toBeInTheDocument();
    expect(screen.getAllByText(/Nhận dạng hình ảnh · phiên bản 2.1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/trang 1 · vùng bảng số liệu/)).toBeInTheDocument();
    expect(screen.queryByText(/AI_CONFIDENCE_UNCALIBRATED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/LOW_CONFIDENCE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/gemini_multimodal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/data_table/)).not.toBeInTheDocument();
  });

  it("explains when OCR awaits server-side provider configuration", async () => {
    mockedApiJson.mockResolvedValue({
      ocr_preview_enabled: false,
      ocr_setup_status: "provider_not_configured",
    });
    const { container } = render(
      <UploadReport onDataExtracted={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await screen.findByText(/sau khi quản trị hoàn tất cấu hình dịch vụ/);

    fireEvent.change(input!, {
      target: { files: [new File(["image"], "bao-cao.png", { type: "image/png" })] },
    });

    expect(screen.getByText(/đang chờ quản trị cấu hình dịch vụ trên máy chủ/)).toBeInTheDocument();
    expect(mockedApiUpload).not.toHaveBeenCalled();
  });

  it("retries an OCR failure through the OCR endpoint instead of Excel", async () => {
    mockedApiJson.mockResolvedValue({
      ocr_preview_enabled: true,
      ocr_setup_status: "ready",
    });
    mockedApiUpload.mockResolvedValue(new Response(
      JSON.stringify({ detail: "OCR processing failed" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    ));
    const { container } = render(
      <UploadReport onDataExtracted={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await waitFor(() => expect(input).toHaveAttribute("accept", ".xlsx,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.pdf"));

    fireEvent.change(input!, {
      target: { files: [new File(["image"], "bao-cao.jpg", { type: "image/jpeg" })] },
    });
    const retry = await screen.findByRole("button", { name: "Thử tải lại" });
    fireEvent.click(retry);

    await waitFor(() => expect(mockedApiUpload).toHaveBeenCalledTimes(2));
    expect(mockedApiUpload).toHaveBeenNthCalledWith(
      1,
      "/reports/ocr-preview",
      expect.any(FormData),
      expect.any(Function),
    );
    expect(mockedApiUpload).toHaveBeenNthCalledWith(
      2,
      "/reports/ocr-preview",
      expect.any(FormData),
      expect.any(Function),
    );
  });

  it("accepts an Excel preview with signed review evidence", async () => {
    mockedApiUpload.mockResolvedValue(new Response(
      JSON.stringify(previewResponse()),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const { container } = render(
      <UploadReport onDataExtracted={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, {
      target: { files: [new File(["xlsx"], "bao-cao.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })] },
    });

    await waitFor(() => expect(mockedApiUpload).toHaveBeenCalledWith(
      "/reports/excel-preview",
      expect.any(FormData),
      expect.any(Function),
    ));
    expect(await screen.findByText(/Kết quả trích xuất/)).toBeInTheDocument();
    expect(screen.getByText("bao-cao.xlsx")).toBeInTheDocument();
    expect(screen.getByText("Tổng số nhân khẩu (Người)")).toBeInTheDocument();
    expect(screen.getByText("Số trẻ em dưới 16 tuổi (Người)")).toBeInTheDocument();
  });
});

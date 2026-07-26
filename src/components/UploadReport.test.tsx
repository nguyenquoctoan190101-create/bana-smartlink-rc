import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UploadReport from "./UploadReport";
import { apiUpload } from "../lib/apiClient";

vi.mock("../lib/apiClient", () => ({
  apiUpload: vi.fn(),
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

const mockedApiUpload = vi.mocked(apiUpload);

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
  };
}

describe("UploadReport", () => {
  beforeEach(() => {
    mockedApiUpload.mockReset();
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

    expect(screen.getByText(/Nhận dạng ảnh\/PDF đang khóa/)).toBeInTheDocument();
    expect(mockedApiUpload).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("accept", ".xlsx");
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
  });
});

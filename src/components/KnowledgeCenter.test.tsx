import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import KnowledgeCenter from "./KnowledgeCenter";

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
  loadVillages: vi.fn(),
}));

vi.mock("../lib/apiClient", () => ({
  apiJson: mocks.apiJson,
  toUserFacingError: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock("../lib/useVillages", () => ({
  loadVillages: mocks.loadVillages,
}));

afterEach(() => {
  cleanup();
  mocks.apiJson.mockReset();
  mocks.loadVillages.mockReset();
});

describe("KnowledgeCenter role boundaries", () => {
  it("describes only the content available to village officers", async () => {
    mocks.apiJson.mockResolvedValue([]);

    render(<KnowledgeCenter role="can_bo_thon" />);

    expect(
      await screen.findByText(
        "Tài liệu nghiệp vụ và mạng lưới hỗ trợ dành cho cán bộ thôn.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/điểm sơ tán được trình bày/)).not.toBeInTheDocument();
    expect(mocks.loadVillages).not.toHaveBeenCalled();
  });

  it("does not request the administrator officer directory for leadership", async () => {
    mocks.apiJson.mockResolvedValue([]);
    mocks.loadVillages.mockResolvedValue([]);

    render(<KnowledgeCenter role="lanh_dao" />);

    await screen.findByRole("heading", {
      name: "Kho tri thức và mạng lưới hỗ trợ",
    });
    await waitFor(() =>
      expect(mocks.apiJson).toHaveBeenCalledWith(
        "/api/pilots/evacuation-points/admin",
      ),
    );
    expect(mocks.apiJson).not.toHaveBeenCalledWith("/auth/officers");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("allows scenario decreases inside the backend-supported range", async () => {
    mocks.loadVillages.mockResolvedValue([]);
    mocks.apiJson.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/api/knowledge/scenarios" && !options) {
        return Promise.resolve([
          { id: "scenario-1", name: "Phương án giảm", status: "draft" },
        ]);
      }
      if (path === "/api/knowledge/scenarios/scenario-1/run") {
        return Promise.resolve({ result: { projection: { population: 950 } } });
      }
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    render(<KnowledgeCenter role="admin_xa" scenarioEnabled />);

    await screen.findByRole("button", { name: "Chạy mô phỏng" });
    const populationChange = screen.getByLabelText("Thay đổi dân số (%)");
    await user.clear(populationChange);
    await user.type(populationChange, "-5");
    await user.click(screen.getByRole("button", { name: "Chạy mô phỏng" }));

    await waitFor(() =>
      expect(mocks.apiJson).toHaveBeenCalledWith(
        "/api/knowledge/scenarios/scenario-1/run",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const runCall = mocks.apiJson.mock.calls.find(
      ([path]) => path === "/api/knowledge/scenarios/scenario-1/run",
    );
    expect(JSON.parse(runCall?.[1]?.body as string)).toMatchObject({
      assumptions: { population_change_pct: -5 },
    });
  });

  it("blocks out-of-range evacuation coordinates before saving", async () => {
    mocks.apiJson.mockResolvedValue([]);
    mocks.loadVillages.mockResolvedValue([
      { id: "village-1", name: "Thôn An Sơn" },
    ]);
    const user = userEvent.setup();
    render(<KnowledgeCenter role="admin_xa" />);

    await screen.findByText("Tạo điểm sơ tán chờ xác minh");
    await user.click(screen.getByText("Tạo điểm sơ tán chờ xác minh"));
    await user.selectOptions(screen.getByLabelText("Thôn"), "village-1");
    await user.type(screen.getByLabelText("Tên điểm sơ tán"), "Nhà văn hóa");
    await user.type(screen.getByLabelText("Vĩ độ"), "91");
    await user.type(screen.getByLabelText("Kinh độ"), "108.12");
    await user.type(screen.getByLabelText("Sức chứa (hộ)"), "100");
    await user.click(
      screen.getByRole("button", { name: "Lưu điểm chờ xác minh" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vĩ độ phải từ -90 đến 90",
    );
    expect(
      mocks.apiJson.mock.calls.some(
        ([path, options]) =>
          path === "/api/pilots/evacuation-points"
          && options?.method === "POST",
      ),
    ).toBe(false);
  });
});

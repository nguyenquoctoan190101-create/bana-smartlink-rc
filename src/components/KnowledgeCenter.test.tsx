import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KnowledgeCenter from "./KnowledgeCenter";

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
  loadVillages: vi.fn(),
}));

vi.mock("../lib/apiClient", () => ({
  apiJson: mocks.apiJson,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
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
});

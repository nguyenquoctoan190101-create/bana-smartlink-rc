import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CitizenCasePanel from "./CitizenCasePanel";

vi.mock("../lib/apiClient", () => ({
  apiJson: vi.fn(),
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

describe("CitizenCasePanel", () => {
  it("selects the first village when the public catalogue finishes loading", async () => {
    const { rerender } = render(
      <CitizenCasePanel villages={[]} onBack={vi.fn()} />,
    );

    rerender(
      <CitizenCasePanel
        villages={[{ id: "village-1", name: "Thôn An Sơn" }]}
        onBack={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Thôn" })).toHaveValue(
        "village-1",
      ),
    );
  });
});

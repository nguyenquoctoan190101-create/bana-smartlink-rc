import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PublicVillagePage from "./PublicVillagePage";

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
  apiFetch: vi.fn(),
  loadVillages: vi.fn(),
}));

vi.mock("../lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/apiClient")>(
      "../lib/apiClient",
    );
  return {
    ...actual,
    apiJson: mocks.apiJson,
    apiFetch: mocks.apiFetch,
  };
});

vi.mock("../lib/useVillages", () => ({
  loadVillages: mocks.loadVillages,
}));

describe("PublicVillagePage navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadVillages.mockResolvedValue([
      { id: "village-1", name: "Thôn An Sơn" },
    ]);
    mocks.apiJson.mockResolvedValue([]);
  });

  it("shows four citizen tasks in the hero and switches to a compact subpage header", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PublicVillagePage onGoToLogin={vi.fn()} />,
    );

    const landingNavigation = screen.getByRole("navigation", {
      name: "Điều hướng cổng công khai",
    });
    expect(within(landingNavigation).getAllByRole("button")).toHaveLength(4);
    expect(
      within(landingNavigation).queryByRole("button", {
        name: "Đăng nhập cán bộ",
      }),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".public-hero")).toBeInTheDocument();

    await user.click(
      within(landingNavigation).getByRole("button", {
        name: "Tra cứu hồ sơ",
      }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Tra cứu hồ sơ" }),
    ).toHaveFocus();
    expect(container.querySelector(".public-hero")).not.toBeInTheDocument();
    expect(container.querySelector(".public-subpage-shell")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("navigation", {
          name: "Điều hướng cổng công khai",
        }),
      ).getAllByRole("button"),
    ).toHaveLength(4);
  });
});

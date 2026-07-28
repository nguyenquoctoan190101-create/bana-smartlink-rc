import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => cleanup());

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

  it("clearly marks example lookup codes and blocks them locally", async () => {
    const user = userEvent.setup();
    render(<PublicVillagePage onGoToLogin={vi.fn()} />);

    await user.click(
      within(
        screen.getByRole("navigation", {
          name: "Điều hướng cổng công khai",
        }),
      ).getByRole("button", { name: "Tra cứu hồ sơ" }),
    );

    expect(
      screen.getAllByText("Mã ví dụ — không dùng để tra cứu"),
    ).toHaveLength(2);
    const lookupInput = screen.getByRole("textbox", {
      name: "Mã tra cứu thật đã được cấp",
    });
    expect(lookupInput).toHaveAttribute(
      "placeholder",
      "Nhập mã thật đã được cấp (16 hoặc 32 ký tự)",
    );

    const callsBeforeLookup = mocks.apiJson.mock.calls.length;
    await user.type(lookupInput, "A1B2C3D4E5F6G7H8");
    await user.click(screen.getByRole("button", { name: "Tra cứu" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Đây là mã ví dụ để minh họa định dạng, không phải mã hồ sơ thật.",
    );
    expect(mocks.apiJson).toHaveBeenCalledTimes(callsBeforeLookup);
  });
});

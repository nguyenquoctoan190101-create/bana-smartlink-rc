import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
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

const publicMetadata = {
  schema_version: "public-report-v1",
  registry_version: "2026-07-28.1",
  source_label:
    "Báo cáo thôn có trạng thái đã công bố trên Ba Na SmartLink",
  indicators: [
    ["CT01", "Tổng số hộ dân", "Số hộ dân.", "hộ", "Không phải điểm."],
    ["CT02", "Tổng số nhân khẩu", "Số người.", "người", "Không phải điểm."],
    ["CT09", "Gia đình văn hóa", "Số hộ đạt.", "hộ", "Không xếp hạng."],
    ["CT12", "Tổ công nghệ số", "Số thành viên.", "người", "Số đếm."],
    ["CT13", "Người được hướng dẫn", "Số người trong kỳ.", "người/kỳ", "Số đếm."],
  ].map(([code, label, definition, unit, interpretation_limit]) => ({
    code,
    label,
    definition,
    unit,
    interpretation_limit,
  })),
};

describe("PublicVillagePage navigation", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadVillages.mockResolvedValue([
      { id: "village-1", name: "Thôn An Sơn" },
    ]);
    mocks.apiJson.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/reports/public/metadata" ? publicMetadata : [],
      ),
    );
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
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      result.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
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

  it("shows governed definitions and a safe download for the selected publication", async () => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path === "/reports/public/metadata") {
        return Promise.resolve(publicMetadata);
      }
      if (path === "/reports/public") {
        return Promise.resolve([
          {
            village_id: "village-1",
            report_period: "Tháng 7/2026",
            published_at: "2026-07-28T08:00:00+07:00",
            values: { CT01: 318 },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    render(<PublicVillagePage onGoToLogin={vi.fn()} />);

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Nguồn và phiên bản dữ liệu",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2026-07-28\.1/)).toBeInTheDocument();
    const definitions = screen.getByRole("region", {
      name: "Định nghĩa 5 chỉ tiêu công khai",
    });
    expect(
      within(definitions).getByRole("heading", {
        level: 2,
        name: "Định nghĩa 5 chỉ tiêu công khai",
      }),
    ).toBeInTheDocument();
    expect(within(definitions).getAllByRole("term")).toHaveLength(5);

    const download = screen.getByRole("link", {
      name: "Tải CSV công khai cho Thôn An Sơn, Tháng 7/2026",
    });
    expect(download).toHaveAttribute(
      "href",
      "/reports/public/export.csv?village_id=village-1&report_period=Th%C3%A1ng%207%2F2026",
    );
    expect(download).toHaveAttribute("download");
  });
});

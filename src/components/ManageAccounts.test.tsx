import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManageAccounts from "./ManageAccounts";

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }));

const villages = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Thôn Một" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Thôn Hai" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Thôn Ba" },
];

vi.mock("../lib/apiClient", () => ({
  apiJson: mocks.apiJson,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

vi.mock("../lib/useVillages", () => ({
  useVillages: () => ({ villages }),
}));

function installApiMock() {
  mocks.apiJson.mockImplementation((path: string, options?: RequestInit) => {
    if (path === "/auth/officers") return Promise.resolve([]);
    if (path === "/auth/staff-users" && options?.method === "POST") {
      const payload = JSON.parse(String(options.body));
      const scope =
        payload.role === "can_bo_thon"
          ? "single_village"
          : payload.role === "to_cnscd"
            ? "assigned_villages"
            : "commune";
      return Promise.resolve({
        user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        role: payload.role,
        scope,
        village_id:
          payload.role === "can_bo_thon" ? payload.village_ids[0] : null,
        village_ids: payload.village_ids,
        force_password_reset: true,
        temporary_password: "Temp-Password9",
      });
    }
    return Promise.reject(new Error(`Unexpected request: ${path}`));
  });
}

async function openAndFillForm() {
  const user = userEvent.setup();
  render(<ManageAccounts />);
  await user.click(
    screen.getByRole("button", { name: "Cấp tài khoản mới" }),
  );
  await user.type(screen.getByPlaceholderText("vd: Nguyễn Văn A"), "Nguyễn Văn A");
  await user.type(
    screen.getByPlaceholderText("vd: canbo.tanlang@bana.gov.vn"),
    "canbo@example.gov.vn",
  );
  await user.type(screen.getByPlaceholderText("vd: 0905123456"), "0901234567");
  return user;
}

function submittedPayload() {
  const call = mocks.apiJson.mock.calls.find(
    ([path, options]) =>
      path === "/auth/staff-users" && options?.method === "POST",
  );
  expect(call).toBeDefined();
  return JSON.parse(String(call?.[1]?.body));
}

describe("ManageAccounts role-specific scopes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installApiMock();
  });

  afterEach(() => cleanup());

  it("submits exactly one village for a village officer", async () => {
    const user = await openAndFillForm();

    await user.selectOptions(
      screen.getByLabelText("Thôn duy nhất cán bộ thôn phụ trách"),
      villages[1].id,
    );
    await user.click(
      screen.getByRole("button", { name: /Tạo tài khoản và mật khẩu tạm/i }),
    );

    await waitFor(() => expect(submittedPayload()).toMatchObject({
      role: "can_bo_thon",
      village_ids: [villages[1].id],
    }));
    expect((await screen.findAllByText("Cán bộ thôn")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Thôn Hai").length).toBeGreaterThan(0);
  });

  it("lets a CNSCĐ member receive multiple explicit villages", async () => {
    const user = await openAndFillForm();
    await user.selectOptions(
      screen.getByLabelText("Phân quyền chức vụ:"),
      "to_cnscd",
    );
    await user.click(screen.getByRole("checkbox", { name: "Thôn Hai" }));

    expect(screen.getByText("Đã chọn 2/3 thôn")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Tạo tài khoản và mật khẩu tạm/i }),
    );

    await waitFor(() => expect(submittedPayload()).toMatchObject({
      role: "to_cnscd",
      village_ids: [villages[0].id, villages[1].id],
    }));
  });

  it.each([
    ["admin_xa", "Cán bộ xã"],
    ["lanh_dao", "Lãnh đạo xã"],
  ])("uses automatic commune scope for %s", async (role, roleLabel) => {
    const user = await openAndFillForm();
    await user.selectOptions(
      screen.getByLabelText("Phân quyền chức vụ:"),
      role,
    );

    expect(
      screen.getByText("Phạm vi toàn xã được gán tự động"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Tạo tài khoản và mật khẩu tạm/i }),
    );

    await waitFor(() => expect(submittedPayload()).toMatchObject({
      role,
      village_ids: [],
    }));
    expect((await screen.findAllByText(roleLabel)).length).toBeGreaterThan(0);
    expect(screen.getByText("Toàn xã · 3/3 thôn")).toBeInTheDocument();
  });
});

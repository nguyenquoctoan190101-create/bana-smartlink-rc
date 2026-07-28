import { describe, expect, it } from "vitest";
import {
  getRoleLabel,
  getRoleScope,
  resolveRoleVillageIds,
} from "./rolePresentation";

describe("role presentation", () => {
  it("labels all staff roles in Vietnamese", () => {
    expect(getRoleLabel("admin_xa")).toBe("Cán bộ xã");
    expect(getRoleLabel("to_cnscd")).toBe("Tổ công nghệ số cộng đồng");
    expect(getRoleLabel("lanh_dao")).toBe("Lãnh đạo xã");
  });

  it("makes mutation boundaries explicit", () => {
    expect(getRoleScope("admin_xa")).toContain("duyệt, khóa và công bố");
    expect(getRoleScope("lanh_dao")).toContain(
      "Không nhập, sửa, duyệt, khóa hoặc công bố báo cáo",
    );
    expect(getRoleScope("lanh_dao")).toContain(
      "chỉ quyết định yêu cầu thay đổi kỳ",
    );
    expect(getRoleScope("to_cnscd")).toContain("Không có quyền duyệt");
  });

  it("keeps village officers in one village and preserves all CNSCĐ assignments", () => {
    expect(
      resolveRoleVillageIds("can_bo_thon", "village-primary", ["village-other"]),
    ).toEqual(["village-primary"]);
    expect(
      resolveRoleVillageIds("to_cnscd", "village-primary", [
        "village-2",
        "village-primary",
        "village-1",
      ]),
    ).toEqual(["village-1", "village-2", "village-primary"]);
    expect(resolveRoleVillageIds("lanh_dao", null, ["village-1"])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { getRoleLabel, getRoleScope } from "./rolePresentation";

describe("role presentation", () => {
  it("labels all staff roles in Vietnamese", () => {
    expect(getRoleLabel("admin_xa")).toBe("Quản trị xã");
    expect(getRoleLabel("to_cnscd")).toBe("Tổ công nghệ số cộng đồng");
    expect(getRoleLabel("lanh_dao")).toBe("Lãnh đạo xã");
  });

  it("makes mutation boundaries explicit", () => {
    expect(getRoleScope("admin_xa")).toContain("duyệt, khóa và công bố");
    expect(getRoleScope("lanh_dao")).toContain("Không sửa dữ liệu");
    expect(getRoleScope("to_cnscd")).toContain("Không có quyền duyệt");
  });
});

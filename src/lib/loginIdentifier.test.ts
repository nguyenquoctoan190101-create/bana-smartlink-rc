import { describe, expect, it } from "vitest";
import { resolveStaffLoginEmail } from "./loginIdentifier";

describe("resolveStaffLoginEmail", () => {
  it("accepts and normalizes formatted staff phone numbers", () => {
    expect(resolveStaffLoginEmail(" 0901 234 567 ")).toBe(
      "0901234567@bana.local",
    );
    expect(resolveStaffLoginEmail("+84 901 234 567")).toBe(
      "0901234567@bana.local",
    );
  });

  it("accepts a real email address without changing its domain", () => {
    expect(resolveStaffLoginEmail("CanBo@BANA.GOV.VN")).toBe(
      "canbo@bana.gov.vn",
    );
  });

  it("rejects malformed identifiers before contacting authentication", () => {
    expect(resolveStaffLoginEmail("123")).toBeNull();
    expect(resolveStaffLoginEmail("canbo@")).toBeNull();
  });
});

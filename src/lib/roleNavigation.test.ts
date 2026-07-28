import { describe, expect, it } from "vitest";
import {
  allowedTabsForRole,
  APP_TAB_TITLES,
  DEFAULT_TAB_BY_ROLE,
  isTabAllowedForRole,
} from "./roleNavigation";

describe("role navigation", () => {
  it("keeps commune administrators inside administrative workflows", () => {
    const tabs = allowedTabsForRole("admin_xa");

    expect(tabs).toEqual(
      new Set([
        "dashboard",
        "progress-dashboard",
        "policy-scorecard",
        "cnscd-impact",
        "create-period",
        "admin-panel",
        "pending-updates",
        "operations",
        "legacy-import",
        "knowledge",
        "cases",
        "record-lookup",
      ]),
    );
    expect(tabs.has("report-form")).toBe(false);
    expect(tabs.has("period-change-requests")).toBe(false);
  });

  it("limits CNSCĐ members to assigned-village support workflows", () => {
    expect(allowedTabsForRole("to_cnscd")).toEqual(
      new Set([
        "dashboard",
        "report-form",
        "cnscd-impact",
        "citizen-proposal",
        "operations",
        "knowledge",
        "cases",
        "record-lookup",
      ]),
    );
    expect(isTabAllowedForRole("to_cnscd", "admin-panel")).toBe(false);
    expect(isTabAllowedForRole("to_cnscd", "pending-updates")).toBe(false);
    expect(isTabAllowedForRole("to_cnscd", "policy-scorecard")).toBe(false);
  });

  it("keeps leadership read-only except for governed period decisions", () => {
    const tabs = allowedTabsForRole("lanh_dao");

    expect(tabs.has("period-change-requests")).toBe(true);
    expect(tabs.has("report-form")).toBe(false);
    expect(tabs.has("pending-updates")).toBe(false);
    expect(tabs.has("create-period")).toBe(false);
    expect(tabs.has("admin-panel")).toBe(false);
    expect(tabs.has("legacy-import")).toBe(false);
  });

  it("exposes pilot workspaces only to commune administrators and leaders when enabled", () => {
    expect(isTabAllowedForRole("admin_xa", "pilots")).toBe(false);
    expect(isTabAllowedForRole("lanh_dao", "pilots")).toBe(false);
    expect(isTabAllowedForRole("admin_xa", "pilots", true)).toBe(true);
    expect(isTabAllowedForRole("lanh_dao", "pilots", true)).toBe(true);
    expect(isTabAllowedForRole("to_cnscd", "pilots", true)).toBe(false);
  });

  it("has a titled, permitted default destination for every role", () => {
    for (const [role, defaultTab] of Object.entries(DEFAULT_TAB_BY_ROLE)) {
      expect(APP_TAB_TITLES[defaultTab]).toBeTruthy();
      expect(isTabAllowedForRole(role as keyof typeof DEFAULT_TAB_BY_ROLE, defaultTab)).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { PUBLIC_INDICATOR_CODES, workflowStatusOf } from "./types";

describe("frontend privacy and workflow contract", () => {
  it("exposes exactly the five approved public indicators", () => {
    expect(PUBLIC_INDICATOR_CODES).toEqual(["CT01", "CT02", "CT09", "CT12", "CT13"]);
    expect(PUBLIC_INDICATOR_CODES).not.toContain("CT14");
  });

  it("normalizes old offline draft statuses without mixing timeliness", () => {
    expect(workflowStatusOf({ workflow_status: "draft", status: "tre_han" })).toBe("draft");
    expect(workflowStatusOf({ workflow_status: "submitted", status: "dung_han" })).toBe("submitted");
  });
});

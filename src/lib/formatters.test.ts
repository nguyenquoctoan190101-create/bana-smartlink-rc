import { describe, expect, it } from "vitest";
import {
  formatViFlexiblePercent,
  formatViNumber,
  formatViPercent,
  localizePercentagesInText,
} from "./formatters";

describe("Vietnamese number presentation", () => {
  it("uses dots for thousands and commas for decimals", () => {
    expect(formatViNumber(1176)).toBe("1.176");
    expect(formatViNumber(3.77, 2)).toBe("3,77");
    expect(formatViPercent(95, 1)).toBe("95,0%");
  });

  it("keeps whole percentages compact and localizes decimal percentages", () => {
    expect(formatViFlexiblePercent(100)).toBe("100%");
    expect(formatViFlexiblePercent(92.9)).toBe("92,9%");
    expect(
      localizePercentagesInText(
        "Điểm chất lượng 100.0%; độ phủ 92.9%; phiên bản 1.2.",
      ),
    ).toBe("Điểm chất lượng 100,0%; độ phủ 92,9%; phiên bản 1.2.");
  });
});

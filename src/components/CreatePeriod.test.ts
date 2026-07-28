import { describe, expect, it } from "vitest";
import { parseVietnameseDeadline } from "./CreatePeriod";

describe("parseVietnameseDeadline", () => {
  it("parses the documented Vietnamese date and time format", () => {
    const result = parseVietnameseDeadline("31/08/2026 17:00");

    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(7);
    expect(result?.getDate()).toBe(31);
    expect(result?.getHours()).toBe(17);
    expect(result?.getMinutes()).toBe(0);
  });

  it.each([
    "08/31/2026 17:00",
    "31/02/2026 17:00",
    "31/08/2026",
    "31/08/2026 25:00",
    "",
  ])("rejects an invalid or non-Vietnamese value: %s", (value) => {
    expect(parseVietnameseDeadline(value)).toBeNull();
  });
});

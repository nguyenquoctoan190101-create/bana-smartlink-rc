import { render } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import PrivacyPolicy from "./PrivacyPolicy";

describe("PrivacyPolicy accessibility", () => {
  it("has no serious or critical axe violations when its dialog is open", async () => {
    const { container } = render(<PrivacyPolicy isOpen onClose={() => undefined} />);
    const result = await axe.run(container, {
      rules: {
        // jsdom does not implement canvas; contrast is exercised in browser QA.
        "color-contrast": { enabled: false },
      },
    });
    const blocking = result.violations.filter(({ impact }) => impact === "serious" || impact === "critical");

    expect(blocking).toEqual([]);
  });
});

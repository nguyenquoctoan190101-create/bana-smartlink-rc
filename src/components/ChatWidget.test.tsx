import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ChatWidget from "./ChatWidget";


describe("ChatWidget suggestions", () => {
  afterEach(() => cleanup());

  it("shows only public-safe indicator suggestions to citizens", () => {
    render(<ChatWidget userPhone={null} />);

    expect(
      screen.getByRole("button", { name: "Thôn Phú Hòa có bao nhiêu hộ dân?" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Thôn tôi có bao nhiêu hộ nghèo?" }),
    ).not.toBeInTheDocument();
  });

  it("shows internal workflow suggestions to authenticated staff", () => {
    render(<ChatWidget userPhone="0900000101" />);

    expect(
      screen.getByRole("button", { name: "Thôn tôi có bao nhiêu hộ nghèo?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Thôn nào chưa nộp báo cáo kỳ này?" }),
    ).toBeInTheDocument();
  });
});

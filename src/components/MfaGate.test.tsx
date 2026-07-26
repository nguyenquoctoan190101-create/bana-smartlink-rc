import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MfaGate from "./MfaGate";
import { supabase } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      mfa: {
        enroll: vi.fn(),
        listFactors: vi.fn(),
        unenroll: vi.fn(),
        challengeAndVerify: vi.fn(),
      },
    },
  },
}));

const enroll = vi.mocked(supabase.auth.mfa.enroll);
const listFactors = vi.mocked(supabase.auth.mfa.listFactors);
const unenroll = vi.mocked(supabase.auth.mfa.unenroll);
const challengeAndVerify = vi.mocked(supabase.auth.mfa.challengeAndVerify);

describe("MfaGate", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    enroll.mockReset();
    listFactors.mockReset();
    unenroll.mockReset();
    challengeAndVerify.mockReset();
    listFactors.mockResolvedValue({
      data: { all: [], totp: [], phone: [] },
      error: null,
    } as never);
  });

  it("requires a six-digit TOTP challenge before continuing", async () => {
    challengeAndVerify.mockResolvedValue({ data: {}, error: null } as never);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <MfaGate
        status="challenge_required"
        factorId="factor-verified"
        onRefresh={onRefresh}
        onLogout={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Mã bảo mật 6 chữ số");
    fireEvent.change(input, { target: { value: "12x34567" } });
    expect(input).toHaveValue("123456");
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và tiếp tục" }));

    await waitFor(() => expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: "factor-verified",
      code: "123456",
    }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("shows the Supabase TOTP QR enrollment without exposing a password", async () => {
    enroll.mockResolvedValue({
      data: {
        id: "factor-new",
        type: "totp",
        friendly_name: "Ba Na SmartLink",
        totp: {
          qr_code: "data:image/svg+xml;base64,PHN2Zy8+",
          secret: "ABCDEF123456",
          uri: "otpauth://totp/BaNa",
        },
      },
      error: null,
    });
    render(
      <MfaGate
        status="setup_required"
        factorId={null}
        onRefresh={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tạo mã QR bảo mật" }));
    expect(await screen.findByAltText(/Mã QR/)).toHaveAttribute(
      "src",
      "data:image/svg+xml;base64,PHN2Zy8+",
    );
    expect(screen.getByText("ABCDEF123456")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Mật khẩu/)).not.toBeInTheDocument();
  });

  it("removes an interrupted TOTP setup before creating a new QR code", async () => {
    listFactors.mockResolvedValue({
      data: {
        all: [{ id: "factor-stale", status: "unverified", factor_type: "totp" }],
        totp: [],
        phone: [],
      },
      error: null,
    } as never);
    unenroll.mockResolvedValue({ data: {}, error: null } as never);
    enroll.mockResolvedValue({
      data: {
        id: "factor-new",
        type: "totp",
        totp: {
          qr_code: "data:image/svg+xml;base64,PHN2Zy8+",
          secret: "NEWSECRET",
          uri: "otpauth://totp/BaNa",
        },
      },
      error: null,
    } as never);

    render(
      <MfaGate
        status="setup_required"
        factorId={null}
        onRefresh={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tạo mã QR bảo mật" }));

    await waitFor(() => expect(unenroll).toHaveBeenCalledWith({ factorId: "factor-stale" }));
    expect(await screen.findByText("NEWSECRET")).toBeInTheDocument();
  });
});

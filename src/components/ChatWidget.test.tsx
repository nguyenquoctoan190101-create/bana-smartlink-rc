import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatWidget from "./ChatWidget";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("../lib/apiClient", () => ({
  apiFetch: mocks.apiFetch,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ChatWidget suggestions", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.apiFetch.mockResolvedValue(jsonResponse({ voice_enabled: false }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows only public-safe indicator suggestions to citizens", () => {
    render(<ChatWidget userPhone={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));

    expect(
      screen.getByRole("button", { name: "Thôn Phú Hòa có bao nhiêu hộ dân?" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Thôn tôi có bao nhiêu hộ nghèo?" }),
    ).not.toBeInTheDocument();

    expect(
      screen.getByText(
        "Không nhập họ tên, số điện thoại, địa chỉ hoặc số giấy tờ cá nhân.",
      ),
    ).toBeInTheDocument();
  });

  it("shows internal workflow suggestions to authenticated staff", () => {
    render(<ChatWidget userPhone="0900000101" />);
    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));

    expect(
      screen.getByRole("button", { name: "Thôn tôi có bao nhiêu hộ nghèo?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Thôn nào chưa nộp báo cáo kỳ này?" }),
    ).toBeInTheDocument();
  });

  it("hides the closed panel from keyboard users and restores focus after Escape", async () => {
    render(<ChatWidget userPhone={null} />);
    const toggle = screen.getByRole("button", { name: "Mở tra cứu số liệu" });

    expect(screen.queryByRole("dialog", { name: "Tra cứu số liệu" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: "Tra cứu số liệu" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Tra cứu số liệu" })).not.toBeInTheDocument();
      expect(toggle).toHaveFocus();
    });
  });

  it("keeps voice input hidden when the backend feature flag is disabled", async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ voice_enabled: false }));
    render(<ChatWidget userPhone={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith("/ai/capabilities"));
    expect(
      screen.queryByRole("button", { name: "Nhập câu hỏi bằng giọng nói" }),
    ).not.toBeInTheDocument();
  });

  it("uses a compact launcher on forms and moves above visible action controls", async () => {
    const task = document.createElement("main");
    const form = document.createElement("form");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Gửi báo cáo";
    submit.getBoundingClientRect = () =>
      ({
        bottom: 756,
        height: 56,
        left: 16,
        right: 374,
        top: 700,
        width: 358,
        x: 16,
        y: 700,
        toJSON: () => ({}),
      }) as DOMRect;
    form.append(submit);
    task.append(form);
    document.body.append(task);

    const { container } = render(<ChatWidget userPhone={null} />);
    const widget = container.querySelector("#chat-widget-root");

    await waitFor(() => {
      expect(widget).toHaveAttribute("data-layout", "compact");
      expect(widget).toHaveClass("chat-widget--avoiding-actions");
      expect(widget).toHaveStyle({
        "--chat-widget-avoidance-offset": "80px",
      });
    });

    task.remove();
  });

  it("shows voice input only after the backend feature flag is enabled", async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ voice_enabled: true }));
    render(<ChatWidget userPhone={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));

    expect(
      await screen.findByRole("button", { name: "Nhập câu hỏi bằng giọng nói" }),
    ).toBeInTheDocument();
  });

  it("uses the branded logo and prefers a labelled Da Nang voice for answers", async () => {
    class FakeSpeechSynthesisUtterance {
      text: string;
      lang = "";
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      onstart: ((event: Event) => void) | null = null;
      onend: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }
    const daNangVoice = {
      default: false,
      lang: "vi-VN",
      localService: true,
      name: "Da Nang Central Vietnamese",
      voiceURI: "local-da-nang",
    } as SpeechSynthesisVoice;
    const speak = vi.fn((utterance: FakeSpeechSynthesisUtterance) => {
      utterance.onstart?.(new Event("start"));
    });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeSpeechSynthesisUtterance);
    vi.stubGlobal("speechSynthesis", {
      cancel: vi.fn(),
      getVoices: vi.fn(() => [daNangVoice]),
      speak,
    });
    mocks.apiFetch
      .mockResolvedValueOnce(jsonResponse({ voice_enabled: true }))
      .mockResolvedValueOnce(jsonResponse({
        answer: "Toàn xã có 18.359 nhân khẩu.",
        intent: "COMMUNE_INDICATOR",
        rows_retrieved: 1,
        sources: [],
        data_scope: "public_published",
        limitations: [],
      }));

    const { container } = render(<ChatWidget userPhone={null} />);
    expect(container.querySelector('img[src="/images/ba-na-brand-mark-96.png"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));
    await screen.findByRole("button", { name: "Nhập câu hỏi bằng giọng nói" });
    fireEvent.click(screen.getByRole("button", { name: "Toàn xã có bao nhiêu nhân khẩu?" }));
    fireEvent.click(await screen.findByRole("button", { name: "Đọc câu trả lời bằng giọng nói" }));

    expect(speak).toHaveBeenCalledTimes(1);
    const utterance = speak.mock.calls[0][0];
    expect(utterance.lang).toBe("vi-VN");
    expect(utterance.voice).toBe(daNangVoice);
    expect(
      await screen.findByText(/Giọng miền Trung: Da Nang Central Vietnamese/),
    ).toBeInTheDocument();
  });

  it("never falls back to an English voice when Vietnamese is unavailable", async () => {
    class FakeSpeechSynthesisUtterance {
      lang = "";
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      onstart: ((event: Event) => void) | null = null;
      onend: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
    }
    const englishVoice = {
      default: true,
      lang: "en-US",
      localService: true,
      name: "English default",
      voiceURI: "local-english",
    } as SpeechSynthesisVoice;
    const speak = vi.fn();
    vi.stubGlobal("SpeechSynthesisUtterance", FakeSpeechSynthesisUtterance);
    vi.stubGlobal("speechSynthesis", {
      cancel: vi.fn(),
      getVoices: vi.fn(() => [englishVoice]),
      onvoiceschanged: null,
      speak,
    });
    mocks.apiFetch
      .mockResolvedValueOnce(jsonResponse({ voice_enabled: true }))
      .mockResolvedValueOnce(jsonResponse({
        answer: "Toàn xã có 18.359 nhân khẩu.",
        intent: "COMMUNE_INDICATOR",
        rows_retrieved: 1,
        sources: [],
        data_scope: "public_published",
        limitations: [],
      }));

    render(<ChatWidget userPhone={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));
    expect(
      await screen.findByText(/không dùng giọng tiếng Anh thay thế/, {}, { timeout: 1600 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toàn xã có bao nhiêu nhân khẩu?" }));

    const readButton = await screen.findByRole("button", {
      name: "Đọc câu trả lời bằng giọng nói",
    });
    expect(readButton).toBeDisabled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("plays signed Vietnamese server audio when the device has no voice", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    class FakeAudio {
      currentTime = 0;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play = play;
      pause = pause;
    }
    vi.stubGlobal("Audio", FakeAudio);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:server-speech"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    mocks.apiFetch
      .mockResolvedValueOnce(jsonResponse({
        voice_enabled: true,
        server_tts_enabled: true,
        tts_provider: "gemini",
      }))
      .mockResolvedValueOnce(jsonResponse({
        answer: "Toàn xã có 18.359 nhân khẩu.",
        intent: "COMMUNE_INDICATOR",
        rows_retrieved: 1,
        sources: [],
        data_scope: "public_published",
        limitations: [],
        speech_token: "signed-speech-token",
      }))
      .mockResolvedValueOnce(new Response(new Blob(["wave"]), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      }));

    render(<ChatWidget userPhone={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));
    expect(
      await screen.findByText(/Giọng tiếng Việt từ máy chủ/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toàn xã có bao nhiêu nhân khẩu?" }));

    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenLastCalledWith("/ai/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "signed-speech-token" }),
      });
    });
    expect(play).not.toHaveBeenCalled();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Đọc câu trả lời bằng giọng nói",
      }),
    );

    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1);
    });
  });

  it("renders the source, update time, scope and limitations returned by the API", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(jsonResponse({ voice_enabled: false }))
      .mockResolvedValueOnce(jsonResponse({
        answer: "Thôn Phú Hòa có 120 hộ dân.",
        intent: "VILLAGE_INDICATOR",
        rows_retrieved: 1,
        sources: [{
          kind: "report_data",
          title: "CT01 — Số hộ dân",
          scope: "Thôn Phú Hòa",
          period: "Tháng 7/2026",
          reference: "CT01",
        }],
        as_of: "2026-07-25T08:00:00+00:00",
        data_scope: "public_published",
        limitations: ["Chỉ phản ánh dữ liệu đã công bố."],
      }));
    render(<ChatWidget userPhone={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith("/ai/capabilities"));
    fireEvent.click(
      screen.getByRole("button", { name: "Thôn Phú Hòa có bao nhiêu hộ dân?" }),
    );

    expect(await screen.findByText("CT01 — Số hộ dân")).toBeInTheDocument();
    expect(screen.getByText("Dữ liệu tổng hợp đã công bố")).toBeInTheDocument();
    expect(screen.getByText("Chỉ phản ánh dữ liệu đã công bố.")).toBeInTheDocument();
  });
});

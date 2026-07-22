import React, { useEffect, useRef, useState } from "react";
import { apiFetch, toUserFacingError } from "../lib/apiClient";
import "./ChatWidget.css";

/* ─────────────────────────── Types ─────────────────────────────────── */

type Message = {
  id: string;
  role: "user" | "bot";
  text: string;
  timestamp: Date;
  isLoading?: boolean;
};

type ChatWidgetProps = {
  /** xa_id scopes all DB queries to one commune. */
  xaId?: string;
  apiBaseUrl?: string;
  userPhone?: string | null;
};

type ApiResponse = {
  answer: string;
  intent: string;
  rows_retrieved: number;
};

/* ─────────────────────────── Constants ──────────────────────────────── */

const viteApiBaseUrl =
  (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env
    ?.VITE_API_BASE_URL ?? "";

/** Public suggestions must stay inside the five published indicators. */
const PUBLIC_SUGGESTED_QUESTIONS = [
  "Thôn Phú Hòa có bao nhiêu hộ dân?",
  "Toàn xã có bao nhiêu nhân khẩu?",
  "Thôn Phú Hòa có bao nhiêu gia đình văn hóa?",
  "Bạn biết những gì?",
];

const STAFF_SUGGESTED_QUESTIONS = [
  "Thôn tôi có bao nhiêu hộ nghèo?",
  "Thôn nào chưa nộp báo cáo kỳ này?",
  "Toàn xã có bao nhiêu nhân khẩu?",
  "So sánh hộ dân giữa Thôn An Sơn và Thôn Phú Hòa?",
];

const DISCLAIMER =
  "Câu trả lời dựa trên dữ liệu báo cáo, có thể chưa đầy đủ.";

let _msgCounter = 0;
function newId() {
  _msgCounter += 1;
  return `msg-${Date.now()}-${_msgCounter}`;
}

/* ─────────────────────────── Component ─────────────────────────────── */

export default function ChatWidget({
  xaId,
  apiBaseUrl = viteApiBaseUrl,
  userPhone,
}: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* Auto-scroll to bottom whenever messages change */
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  /* Focus input when panel opens */
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen]);

  function toggleVoiceInput() {
    const SpeechRecognition = (window as Window & { SpeechRecognition?: new () => { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void } }).SpeechRecognition;
    if (!SpeechRecognition) {
      setMessages((prev) => [...prev, { id: newId(), role: "bot", text: "Thiết bị chưa hỗ trợ nhập bằng giọng nói. Bạn có thể gõ câu hỏi để tiếp tục.", timestamp: new Date() }]);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "vi-VN"; recognition.interimResults = false;
    recognition.onresult = (event) => setInputText(Array.from(event.results).map((result) => result[0].transcript).join(" "));
    recognition.onend = () => setIsListening(false);
    setIsListening(true); recognition.start();
  }

  /* ── Send a question ────────────────────────────────────────────────── */
  async function sendQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isSending) return;

    const userMsg: Message = {
      id: newId(),
      role: "user",
      text: trimmed,
      timestamp: new Date(),
    };
    const loadingMsg: Message = {
      id: newId(),
      role: "bot",
      text: "",
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInputText("");
    setIsSending(true);

    try {
      const history = messages
        .filter((message) => !message.isLoading)
        .slice(-6)
        .map((message) => ({
          role: message.role === "user" ? "user" : "assistant",
          content: message.text.slice(0, 500),
        }));
      const response = await apiFetch("/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          xa_id: xaId ?? null,
          history,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        const detail =
          typeof errJson?.detail === "string"
            ? errJson.detail
            : "Hệ thống không phản hồi được. Vui lòng thử lại sau.";
        throw new Error(detail);
      }

      const data = (await response.json()) as ApiResponse;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, text: data.answer, isLoading: false }
            : m,
        ),
      );
    } catch (err) {
      const errorText = toUserFacingError(err, "Đã xảy ra lỗi. Vui lòng thử lại.");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, text: errorText, isLoading: false }
            : m,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }

  /* ── Keyboard: Enter sends, Shift+Enter = newline ───────────────────── */
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendQuestion(inputText);
    }
  }

  const showSuggestions = messages.length === 0;
  const suggestedQuestions = userPhone
    ? STAFF_SUGGESTED_QUESTIONS
    : PUBLIC_SUGGESTED_QUESTIONS;

  /* ─── Render ──────────────────────────────────────────────────────── */
  return (
    <div className="chat-widget" id="chat-widget-root">
      {/* ── Floating bubble button ── */}
      <button
        id="chat-widget-toggle"
        className={`chat-widget__fab${isOpen ? " chat-widget__fab--open" : ""}`}
        aria-label={isOpen ? "Đóng trợ lý ảo" : "Mở trợ lý ảo SmartLink"}
        aria-expanded={isOpen}
        aria-controls="chat-widget-panel"
        onClick={() => setIsOpen((v) => !v)}
      >
        {isOpen ? (
          /* Close X icon */
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          /* Chat bubble icon */
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 10H6V10h12v2zm0-3H6V7h12v2z" />
          </svg>
        )}
        {/* Unread badge — shown only when closed and there are messages */}
        {!isOpen && messages.length > 0 && (
          <span className="chat-widget__badge" aria-label="Có tin nhắn mới" />
        )}
      </button>

      {/* ── Chat panel ── */}
      <div
        id="chat-widget-panel"
        className={`chat-widget__panel${isOpen ? " chat-widget__panel--visible" : ""}`}
        role="dialog"
        aria-label="Trợ lý ảo SmartLink"
        aria-modal="false"
      >
        {/* Header */}
        <header className="chat-widget__header">
          <div className="chat-widget__header-avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
            </svg>
          </div>
          <div className="chat-widget__header-info">
            <p className="chat-widget__header-name">Trợ lý SmartLink</p>
            <p className="chat-widget__header-status">
              <span className="chat-widget__online-dot" aria-hidden="true" />
              Trực tuyến
            </p>
          </div>
          <button
            className="chat-widget__close-btn"
            aria-label="Đóng cửa sổ chat"
            onClick={() => setIsOpen(false)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {/* Message list */}
        <div
          className="chat-widget__messages"
          ref={listRef}
          aria-live="polite"
          aria-relevant="additions"
          role="log"
        >
          {/* Welcome message */}
          <div className="chat-widget__welcome">
            <p>
              Xin chào! Tôi là trợ lý dữ liệu của hệ thống <strong>Ba Na SmartLink</strong>.
              Hỏi tôi về số liệu báo cáo thôn nhé 👋
            </p>
          </div>

          {/* Suggested questions — only on first open */}
          {showSuggestions && (
            <div className="chat-widget__suggestions" aria-label="Gợi ý câu hỏi">
              <p className="chat-widget__suggestions-label">Bạn có thể hỏi:</p>
              <ul>
                {suggestedQuestions.map((q) => (
                  <li key={q}>
                    <button
                      id={`chat-suggest-${q.slice(0, 20).replace(/\s/g, "-")}`}
                      className="chat-widget__suggestion-btn"
                      onClick={() => void sendQuestion(q)}
                      disabled={isSending}
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Conversation messages */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-widget__bubble-wrap chat-widget__bubble-wrap--${msg.role}`}
            >
              {msg.role === "bot" && (
                <div className="chat-widget__bot-avatar" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                  </svg>
                </div>
              )}

              <div className="chat-widget__bubble-col">
                <div
                  className={`chat-widget__bubble chat-widget__bubble--${msg.role}`}
                  aria-label={msg.role === "user" ? "Bạn" : "Trợ lý"}
                >
                  {msg.isLoading ? (
                    <span className="chat-widget__typing" aria-label="Đang soạn tin">
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : (
                    <span className="chat-widget__bubble-text">{msg.text}</span>
                  )}
                </div>

                {/* Disclaimer shown under EVERY bot answer */}
                {msg.role === "bot" && !msg.isLoading && (
                  <p className="chat-widget__disclaimer">{DISCLAIMER}</p>
                )}

                <time
                  className="chat-widget__timestamp"
                  dateTime={msg.timestamp.toISOString()}
                >
                  {formatTime(msg.timestamp)}
                </time>
              </div>
            </div>
          ))}
        </div>

        {/* Input area */}
        <div className="chat-widget__input-area">
          <textarea
            id="chat-widget-input"
            ref={inputRef}
            className="chat-widget__input"
            placeholder="Nhập câu hỏi… (Enter để gửi)"
            value={inputText}
            rows={1}
            maxLength={500}
            aria-label="Nhập câu hỏi"
            disabled={isSending}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className={`chat-widget__voice-btn${isListening ? " chat-widget__voice-btn--active" : ""}`}
            aria-label={isListening ? "Đang nghe, bấm để dừng" : "Nhập câu hỏi bằng giọng nói"}
            title="Nhập bằng giọng nói (chỉ khi bạn bấm nút)"
            onClick={toggleVoiceInput}
            disabled={isSending}
          >
            {isListening ? "■" : "🎙"}
          </button>
          <button
            id="chat-widget-send"
            className="chat-widget__send-btn"
            aria-label="Gửi câu hỏi"
            disabled={!inputText.trim() || isSending}
            onClick={() => void sendQuestion(inputText)}
          >
            {isSending ? (
              <span className="chat-widget__spinner" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Helpers ───────────────────────────────── */

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

import React, { useEffect, useRef, useState } from "react";
import { LockKeyhole, Mic, Send, ShieldCheck, Square, Volume2, X } from "lucide-react";
import { apiFetch, toUserFacingError } from "../lib/apiClient";
import "./ChatWidget.css";

/* ─────────────────────────── Types ─────────────────────────────────── */

type Message = {
  id: string;
  role: "user" | "bot";
  text: string;
  timestamp: Date;
  isLoading?: boolean;
  sources?: ApiSource[];
  asOf?: string | null;
  dataScope?: string;
  limitations?: string[];
  speechToken?: string | null;
};

type ChatWidgetProps = {
  /** xa_id scopes all DB queries to one commune. */
  xaId?: string;
  apiBaseUrl?: string;
  userPhone?: string | null;
};

type ApiSource = {
  kind: "report_data" | "knowledge_article";
  title: string;
  scope: string;
  period?: string | null;
  reference?: string | null;
};

type ApiResponse = {
  answer: string;
  intent: string;
  rows_retrieved: number;
  sources?: ApiSource[];
  as_of?: string | null;
  data_scope?: string;
  limitations?: string[];
  speech_token?: string | null;
};

type ChatCapabilities = {
  voice_enabled: boolean;
  server_tts_enabled?: boolean;
  tts_provider?: "gemini" | "device_only";
};
type VoiceReadiness = "checking" | "ready" | "unavailable" | "unsupported";

type CachedSpeech = {
  token: string;
  blob?: Blob;
  promise?: Promise<Blob>;
};

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror?: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

/* ─────────────────────────── Constants ──────────────────────────────── */

const viteApiBaseUrl =
  (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env
    ?.VITE_API_BASE_URL ?? "";

/** Public suggestions must stay inside the five published indicators. */
const PUBLIC_SUGGESTED_QUESTIONS = [
  "Thôn Phú Hòa có bao nhiêu hộ dân?",
  "Toàn xã có bao nhiêu nhân khẩu?",
  "Thôn Phú Hòa có bao nhiêu gia đình văn hóa?",
  "Có thể tra cứu những chỉ tiêu nào?",
];

const STAFF_SUGGESTED_QUESTIONS = [
  "Thôn tôi có bao nhiêu hộ nghèo?",
  "Thôn nào chưa nộp báo cáo kỳ này?",
  "Toàn xã có bao nhiêu nhân khẩu?",
  "So sánh hộ dân giữa Thôn An Sơn và Thôn Phú Hòa?",
];

const DISCLAIMER =
  "Vui lòng đối chiếu dữ liệu hoặc tài liệu nguồn trước khi sử dụng.";

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
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [serverTtsEnabled, setServerTtsEnabled] = useState(false);
  const [localVoiceAvailable, setLocalVoiceAvailable] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [voiceReadiness, setVoiceReadiness] = useState<VoiceReadiness>("checking");
  const [voiceProfileLabel, setVoiceProfileLabel] = useState(
    "Đang kiểm tra giọng tiếng Việt trên thiết bị",
  );
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speechCacheRef = useRef<Map<string, CachedSpeech>>(new Map());

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setSpeakingMessageId(null);
  };

  const closeChat = () => {
    stopSpeaking();
    setIsOpen(false);
    window.requestAnimationFrame(() => toggleRef.current?.focus());
  };

  function prepareServerSpeech(
    messageId: string,
    speechToken: string,
  ): Promise<Blob> {
    const cached = speechCacheRef.current.get(messageId);
    if (cached?.token === speechToken) {
      if (cached.blob) return Promise.resolve(cached.blob);
      if (cached.promise) return cached.promise;
    }

    while (speechCacheRef.current.size >= 4) {
      const oldestMessageId = speechCacheRef.current.keys().next().value;
      if (typeof oldestMessageId !== "string") break;
      speechCacheRef.current.delete(oldestMessageId);
    }

    const request = apiFetch("/ai/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: speechToken }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("server speech unavailable");
        const audioBlob = await response.blob();
        if (!audioBlob.size) throw new Error("empty speech audio");
        const current = speechCacheRef.current.get(messageId);
        if (current?.token === speechToken) {
          speechCacheRef.current.set(messageId, {
            token: speechToken,
            blob: audioBlob,
          });
        }
        return audioBlob;
      })
      .catch((error: unknown) => {
        const current = speechCacheRef.current.get(messageId);
        if (current?.token === speechToken) {
          speechCacheRef.current.delete(messageId);
        }
        throw error;
      });

    speechCacheRef.current.set(messageId, {
      token: speechToken,
      promise: request,
    });
    return request;
  }

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

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeChat();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  /* The microphone stays hidden unless the backend explicitly enables it. */
  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    void apiFetch("/ai/capabilities")
      .then(async (response) => {
        if (!response.ok) return;
        const capabilities = (await response.json()) as ChatCapabilities;
        if (active) {
          setVoiceEnabled(capabilities.voice_enabled === true);
          setServerTtsEnabled(capabilities.server_tts_enabled === true);
        }
      })
      .catch(() => {
        if (active) setVoiceEnabled(false);
      });
    return () => {
      active = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      stopSpeaking();
      setIsListening(false);
      setVoiceEnabled(false);
      setServerTtsEnabled(false);
      setLocalVoiceAvailable(false);
      selectedVoiceRef.current = null;
      speechCacheRef.current.clear();
      setVoiceReadiness("checking");
    };
  }, [isOpen]);

  const canUseSpeechSynthesis =
    voiceEnabled &&
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;

  function chooseVietnameseVoice(
    voices: SpeechSynthesisVoice[],
  ): SpeechSynthesisVoice | null {
    const vietnameseVoices = voices.filter((voice) =>
      voice.lang.toLowerCase().startsWith("vi"),
    );
    const regionalMarkers = [
      "đà nẵng",
      "da nang",
      "miền trung",
      "mien trung",
      "central vietnam",
      "central vietnamese",
    ];
    const regionalVoice = vietnameseVoices.find((voice) => {
      const identity = `${voice.name} ${voice.voiceURI}`.toLowerCase();
      return regionalMarkers.some((marker) => identity.includes(marker));
    });
    return (
      regionalVoice ??
      vietnameseVoices.find((voice) => voice.localService) ??
      vietnameseVoices[0] ??
      null
    );
  }

  async function resolveVietnameseVoice(): Promise<SpeechSynthesisVoice | null> {
    if (!canUseSpeechSynthesis) return null;
    const synth = window.speechSynthesis;
    let selected = chooseVietnameseVoice(synth.getVoices());
    if (!selected) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const previousHandler = synth.onvoiceschanged;
        const finish = () => {
          if (settled) return;
          settled = true;
          synth.onvoiceschanged = previousHandler;
          resolve();
        };
        synth.onvoiceschanged = (event) => {
          previousHandler?.call(synth, event);
          finish();
        };
        window.setTimeout(finish, 900);
      });
      selected = chooseVietnameseVoice(synth.getVoices());
    }
    selectedVoiceRef.current = selected;
    if (!selected) {
      setLocalVoiceAvailable(false);
      setVoiceReadiness("unavailable");
      setVoiceProfileLabel(
        "Thiết bị chưa có giọng tiếng Việt; hệ thống sẽ không dùng giọng tiếng Anh thay thế",
      );
      return null;
    }
    setLocalVoiceAvailable(true);
    const regionalIdentity = `${selected.name} ${selected.voiceURI}`.toLowerCase();
    const isCentral = [
      "đà nẵng",
      "da nang",
      "miền trung",
      "mien trung",
      "central vietnam",
      "central vietnamese",
    ].some((marker) => regionalIdentity.includes(marker));
    setVoiceReadiness("ready");
    setVoiceProfileLabel(
      `${isCentral ? "Giọng miền Trung" : "Giọng tiếng Việt"}: ${selected.name} · ${
        selected.localService ? "xử lý trên thiết bị" : "dịch vụ giọng nói của thiết bị"
      }`,
    );
    return selected;
  }

  useEffect(() => {
    if (!isOpen || !voiceEnabled) return;
    if (serverTtsEnabled) {
      setVoiceReadiness("ready");
      setVoiceProfileLabel(
        "Giọng tiếng Việt từ máy chủ · chuẩn bị trước để phát nhanh · không lưu tệp âm thanh",
      );
      return;
    }
    if (!canUseSpeechSynthesis) {
      setVoiceReadiness("unsupported");
      setVoiceProfileLabel("Trình duyệt chưa hỗ trợ đọc câu trả lời");
      return;
    }
    setVoiceReadiness("checking");
    void resolveVietnameseVoice();
  }, [isOpen, voiceEnabled, serverTtsEnabled]);

  async function speakAnswer(
    text: string,
    messageId: string,
    speechToken?: string | null,
  ) {
    if (!voiceEnabled || !text.trim()) return;
    if (speakingMessageId === messageId) {
      stopSpeaking();
      return;
    }
    stopSpeaking();
    if (serverTtsEnabled && speechToken) {
      try {
        setSpeakingMessageId(messageId);
        const audioBlob = await prepareServerSpeech(messageId, speechToken);
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audioUrlRef.current = audioUrl;
        const releaseAudio = () => {
          if (audioRef.current === audio) audioRef.current = null;
          if (audioUrlRef.current === audioUrl) {
            URL.revokeObjectURL(audioUrl);
            audioUrlRef.current = null;
          }
          setSpeakingMessageId((current) =>
            current === messageId ? null : current,
          );
        };
        audio.onended = releaseAudio;
        audio.onerror = releaseAudio;
        await audio.play();
        return;
      } catch {
        stopSpeaking();
        setVoiceProfileLabel(
          "Giọng máy chủ tạm thời chưa sẵn sàng; đang kiểm tra giọng Việt trên thiết bị",
        );
      }
    }
    if (!canUseSpeechSynthesis) return;
    const selectedVoice =
      selectedVoiceRef.current ?? (await resolveVietnameseVoice());
    if (!selectedVoice) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "vi-VN";
    utterance.rate = 0.94;
    utterance.pitch = 1;
    utterance.voice = selectedVoice;
    utterance.onstart = () => setSpeakingMessageId(messageId);
    utterance.onend = () => setSpeakingMessageId(null);
    utterance.onerror = () => setSpeakingMessageId(null);
    window.speechSynthesis.speak(utterance);
  }

  function toggleVoiceInput() {
    if (!voiceEnabled) return;
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      return;
    }
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages((prev) => [...prev, { id: newId(), role: "bot", text: "Thiết bị chưa hỗ trợ nhập bằng giọng nói. Bạn có thể gõ câu hỏi để tiếp tục.", timestamp: new Date() }]);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "vi-VN"; recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      setInputText(transcript);
      if (transcript) void sendQuestion(transcript, true);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };
    recognition.onerror = recognition.onend;
    recognitionRef.current = recognition;
    setIsListening(true); recognition.start();
  }

  /* ── Send a question ────────────────────────────────────────────────── */
  async function sendQuestion(question: string, speakResponse = false) {
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
            ? {
                ...m,
                text: data.answer,
                isLoading: false,
                sources: data.sources ?? [],
                asOf: data.as_of ?? null,
                dataScope: data.data_scope ?? "unavailable",
                limitations: data.limitations ?? [],
                speechToken: data.speech_token ?? null,
              }
            : m,
        ),
      );
      if (data.speech_token) {
        void prepareServerSpeech(loadingMsg.id, data.speech_token).catch(
          () => undefined,
        );
      }
      if (speakResponse) {
        void speakAnswer(data.answer, loadingMsg.id, data.speech_token);
      }
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
        ref={toggleRef}
        id="chat-widget-toggle"
        className={`chat-widget__fab${isOpen ? " chat-widget__fab--open" : ""}`}
        aria-label={isOpen ? "Đóng tra cứu số liệu" : "Mở tra cứu số liệu"}
        aria-expanded={isOpen}
        aria-controls="chat-widget-panel"
        onClick={() => {
          if (isOpen) closeChat();
          else setIsOpen(true);
        }}
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
          <img className="chat-widget__brand-logo" src="/images/ba-na-brand-mark-96.png" alt="" />
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
        hidden={!isOpen}
        role="dialog"
        aria-label="Tra cứu số liệu"
        aria-modal="false"
      >
        {/* Header */}
        <header className="chat-widget__header">
          <div className="chat-widget__header-avatar" aria-hidden="true">
            <img className="chat-widget__brand-logo" src="/images/ba-na-brand-mark-96.png" alt="" />
          </div>
          <div className="chat-widget__header-info">
            <p className="chat-widget__header-eyebrow">TRỢ LÝ DỮ LIỆU CẤP XÃ</p>
            <p className="chat-widget__header-name">Trợ lý Ba Na SmartLink</p>
            <p className="chat-widget__header-status">
              {voiceEnabled ? "Tra cứu và hội thoại giọng nói" : "Tra cứu dữ liệu theo quyền truy cập"}
            </p>
          </div>
          <button
            className="chat-widget__close-btn"
            aria-label="Đóng cửa sổ chat"
            onClick={closeChat}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="chat-widget__trust-strip">
          <span><ShieldCheck aria-hidden="true" /> Trả lời có căn cứ</span>
          <span>Giới hạn theo quyền truy cập</span>
        </div>

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
            <span className="chat-widget__welcome-icon" aria-hidden="true">
              <img className="chat-widget__brand-logo" src="/images/ba-na-brand-mark-96.png" alt="" />
            </span>
            <p>
              <strong>Xin chào, tôi có thể hỗ trợ gì?</strong>
              <span>Hỏi về số liệu báo cáo trong phạm vi bạn được phép xem.</span>
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
                  <img className="chat-widget__brand-logo" src="/images/ba-na-brand-mark-96.png" alt="" />
                </div>
              )}

              <div className="chat-widget__bubble-col">
                <div
                  className={`chat-widget__bubble chat-widget__bubble--${msg.role}`}
                  aria-label={msg.role === "user" ? "Bạn" : "Hệ thống"}
                >
                  {msg.isLoading ? (
                    <span className="chat-widget__typing" aria-label="Đang xử lý">
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
                  <>
                    <AnswerEvidence message={msg} />
                    {voiceEnabled && (
                      <button
                        type="button"
                        className="chat-widget__speak-btn"
                        disabled={
                          !(
                            (serverTtsEnabled && Boolean(msg.speechToken)) ||
                            localVoiceAvailable
                          )
                        }
                        aria-label={speakingMessageId === msg.id ? "Dừng đọc câu trả lời" : "Đọc câu trả lời bằng giọng nói"}
                        onClick={() =>
                          void speakAnswer(msg.text, msg.id, msg.speechToken)
                        }
                      >
                        {speakingMessageId === msg.id
                          ? <Square aria-hidden="true" />
                          : <Volume2 aria-hidden="true" />}
                        {speakingMessageId === msg.id
                          ? "Dừng đọc"
                          : voiceReadiness === "checking"
                            ? "Đang tìm giọng Việt"
                            : voiceReadiness === "ready"
                              ? "Nghe câu trả lời"
                              : "Chưa có giọng Việt"}
                      </button>
                    )}
                    <p className="chat-widget__disclaimer">{DISCLAIMER}</p>
                  </>
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
          <p id="chat-privacy-hint" className="chat-widget__privacy-hint">
            <LockKeyhole aria-hidden="true" />
            <span>Không nhập họ tên, số điện thoại, địa chỉ hoặc số giấy tờ cá nhân.</span>
          </p>
          {voiceEnabled && (
            <p className={`chat-widget__voice-status chat-widget__voice-status--${voiceReadiness}`} aria-live="polite">
              <Volume2 aria-hidden="true" />
              <span>{voiceProfileLabel}</span>
            </p>
          )}
          <div className="chat-widget__composer">
            <textarea
              id="chat-widget-input"
              ref={inputRef}
              className="chat-widget__input"
              placeholder="Nhập câu hỏi… (Enter để gửi)"
              value={inputText}
              rows={1}
              maxLength={500}
              aria-label="Nhập câu hỏi"
              aria-describedby="chat-privacy-hint"
              disabled={isSending}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {voiceEnabled && (
              <button
                type="button"
                className={`chat-widget__voice-btn${isListening ? " chat-widget__voice-btn--active" : ""}`}
                aria-label={isListening ? "Đang nghe, bấm để dừng" : "Nhập câu hỏi bằng giọng nói"}
                title="Nhập bằng giọng nói (chỉ khi bạn bấm nút)"
                onClick={toggleVoiceInput}
                disabled={isSending}
              >
                {isListening ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
              </button>
            )}
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
                <Send aria-hidden="true" />
              )}
            </button>
          </div>
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

function AnswerEvidence({ message }: { message: Message }) {
  const sources = message.sources ?? [];
  const limitations = message.limitations ?? [];
  if (!message.dataScope && !message.asOf && sources.length === 0 && limitations.length === 0) {
    return null;
  }
  return (
    <section className="chat-widget__evidence" aria-label="Nguồn và phạm vi trả lời">
      <p className="chat-widget__evidence-title">Nguồn và phạm vi</p>
      <dl className="chat-widget__evidence-meta">
        {message.dataScope && (
          <>
            <dt>Phạm vi</dt>
            <dd>{formatDataScope(message.dataScope)}</dd>
          </>
        )}
        {message.asOf && (
          <>
            <dt>Cập nhật</dt>
            <dd>{formatAsOf(message.asOf)}</dd>
          </>
        )}
      </dl>
      {sources.length > 0 ? (
        <ul className="chat-widget__source-list">
          {sources.map((source, index) => (
            <li key={`${source.kind}-${source.title}-${source.scope}-${index}`}>
              <strong>{source.title}</strong>
              <span>
                {[formatSourceScope(source), source.period, source.reference].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="chat-widget__no-source">Không có nguồn dữ liệu phù hợp để trích dẫn.</p>
      )}
      {limitations.length > 0 && (
        <ul className="chat-widget__limitation-list">
          {limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>
      )}
    </section>
  );
}

function formatDataScope(scope: string): string {
  const labels: Record<string, string> = {
    public_published: "Dữ liệu tổng hợp đã công bố",
    assigned_villages: "Các thôn được phân công",
    commune_internal: "Dữ liệu nội bộ cấp xã",
    approved_public_knowledge: "Tài liệu đã duyệt công khai",
    approved_role_scoped_knowledge: "Tài liệu đã duyệt theo vai trò",
    unavailable: "Chưa có nguồn phù hợp",
  };
  return labels[scope] ?? "Theo quyền truy cập hiện tại";
}

function formatSourceScope(source: ApiSource): string {
  if (source.kind === "knowledge_article") {
    const labels: Record<string, string> = {
      public: "Công khai",
      internal: "Nội bộ",
      champions: "Tổ công nghệ số cộng đồng",
    };
    return labels[source.scope] ?? "Theo vai trò";
  }
  return source.scope;
}

function formatAsOf(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || !value.match(/^\d{4}-\d{2}-\d{2}/)) {
    return value;
  }
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: value.includes("T") ? "short" : undefined,
  }).format(parsed);
}

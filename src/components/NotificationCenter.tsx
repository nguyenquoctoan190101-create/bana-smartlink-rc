import React, { useEffect, useRef, useState } from "react";
import {
  BellRing,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  FileClock,
  Inbox,
  Info,
  ShieldCheck,
  Volume2,
  VolumeX,
} from "lucide-react";
import "./NotificationCenter.css";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  url?: string | null;
  is_read: boolean;
  created_at: string;
  read_at?: string | null;
};

type NotificationKind = "approval" | "warning" | "success" | "information";

type NotificationMeta = {
  kind: NotificationKind;
  label: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

type NotificationCenterProps = {
  notifications: AppNotification[];
  isOpen: boolean;
  variant: "desktop" | "mobile";
  soundEnabled: boolean;
  error?: string | null;
  onToggleOpen: () => void;
  onToggleSound: () => void;
  onSelect: (notification: AppNotification) => void;
  onMarkAllRead: () => void;
};

let routeCloseScheduled = false;

function notificationMeta(notification: AppNotification): NotificationMeta {
  const content = `${notification.title} ${notification.body} ${notification.url ?? ""}`.toLocaleLowerCase("vi-VN");
  if (
    content.includes("phê duyệt") ||
    content.includes("cần xử lý") ||
    content.includes("period-change-requests")
  ) {
    return { kind: "approval", label: "Cần phê duyệt", Icon: FileClock };
  }
  if (
    content.includes("quá hạn") ||
    content.includes("cảnh báo") ||
    content.includes("thất bại") ||
    content.includes("lỗi")
  ) {
    return { kind: "warning", label: "Cần chú ý", Icon: CircleAlert };
  }
  if (
    content.includes("đã duyệt") ||
    content.includes("hoàn thành") ||
    content.includes("thành công")
  ) {
    return { kind: "success", label: "Đã hoàn thành", Icon: ShieldCheck };
  }
  return { kind: "information", label: "Cập nhật", Icon: Info };
}

export function formatNotificationTime(
  value: string,
  now = Date.now(),
): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Không rõ thời gian";
  const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (elapsedMinutes < 1) return "Vừa xong";
  if (elapsedMinutes < 60) return `${elapsedMinutes} phút trước`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} giờ trước`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays} ngày trước`;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(timestamp));
}

export default function NotificationCenter({
  notifications,
  isOpen,
  variant,
  soundEnabled,
  error,
  onToggleOpen,
  onToggleSound,
  onSelect,
  onMarkAllRead,
}: NotificationCenterProps) {
  const centerRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter(
    (notification) => !notification.is_read,
  ).length;
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const locationKey = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const previousLocationRef = useRef(locationKey);
  const visibleNotifications =
    filter === "unread"
      ? notifications.filter((notification) => !notification.is_read)
      : notifications;

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const center = centerRef.current;
      if (!center || center.offsetParent === null) return;
      if (
        event.target instanceof Node &&
        !center.contains(event.target)
      ) {
        onToggleOpen();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const center = centerRef.current;
      if (
        event.key === "Escape" &&
        center &&
        center.offsetParent !== null
      ) {
        onToggleOpen();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, onToggleOpen]);

  useEffect(() => {
    if (previousLocationRef.current === locationKey) return;
    previousLocationRef.current = locationKey;
    if (!isOpen || routeCloseScheduled) return;

    // The desktop and mobile variants are mounted together and share state.
    // A microtask guard ensures a route change toggles that shared state once.
    routeCloseScheduled = true;
    onToggleOpen();
    window.queueMicrotask(() => {
      routeCloseScheduled = false;
    });
  }, [isOpen, locationKey, onToggleOpen]);

  return (
    <div className="notification-center" ref={centerRef}>
      <button
        type="button"
        onClick={onToggleOpen}
        aria-label="Mở danh sách thông báo"
        aria-expanded={isOpen}
        aria-controls={`${variant}-notification-list`}
        className={`notification-center__trigger notification-center__trigger--${variant} ${
          unreadCount > 0 ? "notification-center__trigger--active" : ""
        }`}
        title={
          unreadCount > 0
            ? `${unreadCount} thông báo chưa đọc`
            : "Không có thông báo mới"
        }
      >
        <BellRing aria-hidden="true" className="notification-center__bell" />
        {unreadCount > 0 && (
          <span
            className="notification-center__count"
            aria-label={`${unreadCount} thông báo chưa đọc`}
            aria-live="polite"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <section
          id={`${variant}-notification-list`}
          className={`notification-center__panel notification-center__panel--${variant}`}
          aria-label="Trung tâm thông báo"
        >
          <header className="notification-center__header">
            <div className="notification-center__heading">
              <span className="notification-center__heading-icon">
                <BellRing aria-hidden="true" />
              </span>
              <div>
                <h2>Trung tâm thông báo</h2>
                <p>
                  {unreadCount > 0
                    ? `${unreadCount} việc mới cần xem`
                    : "Bạn đã xem tất cả thông báo"}
                </p>
              </div>
            </div>
            <button
              type="button"
              className={`notification-center__sound ${
                soundEnabled ? "notification-center__sound--on" : ""
              }`}
              onClick={onToggleSound}
              aria-label={soundEnabled ? "Tắt âm báo" : "Bật âm báo"}
              title={soundEnabled ? "Âm báo đang bật" : "Âm báo đang tắt"}
            >
              {soundEnabled ? (
                <Volume2 aria-hidden="true" />
              ) : (
                <VolumeX aria-hidden="true" />
              )}
            </button>
          </header>
          {error && (
            <div
              role="alert"
              className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-900"
            >
              {error}
            </div>
          )}

          <div className="notification-center__toolbar">
            <div
              className="notification-center__filters"
              role="group"
              aria-label="Lọc thông báo"
            >
              <button
                type="button"
                className={filter === "unread" ? "is-active" : ""}
                aria-pressed={filter === "unread"}
                onClick={() => setFilter("unread")}
              >
                Chưa đọc
                {unreadCount > 0 && <span>{unreadCount}</span>}
              </button>
              <button
                type="button"
                className={filter === "all" ? "is-active" : ""}
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                Tất cả
              </button>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                className="notification-center__mark-all"
                onClick={onMarkAllRead}
              >
                <CheckCheck aria-hidden="true" />
                Đã đọc tất cả
              </button>
            )}
          </div>

          <div className="notification-center__list">
            {visibleNotifications.length === 0 ? (
              <div className="notification-center__empty">
                <span>
                  <Inbox aria-hidden="true" />
                </span>
                <strong>
                  {filter === "unread"
                    ? "Không còn thông báo chưa đọc"
                    : "Chưa có thông báo"}
                </strong>
                <p>
                  {filter === "unread"
                    ? "Các thông báo đã xem vẫn được lưu trong mục Tất cả."
                    : "Thông tin mới sẽ xuất hiện tại đây."}
                </p>
              </div>
            ) : (
              visibleNotifications.map((notification) => {
                const meta = notificationMeta(notification);
                const { Icon } = meta;
                return (
                  <button
                    type="button"
                    key={notification.id}
                    onClick={() => onSelect(notification)}
                    className={`notification-center__item notification-center__item--${meta.kind} ${
                      notification.is_read
                        ? "notification-center__item--read"
                        : "notification-center__item--unread"
                    }`}
                    aria-label={`Mở thông báo: ${notification.title}`}
                  >
                    <span className="notification-center__item-icon">
                      <Icon aria-hidden="true" />
                    </span>
                    <span className="notification-center__item-content">
                      <span className="notification-center__item-meta">
                        <span className="notification-center__kind">
                          {meta.label}
                        </span>
                        <time
                          dateTime={notification.created_at}
                          title={new Date(
                            notification.created_at,
                          ).toLocaleString("vi-VN")}
                        >
                          {formatNotificationTime(notification.created_at)}
                        </time>
                      </span>
                      <strong>{notification.title}</strong>
                      <span className="notification-center__body">
                        {notification.body}
                      </span>
                      {notification.url && (
                        <span className="notification-center__action">
                          Mở màn hình xử lý
                          <ChevronRight aria-hidden="true" />
                        </span>
                      )}
                    </span>
                    {!notification.is_read && (
                      <span
                        className="notification-center__unread-dot"
                        aria-label="Chưa đọc"
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>

          <footer className="notification-center__footer">
            {soundEnabled ? (
              <>
                <Volume2 aria-hidden="true" />
                Chỉ phát âm thanh khi có thông báo mới
              </>
            ) : (
              <>
                <VolumeX aria-hidden="true" />
                Âm báo đang tắt
              </>
            )}
          </footer>
        </section>
      )}
    </div>
  );
}

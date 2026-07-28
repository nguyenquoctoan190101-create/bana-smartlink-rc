import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NotificationCenter, {
  AppNotification,
  formatNotificationBody,
  formatNotificationTime,
} from "./NotificationCenter";

const notifications: AppNotification[] = [
  {
    id: "new-approval",
    title: "Yêu cầu thay đổi kỳ báo cáo cần phê duyệt",
    body: "Quản trị viên đề nghị lưu trữ kỳ báo cáo tháng 01/2027.",
    url: "/app/period-change-requests",
    is_read: false,
    created_at: "2026-07-27T08:00:00+07:00",
  },
  {
    id: "read-update",
    title: "Báo cáo đã hoàn thành",
    body: "Thôn An Sơn đã hoàn thành báo cáo.",
    url: "/app/dashboard",
    is_read: true,
    created_at: "2026-07-26T08:00:00+07:00",
  },
];

describe("NotificationCenter", () => {
  it("derives the unread count, prioritizes unread work and exposes smart actions", () => {
    const onSelect = vi.fn();
    const onMarkAllRead = vi.fn();
    render(
      <NotificationCenter
        notifications={notifications}
        isOpen
        variant="desktop"
        soundEnabled
        onToggleOpen={vi.fn()}
        onToggleSound={vi.fn()}
        onSelect={onSelect}
        onMarkAllRead={onMarkAllRead}
      />,
    );

    expect(screen.getByText("1 việc mới cần xem")).toBeInTheDocument();
    expect(screen.getByText("Cần phê duyệt")).toBeInTheDocument();
    expect(screen.getByText("Mở màn hình xử lý")).toBeInTheDocument();
    expect(screen.queryByText("Báo cáo đã hoàn thành")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tất cả" }));
    expect(screen.getByText("Báo cáo đã hoàn thành")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Mở thông báo: Yêu cầu thay đổi kỳ báo cáo cần phê duyệt",
      }),
    );
    expect(onSelect).toHaveBeenCalledWith(notifications[0]);

    fireEvent.click(screen.getByRole("button", { name: /Đã đọc tất cả/ }));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it("lets the user control notification sound", () => {
    const onToggleSound = vi.fn();
    render(
      <NotificationCenter
        notifications={[]}
        isOpen
        variant="desktop"
        soundEnabled={false}
        onToggleOpen={vi.fn()}
        onToggleSound={onToggleSound}
        onSelect={vi.fn()}
        onMarkAllRead={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Bật âm báo" }));
    expect(onToggleSound).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Âm báo đang tắt")).toBeInTheDocument();
  });

  it("does not disguise a failed notification request as an empty inbox", () => {
    render(
      <NotificationCenter
        notifications={[]}
        isOpen
        variant="desktop"
        soundEnabled
        error="Chưa tải được danh sách thông báo."
        onToggleOpen={vi.fn()}
        onToggleSound={vi.fn()}
        onSelect={vi.fn()}
        onMarkAllRead={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Chưa tải được danh sách thông báo.",
    );
  });

  it("formats recent times in language that is quick to recognize", () => {
    const now = new Date("2026-07-27T08:30:00+07:00").getTime();
    expect(
      formatNotificationTime("2026-07-27T08:29:40+07:00", now),
    ).toBe("Vừa xong");
    expect(
      formatNotificationTime("2026-07-27T08:18:00+07:00", now),
    ).toBe("12 phút trước");
  });

  it("makes report deadlines natural to read", () => {
    expect(
      formatNotificationBody(
        "Kỳ Tháng 8/2026 có hạn nộp 05/08/2026 18:00",
      ),
    ).toBe("Kỳ Tháng 8/2026 có hạn nộp 05/08/2026 lúc 18:00");
  });

  it("closes an open panel when application navigation changes the path", async () => {
    const onToggleOpen = vi.fn();
    window.history.replaceState({}, "", "/app/dashboard");
    const { rerender } = render(
      <NotificationCenter
        notifications={notifications}
        isOpen
        variant="desktop"
        soundEnabled
        onToggleOpen={onToggleOpen}
        onToggleSound={vi.fn()}
        onSelect={vi.fn()}
        onMarkAllRead={vi.fn()}
      />,
    );

    window.history.pushState({}, "", "/app/cases");
    rerender(
      <NotificationCenter
        notifications={notifications}
        isOpen
        variant="desktop"
        soundEnabled
        onToggleOpen={onToggleOpen}
        onToggleSound={vi.fn()}
        onSelect={vi.fn()}
        onMarkAllRead={vi.fn()}
      />,
    );

    await waitFor(() => expect(onToggleOpen).toHaveBeenCalledTimes(1));
  });
});

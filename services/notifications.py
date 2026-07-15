from __future__ import annotations

import abc
import asyncio

from services.push_notify import send_push


class NotificationChannel(abc.ABC):
    @abc.abstractmethod
    async def send_notification(self, user_id: str, title: str, body: str, url: str | None = None) -> bool:
        """Send a notification to a user."""


class WebPushChannel(NotificationChannel):
    async def send_notification(self, user_id: str, title: str, body: str, url: str | None = None) -> bool:
        try:
            return await asyncio.to_thread(send_push, user_id, title, body, url)
        except Exception:
            return False


def get_notification_channels() -> list[NotificationChannel]:
    """Return all active notification channels."""
    return [WebPushChannel()]


async def notify_user(user_id: str, title: str, body: str, url: str | None = None) -> bool:
    """Send a notification via all available channels."""
    channels = get_notification_channels()
    results = [
        await channel.send_notification(user_id, title, body, url)
        for channel in channels
    ]
    return any(results)

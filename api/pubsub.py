"""In-process pub/sub broadcaster for pushing live-update signals to SSE clients.

The broadcaster keeps a set of asyncio queues, one per subscribed client. Mutation
endpoints call `publish(topic)` (usually via BackgroundTasks so it runs after the
DB commit) and each queue receives the topic string. A slow subscriber whose
queue is full is skipped for that message rather than blocking the publisher.
"""

from __future__ import annotations

import asyncio

from fastapi import BackgroundTasks


class Broadcaster:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[str]] = set()

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self._subscribers.discard(q)

    async def publish(self, topic: str) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(topic)
            except asyncio.QueueFull:
                pass


broadcaster = Broadcaster()


def notify(tasks: BackgroundTasks, topic: str = "sites") -> None:
    """Schedule a broadcast to fire after the response commits."""
    tasks.add_task(broadcaster.publish, topic)

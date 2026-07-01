"""Server-Sent Events feed for live UI updates.

Clients open a long-lived GET at /events/stream. When any mutation publishes to
the pubsub broadcaster, subscribed clients receive a `data: <topic>\n\n` frame.
Auth is enforced with the standard session dependency. A periodic keepalive
comment keeps proxies from closing idle connections.
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from deps import requires
from pubsub import broadcaster

router = APIRouter(prefix="/events", tags=["events"])

KEEPALIVE_INTERVAL = 20.0


async def _event_stream(request: Request) -> AsyncIterator[bytes]:
    queue = broadcaster.subscribe()
    try:
        yield b"retry: 3000\n\n"
        while True:
            if await request.is_disconnected():
                return
            try:
                topic = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_INTERVAL)
            except asyncio.TimeoutError:
                yield b": keepalive\n\n"
                continue
            yield f"data: {topic}\n\n".encode("utf-8")
    finally:
        broadcaster.unsubscribe(queue)


@router.get("/stream")
async def stream(request: Request, _=Depends(requires("viewer"))) -> StreamingResponse:
    return StreamingResponse(
        _event_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

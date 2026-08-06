from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any, DefaultDict, Dict, Set

from fastapi import WebSocket


class CreditWebSocketManager:
    def __init__(self) -> None:
        self._connections: DefaultDict[int, Set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[user_id].add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        if user_id in self._connections:
            self._connections[user_id].discard(websocket)
            if not self._connections[user_id]:
                del self._connections[user_id]

    async def send_credit_update(self, user_id: int, credit: int) -> None:
        sockets = list(self._connections.get(user_id, set()))
        if not sockets:
            return
        payload = {"type": "credit_update", "credit": credit}
        for socket in sockets:
            try:
                await socket.send_json(payload)
            except Exception:
                self.disconnect(user_id, socket)


credit_ws_manager = CreditWebSocketManager()


class TaskWebSocketManager:
    def __init__(self) -> None:
        self._connections: DefaultDict[str, Set[WebSocket]] = defaultdict(set)

    async def connect(self, username: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[username].add(websocket)

    def disconnect(self, username: str, websocket: WebSocket) -> None:
        if username in self._connections:
            self._connections[username].discard(websocket)
            if not self._connections[username]:
                del self._connections[username]

    async def send_task_update(self, username: str, task: Dict[str, Any]) -> None:
        sockets = list(self._connections.get(username, set()))
        if not sockets:
            return
        payload = {"type": "task_update", "task": task}
        for socket in sockets:
            try:
                await socket.send_json(payload)
            except Exception:
                self.disconnect(username, socket)


def fire_and_forget(coro: Any) -> None:
    """
    Schedule an async coroutine from sync call-sites.
    Falls back to a blocking run when no loop is active.
    """
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        try:
            asyncio.run(coro)
        except Exception:
            # Best-effort notification; never break business flow.
            return


task_ws_manager = TaskWebSocketManager()

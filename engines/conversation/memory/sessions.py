"""In-memory conversation sessions with TTL."""
import time
import uuid
from config import SESSION_TTL_SECONDS


class SessionStore:
    def __init__(self):
        self._sessions: dict[str, dict] = {}

    def _cleanup(self):
        now = time.time()
        expired = [k for k, v in self._sessions.items() if now - v["last_active"] > SESSION_TTL_SECONDS]
        for k in expired:
            del self._sessions[k]

    def get_or_create(self, session_id: str | None) -> tuple[str, list[dict]]:
        self._cleanup()
        if session_id and session_id in self._sessions:
            self._sessions[session_id]["last_active"] = time.time()
            return session_id, self._sessions[session_id]["messages"]
        sid = session_id or str(uuid.uuid4())
        self._sessions[sid] = {"messages": [], "last_active": time.time()}
        return sid, self._sessions[sid]["messages"]

    def append(self, session_id: str, role: str, content: str):
        if session_id in self._sessions:
            self._sessions[session_id]["messages"].append({"role": role, "content": content})
            self._sessions[session_id]["last_active"] = time.time()


sessions = SessionStore()

"""Vercel entry point: exposes the FastAPI app as a Python serverless function.

The dashboard is served by the `web` service; /api/* is routed here (vercel.json). Start-up problems
(import errors, database initialisation) are reported as JSON on every /api request, with secrets
masked, instead of crashing the function, so the dashboard can show the real cause.
"""
import logging
import os
import re
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

# Serverless filesystems are read-only except /tmp.
os.environ.setdefault("STORAGE_DIR", "/tmp/uploads")
if not os.environ.get("DATABASE_URL"):
    # Without a database URL nothing persists between requests; set DATABASE_URL (Neon) in Vercel.
    os.environ["DATABASE_URL"] = "sqlite:////tmp/fxdesk.db"
    os.environ["EPHEMERAL_DATABASE"] = "1"
    logging.warning("DATABASE_URL not set: using ephemeral /tmp SQLite; data will not persist")

_SECRET = re.compile(r"(://[^:/@\s]+:)[^@\s]+@|((?:password|apikey|api_key|token)=)[^&\s'\"]+", re.I)


def _mask(text: str) -> str:
    return _SECRET.sub(lambda m: (m.group(1) + "***@") if m.group(1) else (m.group(2) + "***"), text)


def _describe(stage: str, exc: BaseException) -> dict:
    tb = traceback.extract_tb(exc.__traceback__)
    where = [f"{Path(f.filename).name}:{f.lineno} in {f.name}" for f in tb[-4:]]
    return {"stage": stage, "error": _mask(f"{type(exc).__name__}: {exc}")[:1500], "where": where}


STARTUP: dict = {"import_error": None, "init_error": None, "init_ok": False, "last_try": 0.0}
fastapi_app = None
try:
    from app.cli import init_db
    from app.api.main import app as fastapi_app
except Exception as e:  # noqa: BLE001
    STARTUP["import_error"] = _describe("import", e)
    logging.exception("API import failed")


def _ensure_init() -> None:
    """Alembic upgrade + config sync. Retried at most every 20s until it succeeds (e.g. Neon waking up)."""
    if STARTUP["init_ok"] or STARTUP["import_error"] or time.monotonic() - STARTUP["last_try"] < 20:
        return
    STARTUP["last_try"] = time.monotonic()
    try:
        init_db()
        STARTUP.update(init_ok=True, init_error=None)
    except Exception as e:  # noqa: BLE001
        STARTUP["init_error"] = _describe("database initialisation", e)
        logging.exception("database initialisation failed")


_ensure_init()


async def _json(send, status: int, body: dict) -> None:
    import json
    data = json.dumps(body).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(data)).encode())]})
    await send({"type": "http.response.body", "body": data})


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        if fastapi_app is not None:
            await fastapi_app(scope, receive, send)
        return
    if scope["type"] in ("http", "websocket"):
        # Vercel may or may not strip the public /api prefix; the FastAPI routes live under /api.
        path = scope.get("path", "")
        if not path.startswith("/api"):
            scope = dict(scope, path="/api" + (path if path.startswith("/") else "/" + path), raw_path=None)
        if scope["type"] == "http":
            if STARTUP["import_error"]:
                await _json(send, 500, {"detail": "API failed to start", **STARTUP["import_error"]})
                return
            _ensure_init()
            if not STARTUP["init_ok"]:
                await _json(send, 503, {"ok": False, "detail": "Database is not ready", **(STARTUP["init_error"] or {})})
                return
    await fastapi_app(scope, receive, send)

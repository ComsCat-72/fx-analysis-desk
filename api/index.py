"""Vercel entrypoint: the FastAPI app runs as one Python function; Vercel serves the dashboard as static files."""
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("STORAGE_DIR", "/tmp/fxdesk-uploads")  # only /tmp is writable on Vercel

from app.cli import init_db  # noqa: E402

# Apply migrations and sync config on every cold start (idempotent), as the Docker image does on boot.
try:
    init_db()
except Exception:
    logging.exception("init-db failed; serving anyway")

from app.api.main import app  # noqa: E402,F401

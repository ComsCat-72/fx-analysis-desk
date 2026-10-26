"""Database engine, session, and a UTC-aware datetime column type."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.types import TypeDecorator

from .config import env


class UTCDateTime(TypeDecorator):
    """Stores UTC; rejects naive input; always returns aware UTC datetimes (also on SQLite)."""
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime not allowed")
        value = value.astimezone(timezone.utc)
        return value.replace(tzinfo=None) if dialect.name == "sqlite" else value

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class Base(DeclarativeBase):
    pass


_engine = None
_Session: sessionmaker | None = None


def engine():
    global _engine, _Session
    if _engine is None:
        url = env().database_url
        if url.startswith("sqlite:///"):
            from pathlib import Path
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(url, future=True)
        if url.startswith("sqlite"):
            @event.listens_for(_engine, "connect")
            def _fk(conn, _):
                conn.execute("PRAGMA foreign_keys=ON")
        _Session = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def reset_engine(url: str | None = None) -> None:
    global _engine, _Session
    if _engine is not None:
        _engine.dispose()
    _engine, _Session = None, None
    if url:
        env().database_url = url


@contextmanager
def session_scope() -> Iterator[Session]:
    engine()
    s = _Session()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_session() -> Iterator[Session]:
    with session_scope() as s:
        yield s

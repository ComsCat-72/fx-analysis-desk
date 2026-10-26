import os

import pytest

os.environ.setdefault("APP_ENV", "development")


@pytest.fixture()
def db(tmp_path, monkeypatch):
    """Fresh SQLite database built by the real Alembic migration (so DB triggers are included)."""
    from alembic import command
    from alembic.config import Config

    from app import config as appconfig
    from app import db as appdb

    url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    appconfig.reload()
    appdb.reset_engine()
    here = os.path.dirname(os.path.dirname(__file__))
    cfg = Config(os.path.join(here, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(here, "migrations"))
    command.upgrade(cfg, "head")
    with appdb.session_scope() as s:
        yield s
    appdb.reset_engine()

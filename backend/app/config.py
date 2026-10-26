"""Configuration: secrets and environment from env vars, analytical settings from YAML."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Env(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    app_env: str = "development"  # development | production
    database_url: str = f"sqlite:///{REPO_ROOT / 'var' / 'fxdesk.db'}"
    config_dir: Path = REPO_ROOT / "config"
    storage_dir: Path = REPO_ROOT / "var" / "uploads"

    anthropic_api_key: str | None = None
    claude_model: str = "claude-sonnet-5-5"
    claude_review_model: str = "claude-sonnet-5-5"

    oanda_api_token: str | None = None
    oanda_account_id: str | None = None
    oanda_environment: str = "practice"  # practice | live

    fred_api_key: str | None = None

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def env() -> Env:
    return Env()


def _load_yaml(name: str) -> dict[str, Any]:
    path = env().config_dir / name
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


@lru_cache
def app_config() -> dict[str, Any]:
    return _load_yaml("app.yaml")


@lru_cache
def terminology_config() -> dict[str, Any]:
    return _load_yaml("terminology.yaml")


def reload() -> None:
    env.cache_clear()
    app_config.cache_clear()
    terminology_config.cache_clear()

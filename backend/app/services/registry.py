"""Builds configured providers. Missing credentials raise; fixtures are never substituted silently."""
from __future__ import annotations

from datetime import date

from ..config import app_config, env
from ..domain.instruments import Instrument
from ..domain.sessions import SessionDef
from ..providers.base import PriceProvider, ProviderNotConfigured


class FixturesForbidden(RuntimeError):
    pass


def session_for(instrument: str) -> SessionDef:
    """Session definition used for an instrument's candles (FX close unless the instrument names one)."""
    inst = instruments(False).get(instrument)
    return session_def(inst.session if inst else None)


def session_def(name: str | None = None) -> SessionDef:
    cfg = app_config()
    name = name or cfg.get("default_session", "fx_ny_close")
    return SessionDef.from_config(name, cfg["sessions"][name], cfg["sessions"].get("holidays", []))


def instruments(enabled_only: bool = True) -> dict[str, Instrument]:
    out = {code: Instrument.from_config(code, c) for code, c in app_config()["instruments"].items()}
    return {k: v for k, v in out.items() if v.enabled or not enabled_only}


def price_provider_name(instrument: str | None = None) -> str:
    """PRICE_PROVIDER overrides everything; else the instrument's own provider; else the default."""
    import os
    if os.environ.get("PRICE_PROVIDER"):
        return os.environ["PRICE_PROVIDER"]
    inst = instruments(False).get(instrument) if instrument else None
    return (inst.price_provider if inst and inst.price_provider else None) or app_config()["providers"]["prices"]["primary"]


def price_provider(instrument: str | None = None) -> PriceProvider:
    name = price_provider_name(instrument)
    e = env()
    if name == "fixture":
        if e.is_production:
            raise FixturesForbidden("fixture prices are not allowed when APP_ENV=production")
        from ..providers.fixtures import FixturePriceProvider
        return FixturePriceProvider(session_for(instrument) if instrument else session_def(),
                                    {k: i.decimals for k, i in instruments(False).items()})
    if name == "twelvedata":
        from ..providers.twelvedata import TwelveDataProvider
        return TwelveDataProvider(e.twelvedata_api_key)
    if name == "yahoo":
        from ..providers.yahoo import YahooProvider
        return YahooProvider()
    if name == "oanda":
        from ..providers.oanda import OandaPriceProvider
        return OandaPriceProvider(e.oanda_api_token, e.oanda_account_id, e.oanda_environment,
                                  app_config()["providers"]["prices"].get("price_component", "M"))
    raise ProviderNotConfigured(f"unknown price provider {name!r}")


def calendar_provider(monday: date | None = None):
    import os
    from datetime import datetime, timezone
    name = os.environ.get("CALENDAR_PROVIDER") or app_config()["providers"]["calendar"]["primary"]
    if name == "fixture":
        if env().is_production:
            raise FixturesForbidden("fixture calendar is not allowed when APP_ENV=production")
        from ..providers.fixtures import FixtureCalendar
        m = monday or date.today()
        return FixtureCalendar(datetime(m.year, m.month, m.day, tzinfo=timezone.utc))
    if name == "ff_weekly_json":
        from ..providers.calendar_ff import FFWeeklyJsonCalendar
        return FFWeeklyJsonCalendar()
    raise ProviderNotConfigured(f"unknown calendar provider {name!r}")

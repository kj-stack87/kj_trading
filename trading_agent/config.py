from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class StrategyConfig:
    short_window: int
    long_window: int
    trade_fraction: float


@dataclass(frozen=True)
class RiskConfig:
    max_position_value: float
    max_order_value: float
    max_daily_loss: float
    allow_short_selling: bool


@dataclass(frozen=True)
class MarketDataConfig:
    provider: str
    seed_price: float


@dataclass(frozen=True)
class AppConfig:
    mode: Literal["paper", "live"]
    symbols: list[str]
    loop_interval_seconds: int
    starting_cash: float
    strategy: StrategyConfig
    risk: RiskConfig
    market_data: MarketDataConfig


def load_config(path: Path) -> AppConfig:
    raw = json.loads(path.read_text(encoding="utf-8"))

    if raw.get("mode") != "paper":
        raise ValueError("Only paper mode is enabled in this starter project.")

    strategy = StrategyConfig(**raw["strategy"])
    risk = RiskConfig(**raw["risk"])
    market_data = MarketDataConfig(**raw["market_data"])

    if strategy.short_window >= strategy.long_window:
        raise ValueError("strategy.short_window must be smaller than long_window.")
    if not 0 < strategy.trade_fraction <= 1:
        raise ValueError("strategy.trade_fraction must be between 0 and 1.")

    return AppConfig(
        mode=raw["mode"],
        symbols=list(raw["symbols"]),
        loop_interval_seconds=int(raw["loop_interval_seconds"]),
        starting_cash=float(raw["starting_cash"]),
        strategy=strategy,
        risk=risk,
        market_data=market_data,
    )


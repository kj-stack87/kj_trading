from __future__ import annotations

import argparse
import logging
from pathlib import Path

from trading_agent.agent import TradingAgent
from trading_agent.broker import PaperBroker
from trading_agent.config import load_config
from trading_agent.journal import JsonlJournal
from trading_agent.market_data import SimulatedMarketData
from trading_agent.risk import RiskManager
from trading_agent.strategy import MovingAverageCrossStrategy


def build_agent(config_path: Path) -> TradingAgent:
    config = load_config(config_path)

    journal = JsonlJournal(Path("data") / "trades.jsonl")
    broker = PaperBroker(starting_cash=config.starting_cash, journal=journal)
    data = SimulatedMarketData(
        symbols=config.symbols,
        seed_price=config.market_data.seed_price,
    )
    strategy = MovingAverageCrossStrategy(
        short_window=config.strategy.short_window,
        long_window=config.strategy.long_window,
        trade_fraction=config.strategy.trade_fraction,
    )
    risk = RiskManager(config.risk)

    return TradingAgent(
        config=config,
        market_data=data,
        strategy=strategy,
        broker=broker,
        risk=risk,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="24H paper trading agent")
    parser.add_argument("--config", default="config.json", help="Path to config JSON")
    parser.add_argument("--once", action="store_true", help="Run one cycle and exit")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )

    config_path = Path(args.config)
    if not config_path.exists():
        config_path = Path("config.example.json")

    agent = build_agent(config_path)
    agent.run_once() if args.once else agent.run_forever()


if __name__ == "__main__":
    main()


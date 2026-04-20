from __future__ import annotations

import logging
import time

from trading_agent.broker import PaperBroker
from trading_agent.config import AppConfig
from trading_agent.market_data import SimulatedMarketData
from trading_agent.models import Order
from trading_agent.risk import RiskManager
from trading_agent.strategy import MovingAverageCrossStrategy


logger = logging.getLogger(__name__)


class TradingAgent:
    def __init__(
        self,
        config: AppConfig,
        market_data: SimulatedMarketData,
        strategy: MovingAverageCrossStrategy,
        broker: PaperBroker,
        risk: RiskManager,
    ) -> None:
        self.config = config
        self.market_data = market_data
        self.strategy = strategy
        self.broker = broker
        self.risk = risk

    def run_forever(self) -> None:
        logger.info("Trading agent started in %s mode.", self.config.mode)
        while True:
            self.run_once()
            time.sleep(self.config.loop_interval_seconds)

    def run_once(self) -> None:
        quotes = self.market_data.get_quotes()
        quote_summary = ", ".join(f"{symbol}={quote.price:.2f}" for symbol, quote in quotes.items())
        logger.info("Quotes: %s", quote_summary)

        signals = self.strategy.on_quotes(
            quotes=quotes,
            cash=self.broker.cash,
            positions=self.broker.positions,
        )

        if not signals:
            logger.info("No trade signals.")
            return

        for signal in signals:
            quote = quotes[signal.symbol]
            order = Order.from_signal(signal, quote.price)
            decision = self.risk.approve(order, self.broker.cash, self.broker.positions)

            if not decision.approved:
                logger.warning("Rejected %s %s: %s", signal.side.value, signal.symbol, decision.reason)
                continue

            logger.info("Signal approved: %s %s x%d (%s)", signal.side.value, signal.symbol, signal.quantity, signal.reason)
            self.broker.submit_order(order)


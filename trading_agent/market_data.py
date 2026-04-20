from __future__ import annotations

import math
import random
from datetime import datetime, timezone

from trading_agent.models import Quote


class SimulatedMarketData:
    """Simple deterministic-ish price feed for development and paper testing."""

    def __init__(self, symbols: list[str], seed_price: float) -> None:
        self.symbols = symbols
        self.tick = 0
        self.random = random.Random(42)
        self.prices = {
            symbol: seed_price + index * 7.5
            for index, symbol in enumerate(symbols)
        }

    def get_quotes(self) -> dict[str, Quote]:
        self.tick += 1
        quotes: dict[str, Quote] = {}
        now = datetime.now(timezone.utc)

        for index, symbol in enumerate(self.symbols):
            wave = math.sin((self.tick + index) / 5) * 0.6
            noise = self.random.uniform(-0.35, 0.35)
            self.prices[symbol] = max(1.0, self.prices[symbol] + wave + noise)
            quotes[symbol] = Quote(symbol=symbol, price=round(self.prices[symbol], 2), timestamp=now)

        return quotes


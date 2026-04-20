from __future__ import annotations

from collections import defaultdict, deque

from trading_agent.models import Quote, Side, Signal


class MovingAverageCrossStrategy:
    def __init__(self, short_window: int, long_window: int, trade_fraction: float) -> None:
        self.short_window = short_window
        self.long_window = long_window
        self.trade_fraction = trade_fraction
        self.history: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=long_window))
        self.last_state: dict[str, str] = {}

    def on_quotes(self, quotes: dict[str, Quote], cash: float, positions: dict[str, int]) -> list[Signal]:
        signals: list[Signal] = []

        for symbol, quote in quotes.items():
            prices = self.history[symbol]
            prices.append(quote.price)

            if len(prices) < self.long_window:
                continue

            short_ma = sum(list(prices)[-self.short_window:]) / self.short_window
            long_ma = sum(prices) / self.long_window
            state = "above" if short_ma > long_ma else "below"
            previous = self.last_state.get(symbol)
            self.last_state[symbol] = state

            if previous is None or previous == state:
                continue

            if previous == "below" and state == "above":
                budget = cash * self.trade_fraction
                quantity = int(budget // quote.price)
                if quantity > 0:
                    signals.append(Signal(symbol, Side.BUY, quantity, "short MA crossed above long MA"))

            if previous == "above" and state == "below":
                quantity = positions.get(symbol, 0)
                if quantity > 0:
                    signals.append(Signal(symbol, Side.SELL, quantity, "short MA crossed below long MA"))

        return signals


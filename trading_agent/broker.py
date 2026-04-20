from __future__ import annotations

from datetime import datetime, timezone
from logging import getLogger

from trading_agent.journal import JsonlJournal
from trading_agent.models import Fill, Order, Side


logger = getLogger(__name__)


class PaperBroker:
    def __init__(self, starting_cash: float, journal: JsonlJournal) -> None:
        self.cash = starting_cash
        self.positions: dict[str, int] = {}
        self.journal = journal

    def submit_order(self, order: Order) -> Fill:
        order_value = order.quantity * order.price
        current = self.positions.get(order.symbol, 0)

        if order.side == Side.BUY:
            self.cash -= order_value
            self.positions[order.symbol] = current + order.quantity
        else:
            self.cash += order_value
            self.positions[order.symbol] = current - order.quantity

        fill = Fill(
            symbol=order.symbol,
            side=order.side,
            quantity=order.quantity,
            price=order.price,
            cash_after=round(self.cash, 2),
            position_after=self.positions[order.symbol],
            filled_at=datetime.now(timezone.utc),
        )
        self.journal.write("fill", {"fill": fill})
        logger.info(
            "PAPER FILL %s %s x%d @ %.2f | cash=%.2f position=%d",
            fill.side.value.upper(),
            fill.symbol,
            fill.quantity,
            fill.price,
            fill.cash_after,
            fill.position_after,
        )
        return fill


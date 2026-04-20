from __future__ import annotations

from dataclasses import dataclass

from trading_agent.config import RiskConfig
from trading_agent.models import Order, Side


@dataclass(frozen=True)
class RiskDecision:
    approved: bool
    reason: str


class RiskManager:
    def __init__(self, config: RiskConfig) -> None:
        self.config = config
        self.realized_pnl_today = 0.0

    def approve(self, order: Order, cash: float, positions: dict[str, int]) -> RiskDecision:
        order_value = order.quantity * order.price
        current_position = positions.get(order.symbol, 0)

        if order.quantity <= 0:
            return RiskDecision(False, "quantity must be positive")
        if order_value > self.config.max_order_value:
            return RiskDecision(False, "order value exceeds max_order_value")
        if self.realized_pnl_today <= -abs(self.config.max_daily_loss):
            return RiskDecision(False, "max_daily_loss reached")

        if order.side == Side.BUY:
            if order_value > cash:
                return RiskDecision(False, "not enough cash")
            new_position_value = (current_position + order.quantity) * order.price
            if new_position_value > self.config.max_position_value:
                return RiskDecision(False, "position value exceeds max_position_value")

        if order.side == Side.SELL:
            if not self.config.allow_short_selling and order.quantity > current_position:
                return RiskDecision(False, "short selling is disabled")

        return RiskDecision(True, "approved")


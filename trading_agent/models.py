from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


@dataclass(frozen=True)
class Quote:
    symbol: str
    price: float
    timestamp: datetime


@dataclass(frozen=True)
class Signal:
    symbol: str
    side: Side
    quantity: int
    reason: str


@dataclass(frozen=True)
class Order:
    symbol: str
    side: Side
    quantity: int
    price: float
    created_at: datetime

    @classmethod
    def from_signal(cls, signal: Signal, price: float) -> "Order":
        return cls(
            symbol=signal.symbol,
            side=signal.side,
            quantity=signal.quantity,
            price=price,
            created_at=datetime.now(timezone.utc),
        )


@dataclass(frozen=True)
class Fill:
    symbol: str
    side: Side
    quantity: int
    price: float
    cash_after: float
    position_after: int
    filled_at: datetime


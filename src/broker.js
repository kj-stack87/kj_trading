import { Side } from "./models.js";

export class PaperBroker {
  constructor(startingCash, journal) {
    this.cash = startingCash;
    this.positions = new Map();
    this.averageCost = new Map();
    this.realizedPnlToday = 0;
    this.fills = [];
    this.exitOrders = [];
    this.journal = journal;
  }

  async submitOrder(order) {
    const orderValue = order.quantity * order.price;
    const current = this.positions.get(order.symbol) ?? 0;
    const avgCost = this.averageCost.get(order.symbol) ?? 0;

    if (order.side === Side.BUY) {
      const newQuantity = current + order.quantity;
      const newCost = current * avgCost + orderValue;
      this.cash -= orderValue;
      this.positions.set(order.symbol, newQuantity);
      this.averageCost.set(order.symbol, newCost / newQuantity);
    } else {
      const sellQuantity = Math.min(order.quantity, current);
      const realized = (order.price - avgCost) * sellQuantity;
      this.cash += orderValue;
      this.positions.set(order.symbol, current - order.quantity);
      this.realizedPnlToday += realized;
      if ((this.positions.get(order.symbol) ?? 0) <= 0) this.averageCost.delete(order.symbol);
      this.cancelExitOrders(order.symbol);
    }

    const fill = {
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      price: order.price,
      cashAfter: round2(this.cash),
      positionAfter: this.positions.get(order.symbol) ?? 0,
      realizedPnlToday: round2(this.realizedPnlToday),
      filledAt: new Date().toISOString()
    };

    this.fills.unshift(fill);
    this.fills = this.fills.slice(0, 50);
    this.journal.write("fill", { fill });
    console.log(`페이퍼 체결: ${fill.symbol} ${fill.side === "buy" ? "매수" : "매도"} ${fill.quantity}주 @ ${fill.price.toFixed(2)} | 현금=${fill.cashAfter.toFixed(2)} 보유=${fill.positionAfter}`);
    return fill;
  }

  placeExitBracket({ symbol, quantity, entryPrice, takeProfitPrice, stopLossPrice, reason }) {
    this.cancelExitOrders(symbol);
    const bracket = {
      id: `${symbol}-${Date.now()}`,
      symbol,
      quantity,
      entryPrice: round2(entryPrice),
      takeProfitPrice: round2(takeProfitPrice),
      stopLossPrice: round2(stopLossPrice),
      reason,
      createdAt: new Date().toISOString()
    };
    this.exitOrders.unshift(bracket);
    this.journal.write("bracket_order", { bracket });
    console.log(`예약 매도: ${symbol} 익절 ${bracket.takeProfitPrice.toFixed(2)} / 손절 ${bracket.stopLossPrice.toFixed(2)}`);
    return bracket;
  }

  async checkExitOrders(quotes) {
    const fills = [];
    for (const bracket of [...this.exitOrders]) {
      const quote = quotes.get(bracket.symbol);
      const position = this.positions.get(bracket.symbol) ?? 0;
      if (!quote || position <= 0) continue;

      if (quote.price >= bracket.takeProfitPrice) {
        fills.push(await this.submitOrder({
          symbol: bracket.symbol,
          side: Side.SELL,
          quantity: Math.min(bracket.quantity, position),
          price: quote.price,
          createdAt: new Date().toISOString(),
          reason: "take profit bracket"
        }));
      } else if (quote.price <= bracket.stopLossPrice) {
        fills.push(await this.submitOrder({
          symbol: bracket.symbol,
          side: Side.SELL,
          quantity: Math.min(bracket.quantity, position),
          price: quote.price,
          createdAt: new Date().toISOString(),
          reason: "stop loss bracket"
        }));
      }
    }
    return fills;
  }

  cancelExitOrders(symbol) {
    this.exitOrders = this.exitOrders.filter((order) => order.symbol !== symbol);
  }

  getSnapshot(quotes = new Map()) {
    const positions = [...this.positions.entries()].map(([symbol, quantity]) => {
      const price = quotes.get(symbol)?.price ?? this.averageCost.get(symbol) ?? 0;
      const averageCost = this.averageCost.get(symbol) ?? 0;
      return {
        symbol,
        quantity,
        averageCost: round2(averageCost),
        marketPrice: round2(price),
        marketValue: round2(quantity * price),
        unrealizedPnl: round2((price - averageCost) * quantity),
        unrealizedPnlRate: averageCost > 0 ? round4((price - averageCost) / averageCost) : 0
      };
    });
    const positionsValue = positions.reduce((sum, position) => sum + position.marketValue, 0);

    return {
      provider: "paper",
      cash: round2(this.cash),
      equity: round2(this.cash + positionsValue),
      realizedPnlToday: round2(this.realizedPnlToday),
      positions,
      recentFills: this.fills,
      exitOrders: this.exitOrders
    };
  }
}

export class AlpacaBroker {
  constructor({ config, journal }) {
    this.config = config;
    this.journal = journal;
    this.cash = config.startingCash;
    this.positions = new Map();
    this.fills = [];
    this.baseUrl = process.env.ALPACA_TRADING_BASE_URL ?? "https://paper-api.alpaca.markets";
    this.keyId = process.env.ALPACA_API_KEY_ID;
    this.secretKey = process.env.ALPACA_API_SECRET_KEY;
  }

  async submitOrder(order) {
    if (!this.config.liveTradingEnabled || process.env.ENABLE_LIVE_TRADING !== "true") {
      throw new Error("Live trading is locked. Set live_trading_enabled=true and ENABLE_LIVE_TRADING=true only after paper testing.");
    }
    if (!this.keyId || !this.secretKey) {
      throw new Error("Missing ALPACA_API_KEY_ID or ALPACA_API_SECRET_KEY.");
    }

    const response = await fetch(`${this.baseUrl}/v2/orders`, {
      method: "POST",
      headers: {
        "APCA-API-KEY-ID": this.keyId,
        "APCA-API-SECRET-KEY": this.secretKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        symbol: order.symbol,
        side: order.side,
        qty: String(order.quantity),
        type: "market",
        time_in_force: "day"
      })
    });

    if (!response.ok) {
      throw new Error(`Alpaca order failed: ${response.status} ${await response.text()}`);
    }

    const result = await response.json();
    this.journal.write("live_order", { order, result });
    return result;
  }

  getSnapshot() {
    return {
      provider: "alpaca",
      cash: this.cash,
      equity: this.cash,
      realizedPnlToday: 0,
      positions: [...this.positions.entries()].map(([symbol, quantity]) => ({ symbol, quantity })),
      recentFills: this.fills
    };
  }
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

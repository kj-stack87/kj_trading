import { createOrderFromSignal } from "./models.js";

export class TradingAgent {
  constructor({ config, marketData, strategy, broker, risk }) {
    this.config = config;
    this.marketData = marketData;
    this.strategy = strategy;
    this.broker = broker;
    this.risk = risk;
    this.lastQuotes = new Map();
    this.lastSignals = [];
    this.rejections = [];
    this.lastCycleAt = null;
    this.lastError = null;
  }

  runForever() {
    console.log(`Trading agent started in ${this.config.mode} mode.`);
    this.runOnce();
    setInterval(() => {
      this.runOnce().catch((error) => {
        this.lastError = error.message;
        console.error(`Agent cycle failed: ${error.message}`);
      });
    }, this.config.loopIntervalSeconds * 1000);
  }

  async runOnce() {
    this.lastCycleAt = new Date().toISOString();
    this.lastError = null;

    if (this.risk.isEmergencyStopped()) {
      console.warn("긴급정지가 켜져 있어 이번 사이클을 건너뜁니다.");
      return;
    }

    const quotes = await this.marketData.getQuotes();
    this.lastQuotes = quotes;
    const quoteSummary = [...quotes.values()].map((quote) => `${quote.symbol}=${quote.price.toFixed(2)}`).join(", ");
    console.log(`시세: ${quoteSummary}`);

    if (typeof this.broker.checkExitOrders === "function") {
      const exitFills = await this.broker.checkExitOrders(quotes);
      if (exitFills.length > 0) {
        for (const fill of exitFills) this.notifyStrategyExit(fill);
        this.lastSignals = exitFills.map((fill) => ({
          symbol: fill.symbol,
          side: fill.side,
          quantity: fill.quantity,
          reason: "reserved exit filled"
        }));
        return;
      }
    }

    const signals = this.strategy.onQuotes(quotes, this.broker.cash, this.broker.positions);
    this.lastSignals = signals;
    if (signals.length === 0) {
      console.log("매매 신호 없음.");
      return;
    }

    for (const signal of signals) {
      const quote = quotes.get(signal.symbol);
      const order = createOrderFromSignal(signal, quote.price);
      const decision = this.risk.approve(order, {
        cash: this.broker.cash,
        positions: this.broker.positions,
        realizedPnlToday: this.broker.realizedPnlToday ?? 0
      });

      if (!decision.approved) {
        this.rejections.unshift({
          signal,
          reason: decision.reason,
          createdAt: new Date().toISOString()
        });
        this.rejections = this.rejections.slice(0, 50);
        console.warn(`주문 거절: ${signal.symbol} ${translateSide(signal.side)} - ${decision.reason}`);
        continue;
      }

      console.log(`매매 신호 승인: ${signal.symbol} ${translateSide(signal.side)} ${signal.quantity}주 (${signal.reason})`);
      const fill = await this.broker.submitOrder(order);
      this.placeBracketAfterBuy(fill);
      if (fill.side === "sell") this.notifyStrategyExit(fill);
    }
  }

  placeBracketAfterBuy(fill) {
    if (typeof this.broker.placeExitBracket !== "function") return;
    if (typeof this.strategy.getBracketPlan !== "function") return;
    const plan = this.strategy.getBracketPlan(fill);
    if (!plan) return;
    this.broker.placeExitBracket({
      symbol: fill.symbol,
      quantity: fill.quantity,
      entryPrice: fill.price,
      takeProfitPrice: plan.takeProfitPrice,
      stopLossPrice: plan.stopLossPrice,
      reason: plan.reason
    });
  }

  notifyStrategyExit(fill) {
    if (typeof this.strategy.recordExit === "function") {
      this.strategy.recordExit(fill);
    }
  }

  getStatus() {
    return {
      mode: this.config.mode,
      liveTradingEnabled: this.config.liveTradingEnabled,
      emergencyStopped: this.risk.isEmergencyStopped(),
      lastCycleAt: this.lastCycleAt,
      lastError: this.lastError,
      symbolNames: this.config.symbolNames,
      strategyStatus: typeof this.strategy.getStatus === "function" ? this.strategy.getStatus() : null,
      strategyConfig: {
        dailyProfitTarget: this.config.strategy.dailyProfitTarget
      },
      quotes: [...this.lastQuotes.values()],
      signals: this.lastSignals,
      rejections: this.rejections,
      account: this.broker.getSnapshot(this.lastQuotes)
    };
  }

  emergencyStop(reason) {
    this.risk.activateEmergencyStop(reason);
  }

  resume() {
    this.risk.clearEmergencyStop();
  }

  setDailyProfitTarget(target) {
    this.config.strategy.dailyProfitTarget = target;
    if (typeof this.strategy.setDailyProfitTarget === "function") {
      this.strategy.setDailyProfitTarget(target);
    }
  }
}

function translateSide(side) {
  return side === "buy" ? "매수" : "매도";
}

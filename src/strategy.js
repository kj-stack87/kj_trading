import { Side } from "./models.js";

export class PairedEtfRotationStrategy {
  constructor(config) {
    this.config = config;
    this.entry = null;
    this.tradeCount = 0;
    this.targetReached = false;
    this.startEquity = null;
    this.currentEquity = null;
    this.rotationCount = 0;
    this.allocationIndex = 0;
    this.lastAllocationFraction = this.currentAllocationFraction();
    this.consecutiveLosses = 0;
    this.cooldownRemaining = 0;
    this.nextSymbol = config.longSymbol;
    this.roundNo = 1;
    this.roundStartedAt = new Date().toISOString();
    this.roundHistory = [];
  }

  onQuotes(quotes, cash, positions) {
    if (this.targetReached || this.tradeCount >= this.config.maxDailyTrades) return [];

    const longQuote = quotes.get(this.config.longSymbol);
    const inverseQuote = quotes.get(this.config.inverseSymbol);
    if (!longQuote || !inverseQuote) return [];

    const longQty = positions.get(this.config.longSymbol) ?? 0;
    const inverseQty = positions.get(this.config.inverseSymbol) ?? 0;
    const currentSymbol = longQty > 0 ? this.config.longSymbol : inverseQty > 0 ? this.config.inverseSymbol : null;
    const currentQty = currentSymbol === this.config.longSymbol ? longQty : inverseQty;
    const currentQuote = currentSymbol === this.config.longSymbol ? longQuote : inverseQuote;
    const equity = estimateEquity(cash, positions, quotes);
    this.startEquity ??= equity;
    this.currentEquity = equity;
    const targetEquity = this.startEquity * (1 + this.config.dailyProfitTarget);
    const dailyStopEquity = this.startEquity * (1 - this.config.dailyStopLoss);

    if (!currentSymbol) {
      if (this.cooldownRemaining > 0) {
        this.cooldownRemaining -= 1;
        return [];
      }
      const targetSymbol = this.nextSymbol;
      const targetQuote = targetSymbol === this.config.longSymbol ? longQuote : inverseQuote;
      return [this.buySignal(targetSymbol, targetQuote.price, equity, targetSymbol === this.config.longSymbol ? "start with semiconductor ETF" : "start with inverse semiconductor ETF")];
    }

    if (!this.entry || this.entry.symbol !== currentSymbol) {
      this.entry = { symbol: currentSymbol, price: currentQuote.price };
    }

    const pnlRate = (currentQuote.price - this.entry.price) / this.entry.price;
    const accountPnlRate = (equity - this.startEquity) / this.startEquity;

    if (equity >= targetEquity) {
      this.tradeCount += 1;
      this.closeRound("target", "10% target reached", equity);
      return [{
        symbol: currentSymbol,
        side: Side.SELL,
        quantity: currentQty,
        reason: `account target reached: ${(accountPnlRate * 100).toFixed(2)}%`
      }];
    }

    if (equity <= dailyStopEquity) {
      this.tradeCount += 1;
      this.closeRound("stop_loss", "daily stop loss reached", equity);
      return [{
        symbol: currentSymbol,
        side: Side.SELL,
        quantity: currentQty,
        reason: `daily stop loss: ${(((equity - this.startEquity) / this.startEquity) * 100).toFixed(2)}%`
      }];
    }

    if (pnlRate <= -Math.abs(this.config.switchLossThreshold)) {
      const nextSymbol = currentSymbol === this.config.longSymbol ? this.config.inverseSymbol : this.config.longSymbol;
      const nextQuote = nextSymbol === this.config.longSymbol ? longQuote : inverseQuote;
      this.prepareNextAfterLoss(nextSymbol);
      this.tradeCount += 1;
      return [
        {
          symbol: currentSymbol,
          side: Side.SELL,
          quantity: currentQty,
          reason: `direction down rotate out: ${(pnlRate * 100).toFixed(2)}%`
        },
      ];
    }

    return [];
  }

  buySignal(symbol, price, equity, reason) {
    const fraction = this.currentAllocationFraction();
    const quantity = Math.floor((equity * fraction) / price);
    this.tradeCount += 1;
    this.entry = { symbol, price };
    this.lastAllocationFraction = fraction;
    return {
      symbol,
      side: Side.BUY,
      quantity,
      reason
    };
  }

  getBracketPlan(fill) {
    if (fill.side !== Side.BUY) return null;
    const takeProfitRate = this.config.perTradeTakeProfit;
    const stopLossRate = Math.abs(this.config.switchLossThreshold);
    return {
      takeProfitPrice: fill.price * (1 + takeProfitRate),
      stopLossPrice: fill.price * (1 - stopLossRate),
      reason: `bracket per-trade +${(takeProfitRate * 100).toFixed(2)}%`
    };
  }

  currentAllocationFraction() {
    return this.config.allocationSteps[Math.min(this.allocationIndex, this.config.allocationSteps.length - 1)];
  }

  prepareNextAfterLoss(nextSymbol) {
    this.nextSymbol = nextSymbol;
    this.entry = null;
    this.rotationCount += 1;
    this.consecutiveLosses += 1;
    this.allocationIndex = Math.min(this.allocationIndex + 1, this.config.allocationSteps.length - 1);
    if (this.consecutiveLosses >= this.config.cooldownAfterLosses) {
      this.cooldownRemaining = this.config.cooldownCycles;
      this.consecutiveLosses = 0;
    }
  }

  recordExit(fill) {
    if (fill.side !== Side.SELL || !this.startEquity || !this.currentEquity) return;
    const wasLoss = fill.price < (this.entry?.price ?? fill.price);
    const nextSymbol = fill.symbol === this.config.longSymbol ? this.config.inverseSymbol : this.config.longSymbol;
    this.entry = null;

    if (wasLoss) {
      this.prepareNextAfterLoss(nextSymbol);
    } else {
      this.consecutiveLosses = 0;
      this.allocationIndex = 0;
      this.nextSymbol = fill.symbol;
    }
  }

  getStatus() {
    const targetEquity = this.startEquity === null ? null : this.startEquity * (1 + this.config.dailyProfitTarget);
    const accountPnlRate = this.startEquity && this.currentEquity
      ? (this.currentEquity - this.startEquity) / this.startEquity
      : 0;
    const progressRate = targetEquity && this.currentEquity
      ? (this.currentEquity - this.startEquity) / (targetEquity - this.startEquity)
      : 0;

    return {
      strategyName: "paired_etf_rotation",
      roundNo: this.roundNo,
      roundStartedAt: this.roundStartedAt,
      roundHistory: this.roundHistory,
      startEquity: this.startEquity,
      currentEquity: this.currentEquity,
      targetEquity,
      accountPnlRate,
      progressRate,
      rotationCount: this.rotationCount,
      allocationIndex: this.allocationIndex,
      currentAllocationFraction: this.currentAllocationFraction(),
      lastAllocationFraction: this.lastAllocationFraction,
      perTradeTakeProfit: this.config.perTradeTakeProfit,
      switchLossThreshold: this.config.switchLossThreshold,
      dailyStopLoss: this.config.dailyStopLoss,
      consecutiveLosses: this.consecutiveLosses,
      cooldownRemaining: this.cooldownRemaining,
      targetReached: this.targetReached,
      tradeCount: this.tradeCount,
      maxDailyTrades: this.config.maxDailyTrades
    };
  }

  setDailyProfitTarget(target) {
    this.config.dailyProfitTarget = target;
    this.targetReached = false;
  }

  closeRound(result, reason, equity) {
    const startEquity = this.startEquity ?? equity;
    const pnl = equity - startEquity;
    this.roundHistory.unshift({
      no: this.roundNo,
      result,
      reason,
      startedAt: this.roundStartedAt,
      endedAt: new Date().toISOString(),
      startEquity: round2(startEquity),
      endEquity: round2(equity),
      pnl: round2(pnl),
      pnlRate: startEquity > 0 ? round4(pnl / startEquity) : 0,
      tradeCount: this.tradeCount,
      rotationCount: this.rotationCount
    });
    this.roundHistory = this.roundHistory.slice(0, 100);
    this.resetForNextRound(equity);
  }

  resetForNextRound(equity) {
    this.roundNo += 1;
    this.roundStartedAt = new Date().toISOString();
    this.startEquity = equity;
    this.currentEquity = equity;
    this.entry = null;
    this.targetReached = false;
    this.nextSymbol = this.config.longSymbol;
    this.allocationIndex = 0;
    this.rotationCount = 0;
    this.consecutiveLosses = 0;
    this.cooldownRemaining = 0;
    this.tradeCount = 0;
  }
}

export class AvatarComboStrategy {
  constructor(config) {
    this.config = config;
    this.history = new Map();
    this.lastTrend = new Map();
    this.lastMacd = new Map();
    this.initialBuyDone = false;
  }

  onQuotes(quotes, cash, positions) {
    const signals = [];

    if (this.config.forceInitialBuy && !this.initialBuyDone) {
      this.initialBuyDone = true;
      const [symbol, quote] = quotes.entries().next().value ?? [];
      if (symbol && (positions.get(symbol) ?? 0) === 0) {
        const quantity = Math.floor((cash * this.config.tradeFraction) / quote.price);
        if (quantity > 0) {
          signals.push({
            symbol,
            side: Side.BUY,
            quantity,
            reason: "initial simulation buy"
          });
          return signals;
        }
      }
    }

    for (const [symbol, quote] of quotes.entries()) {
      const prices = this.getHistory(symbol);
      prices.push(quote.price);
      if (prices.length > this.config.macdSlow + this.config.macdSignal + 20) prices.shift();
      if (prices.length < Math.max(this.config.longWindow, this.config.rsiPeriod + 1, this.config.macdSlow)) continue;

      const indicators = this.calculateIndicators(prices);
      const position = positions.get(symbol) ?? 0;
      const trend = indicators.shortMa > indicators.longMa ? "bullish" : "bearish";
      const previousTrend = this.lastTrend.get(symbol);
      const previousMacd = this.lastMacd.get(symbol);
      this.lastTrend.set(symbol, trend);
      this.lastMacd.set(symbol, indicators.macdHistogram);

      const bullishCross = previousTrend === "bearish" && trend === "bullish";
      const macdTurnedUp = previousMacd !== undefined && previousMacd <= 0 && indicators.macdHistogram > 0;
      const oversoldBounce = indicators.rsi <= this.config.rsiBuyBelow && trend === "bullish";

      if (position === 0 && (bullishCross || macdTurnedUp || oversoldBounce)) {
        const quantity = Math.floor((cash * this.config.tradeFraction) / quote.price);
        if (quantity > 0) {
          signals.push({
            symbol,
            side: Side.BUY,
            quantity,
            reason: `buy: trend=${trend}, rsi=${indicators.rsi.toFixed(1)}, macdHist=${indicators.macdHistogram.toFixed(3)}`
          });
        }
      }

      const bearishCross = previousTrend === "bullish" && trend === "bearish";
      const macdTurnedDown = previousMacd !== undefined && previousMacd >= 0 && indicators.macdHistogram < 0;
      const overbought = indicators.rsi >= this.config.rsiSellAbove;

      if (position > 0 && (bearishCross || macdTurnedDown || overbought)) {
        signals.push({
          symbol,
          side: Side.SELL,
          quantity: position,
          reason: `sell: trend=${trend}, rsi=${indicators.rsi.toFixed(1)}, macdHist=${indicators.macdHistogram.toFixed(3)}`
        });
      }
    }

    return signals;
  }

  calculateIndicators(prices) {
    return {
      shortMa: average(prices.slice(-this.config.shortWindow)),
      longMa: average(prices.slice(-this.config.longWindow)),
      rsi: calculateRsi(prices, this.config.rsiPeriod),
      macdHistogram: calculateMacdHistogram(prices, this.config.macdFast, this.config.macdSlow, this.config.macdSignal)
    };
  }

  getHistory(symbol) {
    if (!this.history.has(symbol)) this.history.set(symbol, []);
    return this.history.get(symbol);
  }
}

function estimateEquity(cash, positions, quotes) {
  let equity = cash;
  for (const [symbol, quantity] of positions.entries()) {
    equity += quantity * (quotes.get(symbol)?.price ?? 0);
  }
  return equity;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function calculateRsi(prices, period) {
  const window = prices.slice(-(period + 1));
  let gains = 0;
  let losses = 0;

  for (let index = 1; index < window.length; index += 1) {
    const change = window[index] - window[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function calculateMacdHistogram(prices, fastPeriod, slowPeriod, signalPeriod) {
  const fast = emaSeries(prices, fastPeriod);
  const slow = emaSeries(prices, slowPeriod);
  const macdSeries = fast.slice(-slow.length).map((value, index) => value - slow[index]);
  const signal = emaSeries(macdSeries, signalPeriod);
  return macdSeries[macdSeries.length - 1] - signal[signal.length - 1];
}

function emaSeries(values, period) {
  const multiplier = 2 / (period + 1);
  const output = [];
  let ema = values[0];

  for (const value of values) {
    ema = value * multiplier + ema * (1 - multiplier);
    output.push(ema);
  }

  return output;
}

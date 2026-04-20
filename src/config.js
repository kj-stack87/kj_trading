import fs from "node:fs";

export function loadConfig(path) {
  const resolvedPath = fs.existsSync(path) ? path : "config.example.json";
  const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

  if (raw.mode !== "paper") {
    throw new Error("Only paper mode is enabled in this starter project.");
  }

  const config = {
    mode: raw.mode,
    liveTradingEnabled: Boolean(raw.live_trading_enabled),
    symbols: raw.symbols,
    symbolNames: raw.symbol_names ?? {},
    loopIntervalSeconds: raw.loop_interval_seconds,
    startingCash: raw.starting_cash,
    strategy: {
      name: raw.strategy.name ?? "avatar_combo",
      longSymbol: raw.strategy.long_symbol,
      inverseSymbol: raw.strategy.inverse_symbol,
      forceInitialBuy: raw.strategy.force_initial_buy ?? true,
      dailyProfitTarget: raw.strategy.daily_profit_target ?? 0.01,
      perTradeTakeProfit: raw.strategy.per_trade_take_profit ?? 0.008,
      switchLossThreshold: raw.strategy.switch_loss_threshold ?? 0.003,
      dailyStopLoss: raw.strategy.daily_stop_loss ?? 0.03,
      maxDailyTrades: raw.strategy.max_daily_trades ?? 8,
      allocationSteps: raw.strategy.allocation_steps ?? [0.35, 0.5, 0.7, 0.9],
      cooldownAfterLosses: raw.strategy.cooldown_after_losses ?? 3,
      cooldownCycles: raw.strategy.cooldown_cycles ?? 12,
      shortWindow: raw.strategy.short_window,
      longWindow: raw.strategy.long_window,
      tradeFraction: raw.strategy.trade_fraction,
      rsiPeriod: raw.strategy.rsi_period ?? 14,
      rsiBuyBelow: raw.strategy.rsi_buy_below ?? 35,
      rsiSellAbove: raw.strategy.rsi_sell_above ?? 70,
      macdFast: raw.strategy.macd_fast ?? 12,
      macdSlow: raw.strategy.macd_slow ?? 26,
      macdSignal: raw.strategy.macd_signal ?? 9
    },
    risk: {
      maxPositionValue: raw.risk.max_position_value,
      maxOrderValue: raw.risk.max_order_value,
      maxDailyLoss: raw.risk.max_daily_loss,
      allowShortSelling: raw.risk.allow_short_selling,
      emergencyStopFile: raw.risk.emergency_stop_file ?? "data/emergency-stop.json"
    },
    marketData: {
      provider: raw.market_data.provider,
      seedPrice: raw.market_data.seed_price
    },
    broker: {
      provider: raw.broker?.provider ?? "paper"
    },
    dashboard: {
      enabled: raw.dashboard?.enabled ?? true,
      port: raw.dashboard?.port ?? 8787
    },
    gitPublish: {
      enabled: raw.git_publish?.enabled ?? false,
      docsDir: raw.git_publish?.docs_dir ?? "docs",
      intervalSeconds: raw.git_publish?.interval_seconds ?? 60,
      commitAndPush: raw.git_publish?.commit_and_push ?? false
    }
  };

  validateConfig(config);
  return config;
}

function validateConfig(config) {
  if (!Array.isArray(config.symbols) || config.symbols.length === 0) {
    throw new Error("symbols must contain at least one ticker.");
  }
  if (config.strategy.shortWindow >= config.strategy.longWindow) {
    throw new Error("strategy.short_window must be smaller than long_window.");
  }
  if (config.strategy.tradeFraction <= 0 || config.strategy.tradeFraction > 1) {
    throw new Error("strategy.trade_fraction must be between 0 and 1.");
  }
  if (config.loopIntervalSeconds < 1) {
    throw new Error("loop_interval_seconds must be at least 1.");
  }
}

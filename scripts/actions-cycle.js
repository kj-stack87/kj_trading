import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = fs.existsSync("config.json") ? "config.json" : "config.example.json";
const DOCS_DIR = "docs";
const STATE_PATH = path.join(DOCS_DIR, "action-state.json");
const STATUS_PATH = path.join(DOCS_DIR, "status.json");
const HISTORY_PATH = path.join(DOCS_DIR, "history.json");
const INDEX_PATH = path.join(DOCS_DIR, "index.html");

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
fs.mkdirSync(DOCS_DIR, { recursive: true });

const state = loadState();
ensureRoundState(state);
const quotes = nextQuotes(state);
const fills = [];

checkExitOrders(state, quotes, fills);
runStrategyCycle(state, quotes, fills);
completeRoundIfNeeded(state, quotes);

const status = buildStatus(state, quotes);
const history = buildHistory(state);

writeJson(STATE_PATH, state);
writeJson(STATUS_PATH, status);
writeJson(HISTORY_PATH, history);
fs.writeFileSync(INDEX_PATH, renderDashboard(), "utf8");

console.log(`cycle=${state.tick} round=${state.roundNo} equity=${status.account.equity} fills=${fills.length}`);

function loadState() {
  if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  return freshState();
}

function freshState() {
  return {
    tick: 0,
    randomState: 42,
    cash: config.starting_cash,
    positions: {},
    averageCost: {},
    realizedPnlToday: 0,
    startEquity: null,
    roundNo: 1,
    roundStartedAt: new Date().toISOString(),
    roundHistory: [],
    targetReached: false,
    nextSymbol: config.strategy.long_symbol,
    allocationIndex: 0,
    rotationCount: 0,
    consecutiveLosses: 0,
    cooldownRemaining: 0,
    tradeCount: 0,
    fills: [],
    exitOrders: [],
    prices: Object.fromEntries(config.symbols.map((symbol, index) => [symbol, config.market_data.seed_price + index * 7.5]))
  };
}

function nextQuotes(state) {
  state.tick += 1;
  const quotes = {};
  const now = new Date().toISOString();
  config.symbols.forEach((symbol, index) => {
    const current = state.prices[symbol] ?? config.market_data.seed_price;
    const wave = Math.sin((state.tick + index) / 5) * 0.6;
    const noise = nextRandomBetween(state, -0.35, 0.35);
    const price = round2(Math.max(1, current + wave + noise));
    state.prices[symbol] = price;
    quotes[symbol] = { symbol, price, timestamp: now };
  });
  return quotes;
}

function runStrategyCycle(state, quotes, fills) {
  if (state.targetReached || state.tradeCount >= config.strategy.max_daily_trades) return;
  const equity = estimateEquity(state, quotes);
  state.startEquity ??= equity;
  const targetEquity = state.startEquity * (1 + config.strategy.daily_profit_target);
  const dailyStopEquity = state.startEquity * (1 - config.strategy.daily_stop_loss);

  if (equity >= targetEquity) {
    sellAll(state, quotes, fills, "account target reached");
    state.pendingRoundClose = { result: "target", reason: "target reached", closedAt: new Date().toISOString() };
    return;
  }
  if (equity <= dailyStopEquity) {
    sellAll(state, quotes, fills, "daily stop loss");
    state.pendingRoundClose = { result: "stop_loss", reason: "daily stop loss reached", closedAt: new Date().toISOString() };
    return;
  }

  if (!currentHoldingSymbol(state)) {
    if (state.cooldownRemaining > 0) {
      state.cooldownRemaining -= 1;
      return;
    }
    buySymbol(state, state.nextSymbol, quotes[state.nextSymbol].price, fills, "scheduled entry");
  }
}

function checkExitOrders(state, quotes, fills) {
  for (const order of [...state.exitOrders]) {
    const quote = quotes[order.symbol];
    const quantity = state.positions[order.symbol] ?? 0;
    if (!quote || quantity <= 0) continue;
    if (quote.price >= order.takeProfitPrice) {
      sellSymbol(state, order.symbol, Math.min(quantity, order.quantity), quote.price, fills, "take profit bracket");
      state.allocationIndex = 0;
      state.consecutiveLosses = 0;
      state.nextSymbol = order.symbol;
    } else if (quote.price <= order.stopLossPrice) {
      sellSymbol(state, order.symbol, Math.min(quantity, order.quantity), quote.price, fills, "stop loss bracket");
      const nextSymbol = order.symbol === config.strategy.long_symbol ? config.strategy.inverse_symbol : config.strategy.long_symbol;
      prepareNextAfterLoss(state, nextSymbol);
    }
  }
}

function buySymbol(state, symbol, price, fills, reason) {
  const allocation = allocationFraction(state);
  const equity = estimateEquity(state, objectQuotesFromPrices(state));
  const quantity = Math.floor((equity * allocation) / price);
  if (quantity <= 0) return;
  state.cash -= quantity * price;
  state.positions[symbol] = (state.positions[symbol] ?? 0) + quantity;
  state.averageCost[symbol] = price;
  state.tradeCount += 1;
  addFill(state, fills, { symbol, side: "buy", quantity, price, reason });
  placeExitBracket(state, symbol, quantity, price);
}

function sellSymbol(state, symbol, quantity, price, fills, reason) {
  const current = state.positions[symbol] ?? 0;
  if (current <= 0 || quantity <= 0) return;
  const sellQuantity = Math.min(quantity, current);
  const averageCost = state.averageCost[symbol] ?? price;
  state.cash += sellQuantity * price;
  state.positions[symbol] = current - sellQuantity;
  state.realizedPnlToday += (price - averageCost) * sellQuantity;
  if (state.positions[symbol] <= 0) {
    delete state.positions[symbol];
    delete state.averageCost[symbol];
    state.exitOrders = state.exitOrders.filter((order) => order.symbol !== symbol);
  }
  state.tradeCount += 1;
  addFill(state, fills, { symbol, side: "sell", quantity: sellQuantity, price, reason });
}

function sellAll(state, quotes, fills, reason) {
  for (const [symbol, quantity] of Object.entries(state.positions)) {
    sellSymbol(state, symbol, quantity, quotes[symbol]?.price ?? state.averageCost[symbol], fills, reason);
  }
}

function placeExitBracket(state, symbol, quantity, entryPrice) {
  state.exitOrders = state.exitOrders.filter((order) => order.symbol !== symbol);
  state.exitOrders.unshift({
    id: `${symbol}-${Date.now()}`,
    symbol,
    quantity,
    entryPrice: round2(entryPrice),
    takeProfitPrice: round2(entryPrice * (1 + config.strategy.per_trade_take_profit)),
    stopLossPrice: round2(entryPrice * (1 - config.strategy.switch_loss_threshold)),
    createdAt: new Date().toISOString()
  });
}

function prepareNextAfterLoss(state, nextSymbol) {
  state.nextSymbol = nextSymbol;
  state.rotationCount += 1;
  state.consecutiveLosses += 1;
  state.allocationIndex = Math.min(state.allocationIndex + 1, config.strategy.allocation_steps.length - 1);
  if (state.consecutiveLosses >= config.strategy.cooldown_after_losses) {
    state.cooldownRemaining = config.strategy.cooldown_cycles;
    state.consecutiveLosses = 0;
  }
}

function ensureRoundState(state) {
  state.roundNo ??= 1;
  state.roundStartedAt ??= new Date().toISOString();
  state.roundHistory ??= [];
  state.pendingRoundClose ??= null;
}

function completeRoundIfNeeded(state, quotes) {
  if (!state.pendingRoundClose) return;
  const endEquity = estimateEquity(state, quotes);
  const startEquity = state.startEquity ?? endEquity;
  const pnl = endEquity - startEquity;
  state.roundHistory.unshift({
    no: state.roundNo,
    result: state.pendingRoundClose.result,
    reason: state.pendingRoundClose.reason,
    startedAt: state.roundStartedAt,
    endedAt: state.pendingRoundClose.closedAt,
    startEquity: round2(startEquity),
    endEquity: round2(endEquity),
    pnl: round2(pnl),
    pnlRate: startEquity > 0 ? round4(pnl / startEquity) : 0,
    tradeCount: state.tradeCount,
    rotationCount: state.rotationCount
  });
  state.roundHistory = state.roundHistory.slice(0, 100);
  resetForNextRound(state, endEquity);
}

function resetForNextRound(state, equity) {
  state.roundNo += 1;
  state.roundStartedAt = new Date().toISOString();
  state.startEquity = equity;
  state.targetReached = false;
  state.nextSymbol = config.strategy.long_symbol;
  state.allocationIndex = 0;
  state.rotationCount = 0;
  state.consecutiveLosses = 0;
  state.cooldownRemaining = 0;
  state.tradeCount = 0;
  state.exitOrders = [];
  state.pendingRoundClose = null;
}

function buildStatus(state, quotes) {
  const equity = estimateEquity(state, quotes);
  const accountPnlRate = state.startEquity ? (equity - state.startEquity) / state.startEquity : 0;
  const progressRate = config.strategy.daily_profit_target > 0 ? accountPnlRate / config.strategy.daily_profit_target : 0;
  return {
    mode: "github-actions-paper",
    publishedAt: new Date().toISOString(),
    round: { no: state.roundNo, startedAt: state.roundStartedAt, history: state.roundHistory ?? [] },
    symbolNames: config.symbol_names,
    quotes: Object.values(quotes),
    strategyConfig: { dailyProfitTarget: config.strategy.daily_profit_target },
    strategyStatus: {
      strategyName: "github_actions_rotation",
      startEquity: state.startEquity,
      currentEquity: equity,
      accountPnlRate,
      progressRate,
      roundNo: state.roundNo,
      rotationCount: state.rotationCount,
      allocationIndex: state.allocationIndex,
      currentAllocationFraction: allocationFraction(state),
      perTradeTakeProfit: config.strategy.per_trade_take_profit,
      switchLossThreshold: config.strategy.switch_loss_threshold,
      consecutiveLosses: state.consecutiveLosses,
      cooldownRemaining: state.cooldownRemaining,
      targetReached: state.targetReached,
      tradeCount: state.tradeCount,
      maxDailyTrades: config.strategy.max_daily_trades
    },
    account: {
      provider: "github-actions-paper",
      cash: round2(state.cash),
      equity: round2(equity),
      realizedPnlToday: round2(state.realizedPnlToday),
      positions: Object.entries(state.positions).map(([symbol, quantity]) => {
        const price = quotes[symbol]?.price ?? state.averageCost[symbol] ?? 0;
        const avg = state.averageCost[symbol] ?? 0;
        return { symbol, quantity, averageCost: round2(avg), marketPrice: round2(price), marketValue: round2(quantity * price), unrealizedPnl: round2((price - avg) * quantity), unrealizedPnlRate: avg > 0 ? round4((price - avg) / avg) : 0 };
      }),
      recentFills: state.fills.slice(0, 50),
      exitOrders: state.exitOrders
    }
  };
}

function buildHistory(state) {
  return {
    dates: [...new Set(state.fills.map((fill) => toKstDate(fill.filledAt)))],
    rounds: state.roundHistory ?? [],
    rows: state.fills.map((fill) => ({ kstDate: toKstDate(fill.filledAt), symbolName: config.symbol_names?.[fill.symbol] ?? "-", fill }))
  };
}

function addFill(state, fills, fill) {
  const record = { ...fill, price: round2(fill.price), cashAfter: round2(state.cash), positionAfter: state.positions[fill.symbol] ?? 0, realizedPnlToday: round2(state.realizedPnlToday), filledAt: new Date().toISOString() };
  fills.push(record);
  state.fills.unshift(record);
  state.fills = state.fills.slice(0, 200);
}

function currentHoldingSymbol(state) { return Object.entries(state.positions).find(([, quantity]) => quantity > 0)?.[0] ?? null; }
function allocationFraction(state) { return config.strategy.allocation_steps[Math.min(state.allocationIndex, config.strategy.allocation_steps.length - 1)]; }
function estimateEquity(state, quotes) { return state.cash + Object.entries(state.positions).reduce((sum, [symbol, quantity]) => sum + quantity * (quotes[symbol]?.price ?? state.averageCost[symbol] ?? 0), 0); }
function objectQuotesFromPrices(state) { return Object.fromEntries(Object.entries(state.prices).map(([symbol, price]) => [symbol, { symbol, price }])); }
function nextRandomBetween(state, min, max) { state.randomState = (1664525 * state.randomState + 1013904223) % 4294967296; return min + (state.randomState / 4294967296) * (max - min); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function round2(value) { return Math.round(value * 100) / 100; }
function round4(value) { return Math.round(value * 10000) / 10000; }
function toKstDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function renderDashboard() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Trading Agent</title>
  <style>
    body { margin:0; font-family:Arial,sans-serif; background:#f6f8fb; color:#17202a; }
    header { background:#101828; color:white; padding:18px 22px; }
    main { max-width:1120px; margin:0 auto; padding:18px; }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
    .panel { background:white; border:1px solid #d9e1ea; border-radius:8px; padding:14px; margin-top:14px; }
    .metric { color:#5b6776; font-size:12px; font-weight:800; }
    .value { margin-top:6px; font-size:24px; font-weight:800; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { text-align:left; border-bottom:1px solid #d9e1ea; padding:9px 6px; }
    @media (max-width:760px){ .grid{grid-template-columns:repeat(2,minmax(0,1fr));} }
  </style>
</head>
<body>
  <header><h1>&#51088;&#46041;&#47588;&#47588; &#50500;&#48148;&#53440; &#49828;&#45257;&#49383;</h1><div id="published">&#48520;&#47084;&#50724;&#45716; &#51473;...</div></header>
  <main>
    <div class="grid">
      <div class="panel"><div class="metric">&#54788;&#51116; No.</div><div class="value" id="roundNo">-</div></div>
      <div class="panel"><div class="metric">&#54217;&#44032;&#44552;</div><div class="value" id="equity">-</div></div>
      <div class="panel"><div class="metric">&#54788;&#44552;</div><div class="value" id="cash">-</div></div>
      <div class="panel"><div class="metric">&#44228;&#51340; &#49688;&#51061;&#47456;</div><div class="value" id="rate">-</div></div>
      <div class="panel"><div class="metric">&#47785;&#54364; &#51652;&#54665;&#47456;</div><div class="value" id="progress">-</div></div>
    </div>
    <section class="panel"><h2>&#47784;&#45768;&#53552;&#47553; &#51333;&#47785;</h2><table><thead><tr><th>No.</th><th>&#51333;&#47785;</th><th>&#51333;&#47785;&#47749;</th><th>&#44032;&#44201;</th></tr></thead><tbody id="watchlist"></tbody></table></section>
    <section class="panel"><h2>&#48372;&#50976; &#51333;&#47785;</h2><table><thead><tr><th>&#51333;&#47785;</th><th>&#51333;&#47785;&#47749;</th><th>&#49688;&#47049;</th><th>&#54788;&#51116;&#44032;</th><th>&#49688;&#51061;&#47456;</th></tr></thead><tbody id="positions"></tbody></table></section>
    <section class="panel"><h2>&#50696;&#50557; &#47588;&#46020;</h2><table><thead><tr><th>&#51333;&#47785;</th><th>&#49688;&#47049;</th><th>&#51061;&#51208;&#44032;</th><th>&#49552;&#51208;&#44032;</th></tr></thead><tbody id="orders"></tbody></table></section>
    <section class="panel"><h2>&#52572;&#44540; &#52404;&#44208;</h2><table><thead><tr><th>No.</th><th>&#51333;&#47785;</th><th>&#44396;&#48516;</th><th>&#49688;&#47049;</th><th>&#44032;&#44201;</th><th>KST &#49884;&#44036;</th></tr></thead><tbody id="fills"></tbody></table></section>
    <section class="panel"><h2>No.&#48324; &#50756;&#47308; &#51060;&#47141;</h2><table><thead><tr><th>No.</th><th>&#44208;&#44284;</th><th>&#49688;&#51061;&#47456;</th><th>&#49552;&#51061;</th><th>&#49884;&#51089; &#54217;&#44032;&#44552;</th><th>&#51333;&#47308; &#54217;&#44032;&#44552;</th><th>KST &#51333;&#47308;</th></tr></thead><tbody id="rounds"></tbody></table></section>
  </main>
  <script>
    const money = (v) => new Intl.NumberFormat("en-US", { style:"currency", currency:"USD" }).format(v ?? 0);
    const pct = (v) => ((Number(v ?? 0) * 100).toFixed(2) + "%");
    const kst = (v) => v ? new Intl.DateTimeFormat("ko-KR", { timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).format(new Date(v)) : "-";
    const row = (cells) => "<tr>" + cells.map((c) => "<td>" + c + "</td>").join("") + "</tr>";
    async function load() {
      const status = await fetch("status.json?ts=" + Date.now()).then((r) => r.json());
      document.getElementById("published").textContent = "마지막 업데이트: " + kst(status.publishedAt);
      document.getElementById("roundNo").textContent = status.round?.no ?? "-";
      document.getElementById("equity").textContent = money(status.account.equity);
      document.getElementById("cash").textContent = money(status.account.cash);
      document.getElementById("rate").textContent = pct(status.strategyStatus?.accountPnlRate);
      document.getElementById("progress").textContent = ((Number(status.strategyStatus?.progressRate ?? 0) * 100).toFixed(0)) + "%";
      document.getElementById("watchlist").innerHTML = (status.quotes ?? []).map((q, i) => row([i + 1, q.symbol, status.symbolNames?.[q.symbol] ?? "-", money(q.price)])).join("") || row(["-", "-", "-", "-"]);
      document.getElementById("positions").innerHTML = (status.account.positions ?? []).map((p) => row([p.symbol, status.symbolNames?.[p.symbol] ?? "-", p.quantity, money(p.marketPrice), pct(p.unrealizedPnlRate)])).join("") || row(["-", "-", "-", "-", "-"]);
      document.getElementById("orders").innerHTML = (status.account.exitOrders ?? []).map((o) => row([o.symbol, o.quantity, money(o.takeProfitPrice), money(o.stopLossPrice)])).join("") || row(["-", "-", "-", "-"]);
      document.getElementById("fills").innerHTML = [...(status.account.recentFills ?? [])].reverse().map((f, i) => row([i + 1, f.symbol, f.side === "buy" ? "매수" : "매도", f.quantity, money(f.price), kst(f.filledAt)])).join("") || row(["-", "-", "-", "-", "-", "-"]);
      document.getElementById("rounds").innerHTML = (status.round?.history ?? []).map((r) => row([r.no, r.result === "target" ? "목표달성" : "손실중지", pct(r.pnlRate), money(r.pnl), money(r.startEquity), money(r.endEquity), kst(r.endedAt)])).join("") || row(["-", "-", "-", "-", "-", "-", "-"]);
    }
    load();
    setInterval(load, 180000);
  </script>
</body>
</html>`;
}

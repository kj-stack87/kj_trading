import fs from "node:fs";
import http from "node:http";

export class DashboardServer {
  constructor(agent, port) {
    this.agent = agent;
    this.port = port;
  }

  start() {
    this.server = http.createServer(async (request, response) => {
      try {
        await this.route(request, response);
      } catch (error) {
        sendJson(response, 500, { error: error.message });
      }
    });

    this.server.listen(this.port, () => {
      console.log(`Dashboard: http://localhost:${this.port}`);
    });
  }

  async route(request, response) {
    if (request.method === "GET" && request.url === "/") {
      sendHtml(response, renderDashboardHtml());
      return;
    }

    if (request.method === "GET" && request.url === "/api/status") {
      sendJson(response, 200, this.agent.getStatus());
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/daily-history")) {
      const url = new URL(request.url, `http://localhost:${this.port}`);
      sendJson(response, 200, readDailyHistory(url.searchParams.get("date"), this.agent.config.symbolNames));
      return;
    }

    if (request.method === "POST" && request.url === "/api/stop") {
      this.agent.emergencyStop("dashboard emergency stop");
      sendJson(response, 200, { ok: true, emergencyStopped: true });
      return;
    }

    if (request.method === "POST" && request.url === "/api/resume") {
      this.agent.resume();
      sendJson(response, 200, { ok: true, emergencyStopped: false });
      return;
    }

    if (request.method === "POST" && request.url.startsWith("/api/target")) {
      const url = new URL(request.url, `http://localhost:${this.port}`);
      const target = Number(url.searchParams.get("value"));
      if (![0.01, 0.05, 0.10].includes(target)) {
        sendJson(response, 400, { error: "Invalid target" });
        return;
      }
      this.agent.setDailyProfitTarget(target);
      sendJson(response, 200, { ok: true, dailyProfitTarget: target });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(html);
}

function renderDashboardHtml() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>&#51088;&#46041;&#47588;&#47588; &#50500;&#48148;&#53440;</title>
  <style>
    :root { color-scheme: light; --ink:#17202a; --muted:#5b6776; --line:#d9e1ea; --buy:#0f7b61; --sell:#b42318; --bg:#f6f8fb; --panel:#ffffff; --accent:#2f6fed; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Arial, sans-serif; background:var(--bg); color:var(--ink); }
    header { padding:18px 22px; background:#101828; color:white; display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; }
    h1 { margin:0; font-size:22px; letter-spacing:0; }
    h2 { margin:0 0 10px; font-size:18px; }
    main { max-width:1160px; margin:0 auto; padding:18px; }
    button { border:0; border-radius:6px; padding:10px 14px; font-weight:700; cursor:pointer; }
    .stop { background:var(--sell); color:white; }
    .resume { background:var(--accent); color:white; }
    .grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }
    .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
    .metric { color:var(--muted); font-size:12px; font-weight:800; }
    .value { margin-top:6px; font-size:24px; font-weight:800; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { text-align:left; border-bottom:1px solid var(--line); padding:9px 6px; vertical-align:top; }
    th { color:var(--muted); font-size:12px; font-weight:800; }
    .section { margin-top:14px; overflow:auto; }
    .status { display:inline-flex; align-items:center; gap:8px; padding:8px 10px; border-radius:999px; background:#e7f8ef; color:#075e45; font-weight:700; white-space:nowrap; }
    .status.stopped { background:#fde7e7; color:#9f1c12; }
    .buy, .sell { display:inline-flex; align-items:center; border-radius:999px; padding:4px 8px; font-weight:800; white-space:nowrap; }
    .buy { color:var(--buy); background:#e7f8ef; }
    .sell { color:var(--sell); background:#fde7e7; }
    .tradeText { font-weight:800; white-space:nowrap; }
    @media (max-width: 760px) { .grid { grid-template-columns:repeat(2, minmax(0,1fr)); } }
  </style>
</head>
<body>
  <header>
    <h1>&#51088;&#46041;&#47588;&#47588; &#50500;&#48148;&#53440;</h1>
    <div>
      <button class="resume" onclick="resumeAgent()">&#45796;&#49884; &#49884;&#51089;</button>
      <button class="stop" onclick="stopAgent()">&#44596;&#44553;&#51221;&#51648;</button>
    </div>
  </header>
  <main>
    <div class="grid">
      <div class="panel"><div class="metric">&#54217;&#44032;&#44552;</div><div class="value" id="equity">-</div></div>
      <div class="panel"><div class="metric">&#54788;&#44552;</div><div class="value" id="cash">-</div></div>
      <div class="panel"><div class="metric">&#50724;&#45720; &#49892;&#54788;&#49552;&#51061;</div><div class="value" id="pnl">-</div></div>
      <div class="panel"><div class="metric">&#49345;&#53468;</div><div class="value"><span id="status" class="status">-</span></div></div>
      <div class="panel"><div class="metric">&#44228;&#51340; &#49688;&#51061;&#47456;</div><div class="value" id="accountRate">-</div></div>
      <div class="panel"><div class="metric" id="targetLabel">&#47785;&#54364; &#51652;&#54665;&#47456;</div><div class="value" id="targetProgress">-</div></div>
      <div class="panel"><div class="metric">&#54788;&#51116; &#53804;&#51077;&#48708;&#51473;</div><div class="value" id="allocation">-</div></div>
      <div class="panel"><div class="metric">&#51204;&#54872;&#54943;&#49688;</div><div class="value" id="rotationCount">-</div></div>
      <div class="panel"><div class="metric">1&#54924; &#51061;&#51208;</div><div class="value" id="perTradeTp">-</div></div>
      <div class="panel"><div class="metric">&#51204;&#54872; &#49552;&#51208;</div><div class="value" id="switchLoss">-</div></div>
      <div class="panel"><div class="metric">&#50672;&#49549; &#49552;&#49892;</div><div class="value" id="lossStreak">-</div></div>
      <div class="panel"><div class="metric">&#53224;&#45796;&#50868;</div><div class="value" id="cooldown">-</div></div>
    </div>
    <section class="panel section"><h2>&#49892;&#54744;&#50857; &#47785;&#54364; &#49444;&#51221;</h2><div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="resume" onclick="setTarget(0.01)">1%</button><button class="resume" onclick="setTarget(0.05)">5%</button><button class="resume" onclick="setTarget(0.10)">10%</button></div></section>
    <section class="panel section"><h2>&#54788;&#51116; &#49884;&#49464;</h2><table><thead><tr><th>&#51333;&#47785;</th><th>&#51333;&#47785;&#47749;</th><th>&#44032;&#44201;</th><th>KST &#49884;&#44036;</th></tr></thead><tbody id="quotes"></tbody></table></section>
    <section class="panel section"><h2>&#48372;&#50976; &#51333;&#47785;</h2><table><thead><tr><th>&#51333;&#47785;</th><th>&#51333;&#47785;&#47749;</th><th>&#49688;&#47049;</th><th>&#54217;&#44512;&#45800;&#44032;</th><th>&#54788;&#51116;&#44032;</th><th>&#54217;&#44032;&#44552;&#50529;</th><th>&#54217;&#44032;&#49552;&#51061;</th><th>&#49688;&#51061;&#47456;</th></tr></thead><tbody id="positions"></tbody></table></section>
    <section class="panel section"><h2>&#52572;&#44540; &#47588;&#47588; &#49888;&#54840;</h2><table><thead><tr><th>&#51333;&#47785;</th><th>&#51333;&#47785;&#47749;</th><th>&#44396;&#48516;</th><th>&#49688;&#47049;</th><th>&#54032;&#45800; &#51060;&#50976;</th></tr></thead><tbody id="signals"></tbody></table></section>
    <section class="panel section"><h2>&#50696;&#50557; &#47588;&#46020; &#51452;&#47928;</h2><table><thead><tr><th>&#51333;&#47785;</th><th>&#51333;&#47785;&#47749;</th><th>&#49688;&#47049;</th><th>&#51652;&#51077;&#44032;</th><th>&#51061;&#51208;&#44032;</th><th>&#49552;&#51208;&#44032;</th><th>KST &#49884;&#44036;</th></tr></thead><tbody id="exitOrders"></tbody></table></section>
    <section class="panel section"><h2>&#52572;&#44540; &#47588;&#47588; &#45236;&#50669;</h2><table><thead><tr><th>&#47588;&#47588; &#45236;&#50857;</th><th>&#51333;&#47785;</th><th>&#51333;&#47785;&#47749;</th><th>&#44396;&#48516;</th><th>&#49688;&#47049;</th><th>&#44032;&#44201;</th><th>KST &#49884;&#44036;</th></tr></thead><tbody id="fills"></tbody></table></section>
    <section class="panel section"><h2>&#45216;&#51676;&#48324; &#47588;&#47588; &#44592;&#47197;</h2><div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;"><select id="historyDate"></select><button class="resume" onclick="loadHistory()">&#51312;&#54924;</button></div><table><thead><tr><th>KST &#45216;&#51676;</th><th>&#47588;&#47588; &#45236;&#50857;</th><th>&#51333;&#47785;&#47749;</th><th>&#49688;&#47049;</th><th>&#44032;&#44201;</th><th>&#54788;&#44552;</th><th>KST &#49884;&#44036;</th></tr></thead><tbody id="history"></tbody></table></section>
    <section class="panel section"><h2>&#44144;&#51208;&#46108; &#51452;&#47928;</h2><table><thead><tr><th>&#51333;&#47785;</th><th>&#44396;&#48516;</th><th>&#49324;&#50976;</th><th>&#49884;&#44036;</th></tr></thead><tbody id="rejections"></tbody></table></section>
  </main>
  <script>
    const money = (value) => new Intl.NumberFormat("en-US", { style:"currency", currency:"USD" }).format(value ?? 0);
    async function refresh() {
      const status = await fetch("/api/status", { cache: "no-store" }).then((res) => res.json());
      document.getElementById("equity").textContent = money(status.account.equity);
      document.getElementById("cash").textContent = money(status.account.cash);
      document.getElementById("pnl").textContent = money(status.account.realizedPnlToday);
      const strategy = status.strategyStatus ?? {};
      const targetPct = Number(status.strategyConfig?.dailyProfitTarget ?? 0) * 100;
      document.getElementById("targetLabel").textContent = targetPct.toFixed(0) + "% \ubaa9\ud45c \uc9c4\ud589\ub960";
      document.getElementById("accountRate").innerHTML = percent(strategy.accountPnlRate ?? 0);
      document.getElementById("targetProgress").textContent = ((Number(strategy.progressRate ?? 0) * 100).toFixed(0)) + "%";
      document.getElementById("allocation").textContent = ((Number(strategy.currentAllocationFraction ?? 0) * 100).toFixed(0)) + "%";
      document.getElementById("rotationCount").textContent = String(strategy.rotationCount ?? 0);
      document.getElementById("perTradeTp").textContent = ((Number(strategy.perTradeTakeProfit ?? 0) * 100).toFixed(2)) + "%";
      document.getElementById("switchLoss").textContent = "-" + ((Number(strategy.switchLossThreshold ?? 0) * 100).toFixed(2)) + "%";
      document.getElementById("lossStreak").textContent = String(strategy.consecutiveLosses ?? 0);
      document.getElementById("cooldown").textContent = String(strategy.cooldownRemaining ?? 0);
      const statusEl = document.getElementById("status");
      statusEl.textContent = status.emergencyStopped ? "\uc815\uc9c0\ub428" : "\uc2e4\ud589 \uc911";
      statusEl.className = status.emergencyStopped ? "status stopped" : "status";
      renderRows("quotes", status.quotes, (q) => [q.symbol, nameOf(status, q.symbol), money(q.price), kst(q.timestamp)]);
      renderRows("positions", status.account.positions, (p) => [p.symbol, nameOf(status, p.symbol), p.quantity + "\uc8fc", money(p.averageCost), money(p.marketPrice), money(p.marketValue), money(p.unrealizedPnl), percent(p.unrealizedPnlRate)]);
      renderRows("signals", status.signals, (s) => [s.symbol, nameOf(status, s.symbol), tag(s.side), s.quantity + "\uc8fc", translateReason(s.reason)]);
      renderRows("exitOrders", status.account.exitOrders ?? [], (o) => [o.symbol, nameOf(status, o.symbol), o.quantity + "\uc8fc", money(o.entryPrice), money(o.takeProfitPrice), money(o.stopLossPrice), kst(o.createdAt)]);
      renderRows("fills", status.account.recentFills, (f) => [tradeText(f), f.symbol, nameOf(status, f.symbol), tag(f.side), f.quantity + "\uc8fc", money(f.price), kst(f.filledAt)]);
      renderRows("rejections", status.rejections, (r) => [r.signal.symbol, tag(r.signal.side), translateReason(r.reason), kst(r.createdAt)]);
      await refreshHistoryDates();
    }
    function renderRows(id, rows, mapper) {
      const body = document.getElementById(id);
      body.innerHTML = rows.map((row) => "<tr>" + mapper(row).map((cell) => "<td>" + cell + "</td>").join("") + "</tr>").join("") || "<tr><td colspan='6'>-</td></tr>";
    }
    function tag(side) { return "<span class='" + side + "'>" + (side === "buy" ? "\ub9e4\uc218" : "\ub9e4\ub3c4") + "</span>"; }
    function nameOf(status, symbol) { return status.symbolNames?.[symbol] ?? "-"; }
    function percent(value) {
      const pct = (Number(value ?? 0) * 100).toFixed(2) + "%";
      return Number(value ?? 0) >= 0 ? "<span class='buy'>" + pct + "</span>" : "<span class='sell'>" + pct + "</span>";
    }
    function kst(value) {
      if (!value) return "-";
      return new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(new Date(value));
    }
    function tradeText(fill) {
      const action = fill.side === "buy" ? "\ub9e4\uc218" : "\ub9e4\ub3c4";
      return "<span class='tradeText'>" + fill.symbol + " " + action + " " + fill.quantity + "\uc8fc</span>";
    }
    async function refreshHistoryDates() {
      const select = document.getElementById("historyDate");
      if (select.dataset.loaded === "true") return;
      const data = await fetch("/api/daily-history", { cache: "no-store" }).then((res) => res.json());
      select.innerHTML = data.dates.map((date) => "<option value='" + date + "'>" + date + "</option>").join("");
      select.dataset.loaded = "true";
      if (data.selectedDate) select.value = data.selectedDate;
      renderHistory(data);
    }
    async function loadHistory() {
      const date = document.getElementById("historyDate").value;
      const data = await fetch("/api/daily-history?date=" + encodeURIComponent(date), { cache: "no-store" }).then((res) => res.json());
      renderHistory(data);
    }
    function renderHistory(data) {
      renderRows("history", data.rows, (row) => [row.kstDate, tradeText(row.fill), row.symbolName, row.fill.quantity + "\uc8fc", money(row.fill.price), money(row.fill.cashAfter), kst(row.fill.filledAt)]);
    }
    function translateReason(reason) {
      return String(reason)
        .replace("initial simulation buy", "\uc2dc\ubbac\ub808\uc774\uc158 \uc2dc\uc791 \ub9e4\uc218")
        .replace("start with semiconductor ETF", "\ubc18\ub3c4\uccb4 ETF\ub85c \uccab \ub9e4\uc218")
        .replace("start with KOSDAQ ETF", "\ucf54\uc2a4\ub2e5 ETF\ub85c \uccab \ub9e4\uc218")
        .replace("start with regular ETF", "\uc77c\ubc18 ETF\ub85c \uccab \ub9e4\uc218")
        .replace("account target reached", "\uacc4\uc88c \uae30\uc900 1% \ubaa9\ud45c \ub3c4\ub2ec")
        .replace("reserved exit filled", "\uc608\uc57d \ub9e4\ub3c4 \uccb4\uacb0")
        .replace("daily target reached", "\uc77c\uc77c 1% \ubaa9\ud45c \ub3c4\ub2ec")
        .replace("direction down rotate out", "\ub0b4\ub9bc \uac10\uc9c0, \ud604\uc7ac \uc885\ubaa9 \ub9e4\ub3c4")
        .replace("increase allocation rotate into", "\ud22c\uc785\ube44\uc911 \uc99d\uac00 \ud6c4 \ubc18\ub300 \uc885\ubaa9 \ub9e4\uc218")
        .replace("stop loss", "\uc190\uc808")
        .replace("daily stop loss", "\uc77c\uc77c \uc190\uc2e4 \ud55c\ub3c4 \uc911\uc9c0")
        .replace("rotate out", "\ud604\uc7ac \uc885\ubaa9 \ub9e4\ub3c4")
        .replace("rotate into", "\uc804\ud658 \ub9e4\uc218")
        .replace("short selling is disabled", "\uacf5\ub9e4\ub3c4 \ube44\ud65c\uc131\ud654")
        .replace("not enough cash", "\ud604\uae08 \ubd80\uc871")
        .replace("order value exceeds maxOrderValue", "\uc8fc\ubb38 \uae08\uc561 \ud55c\ub3c4 \ucd08\uacfc")
        .replace("position value exceeds maxPositionValue", "\uc885\ubaa9 \ubcf4\uc720 \ud55c\ub3c4 \ucd08\uacfc")
        .replace("maxDailyLoss reached", "\uc77c\uc77c \uc190\uc2e4 \ud55c\ub3c4 \ub3c4\ub2ec")
        .replace("emergency stop is active", "\uae34\uae09\uc815\uc9c0 \ud65c\uc131\ud654")
        .replace("quantity must be positive", "\uc218\ub7c9\uc774 0 \uc774\ud558\uc785\ub2c8\ub2e4")
        .replace("buy:", "\ub9e4\uc218 \ud310\ub2e8:")
        .replace("sell:", "\ub9e4\ub3c4 \ud310\ub2e8:")
        .replace("trend=bullish", "\ucd94\uc138=\uc0c1\uc2b9")
        .replace("trend=bearish", "\ucd94\uc138=\ud558\ub77d")
        .replace("rsi=", "RSI=")
        .replace("macdHist=", "MACD=");
    }
    async function stopAgent() { await fetch("/api/stop", { method:"POST" }); refresh(); }
    async function resumeAgent() { await fetch("/api/resume", { method:"POST" }); refresh(); }
    async function setTarget(value) { await fetch("/api/target?value=" + value, { method:"POST" }); refresh(); }
    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;
}

function readDailyHistory(selectedDate, symbolNames) {
  const path = "data/trades.jsonl";
  if (!fs.existsSync(path)) {
    return { dates: [], selectedDate: null, rows: [] };
  }

  const rows = fs.readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => safeJsonParse(line))
    .filter((record) => record?.eventType === "fill" && record.payload?.fill)
    .map((record) => {
      const fill = record.payload.fill;
      const kstDate = toKstDate(fill.filledAt);
      return {
        kstDate,
        symbolName: symbolNames?.[fill.symbol] ?? "-",
        fill
      };
    })
    .sort((a, b) => new Date(b.fill.filledAt) - new Date(a.fill.filledAt));

  const dates = [...new Set(rows.map((row) => row.kstDate))];
  const date = selectedDate || dates[0] || null;
  return {
    dates,
    selectedDate: date,
    rows: date ? rows.filter((row) => row.kstDate === date) : []
  };
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function toKstDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class GitSnapshotPublisher {
  constructor(agent, config) {
    this.agent = agent;
    this.config = config;
    this.docsDir = config.docsDir;
  }

  start() {
    this.publishOnce().catch((error) => console.warn(`Git snapshot failed: ${error.message}`));
    setInterval(() => {
      this.publishOnce().catch((error) => console.warn(`Git snapshot failed: ${error.message}`));
    }, this.config.intervalSeconds * 1000);
    console.log(`Git Pages snapshot: ${this.docsDir}/status.json`);
  }

  async publishOnce() {
    fs.mkdirSync(this.docsDir, { recursive: true });
    const status = this.agent.getStatus();
    const history = readDailyHistoryForStatic(status.symbolNames);

    writeJson(path.join(this.docsDir, "status.json"), {
      ...status,
      publishedAt: new Date().toISOString()
    });
    writeJson(path.join(this.docsDir, "history.json"), history);
    fs.writeFileSync(path.join(this.docsDir, "index.html"), renderStaticDashboard(), "utf8");

    if (this.config.commitAndPush) {
      await commitAndPush(this.docsDir);
    }
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readDailyHistoryForStatic(symbolNames) {
  const filePath = "data/trades.jsonl";
  if (!fs.existsSync(filePath)) return { dates: [], rows: [] };

  const rows = fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => safeJsonParse(line))
    .filter((record) => record?.eventType === "fill" && record.payload?.fill)
    .map((record) => {
      const fill = record.payload.fill;
      return {
        kstDate: toKstDate(fill.filledAt),
        symbolName: symbolNames?.[fill.symbol] ?? "-",
        fill
      };
    })
    .sort((a, b) => new Date(b.fill.filledAt) - new Date(a.fill.filledAt));

  return {
    dates: [...new Set(rows.map((row) => row.kstDate))],
    rows
  };
}

async function commitAndPush(docsDir) {
  await execFileAsync("git", ["add", docsDir]);
  const status = await execFileAsync("git", ["status", "--porcelain", docsDir]);
  if (!status.stdout.trim()) return;

  const timestamp = new Date().toISOString();
  await execFileAsync("git", ["commit", "-m", `Update dashboard snapshot ${timestamp}`]);
  await execFileAsync("git", ["push"]);
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

function renderStaticDashboard() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Trading Agent Snapshot</title>
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
  <header><h1>자동매매 아바타 스냅샷</h1><div id="published">불러오는 중...</div></header>
  <main>
    <div class="grid">
      <div class="panel"><div class="metric">평가금</div><div class="value" id="equity">-</div></div>
      <div class="panel"><div class="metric">현금</div><div class="value" id="cash">-</div></div>
      <div class="panel"><div class="metric">계좌 수익률</div><div class="value" id="rate">-</div></div>
      <div class="panel"><div class="metric">목표 진행률</div><div class="value" id="progress">-</div></div>
    </div>
    <section class="panel"><h2>보유 종목</h2><table><thead><tr><th>종목</th><th>종목명</th><th>수량</th><th>현재가</th><th>수익률</th></tr></thead><tbody id="positions"></tbody></table></section>
    <section class="panel"><h2>예약 매도</h2><table><thead><tr><th>종목</th><th>수량</th><th>익절가</th><th>손절가</th></tr></thead><tbody id="orders"></tbody></table></section>
    <section class="panel"><h2>최근 체결</h2><table><thead><tr><th>종목</th><th>구분</th><th>수량</th><th>가격</th><th>KST 시간</th></tr></thead><tbody id="fills"></tbody></table></section>
  </main>
  <script>
    const money = (v) => new Intl.NumberFormat("en-US", { style:"currency", currency:"USD" }).format(v ?? 0);
    const pct = (v) => ((Number(v ?? 0) * 100).toFixed(2) + "%");
    const kst = (v) => v ? new Intl.DateTimeFormat("ko-KR", { timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).format(new Date(v)) : "-";
    const row = (cells) => "<tr>" + cells.map((c) => "<td>" + c + "</td>").join("") + "</tr>";
    async function load() {
      const status = await fetch("status.json?ts=" + Date.now()).then((r) => r.json());
      document.getElementById("published").textContent = "마지막 업데이트: " + kst(status.publishedAt);
      document.getElementById("equity").textContent = money(status.account.equity);
      document.getElementById("cash").textContent = money(status.account.cash);
      document.getElementById("rate").textContent = pct(status.strategyStatus?.accountPnlRate);
      document.getElementById("progress").textContent = ((Number(status.strategyStatus?.progressRate ?? 0) * 100).toFixed(0)) + "%";
      document.getElementById("positions").innerHTML = (status.account.positions ?? []).map((p) => row([p.symbol, status.symbolNames?.[p.symbol] ?? "-", p.quantity, money(p.marketPrice), pct(p.unrealizedPnlRate)])).join("") || row(["-", "-", "-", "-", "-"]);
      document.getElementById("orders").innerHTML = (status.account.exitOrders ?? []).map((o) => row([o.symbol, o.quantity, money(o.takeProfitPrice), money(o.stopLossPrice)])).join("") || row(["-", "-", "-", "-"]);
      document.getElementById("fills").innerHTML = (status.account.recentFills ?? []).map((f) => row([f.symbol, f.side === "buy" ? "매수" : "매도", f.quantity, money(f.price), kst(f.filledAt)])).join("") || row(["-", "-", "-", "-", "-"]);
    }
    load();
    setInterval(load, 30000);
  </script>
</body>
</html>`;
}

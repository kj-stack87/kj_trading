import fs from "node:fs";
import path from "node:path";
import { TradingAgent } from "./agent.js";
import { AlpacaBroker, PaperBroker } from "./broker.js";
import { loadConfig } from "./config.js";
import { DashboardServer } from "./dashboard.js";
import { GitSnapshotPublisher } from "./gitPublisher.js";
import { JsonlJournal } from "./journal.js";
import { AlpacaMarketData, SimulatedMarketData } from "./marketData.js";
import { RiskManager } from "./risk.js";
import { AvatarComboStrategy, PairedEtfRotationStrategy } from "./strategy.js";

function buildAgent(configPath) {
  const config = loadConfig(configPath);
  const journal = new JsonlJournal("data/trades.jsonl");
  const broker = buildBroker(config, journal);
  const marketData = buildMarketData(config);
  const strategy = buildStrategy(config);
  const risk = new RiskManager(config.risk);

  return new TradingAgent({ config, marketData, strategy, broker, risk });
}

function buildStrategy(config) {
  if (config.strategy.name === "paired_etf_rotation") {
    return new PairedEtfRotationStrategy(config.strategy);
  }
  return new AvatarComboStrategy(config.strategy);
}

function buildBroker(config, journal) {
  if (config.broker.provider === "alpaca") {
    return new AlpacaBroker({ config, journal });
  }
  return new PaperBroker(config.startingCash, journal);
}

function buildMarketData(config) {
  if (config.marketData.provider === "alpaca") {
    return new AlpacaMarketData(config.symbols);
  }
  return new SimulatedMarketData(config.symbols, config.marketData.seedPrice);
}

const args = new Set(process.argv.slice(2));
const configArgIndex = process.argv.indexOf("--config");
const configPath = configArgIndex >= 0 ? process.argv[configArgIndex + 1] : "config.json";
if (!args.has("--once")) {
  resetDashboardData();
}
const agent = buildAgent(configPath);

if (args.has("--once")) {
  await agent.runOnce();
} else {
  if (agent.config.dashboard.enabled) {
    const dashboard = new DashboardServer(agent, agent.config.dashboard.port);
    dashboard.start();
  }
  if (agent.config.gitPublish.enabled) {
    const publisher = new GitSnapshotPublisher(agent, agent.config.gitPublish);
    publisher.start();
  }
  agent.runForever();
}

function resetDashboardData() {
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(path.join("data", "trades.jsonl"), "", "utf8");
  fs.writeFileSync(
    path.join("data", "emergency-stop.json"),
    JSON.stringify({ active: false, reason: "reset on start", updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  console.log("대시보드 데이터를 초기화했습니다.");
}

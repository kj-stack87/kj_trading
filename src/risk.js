import fs from "node:fs";
import path from "node:path";
import { Side } from "./models.js";

export class RiskManager {
  constructor(config) {
    this.config = config;
    this.ensureStopFile();
  }

  approve(order, account) {
    const orderValue = order.quantity * order.price;
    const currentPosition = account.positions.get(order.symbol) ?? 0;

    if (this.isEmergencyStopped()) return reject("emergency stop is active");
    if (order.quantity <= 0) return reject("quantity must be positive");
    if (orderValue > this.config.maxOrderValue) return reject("order value exceeds maxOrderValue");
    if (account.realizedPnlToday <= -Math.abs(this.config.maxDailyLoss)) return reject("maxDailyLoss reached");

    if (order.side === Side.BUY) {
      if (orderValue > account.cash) return reject("not enough cash");
      const newPositionValue = (currentPosition + order.quantity) * order.price;
      if (newPositionValue > this.config.maxPositionValue) return reject("position value exceeds maxPositionValue");
    }

    if (order.side === Side.SELL) {
      if (!this.config.allowShortSelling && order.quantity > currentPosition) {
        return reject("short selling is disabled");
      }
    }

    return { approved: true, reason: "approved" };
  }

  activateEmergencyStop(reason = "manual stop") {
    this.writeStopFile({ active: true, reason, updatedAt: new Date().toISOString() });
  }

  clearEmergencyStop() {
    this.writeStopFile({ active: false, reason: "resumed", updatedAt: new Date().toISOString() });
  }

  isEmergencyStopped() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.config.emergencyStopFile, "utf8"));
      return Boolean(raw.active);
    } catch {
      return false;
    }
  }

  ensureStopFile() {
    if (fs.existsSync(this.config.emergencyStopFile)) return;
    this.writeStopFile({ active: false, reason: "initial", updatedAt: new Date().toISOString() });
  }

  writeStopFile(payload) {
    fs.mkdirSync(path.dirname(this.config.emergencyStopFile), { recursive: true });
    fs.writeFileSync(this.config.emergencyStopFile, JSON.stringify(payload, null, 2), "utf8");
  }
}

function reject(reason) {
  return { approved: false, reason };
}

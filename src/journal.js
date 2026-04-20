import fs from "node:fs";
import path from "node:path";

export class JsonlJournal {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  write(eventType, payload) {
    const record = {
      eventType,
      payload,
      createdAt: new Date().toISOString()
    };
    fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}

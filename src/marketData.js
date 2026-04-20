export class SimulatedMarketData {
  constructor(symbols, seedPrice) {
    this.symbols = symbols;
    this.tick = 0;
    this.prices = new Map(symbols.map((symbol, index) => [symbol, seedPrice + index * 7.5]));
    this.randomState = 42;
  }

  getQuotes() {
    this.tick += 1;
    const now = new Date().toISOString();
    const quotes = new Map();

    this.symbols.forEach((symbol, index) => {
      const current = this.prices.get(symbol);
      const wave = Math.sin((this.tick + index) / 5) * 0.6;
      const noise = this.nextRandomBetween(-0.35, 0.35);
      const price = Math.max(1, current + wave + noise);
      const rounded = Math.round(price * 100) / 100;
      this.prices.set(symbol, rounded);
      quotes.set(symbol, { symbol, price: rounded, timestamp: now });
    });

    return quotes;
  }

  nextRandomBetween(min, max) {
    this.randomState = (1664525 * this.randomState + 1013904223) % 4294967296;
    return min + (this.randomState / 4294967296) * (max - min);
  }
}

export class AlpacaMarketData {
  constructor(symbols) {
    this.symbols = symbols;
    this.baseUrl = process.env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets";
    this.keyId = process.env.ALPACA_API_KEY_ID;
    this.secretKey = process.env.ALPACA_API_SECRET_KEY;
  }

  async getQuotes() {
    if (!this.keyId || !this.secretKey) {
      throw new Error("Missing ALPACA_API_KEY_ID or ALPACA_API_SECRET_KEY for Alpaca market data.");
    }

    const symbols = encodeURIComponent(this.symbols.join(","));
    const response = await fetch(`${this.baseUrl}/v2/stocks/quotes/latest?symbols=${symbols}`, {
      headers: {
        "APCA-API-KEY-ID": this.keyId,
        "APCA-API-SECRET-KEY": this.secretKey
      }
    });

    if (!response.ok) {
      throw new Error(`Alpaca market data failed: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json();
    const quotes = new Map();
    for (const symbol of this.symbols) {
      const item = payload.quotes?.[symbol];
      const bid = Number(item?.bp ?? 0);
      const ask = Number(item?.ap ?? 0);
      const price = bid > 0 && ask > 0 ? (bid + ask) / 2 : ask || bid;
      if (!price) continue;
      quotes.set(symbol, {
        symbol,
        price: Math.round(price * 100) / 100,
        timestamp: item?.t ?? new Date().toISOString()
      });
    }
    return quotes;
  }
}

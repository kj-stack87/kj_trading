export const Side = Object.freeze({
  BUY: "buy",
  SELL: "sell"
});

export function createOrderFromSignal(signal, price) {
  return {
    symbol: signal.symbol,
    side: signal.side,
    quantity: signal.quantity,
    price,
    createdAt: new Date().toISOString()
  };
}

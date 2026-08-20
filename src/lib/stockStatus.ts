export type StockStatus = "out" | "low" | "ok";

// Below this, stock is flagged regardless of the product's own reorder threshold.
export const LOW_STOCK_FLOOR = 5;

export function stockStatus(quantity: number, threshold: number): StockStatus {
  if (quantity <= 0) return "out";
  if (quantity < LOW_STOCK_FLOOR || quantity <= threshold) return "low";
  return "ok";
}

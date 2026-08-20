export type StockStatus = "out" | "low" | "ok";

// Fixed floor: stock is flagged regardless of the product's own reorder threshold.
export const LOW_STOCK_FLOOR = 5;

export function stockStatus(quantity: number): StockStatus {
  if (quantity <= 0) return "out";
  if (quantity < LOW_STOCK_FLOOR) return "low";
  return "ok";
}

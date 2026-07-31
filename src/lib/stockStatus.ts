export type StockStatus = "out" | "low" | "ok";

export function stockStatus(quantity: number, threshold: number): StockStatus {
  if (quantity <= 0) return "out";
  if (quantity <= threshold) return "low";
  return "ok";
}

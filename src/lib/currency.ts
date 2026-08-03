const formatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export function formatCurrency(amount: number): string {
  return `${formatter.format(Math.round(amount))} FBU`;
}

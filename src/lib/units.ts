export const UNIT_OPTIONS = [
  { value: "piece", label: "Pièce" },
  { value: "kg", label: "Kilogramme (kg)" },
  { value: "litre", label: "Litre (L)" },
  { value: "jet", label: "Jet (4 pièces)" },
  { value: "metre", label: "Mètre (m)" },
  { value: "cm", label: "Centimètre (cm)" },
] as const;

export type UnitValue = (typeof UNIT_OPTIONS)[number]["value"];

const UNIT_LABELS: Record<string, string> = Object.fromEntries(UNIT_OPTIONS.map((u) => [u.value, u.label]));

export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return "";
  return UNIT_LABELS[unit] ?? unit;
}

export function unitShort(unit: string | null | undefined): string {
  if (!unit) return "";
  if (unit === "piece") return "pc";
  if (unit === "kg") return "kg";
  if (unit === "litre") return "L";
  if (unit === "jet") return "jet";
  if (unit === "metre") return "m";
  if (unit === "cm") return "cm";
  return unit;
}

// Products created before the unit dropdown existed may hold arbitrary text
// (or stray numbers typed into the old free-text field). Only trust known values.
export function isKnownUnit(unit: string | null | undefined): unit is UnitValue {
  return !!unit && unit in UNIT_LABELS;
}

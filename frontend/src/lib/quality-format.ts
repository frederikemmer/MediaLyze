export function rawVisualDensityToGbPerHour(value: number): number {
  return value * 60;
}

export function gbPerHourToRawVisualDensity(value: number): number {
  return value / 60;
}

export function formatVisualDensityGbPerHour(value: number): string {
  const gbPerHour = rawVisualDensityToGbPerHour(value);
  const decimals = gbPerHour < 1 ? 2 : 1;
  return gbPerHour.toFixed(decimals).replace(/\.?0+$/, "");
}

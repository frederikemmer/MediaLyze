export function splitDisplayPath(value: string): string[] {
  const normalizedValue = value.replaceAll("\\", "/");
  const segments = normalizedValue.split("/").filter(Boolean);

  if (segments.length > 0) {
    return segments;
  }

  return [value];
}

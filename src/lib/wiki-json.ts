export function canonicalizeJson(src: string): string | null {
  try {
    const value: unknown = JSON.parse(src);
    if (value === null || typeof value !== "object") return null;
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

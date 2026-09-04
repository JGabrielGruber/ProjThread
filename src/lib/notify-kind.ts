export const NOTIFY_KINDS = [
  "node.created",
  "node.updated",
  "node.included",
  "node.cited",
] as const;

export type NotifyKind = (typeof NOTIFY_KINDS)[number];

const KIND_SET = new Set<string>(NOTIFY_KINDS);

export function parseKinds(value: unknown): NotifyKind[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = new Set<NotifyKind>();
  for (const item of value) {
    if (typeof item !== "string" || !KIND_SET.has(item)) return null;
    out.add(item as NotifyKind);
  }
  return [...out].sort();
}

export function parseKindsJson(text: string): NotifyKind[] | null {
  try {
    return parseKinds(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

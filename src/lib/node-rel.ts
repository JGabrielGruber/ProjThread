export type IncludeEdge = { from_id: string; to_id: string };

export function wouldCycleIncludes(
  parentId: string,
  childId: string,
  edges: IncludeEdge[],
): boolean {
  if (parentId === childId) return true;
  const children = new Map<string, string[]>();
  for (const e of edges) {
    const list = children.get(e.from_id) ?? [];
    list.push(e.to_id);
    children.set(e.from_id, list);
  }
  const seen = new Set<string>();
  const stack = [childId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === parentId) return true;
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return false;
}

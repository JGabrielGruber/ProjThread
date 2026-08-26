export type TreeNode = { id: string; parent_id: string | null };

export function descendantIds(
  rootId: string,
  nodes: TreeNode[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    const list = children.get(n.parent_id) ?? [];
    list.push(n.id);
    children.set(n.parent_id, list);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return out;
}

export function wouldCycle(
  nodeId: string,
  newParentId: string | null,
  nodes: TreeNode[],
): boolean {
  if (newParentId == null) return false;
  if (newParentId === nodeId) return true;
  return descendantIds(nodeId, nodes).has(newParentId);
}

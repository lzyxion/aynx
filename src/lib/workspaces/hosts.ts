// 저장 트리의 호스트 참조 처리. 제목/경로에서 별칭을 추측하지 않는다.
import type { SavedNodeV2, SavedWorkspaceSplit } from "./schema";

function isSplit(node: SavedNodeV2): node is SavedWorkspaceSplit { return typeof node.dir === "string"; }

export function hostAliasOf(node: SavedNodeV2): string | null {
  if (isSplit(node)) return null;
  if (node.adhoc) return null;
  return typeof node.alias === "string" ? node.alias : node.startProject?.host ?? null;
}
export function hostTreeCount(node: SavedNodeV2, aliases: ReadonlySet<string>): number {
  if (isSplit(node)) return hostTreeCount(node.a, aliases) + hostTreeCount(node.b, aliases);
  const alias = hostAliasOf(node);
  return alias && aliases.has(alias.trim().toLowerCase()) ? 1 : 0;
}
export function rewriteHostTree(node: SavedNodeV2, aliases: ReadonlySet<string>, to?: string, removedKeys?: ReadonlySet<string>): SavedNodeV2 | null {
  if (isSplit(node)) {
    const a = rewriteHostTree(node.a, aliases, to, removedKeys);
    const b = rewriteHostTree(node.b, aliases, to, removedKeys);
    return a && b ? { ...node, a, b } : a ?? b;
  }
  const alias = hostAliasOf(node);
  const matches = alias && aliases.has(alias.trim().toLowerCase());
  if (removedKeys ? removedKeys.has(node.tileKey) : matches && !to) return null;
  if (!matches || !to) return node;
  return { ...node, ...(node.alias ? { alias: to } : {}),
    ...(node.startProject?.host ? { startProject: { ...node.startProject, host: to } } : {}) };
}
export function emptyHostTree(node: SavedNodeV2): SavedNodeV2 {
  return { kind: "start", tileKey: leftmostTileKey(node) };
}

function leftmostTileKey(node: SavedNodeV2): string {
  return isSplit(node) ? leftmostTileKey(node.a) : node.tileKey;
}

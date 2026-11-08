import { expect, it } from "vitest";
import { emptyHostTree, rewriteHostTree } from "./hosts";
import type { SavedNodeV2 } from "./schema";
const tree: SavedNodeV2 = { dir: "row", ratio: 0.4, a: { kind: "ssh", alias: " Web ", tileKey: "a", historyStreamId: "stream" }, b: { kind: "local", tileKey: "b", cwd: "/keep" } };
it("이름 변경은 키/stream/배치를 유지하고 원본을 바꾸지 않는다", () => {
  expect(rewriteHostTree(tree, new Set(["web"]), "new")).toMatchObject({ a: { alias: "new", tileKey: "a", historyStreamId: "stream" }, b: { cwd: "/keep" } });
  expect(tree.a).toMatchObject({ alias: " Web " });
});
it("제거는 저장 트리를 축약하고 live 저장은 제거된 키만 뺀다", () => {
  expect(rewriteHostTree(tree, new Set(["web"]))).toEqual(tree.b);
  expect(rewriteHostTree(tree, new Set(), undefined, new Set(["a"]))).toEqual(tree.b);
  expect(emptyHostTree(tree)).toEqual({ kind: "start", tileKey: "a" });
});
it("빠른 접속은 별칭 정리 대상이 아니다", () => {
  const node: SavedNodeV2 = { kind: "ssh", alias: "web", adhoc: { host: "1.2.3.4" }, tileKey: "adhoc" };
  expect(rewriteHostTree(node, new Set(["web"]))).toBe(node);
});

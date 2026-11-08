// v2 영속 스키마와 순수 키 변환. IO·룬·부팅 연결은 없다.
// 불변식: tabKey/tileKey는 런타임 id와 독립적이다. 입력과 추가 필드를 보존한다.
import type { SavedLeaf, SavedNode } from "$lib/tabs";
import type { SplitDir } from "$lib/session/spec";

export type Placement = { kind: "main" } | { kind: "aux"; groupId: string };
export type WriterScope = Placement;

export type SavedWorkspaceLeaf = SavedLeaf & { tileKey: string; [key: string]: unknown };
export interface SavedWorkspaceSplit {
  dir: SplitDir;
  ratio: number;
  px?: number;
  a: SavedNodeV2;
  b: SavedNodeV2;
  [key: string]: unknown;
}
export type SavedNodeV2 = SavedWorkspaceLeaf | SavedWorkspaceSplit;

export interface LastActive {
  tabKey?: string;
  tileKey?: string;
  at?: number;
  [key: string]: unknown;
}
export interface SavedWorkspaceTab {
  tabKey: string;
  placement: Placement;
  projectId?: string;
  name?: string;
  pinnedTitle?: string;
  projectFolder?: string;
  title: string;
  root: SavedNodeV2;
  [key: string]: unknown;
}
export interface Workspace {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  tabs: SavedWorkspaceTab[];
  lastActive: LastActive;
  [key: string]: unknown;
}
export interface MigrationRecord {
  from: 1;
  at: string;
  backupDir: string;
  importedLayouts: number;
  [key: string]: unknown;
}
export interface WorkspaceFile {
  kind: "aynx.workspaces";
  version: 2;
  revision: number;
  activeWorkspaceId: string;
  workspaces: Workspace[];
  migration?: MigrationRecord;
  [key: string]: unknown;
}
export interface Problem {
  file: string;
  index?: number;
  path: string;
  code: string;
}
export type WorkspaceLoad =
  | { state: "v2"; file: WorkspaceFile }
  | { state: "needsMigration" }
  | { state: "empty" }
  | { state: "corrupt"; problems: Problem[] };

/** workspaces_apply의 tagged JSON 계약. 저장 완료는 성공 응답의 revision으로만 판단한다. */
export type WorkspaceMutation =
  | { op: "putTabs"; workspaceId: string; scope: WriterScope; generation: number; tabs: SavedWorkspaceTab[]; lastActive?: LastActive }
  | { op: "moveTab"; tabKey: string; toWorkspaceId?: string; toPlacement: Placement }
  | { op: "createWorkspace"; id: string; name: string; icon?: string; color?: string }
  | { op: "renameWorkspace"; id: string; name: string }
  | { op: "setWorkspaceStyle"; id: string; icon?: string; color?: string }
  | { op: "reorderWorkspaces"; ids: string[] }
  | { op: "setActiveWorkspace"; id: string }
  | { op: "deleteWorkspace"; id: string }
  | { op: "rewriteHostAliases"; aliases: string[]; to?: string }
  | { op: "returnAuxTabsToMain" }
  | { op: "returnAuxGroup"; workspaceId: string; groupId: string };

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // factory.ts::nextHistoryStreamId와 같은 난수/SSR 폴백을 UUID v4 모양으로 낸다.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
export function newWorkspaceId(): string { return uuid(); }
export function newTabKey(): string { return uuid(); }
export function newTileKey(): string { return uuid(); }

function isSplit(root: SavedNode | SavedNodeV2): root is SavedWorkspaceSplit {
  return "dir" in root && typeof root.dir === "string";
}

/** 없는 잎 키만 채우며 기존 키·이력 스트림·추가 필드와 입력 객체를 보존한다. */
export function assignTileKeys(root: SavedNode | SavedNodeV2): SavedNodeV2 {
  if (isSplit(root)) return { ...root, a: assignTileKeys(root.a), b: assignTileKeys(root.b) };
  const existing = "tileKey" in root ? root.tileKey : undefined;
  return { ...root, tileKey: typeof existing === "string" ? existing : newTileKey() } as SavedWorkspaceLeaf;
}

/** 순서는 트리의 a → b 순서이며 중복을 숨기지 않는다. */
export function collectTileKeys(root: SavedNode | SavedNodeV2): string[] {
  if (isSplit(root)) return [...collectTileKeys(root.a), ...collectTileKeys(root.b)];
  return "tileKey" in root && typeof root.tileKey === "string" ? [root.tileKey] : [];
}

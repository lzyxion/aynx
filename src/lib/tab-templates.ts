import { isSavedSplit, parseNode, saveNode, type SavedLeaf, type SavedNode } from "$lib/tabs";
import type { PaneKind, PaneNode } from "$lib/session";
import { freshAgentAutorun } from "$lib/agent-sessions";

/**
 * 탭 템플릿의 순수 층 — 열 때마다 새 세션으로 찍어 낸다.
 * 저장 트리는 탭 복원의 `SavedNode` 그대로이고 읽을 때도 같은 검증(`parseNode`)을 지난다 — 규칙이 두 벌이면 한쪽만 통과하는 값이 생긴다.
 * 상대 폴더(`.` · `./하위`)는 실제 시작 폴더와 겹치지 않는다 — `PaneSpec.cwd` 는 늘 절대 경로다.
 */

/** 파일 형식 버전 — 모르는 버전이면 읽지 않는다 */
export const TAB_TEMPLATE_VERSION = 1;
export const MAX_TEMPLATE_NAME = 60;
export const MAX_TEMPLATES = 100;

/** 복원해 봐야 뜻이 없는 한때의 자리 — 프로듀서 채팅은 앨범에 묶여 있다 */
export const TEMPLATE_SKIP_KINDS: readonly PaneKind[] = ["start", "run", "producer"];

export interface TabTemplate {
  id: string;
  name: string;
  projectId?: string;
  root: SavedNode;
  /** ms */
  savedAt: number;
}

export interface TabTemplateFile {
  version: number;
  templates: TabTemplate[];
}

/** `remote` 는 원격 프로젝트의 호스트 별칭(로컬이면 `null`) */
export interface FolderBase {
  folder: string;
  remote: string | null;
}

// ── 폴더 ──

export function isRelativeFolder(p: string): boolean {
  return p === "." || p.startsWith("./");
}

function normFolder(p: string, local: boolean): string {
  let s = p.trim();
  if (local) s = s.replace(/\\/g, "/").toLowerCase();
  while (s.length > 1 && s.endsWith("/") && !/^[a-z]:\/$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** 상대 부분의 구분자는 늘 `/` 로 적는다(풀 때 기준 폴더의 구분자로 돌린다) */
export function relativizeFolder(path: string, base: string, local: boolean): string | null {
  const p = normFolder(path, local);
  const b = normFolder(base, local);
  if (p === "" || b === "") return null;
  if (p === b) return ".";
  const prefix = b.endsWith("/") ? b : `${b}/`;
  if (!p.startsWith(prefix)) return null;
  const raw = (local ? path.trim().replace(/\\/g, "/") : path.trim()).slice(prefix.length);
  const rest = raw.replace(/\/+$/, "");
  return rest === "" ? "." : `./${rest}`;
}

export function resolveFolder(p: string, base: string): string {
  if (!isRelativeFolder(p)) return p;
  const b = base.trim();
  if (p === ".") return b;
  const sep = b.includes("\\") ? "\\" : "/";
  const rest = p.slice(2).split("/").filter((s) => s !== "").join(sep);
  if (rest === "") return b;
  return b.endsWith(sep) ? `${b}${rest}` : `${b}${sep}${rest}`;
}

function followsBase(leaf: SavedLeaf, base: FolderBase): "cwd" | "path" | null {
  if (base.remote === null) {
    if (leaf.kind === "local") return "cwd";
    if (leaf.kind === "localfs") return "path";
    return null;
  }
  if (leaf.kind === "ssh" && !leaf.adhoc && leaf.alias === base.remote) return "cwd";
  return null;
}

// ── 살아 있는 트리 → 템플릿 트리 ──

/** 세션 고유 값을 지운다. 이관 재시작 명세(`restart`)를 이미 펼쳐 둔 `saveNode(…, true)` 의 값을 받는다 */
function cleanLeaf(raw: SavedLeaf, base: FolderBase | null): SavedLeaf {
  const leaf: SavedLeaf = { ...raw };
  delete leaf.tileKey;
  delete leaf.historyStreamId;
  delete leaf.agentLink;
  delete leaf.tmux;
  delete leaf.scrollback;
  if (leaf.kind === "local" && !leaf.cwd && !leaf.autorun && leaf.lastCwd) leaf.cwd = leaf.lastCwd;
  delete leaf.lastCwd;
  if (leaf.autorun) leaf.autorun = freshAgentAutorun(leaf.autorun);
  if (leaf.kind === "query" && leaf.query) {
    leaf.query = { connId: leaf.query.connId, ...(leaf.query.maxRows !== undefined ? { maxRows: leaf.query.maxRows } : {}) };
  }
  return base ? relativizeLeaf(leaf, base) : leaf;
}

/** 그 자리에서 고친다 */
function relativizeLeaf(leaf: SavedLeaf, base: FolderBase): SavedLeaf {
  const field = followsBase(leaf, base);
  const value = field ? leaf[field] : undefined;
  if (field && value && !isRelativeFolder(value)) {
    const rel = relativizeFolder(value, base.folder, base.remote === null);
    if (rel !== null) leaf[field] = rel;
  }
  return leaf;
}

function mapTree(node: SavedNode, fn: (leaf: SavedLeaf) => SavedLeaf | null): SavedNode | null {
  if (isSavedSplit(node)) {
    const a = mapTree(node.a, fn);
    const b = mapTree(node.b, fn);
    if (a === null) return b;
    if (b === null) return a;
    return { ...node, a, b };
  }
  return fn(node);
}

export function templateFromTree(root: PaneNode, base: FolderBase | null): { root: SavedNode | null; skipped: number } {
  let skipped = 0;
  const out = mapTree(saveNode(root, true), (leaf) => {
    if (TEMPLATE_SKIP_KINDS.includes(leaf.kind)) {
      skipped += 1;
      return null;
    }
    return cleanLeaf(leaf, base);
  });
  return { root: out, skipped };
}

export function hasRelativeFolders(root: SavedNode): boolean {
  return templateLeaves(root).some((l) => (l.cwd !== undefined && isRelativeFolder(l.cwd)) || (l.path !== undefined && isRelativeFolder(l.path)));
}

/** 기준이 없으면 상대 폴더 칸을 지운다 — 그 타일은 기본 폴더에서 연다 */
export function resolveTemplate(root: SavedNode, base: FolderBase | null): SavedNode {
  return (
    mapTree(root, (raw) => {
      const leaf: SavedLeaf = { ...raw };
      for (const field of ["cwd", "path"] as const) {
        const value = leaf[field];
        if (value === undefined || !isRelativeFolder(value)) continue;
        if (base) leaf[field] = resolveFolder(value, base.folder);
        else delete leaf[field];
      }
      return leaf;
    }) ?? root
  );
}

/** `from` 이 `null` 인데 상대 폴더가 있으면 그 칸이 지워진다 — 부르는 쪽이 그때는 옮기지 않는다(`hasRelativeFolders`) */
export function rebaseTemplate(root: SavedNode, from: FolderBase | null, to: FolderBase | null): SavedNode {
  const resolved = resolveTemplate(root, from);
  if (!to) return resolved;
  return mapTree(resolved, (leaf) => relativizeLeaf({ ...leaf }, to)) ?? resolved;
}

/** 사라진 대상을 가리키는 잎은 시작 타일로 — 탭 전체를 실패시키지 않는다 */
export function replaceMissing(
  root: SavedNode,
  missing: (leaf: SavedLeaf) => string | null,
): { root: SavedNode; missing: string[] } {
  const names: string[] = [];
  const out =
    mapTree(root, (leaf) => {
      const name = missing(leaf);
      if (name === null) return leaf;
      if (!names.includes(name)) names.push(name);
      return { kind: "start" };
    }) ?? root;
  return { root: out, missing: names };
}

// ── 첫 AI 잎 ──

export interface FirstAiPatch {
  autorun: string;
  cwd?: string;
}

export function firstAiLeaf(root: SavedNode): SavedLeaf | null {
  return templateLeaves(root).find((l) => leafChip(l) === "ai") ?? null;
}

/** 로컬 잎이면 MCP 토큰 표식도 켠다 — AI 타일이다(`newAiPane` 과 같다) */
export function withFirstAi(root: SavedNode, patch: FirstAiPatch): SavedNode {
  let done = false;
  return (
    mapTree(root, (leaf) => {
      if (done || leafChip(leaf) !== "ai") return leaf;
      done = true;
      const out: SavedLeaf = { ...leaf, autorun: patch.autorun };
      if (patch.cwd !== undefined) out.cwd = patch.cwd;
      if (out.kind === "local") out.injectMcpToken = true;
      return out;
    }) ?? root
  );
}

// ── 읽기 · 미리보기 ──

/** 화면에서 읽는 순서(왼쪽 · 위 먼저) */
export function templateLeaves(root: SavedNode): SavedLeaf[] {
  if (isSavedSplit(root)) return [...templateLeaves(root.a), ...templateLeaves(root.b)];
  return [root];
}

/** 화면의 낱말은 `app.tabTemplates.chip.<이것>` */
export type TemplateChip = "ai" | "ssh" | "shell" | "db" | "files" | "doc" | "image" | "git" | "empty";

export function leafChip(leaf: SavedLeaf): TemplateChip {
  switch (leaf.kind) {
    case "local":
      return leaf.autorun ? "ai" : "shell";
    case "ssh":
      return leaf.autorun ? "ai" : "ssh";
    case "query":
      return "db";
    case "localfs":
    case "sftp":
      return "files";
    case "doc":
      return "doc";
    case "image":
      return "image";
    case "branches":
    case "diff":
      return "git";
    default:
      return "empty";
  }
}

const CHIP_ORDER: readonly TemplateChip[] = ["ai", "ssh", "shell", "db", "files", "doc", "image", "git", "empty"];

export function chipCounts(root: SavedNode): { chip: TemplateChip; n: number }[] {
  const counts = new Map<TemplateChip, number>();
  for (const leaf of templateLeaves(root)) {
    const c = leafChip(leaf);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return CHIP_ORDER.filter((c) => counts.has(c)).map((chip) => ({ chip, n: counts.get(chip) ?? 0 }));
}

/** 0~1 비율의 사각형 */
export interface TemplateCell {
  x: number;
  y: number;
  w: number;
  h: number;
  chip: TemplateChip;
  leaf: SavedLeaf;
}

/** `row` 는 좌우, `col` 은 위아래. `px` 고정 몫은 그림에 넣지 않는다 */
export function templateCells(root: SavedNode): TemplateCell[] {
  const out: TemplateCell[] = [];
  const walk = (n: SavedNode, x: number, y: number, w: number, h: number) => {
    if (!isSavedSplit(n)) {
      out.push({ x, y, w, h, chip: leafChip(n), leaf: n });
      return;
    }
    const r = Math.min(0.95, Math.max(0.05, n.ratio));
    if (n.dir === "row") {
      walk(n.a, x, y, w * r, h);
      walk(n.b, x + w * r, y, w * (1 - r), h);
    } else {
      walk(n.a, x, y, w, h * r);
      walk(n.b, x, y + h * r, w, h * (1 - r));
    }
  };
  walk(root, 0, 0, 1, 1);
  return out;
}

function tailOf(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function leafTarget(leaf: SavedLeaf): { host?: string; connId?: string; agent?: string; folder?: string; file?: string } {
  const folder = leaf.cwd ? (leaf.cwd === "." ? "." : isRelativeFolder(leaf.cwd) ? leaf.cwd.slice(2) : tailOf(leaf.cwd)) : undefined;
  const agent = leaf.autorun ? leaf.autorun.trim().split(/\s+/)[0] : undefined;
  switch (leaf.kind) {
    case "local":
      return { ...(agent ? { agent } : {}), ...(folder ? { folder } : {}) };
    case "ssh":
      return { host: leaf.adhoc ? (leaf.alias ?? leaf.adhoc.host) : (leaf.alias ?? ""), ...(agent ? { agent } : {}), ...(folder ? { folder } : {}) };
    case "query":
      return leaf.query ? { connId: leaf.query.connId } : {};
    case "sftp":
      return { host: leaf.alias ?? "", ...(leaf.path ? { folder: tailOf(leaf.path) } : {}) };
    case "localfs":
      return leaf.path ? { folder: leaf.path === "." ? "." : isRelativeFolder(leaf.path) ? leaf.path.slice(2) : tailOf(leaf.path) } : {};
    case "doc":
    case "image":
      return { ...(leaf.alias ? { host: leaf.alias } : {}), ...(leaf.path ? { file: tailOf(leaf.path) } : {}) };
    default:
      return {};
  }
}

// ── 목록 규칙 ──

export function cleanTemplateName(raw: string): string {
  const name = raw.split(/\s+/u).filter((w) => w !== "").join(" ");
  return [...name].slice(0, MAX_TEMPLATE_NAME).join("");
}

export function findByName(list: readonly TabTemplate[], name: string, exceptId?: string): TabTemplate | undefined {
  const key = cleanTemplateName(name).toLowerCase();
  if (key === "") return undefined;
  return list.find((x) => x.id !== exceptId && x.name.toLowerCase() === key);
}

export function withTemplate(list: readonly TabTemplate[], tpl: TabTemplate): TabTemplate[] {
  return [tpl, ...list.filter((x) => x.id !== tpl.id)].slice(0, MAX_TEMPLATES);
}

export function withoutTemplate(list: readonly TabTemplate[], id: string): TabTemplate[] {
  return list.filter((x) => x.id !== id);
}

export function templatesForProject(list: readonly TabTemplate[], projectId: string): TabTemplate[] {
  return list.filter((x) => x.projectId === projectId);
}

/** 프로젝트를 지우면 그 프로젝트 템플릿도 함께 지운다(사용자 결정) */
export function withoutProjectTemplates(list: readonly TabTemplate[], projectId: string): TabTemplate[] {
  return list.filter((x) => x.projectId !== projectId);
}

export function newTemplateId(): string {
  const rnd = Math.floor(Math.random() * 0x100000000)
    .toString(36)
    .padStart(7, "0");
  return `t-${Date.now().toString(36)}-${rnd}`;
}

// ── 파일 ──

/** 모양을 못 읽으면(깨진 JSON · 모르는 버전) `null` — 부르는 쪽이 그 파일을 덮어쓰지 않게(앞선 판이 남긴 새 형식을 지우지 않는다) */
export function parseTemplates(json: string | null | undefined): TabTemplate[] | null {
  if (json === null || json === undefined || json.trim() === "") return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== TAB_TEMPLATE_VERSION || !Array.isArray(o.templates)) return null;
  const out: TabTemplate[] = [];
  for (const t of o.templates) {
    if (!t || typeof t !== "object") continue;
    const e = t as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id.trim() : "";
    const name = typeof e.name === "string" ? cleanTemplateName(e.name) : "";
    const root = parseNode(e.root);
    if (id === "" || name === "" || !root || out.some((x) => x.id === id)) continue;
    const projectId = typeof e.projectId === "string" ? e.projectId.trim() : "";
    const savedAt = typeof e.savedAt === "number" && Number.isFinite(e.savedAt) ? e.savedAt : 0;
    out.push({ id, name, ...(projectId ? { projectId } : {}), root, savedAt });
    if (out.length >= MAX_TEMPLATES) break;
  }
  return out;
}

/** 키 순서가 늘 같아야 한다 — 같은 목록 = 같은 글자라 무변경 쓰기를 건너뛴다 */
export function serializeTemplates(list: readonly TabTemplate[]): TabTemplateFile {
  return {
    version: TAB_TEMPLATE_VERSION,
    templates: list.map((x) => ({
      id: x.id,
      name: x.name,
      ...(x.projectId ? { projectId: x.projectId } : {}),
      root: x.root,
      savedAt: x.savedAt,
    })),
  };
}

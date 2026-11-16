import { isSavedSplit, parseNode, saveNode, type SavedLeaf, type SavedNode } from "$lib/tabs";
import type { PaneKind, PaneNode } from "$lib/session";
import { freshAgentAutorun } from "$lib/agent-sessions";

/**
 * **탭 템플릿의 순수 층** (2026-11-16) — 모양 · 파일 형식 · 버전 · 살아 있는 트리 → 템플릿 트리 · 폴더 상대화/풀기 ·
 * 미리보기 칸 · 타일 요약. 룬도 DOM 도 없다. 목록 · 파일 왕복 · 여는 길 · 저장 상자는 `app/tab-templates.svelte.ts`.
 *
 * 템플릿은 **탭 하나를 여는 법**이다 — 분할 트리 배치 + 타일마다 종류와 연결 대상(호스트 · DB 연결 · 폴더 · 에이전트). 열 때마다
 * **새 세션**으로 찍어 낸다. 워크스페이스(살아 있는 탭 묶음)와 다르고, 2026-10-02 에 걷은 저장 레이아웃과도 다르다.
 *
 * ## 저장 트리는 탭 복원의 모양 그대로다
 *
 * 잎 · 분할은 `tabs.ts` 의 [`SavedNode`] 이고 읽을 때도 같은 검증([`parseNode`])을 지난다 — 규칙이 두 벌이면 한쪽만 통과하는 값이
 * 생긴다. 다른 것은 **지우는 칸**이다: 세션 고유 값(타일 키 · 이력 거울 키 · 대화 연결 · tmux 세션 이름 · 스크롤백 줄 수 · 마지막
 * 폴더)과 쿼리 초안은 담지 않는다([`cleanLeaf`]). AI 타일의 실행 줄은 새 대화의 줄로 되돌린다(`freshAgentAutorun`).
 *
 * ## 폴더 상대화
 *
 * 프로젝트에 붙인 템플릿은 로컬 셸 · AI 타일(원격 프로젝트면 그 호스트의 SSH 타일)의 시작 폴더가 프로젝트 폴더(또는 그 아래)면
 * **`.` · `./하위`** 로 적는다 — 열 때 "지금 여는 프로젝트의 폴더"(워크트리 시작 화면이면 그 워크트리)에 붙여 푼다. 그 밖의 경로는
 * 절대 경로 그대로다. 실제 시작 폴더는 늘 절대 경로라(`PaneSpec.cwd`) `./` 로 시작하는 값과 겹치지 않는다.
 */

/** 파일 형식 버전 — 모르는 버전이면 읽지 않는다([`parseTemplates`]) */
export const TAB_TEMPLATE_VERSION = 1;
/** 이름 상한(글자) */
export const MAX_TEMPLATE_NAME = 60;
/** 목록 상한 — 넘치면 오래된 것부터 밀려난다 */
export const MAX_TEMPLATES = 100;

/**
 * **템플릿에 넣지 않는 종류** — 복원해 봐야 뜻이 없는 한때의 자리다: 시작 타일(launcher · 프로젝트 시작 화면 — 무엇을 열지 고르는
 * 자리) · 오케스트레이션 보드 · 프로듀서 채팅(앨범에 묶인 것 — 탭 복원도 오케스트레이션 탭은 앱이 쥔다). 걷은 종류(`RETIRED_KINDS`)는
 * 살아 있는 트리에 없다.
 */
export const TEMPLATE_SKIP_KINDS: readonly PaneKind[] = ["start", "run", "producer"];

export interface TabTemplate {
  id: string;
  name: string;
  /** 붙인 프로젝트 id — 없으면 붙이지 않음(그 프로젝트 시작 화면에 서지 않고, 폴더는 저장한 그대로 푼다) */
  projectId?: string;
  root: SavedNode;
  /** 저장(덮어쓰기)한 시각 ms */
  savedAt: number;
}

export interface TabTemplateFile {
  version: number;
  templates: TabTemplate[];
}

/** 폴더를 상대화 · 풀 기준 — `remote` 는 원격 프로젝트의 호스트 별칭(로컬이면 `null`) */
export interface FolderBase {
  folder: string;
  remote: string | null;
}

// ---------------------------------------------------------------------------
// 폴더 — 상대화 · 풀기
// ---------------------------------------------------------------------------

/** 상대 표식인가 — `.` · `./…` */
export function isRelativeFolder(p: string): boolean {
  return p === "." || p.startsWith("./");
}

/** 비교용 꼴 — 로컬(Windows)은 `\` → `/` · 대소문자 무시, 원격은 그대로. 끝의 `/` 는 뗀다(뿌리 하나짜리는 둔다) */
function normFolder(p: string, local: boolean): string {
  let s = p.trim();
  if (local) s = s.replace(/\\/g, "/").toLowerCase();
  while (s.length > 1 && s.endsWith("/") && !/^[a-z]:\/$/.test(s)) s = s.slice(0, -1);
  return s;
}

/**
 * `path` 가 `base` 이거나 그 아래면 상대 표식(`.` · `./a/b`), 아니면 `null`. 로컬은 구분자 · 대소문자를 가리지 않는다(Windows).
 * 상대 부분의 구분자는 늘 `/` 로 적는다(풀 때 기준 폴더의 구분자로 돌린다).
 */
export function relativizeFolder(path: string, base: string, local: boolean): string | null {
  const p = normFolder(path, local);
  const b = normFolder(base, local);
  if (p === "" || b === "") return null;
  if (p === b) return ".";
  const prefix = b.endsWith("/") ? b : `${b}/`;
  if (!p.startsWith(prefix)) return null;
  // 원문에서 같은 길이만큼 잘라 낸다 — 대소문자는 사람이 적은 그대로 남긴다
  const raw = (local ? path.trim().replace(/\\/g, "/") : path.trim()).slice(prefix.length);
  const rest = raw.replace(/\/+$/, "");
  return rest === "" ? "." : `./${rest}`;
}

/** 상대 표식을 기준 폴더에 붙여 푼다 — 기준 폴더의 구분자(`\` 가 있으면 `\`)로 잇는다. 상대가 아니면 그대로 */
export function resolveFolder(p: string, base: string): string {
  if (!isRelativeFolder(p)) return p;
  const b = base.trim();
  if (p === ".") return b;
  const sep = b.includes("\\") ? "\\" : "/";
  const rest = p.slice(2).split("/").filter((s) => s !== "").join(sep);
  if (rest === "") return b;
  return b.endsWith(sep) ? `${b}${rest}` : `${b}${sep}${rest}`;
}

/** 이 잎의 폴더가 그 기준을 따르는가 — 로컬 프로젝트는 로컬 셸 · 로컬 파일, 원격 프로젝트는 그 호스트의 SSH 타일 */
function followsBase(leaf: SavedLeaf, base: FolderBase): "cwd" | "path" | null {
  if (base.remote === null) {
    if (leaf.kind === "local") return "cwd";
    if (leaf.kind === "localfs") return "path";
    return null;
  }
  if (leaf.kind === "ssh" && !leaf.adhoc && leaf.alias === base.remote) return "cwd";
  return null;
}

// ---------------------------------------------------------------------------
// 살아 있는 트리 → 템플릿 트리
// ---------------------------------------------------------------------------

/**
 * 잎 하나를 템플릿 모양으로 — 세션 고유 값을 지우고, AI 실행 줄을 새 대화로, 폴더를 (기준이 있으면) 상대로.
 * 복원 저장(`saveNode(…, true)`)이 이관 재시작 명세(`restart`)를 이미 펼쳐 둔 값을 받는다.
 */
function cleanLeaf(raw: SavedLeaf, base: FolderBase | null): SavedLeaf {
  const leaf: SavedLeaf = { ...raw };
  delete leaf.tileKey;
  delete leaf.historyStreamId;
  delete leaf.agentLink;
  delete leaf.tmux;
  delete leaf.scrollback;
  // 로컬 셸의 지금 폴더 — 시작 폴더가 없으면 그것을 시작 폴더로(그 자리에서 다시 연다). 마지막 폴더 칸 자체는 담지 않는다.
  if (leaf.kind === "local" && !leaf.cwd && !leaf.autorun && leaf.lastCwd) leaf.cwd = leaf.lastCwd;
  delete leaf.lastCwd;
  if (leaf.autorun) leaf.autorun = freshAgentAutorun(leaf.autorun);
  // 쿼리 타일 — 연결과 행 상한만(초안 · 스크립트 탭은 그 자리의 글이다)
  if (leaf.kind === "query" && leaf.query) {
    leaf.query = { connId: leaf.query.connId, ...(leaf.query.maxRows !== undefined ? { maxRows: leaf.query.maxRows } : {}) };
  }
  if (base) {
    const field = followsBase(leaf, base);
    const value = field ? leaf[field] : undefined;
    if (field && value) {
      const rel = relativizeFolder(value, base.folder, base.remote === null);
      if (rel !== null) leaf[field] = rel;
    }
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

/**
 * 살아 있는 탭 트리 → 템플릿 트리(순수). 넣지 않는 종류([`TEMPLATE_SKIP_KINDS`])는 빼고 그 수를 센다(형제가 자리를 차지한다 —
 * 타일 닫기와 같은 접힘). 남는 타일이 없으면 `root: null`.
 */
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

/** 템플릿에 상대 폴더가 있는가 — 붙인 프로젝트를 못 찾으면 풀 수 없다 */
export function hasRelativeFolders(root: SavedNode): boolean {
  return templateLeaves(root).some((l) => (l.cwd !== undefined && isRelativeFolder(l.cwd)) || (l.path !== undefined && isRelativeFolder(l.path)));
}

/**
 * 템플릿 트리의 상대 폴더를 기준 폴더에 붙여 푼다(순수). 기준이 없으면 상대 폴더 칸을 지운다(그 타일은 기본 폴더에서 연다 —
 * 붙인 프로젝트가 사라진 경우).
 */
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

/**
 * 잎마다 대상을 물어 **사라진 대상을 가리키는 잎을 빈 타일로** 바꾼다(순수) — `missing` 이 사라진 대상의 이름을 돌려주면 그 잎이
 * 시작 타일이 되고 이름이 모인다(같은 이름은 한 번). 탭 전체를 실패시키지 않는다.
 */
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

// ---------------------------------------------------------------------------
// 읽기 · 미리보기
// ---------------------------------------------------------------------------

/** 잎들 — 화면에서 읽는 순서(왼쪽 · 위 먼저) */
export function templateLeaves(root: SavedNode): SavedLeaf[] {
  if (isSavedSplit(root)) return [...templateLeaves(root.a), ...templateLeaves(root.b)];
  return [root];
}

/** 타일 종류 칩 — 화면의 낱말은 `app.tabTemplates.chip.<이것>` */
export type TemplateChip = "ai" | "ssh" | "shell" | "db" | "files" | "doc" | "image" | "git" | "empty";

/** 잎 하나의 칩 — 실행 줄이 있는 로컬 · SSH 타일은 AI(에이전트 타일) */
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

/** 칩 순서 — 요약 줄이 늘 같은 순서로 선다 */
const CHIP_ORDER: readonly TemplateChip[] = ["ai", "ssh", "shell", "db", "files", "doc", "image", "git", "empty"];

/** 칩마다 개수 — [`CHIP_ORDER`] 순서, 0 은 빠진다 */
export function chipCounts(root: SavedNode): { chip: TemplateChip; n: number }[] {
  const counts = new Map<TemplateChip, number>();
  for (const leaf of templateLeaves(root)) {
    const c = leafChip(leaf);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return CHIP_ORDER.filter((c) => counts.has(c)).map((chip) => ({ chip, n: counts.get(chip) ?? 0 }));
}

/** 미리보기 칸 하나 — 0~1 비율의 사각형 */
export interface TemplateCell {
  x: number;
  y: number;
  w: number;
  h: number;
  chip: TemplateChip;
}

/** 작은 분할 그림의 칸들(순수) — `row` 는 좌우, `col` 은 위아래. `px` 고정 몫은 그림에 넣지 않는다 */
export function templateCells(root: SavedNode): TemplateCell[] {
  const out: TemplateCell[] = [];
  const walk = (n: SavedNode, x: number, y: number, w: number, h: number) => {
    if (!isSavedSplit(n)) {
      out.push({ x, y, w, h, chip: leafChip(n) });
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

/** 경로의 마지막 조각(구분자 둘 다) — 없으면 그대로 */
function tailOf(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * 잎 하나의 **대상 요약 재료**(순수 — 낱말은 화면이 얹는다): 주 대상(호스트 별칭 · 연결 id · 파일 이름 · 폴더)과 덧붙일 폴더.
 * 쿼리 타일의 연결 이름 · 에이전트 표시 이름은 화면이 앱 상태에서 찾는다.
 */
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

// ---------------------------------------------------------------------------
// 목록 규칙
// ---------------------------------------------------------------------------

/** 이름 다듬기 — 공백류를 한 칸으로 · 앞뒤를 떼고 · 상한에서 자른다 */
export function cleanTemplateName(raw: string): string {
  const name = raw.split(/\s+/u).filter((w) => w !== "").join(" ");
  return [...name].slice(0, MAX_TEMPLATE_NAME).join("");
}

/** 같은 이름(대소문자 무시)의 템플릿 — `exceptId` 는 빼고 본다 */
export function findByName(list: readonly TabTemplate[], name: string, exceptId?: string): TabTemplate | undefined {
  const key = cleanTemplateName(name).toLowerCase();
  if (key === "") return undefined;
  return list.find((x) => x.id !== exceptId && x.name.toLowerCase() === key);
}

/** 넣거나 갈아 끼운다 — 맨 앞으로(가장 최근) · 상한을 넘으면 뒤에서 밀려난다 */
export function withTemplate(list: readonly TabTemplate[], tpl: TabTemplate): TabTemplate[] {
  return [tpl, ...list.filter((x) => x.id !== tpl.id)].slice(0, MAX_TEMPLATES);
}

export function withoutTemplate(list: readonly TabTemplate[], id: string): TabTemplate[] {
  return list.filter((x) => x.id !== id);
}

/** 그 프로젝트에 붙인 템플릿 — 목록 순서(최근 먼저) 그대로 */
export function templatesForProject(list: readonly TabTemplate[], projectId: string): TabTemplate[] {
  return list.filter((x) => x.projectId === projectId);
}

/** 그 프로젝트 템플릿을 뺀 목록 — 프로젝트를 지우면 그 프로젝트 템플릿도 함께 지운다(2026-11-16 사용자 결정) */
export function withoutProjectTemplates(list: readonly TabTemplate[], projectId: string): TabTemplate[] {
  return list.filter((x) => x.projectId !== projectId);
}

/**
 * 그 탭에서 **덮어쓸 수 있는** 템플릿(탭 우클릭 [템플릿 덮어쓰기 ▸]) — 탭의 프로젝트 템플릿 + 프로젝트 없는 템플릿. 프로젝트 없이 연
 * 탭이면 프로젝트 없는 템플릿만(다른 프로젝트 템플릿을 남의 탭 배치로 바꾸지 않는다). 목록 순서 그대로.
 */
export function templatesForTab(list: readonly TabTemplate[], projectId: string | null): TabTemplate[] {
  return list.filter((x) => !x.projectId || (projectId !== null && x.projectId === projectId));
}

/** 새 id — 겹치지 않으면 된다(파일 안에서만 뜻이 있다) */
export function newTemplateId(): string {
  const rnd = Math.floor(Math.random() * 0x100000000)
    .toString(36)
    .padStart(7, "0");
  return `t-${Date.now().toString(36)}-${rnd}`;
}

// ---------------------------------------------------------------------------
// 파일
// ---------------------------------------------------------------------------

/**
 * 원시 JSON → 템플릿 목록. 파일이 없으면 빈 목록, **모양을 못 읽으면(깨진 JSON · 모르는 버전) `null`** — 부르는 쪽이 그 파일을
 * 덮어쓰지 않게(앞선 판이 남긴 새 형식을 지우지 않는다). 항목 하나가 틀리면 그 항목만 버린다(목록 전체를 버리지 않는다).
 */
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

/** 목록 → 파일 모양 — 키 순서가 늘 같다(같은 목록 = 같은 글자 · 무변경 쓰기 생략) */
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

import { invoke } from "$lib/ipc";
import { showNotice } from "$lib/app/notice";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { projectById, projects } from "$lib/app/project-list.svelte.js";
import { hostCache, lookupHost } from "$lib/app/hosts.svelte.js";
import { rememberTarget } from "$lib/app/prompts.svelte.js";
import { ensureDbConns, findDbConn } from "$lib/app/db-conns.svelte.js";
import { displayTabTitle } from "$lib/app/titles.svelte.js";
import {
  activeTab,
  adoptPane,
  focusPane,
  focusTile,
  openTab,
  replaceTileWithTree,
  residentWindowTabs,
} from "$lib/app/tabs.svelte.js";
import { hostMeta } from "$lib/hosts";
import { isRemote, type Project } from "$lib/projects";
import { aiDisplayName } from "$lib/pane-icons";
import { restoreNode, type SavedLeaf, type SavedNode } from "$lib/tabs";
import { clampScrollback, findFirstPane, listPanes, restoredTab, shellLabel, type PaneNode, type TabSpec } from "$lib/session";
import {
  chipCounts,
  cleanTemplateName,
  findByName,
  hasRelativeFolders,
  leafChip,
  leafTarget,
  newTemplateId,
  parseTemplates,
  replaceMissing,
  resolveTemplate,
  serializeTemplates,
  templateFromTree,
  templateLeaves,
  templatesForProject,
  templatesForTab,
  withoutProjectTemplates,
  withTemplate,
  withoutTemplate,
  type FolderBase,
  type TabTemplate,
  type TemplateChip,
} from "$lib/tab-templates";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { Key } from "$lib/i18n/keys";

/**
 * **탭 템플릿의 창 상태와 손잡이** (2026-11-16) — 목록과 `tab-templates.json` 왕복 · 저장 상자 · 여는 길 · 이름 바꾸기 · 덮어쓰기 · 지우기.
 * 규칙(모양 · 검증 · 폴더 상대화 · 트리 변환)은 순수 층 `$lib/tab-templates` 에 있다.
 *
 * 입구: 탭 우클릭 [템플릿으로 저장…] · 팔레트 [지금 탭을 템플릿으로 저장…](저장 상자 `TabTemplateSaveDialog.svelte` — 문 하나) /
 * 프로젝트 시작 화면의 템플릿 칸(그 자리를 템플릿 배치로) · 팔레트의 템플릿 줄(지금 워크스페이스에 새 탭 하나). 전역 단축키 · 독 줄은 없다.
 *
 * ## 쓰기는 조작 단위로 디스크 최신 위에
 *
 * 창이 여럿(주 창 · 보조 창 · 원격 창)이라 각자의 사본이 낡을 수 있다 — 고칠 때마다 파일을 다시 읽고 그 위에 얹어 쓴다([`mutate`]).
 * 파일을 못 읽으면(깨진 JSON · 모르는 버전) **쓰지 않는다** — 다른 판이 남긴 새 형식을 지우지 않게.
 *
 * ## 여는 길은 탭 복원과 같다
 *
 * 템플릿 트리 → 폴더 풀기 → 사라진 대상은 빈 타일 → `restoreNode`(복원과 같은 패널 생성자 · SFTP 짝 찾기). 다른 것은 셋 — SSH 를
 * 연결 대기로 두지 않고(사람이 방금 연 것이다) 첫 접속에 시작 폴더 · 에이전트를 싣고(`firstRun`), 그룹 열기와 같은 계단 지연을 준다.
 * 인증은 여느 타일과 같은 길(볼트 · 호스트 설정 · 비밀번호 입력)이다 — 템플릿에는 비밀이 없다.
 */

/** 최근 먼저 */
let list = $state<TabTemplate[]>([]);
/** 파일을 한 번이라도 읽었나 — [`ensureTabTemplates`] 는 처음 한 번만 실제로 읽는다 */
let loaded = false;

/** 지금 목록(반응형) */
export function tabTemplates(): readonly TabTemplate[] {
  return list;
}

/** 그 프로젝트에 붙인 템플릿(최근 먼저) */
export function projectTabTemplates(projectId: string): TabTemplate[] {
  return templatesForProject(list, projectId);
}

/** 파일 → 목록. 못 읽으면 `null`(사본은 그대로) */
async function readFile(): Promise<TabTemplate[] | null> {
  try {
    return parseTemplates(await invoke<string | null>("load_tab_templates"));
  } catch {
    return null;
  }
}

/** 창당 처음 한 번 읽는다(부팅) — 실패하면 빈 목록으로 산다 */
export async function ensureTabTemplates(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const read = await readFile();
  if (read) list = read;
}

/** 다시 읽는다 — 다른 창이 고쳤을 수 있다(프로젝트 시작 화면이 뜰 때) */
export async function reloadTabTemplates(): Promise<void> {
  loaded = true;
  const read = await readFile();
  if (read) list = read;
}

/**
 * 조작 하나 — 디스크의 최신 위에 얹어 쓴다(머리말). 못 읽은 파일 위에는 쓰지 않고 안내만 한다. 쓰기 실패도 안내 한 줄(사본은 바뀐 채 —
 * 이번 실행에서는 그대로 쓴다).
 */
async function mutate(fn: (cur: TabTemplate[]) => TabTemplate[]): Promise<boolean> {
  const cur = await readFile();
  if (cur === null) {
    showNotice(t("app.tabTemplates.notice.fileUnreadable"));
    return false;
  }
  const next = fn(cur);
  list = next;
  loaded = true;
  try {
    await invoke("save_tab_templates", { json: JSON.stringify(serializeTemplates(next)) });
  } catch (e) {
    showNotice(t("app.tabTemplates.notice.saveFailed", { error: e instanceof Error ? e.message : String(e) }));
  }
  return true;
}

// ---------------------------------------------------------------------------
// 탭 → 템플릿
// ---------------------------------------------------------------------------

/**
 * 그 탭이 어느 프로젝트에서 열렸나 — 탭의 프로젝트, 없으면 탭 안의 프로젝트 시작 화면 · 둘 다 없으면 `null`. 저장 상자의 기본값과
 * 덮어쓰기 옆목록(어느 템플릿이 보이나)이 같은 판정을 쓴다.
 */
export function tabProjectOf(tab: TabSpec): Project | null {
  if (tab.projectId) {
    const p = projectById(tab.projectId);
    if (p) return p;
  }
  for (const pane of listPanes(tab.root)) {
    if (pane.kind === "start" && pane.startProject) {
      const p = projectById(pane.startProject.projectId);
      if (p) return p;
    }
  }
  return null;
}

/** 저장할 때 폴더를 상대화할 기준 — 그 탭의 폴더(로컬 프로젝트 탭 · 그 프로젝트의 시작 화면), 없으면 프로젝트 주 폴더 */
function saveBase(tab: TabSpec, p: Project): FolderBase {
  const remote = isRemote(p) ? p.host : null;
  if (remote === null && tab.projectId === p.id && tab.projectFolder) return { folder: tab.projectFolder, remote };
  for (const pane of listPanes(tab.root)) {
    if (pane.kind === "start" && pane.startProject?.projectId === p.id) return { folder: pane.startProject.folder, remote };
  }
  return { folder: p.path, remote };
}

/** 템플릿에 넣을 타일이 있는 탭인가 — 탭 우클릭의 [템플릿으로 저장…] · [템플릿 덮어쓰기] 가 같은 규칙으로 꺼진다 */
export function tabTemplateSavable(tab: TabSpec): boolean {
  return templateFromTree(tab.root, null).root !== null;
}

/** 그 탭 → 템플릿 트리(프로젝트에 붙이면 그 기준으로 상대화) */
function treeOf(tab: TabSpec, projectId: string | null): { root: SavedNode | null; skipped: number } {
  const p = projectId ? projectById(projectId) : null;
  return templateFromTree(tab.root, p ? saveBase(tab, p) : null);
}

// ---------------------------------------------------------------------------
// 저장 상자 — 한 칸(모달은 `TabTemplateSaveDialog.svelte`)
// ---------------------------------------------------------------------------

const FOCUS_TEMPLATE_SAVE = "tab-template-save";

export interface TabTemplateSaveForm {
  name: string;
  /** 붙일 프로젝트 id — `""` = 붙이지 않음 */
  projectId: string;
  /** 미리보기 트리(남는 타일이 없으면 `null`) */
  root: SavedNode | null;
  /** 넣지 않는 타일 수 */
  skipped: number;
}

const save = $state<{ open: boolean; tabId: string } & TabTemplateSaveForm>({
  open: false,
  tabId: "",
  name: "",
  projectId: "",
  root: null,
  skipped: 0,
});

/** 상자가 떠 있는가 — `anyModalOpen()` 이 본다(전역 단축키가 쉰다) */
export function tabTemplateSaveOpen(): boolean {
  return save.open;
}

/** 상자가 그리는 것(`null` = 닫힘) */
export function tabTemplateSaveForm(): TabTemplateSaveForm | null {
  if (!save.open) return null;
  return { name: save.name, projectId: save.projectId, root: save.root, skipped: save.skipped };
}

/** 칸을 고친다 — 프로젝트를 바꾸면 미리보기를 다시 짓는다(폴더 상대화가 기준을 따른다) */
export function setTabTemplateSaveField(patch: Partial<Pick<TabTemplateSaveForm, "name" | "projectId">>): void {
  if (!save.open) return;
  if (patch.name !== undefined) save.name = patch.name;
  if (patch.projectId !== undefined && patch.projectId !== save.projectId) {
    save.projectId = patch.projectId;
    const tab = residentWindowTabs().find((x) => x.id === save.tabId);
    if (tab) {
      const d = treeOf(tab, save.projectId || null);
      save.root = d.root;
      save.skipped = d.skipped;
    }
  }
}

/**
 * **저장 상자를 연다** — 탭 우클릭 [템플릿으로 저장…] · 팔레트의 저장 줄이 함께 쓰는 문 하나. 이름의 기본은 탭에 보이는 이름, 프로젝트의
 * 기본은 그 탭이 열린 프로젝트(모르면 붙이지 않음). 남는 타일이 없는 탭(시작 화면 하나 · 오케스트레이션 탭)은 상자를 열지 않고 안내만.
 */
export function openTabTemplateSave(tabId: string | null): void {
  const tab = tabId ? residentWindowTabs().find((x) => x.id === tabId) : activeTab();
  if (!tab) return;
  const p = tabProjectOf(tab);
  const d = treeOf(tab, p?.id ?? null);
  if (d.root === null) {
    showNotice(t("app.tabTemplates.notice.nothing"));
    return;
  }
  if (!save.open) rememberFocusOrigin(FOCUS_TEMPLATE_SAVE);
  save.tabId = tab.id;
  save.name = cleanTemplateName(displayTabTitle(tab));
  save.projectId = p?.id ?? "";
  save.root = d.root;
  save.skipped = d.skipped;
  save.open = true;
}

export function cancelTabTemplateSave(): void {
  save.open = false;
  returnFocus(FOCUS_TEMPLATE_SAVE);
}

/**
 * 저장한다. 이름이 비면 상자를 연 채 안내만 한다. **같은 이름이 있으면 덮어쓸지 묻는다**(덮어쓰면 그 템플릿의 id 를 이어 쓴다 — 붙인
 * 프로젝트 · 배치가 이번 것으로 바뀐다). 묻는 동안 상자는 그대로다.
 */
export async function commitTabTemplateSave(): Promise<void> {
  if (!save.open) return;
  const name = cleanTemplateName(save.name);
  if (name === "") {
    showNotice(t("app.tabTemplates.notice.noName"));
    return;
  }
  const tab = residentWindowTabs().find((x) => x.id === save.tabId);
  const d = tab ? treeOf(tab, save.projectId || null) : null;
  if (!d || d.root === null) {
    showNotice(t("app.tabTemplates.notice.nothing"));
    return;
  }
  const root = d.root;
  const projectId = save.projectId || undefined;
  const same = findByName(list, name);
  if (same) {
    const ok = await askConfirm(t("app.tabTemplates.overwrite.body", { name: same.name }), {
      title: t("app.tabTemplates.overwrite.title"),
      kind: "warning",
      okLabel: t("app.tabTemplates.overwrite.ok"),
    });
    if (!ok || !save.open) return;
  }
  save.open = false;
  returnFocus(FOCUS_TEMPLATE_SAVE);
  await mutate((cur) => {
    const hit = findByName(cur, name);
    return withTemplate(cur, { id: hit?.id ?? newTemplateId(), name, ...(projectId ? { projectId } : {}), root, savedAt: Date.now() });
  });
  showNotice(t("app.tabTemplates.notice.saved", { name }));
}

// ---------------------------------------------------------------------------
// 고치기 — 이름 바꾸기 · 지금 탭으로 덮어쓰기 · 지우기(프로젝트 시작 화면의 카드 메뉴)
// ---------------------------------------------------------------------------

/** 이름을 바꾼다 — 같은 이름이 이미 있으면 던진다(문구 = 화면에 보일 것 · 이름 칸이 말풍선으로 보인다) */
export async function renameTabTemplate(id: string, raw: string): Promise<void> {
  const name = cleanTemplateName(raw);
  if (findByName(list, name, id)) throw new Error(t("app.tabTemplates.rename.taken", { name }));
  await mutate((cur) => cur.map((x) => (x.id === id ? { ...x, name } : x)));
}

/** 그 탭에서 덮어쓸 수 있는 템플릿 — 탭의 프로젝트 템플릿 + 프로젝트 없는 템플릿(탭 우클릭 [템플릿 덮어쓰기 ▸]) */
export function overwritableTemplates(tab: TabSpec): TabTemplate[] {
  return templatesForTab(list, tabProjectOf(tab)?.id ?? null);
}

/**
 * 그 탭의 배치로 그 템플릿을 갈아 끼운다(확인 상자 · 탭 우클릭 [템플릿 덮어쓰기 ▸]) — 이름은 그대로. 프로젝트 템플릿이면 프로젝트도
 * 그대로이고 폴더 상대화는 그 프로젝트 기준. **프로젝트 없는 템플릿을 프로젝트 탭으로 덮어쓰면** 그 탭의 프로젝트 템플릿이 된다(저장
 * 상자의 기본값과 같은 판정 [`tabProjectOf`] · 같은 상대화) — 확인 상자가 그 사실을 한 줄로 말한다. 옆목록에 없는 짝(다른 프로젝트
 * 템플릿)은 하지 않는다.
 */
export async function overwriteTabTemplate(id: string, tabId: string): Promise<void> {
  const tpl = list.find((x) => x.id === id);
  const tab = residentWindowTabs().find((x) => x.id === tabId);
  if (!tpl || !tab) return;
  const tabProject = tabProjectOf(tab);
  if (!templatesForTab([tpl], tabProject?.id ?? null).length) return;
  const attach = !tpl.projectId && tabProject ? tabProject : null;
  const projectId = tpl.projectId ?? attach?.id ?? null;
  const d = treeOf(tab, projectId);
  if (d.root === null) {
    showNotice(t("app.tabTemplates.notice.nothing"));
    return;
  }
  const params = { name: tpl.name, tab: displayTabTitle(tab) };
  const body = attach
    ? t("app.tabTemplates.replace.bodyAttach", { ...params, project: attach.name })
    : t("app.tabTemplates.replace.body", params);
  const ok = await askConfirm(body, {
    title: t("app.tabTemplates.replace.title"),
    kind: "warning",
    okLabel: t("app.tabTemplates.replace.ok"),
  });
  if (!ok) return;
  const root = d.root;
  await mutate((cur) =>
    cur.map((x) => (x.id === id ? { ...x, ...(projectId ? { projectId } : {}), root, savedAt: Date.now() } : x)),
  );
  showNotice(t("app.tabTemplates.notice.saved", { name: tpl.name }));
}

/** 그 프로젝트 템플릿 수 — 파일의 최신으로 센다(프로젝트 삭제 확인 상자의 "템플릿 N개" 줄). 못 읽으면 사본으로 */
export async function projectTemplateCount(projectId: string): Promise<number> {
  const cur = (await readFile()) ?? list;
  return templatesForProject(cur, projectId).length;
}

/**
 * 그 프로젝트 템플릿을 모두 지운다 — `project_remove` 가 **성공한 뒤에만** 부른다(`app/projects` 의 삭제 흐름). 디스크 최신 위에 쓴다.
 * 못 읽거나 못 쓰면 [`mutate`] 가 안내 한 줄을 띄운다(프로젝트 삭제는 되돌리지 않는다).
 */
export async function dropProjectTemplates(projectId: string): Promise<void> {
  if ((await readFile())?.some((x) => x.projectId === projectId) === false) return; // 지울 것이 없으면 쓰지 않는다
  await mutate((cur) => withoutProjectTemplates(cur, projectId));
}

/** 지운다(확인 상자 · 위험) */
export async function deleteTabTemplate(id: string): Promise<void> {
  const tpl = list.find((x) => x.id === id);
  if (!tpl) return;
  const ok = await askConfirm(t("app.tabTemplates.delete.body", { name: tpl.name }), {
    title: t("app.tabTemplates.delete.title"),
    kind: "warning",
    danger: true,
    okLabel: t("app.tabTemplates.delete.ok"),
  });
  if (!ok) return;
  await mutate((cur) => withoutTemplate(cur, id));
}

// ---------------------------------------------------------------------------
// 열기
// ---------------------------------------------------------------------------

/** SSH 타일 사이의 시작 간격 — 그룹 전체 열기(`app/hosts/open.ts` 의 `OPEN_STAGGER_MS`)와 같은 값 */
const OPEN_STAGGER_MS = 120;

/** 어디에 여나 — 새 탭(팔레트) · 그 시작 화면 타일 자리(프로젝트 시작 화면) */
export type TemplateOpenWhere =
  | { kind: "newTab" }
  | { kind: "replace"; tabId: string; paneId: string; folder: string; host?: string };

/** 사라진 대상의 이름 — 없으면 `null`(호스트 목록 · DB 연결 · 프로젝트를 아직 못 읽었으면 묻지 않는다) */
function missingTarget(leaf: SavedLeaf, hostsKnown: boolean): string | null {
  if ((leaf.kind === "ssh" || leaf.kind === "sftp") && !leaf.adhoc && leaf.alias && hostsKnown && !lookupHost(leaf.alias)) return leaf.alias;
  if (leaf.kind === "query" && leaf.query?.connId && !findDbConn(leaf.query.connId)) return leaf.query.connId;
  if (leaf.kind === "branches" && leaf.branchGraph?.projectId && !projectById(leaf.branchGraph.projectId)) return t("app.tabTemplates.missing.project");
  if (leaf.kind === "diff" && leaf.diff?.projectId && !projectById(leaf.diff.projectId)) return t("app.tabTemplates.missing.project");
  return null;
}

/** 열 트리를 짓는다 — 폴더 풀기 · 사라진 대상 · 새 패널(SSH 는 곧바로 · 계단 지연 · 그 호스트의 스크롤백) */
async function buildTree(tpl: TabTemplate, base: FolderBase | null): Promise<PaneNode> {
  if (tpl.projectId && !base && hasRelativeFolders(tpl.root)) showNotice(t("app.tabTemplates.notice.projectGone", { name: tpl.name }));
  await ensureDbConns().catch(() => undefined);
  const resolved = resolveTemplate(tpl.root, base);
  const checked = replaceMissing(resolved, (leaf) => missingTarget(leaf, hostCache().length > 0));
  if (checked.missing.length > 0) {
    showNotice(t("app.tabTemplates.notice.missing", { name: tpl.name, targets: checked.missing.join(" · ") }));
  }
  const node = restoreNode(checked.root, { deferSsh: false, firstRun: true });
  let i = 0;
  for (const pane of listPanes(node)) {
    if (pane.kind !== "ssh") continue;
    const host = pane.adhoc ? null : lookupHost(pane.alias ?? "");
    if (host) {
      rememberTarget(host); // 비밀번호 모달이 "어디에 붙는 중인지" 를 말할 수 있게(그룹 열기와 같다)
      const lines = clampScrollback(hostMeta(host).scrollback);
      if (lines !== undefined) pane.scrollback = lines;
    }
    if (i > 0) pane.openDelay = i * OPEN_STAGGER_MS;
    i += 1;
  }
  return node;
}

/**
 * **템플릿을 연다** — 새 세션으로 찍어 낸다(머리말 "여는 길").
 *
 * - `replace` — 프로젝트 시작 화면 타일 자리가 템플릿 배치로 바뀐다(탭의 유일한 타일이면 탭 내용 전체가, 분할 안이면 그 칸이). 폴더는
 *   그 시작 화면의 폴더(워크트리면 그 워크트리)에 붙여 푼다.
 * - `newTab` — 지금 워크스페이스에 새 탭 하나(이름 = 템플릿 이름). 붙인 프로젝트가 있으면 그 주 폴더에 붙여 푼다.
 */
export async function openTabTemplate(id: string, where: TemplateOpenWhere): Promise<void> {
  const tpl = list.find((x) => x.id === id);
  if (!tpl) return;
  const project = tpl.projectId ? projectById(tpl.projectId) : null;
  let base: FolderBase | null = null;
  if (where.kind === "replace") base = { folder: where.folder, remote: where.host ?? (project && isRemote(project) ? project.host : null) };
  else if (project) base = { folder: project.path, remote: isRemote(project) ? project.host : null };
  const node = await buildTree(tpl, base);
  const first = findFirstPane(node);
  if (where.kind === "replace") {
    // 시작 화면이 탭에 혼자였으면(탭 전체가 템플릿이 된다) 탭 이름도 템플릿 이름 — 팔레트로 연 새 탭과 같다. 분할 안의 한 칸이면 그대로.
    if (replaceTileWithTree(where.tabId, where.paneId, node, tpl.name)) focusTile(where.tabId, first.id);
    return;
  }
  const localFolder = base && base.remote === null ? base.folder : undefined;
  const fresh = restoredTab(node, undefined, tpl.name, undefined, localFolder);
  if (project) fresh.projectId = project.id;
  const tab = openTab(fresh);
  focusPane(tab.id, first.id);
  for (const p of listPanes(tab.root)) adoptPane(tab.id, p.id);
}

// ---------------------------------------------------------------------------
// 화면 글자 — 칩 · 요약 · 팔레트 줄
// ---------------------------------------------------------------------------

/** 칩 → 문구 키 */
const CHIP_KEY: Record<TemplateChip, Key> = {
  ai: "app.tabTemplates.chip.ai",
  ssh: "app.tabTemplates.chip.ssh",
  shell: "app.tabTemplates.chip.shell",
  db: "app.tabTemplates.chip.db",
  files: "app.tabTemplates.chip.files",
  doc: "app.tabTemplates.chip.doc",
  image: "app.tabTemplates.chip.image",
  git: "app.tabTemplates.chip.git",
  empty: "app.tabTemplates.chip.empty",
};

/** 칩 하나의 낱말 */
export function chipLabel(chip: TemplateChip): string {
  return t(CHIP_KEY[chip]);
}

/** 카드 · 팔레트의 타일 요약 — "AI 2 · SSH · DB" */
export function templateSummary(root: SavedNode): string {
  const leaves = templateLeaves(root);
  const out: string[] = [];
  for (const { chip } of chipCounts(root)) {
    // 같은 칩 안에서도 셸은 종류 이름마다 따로 센다("PowerShell 7 2 · Git Bash") — 칩 순서는 그대로
    const counts = new Map<string, number>();
    for (const leaf of leaves) {
      if (leafChip(leaf) !== chip) continue;
      const label = leafChipLabel(leaf);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    for (const [label, n] of counts) out.push(n > 1 ? `${label} ${n}` : label);
  }
  return out.join(" · ");
}

/** 잎 하나의 칩 글자 — 로컬 셸은 타일 머리줄과 같은 셸 이름(`shellLabel`), 종류를 모르면 "셸" */
export function leafChipLabel(leaf: SavedLeaf): string {
  const chip = leafChip(leaf);
  if (chip === "shell" && leaf.kind === "local" && leaf.shell) return shellLabel(leaf.shell, t);
  return chipLabel(chip);
}

/** 잎 하나의 대상 요약 — 저장 상자의 타일 목록 */
export function leafSummary(leaf: SavedLeaf): string {
  const tg = leafTarget(leaf);
  const parts: string[] = [];
  if (tg.agent) parts.push(aiDisplayName(tg.agent) ?? tg.agent);
  if (tg.host) parts.push(tg.host);
  if (tg.connId) parts.push(findDbConn(tg.connId)?.name ?? tg.connId);
  if (tg.file) parts.push(tg.file);
  if (tg.folder) parts.push(tg.folder === "." ? t("app.tabTemplates.folder.root") : tg.folder);
  if (leaf.kind === "branches" || leaf.kind === "diff") {
    const pid = leaf.branchGraph?.projectId ?? leaf.diff?.projectId;
    const p = pid ? projectById(pid) : null;
    if (p) parts.push(p.name);
  }
  return parts.join(" · ");
}

/** 저장 상자의 타일 목록 — 칩 · 대상 */
export function templateRows(root: SavedNode): { chip: TemplateChip; label: string; target: string }[] {
  return templateLeaves(root).map((leaf) => {
    const chip = leafChip(leaf);
    return { chip, label: leafChipLabel(leaf), target: leafSummary(leaf) };
  });
}

/** 팔레트 한 줄 — 붙인 프로젝트 이름(없으면 타일 요약) */
export interface TemplatePaletteEntry {
  id: string;
  name: string;
  detail: string;
  keywords: string;
}

export function templatePaletteEntries(): TemplatePaletteEntry[] {
  return list.map((x) => {
    const p = x.projectId ? projectById(x.projectId) : null;
    const summary = templateSummary(x.root);
    return { id: x.id, name: x.name, detail: p ? p.name : summary, keywords: `${x.name} ${p?.name ?? ""} ${summary}` };
  });
}

/** 저장 상자의 프로젝트 고르기 — 붙이지 않음 + 이름순 */
export function templateProjectOptions(): { value: string; label: string }[] {
  const sorted = [...projects()].sort((a, b) => a.name.localeCompare(b.name));
  return [{ value: "", label: t("app.tabTemplates.save.noProject") }, ...sorted.map((p) => ({ value: p.id, label: p.name }))];
}

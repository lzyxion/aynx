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
import { DB_ENGINE_ICON } from "$lib/db-conn";
import { leafLogo, type LogoEnv, type TemplateLogo } from "$lib/template-icons";
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
  rebaseTemplate,
  replaceMissing,
  resolveTemplate,
  serializeTemplates,
  templateFromTree,
  templateLeaves,
  templatesForProject,
  withoutProjectTemplates,
  withTemplate,
  withoutTemplate,
  withFirstAi,
  type FirstAiPatch,
  type FolderBase,
  type TabTemplate,
  type TemplateChip,
} from "$lib/tab-templates";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { Key } from "$lib/i18n/keys";

/** 탭 템플릿의 창 상태 — 템플릿에는 비밀이 없다(인증은 여느 타일과 같은 길) */

/** 최근 먼저 */
let list = $state<TabTemplate[]>([]);
let loaded = false;

export function tabTemplates(): readonly TabTemplate[] {
  return list;
}

export function projectTabTemplates(projectId: string): TabTemplate[] {
  return templatesForProject(list, projectId);
}

/** 못 읽으면 `null` */
async function readFile(): Promise<TabTemplate[] | null> {
  try {
    return parseTemplates(await invoke<string | null>("load_tab_templates"));
  } catch {
    return null;
  }
}

export async function ensureTabTemplates(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const read = await readFile();
  if (read) list = read;
}

export async function reloadTabTemplates(): Promise<void> {
  loaded = true;
  const read = await readFile();
  if (read) list = read;
}

/**
 * 창이 여럿이라 사본이 낡을 수 있다 — 조작마다 디스크 최신을 다시 읽고 그 위에 쓴다. 못 읽으면(깨진 JSON · 모르는 버전) 쓰지 않는다 —
 * 다른 판이 남긴 새 형식을 지우지 않게. 디스크에 써졌을 때만 `true`.
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
    return false;
  }
  return true;
}

// ── 탭 → 템플릿 ──

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

function saveBase(tab: TabSpec, p: Project): FolderBase {
  const remote = isRemote(p) ? p.host : null;
  if (remote === null && tab.projectId === p.id && tab.projectFolder) return { folder: tab.projectFolder, remote };
  for (const pane of listPanes(tab.root)) {
    if (pane.kind === "start" && pane.startProject?.projectId === p.id) return { folder: pane.startProject.folder, remote };
  }
  return { folder: p.path, remote };
}

export function tabTemplateSavable(tab: TabSpec): boolean {
  return templateFromTree(tab.root, null).root !== null;
}

function treeOf(tab: TabSpec, projectId: string | null): { root: SavedNode | null; skipped: number } {
  const p = projectId ? projectById(projectId) : null;
  return templateFromTree(tab.root, p ? saveBase(tab, p) : null);
}

// ── 저장 상자 ──

const FOCUS_TEMPLATE_SAVE = "tab-template-save";

export interface TabTemplateSaveForm {
  name: string;
  /** `""` = 붙이지 않음 */
  projectId: string;
  root: SavedNode | null;
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

/** `anyModalOpen()` 이 본다 */
export function tabTemplateSaveOpen(): boolean {
  return save.open;
}

export function tabTemplateSaveForm(): TabTemplateSaveForm | null {
  if (!save.open) return null;
  return { name: save.name, projectId: save.projectId, root: save.root, skipped: save.skipped };
}

/** 프로젝트를 바꾸면 미리보기를 다시 짓는다 — 폴더 상대화가 기준을 따른다 */
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

/** 같은 이름이면 덮어쓸지 묻는다 — 덮어쓰면 그 템플릿의 id 를 이어 쓴다 */
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
  const ok = await mutate((cur) => {
    const hit = findByName(cur, name);
    return withTemplate(cur, { id: hit?.id ?? newTemplateId(), name, ...(projectId ? { projectId } : {}), root, savedAt: Date.now() });
  });
  if (ok) showNotice(t("app.tabTemplates.notice.saved", { name }));
}

// ── 고치기 ──

/** 같은 이름이 있으면 던진다 — 그 문구가 화면에 그대로 보인다 */
export async function renameTabTemplate(id: string, raw: string): Promise<boolean> {
  const name = cleanTemplateName(raw);
  if (findByName(list, name, id)) throw new Error(t("app.tabTemplates.rename.taken", { name }));
  return mutate((cur) => cur.map((x) => (x.id === id ? { ...x, name } : x)));
}

function projectBase(p: Project): FolderBase {
  return { folder: p.path, remote: isRemote(p) ? p.host : null };
}

/** 옛 프로젝트를 못 찾는데 상대 폴더가 있으면 풀 기준이 없어 옮기지 않는다 — 폴더를 잃지 않게 */
export async function moveTabTemplateProject(id: string, projectId: string | null): Promise<boolean> {
  const tpl = list.find((x) => x.id === id);
  if (!tpl) return false;
  if ((tpl.projectId ?? null) === projectId) return true;
  const to = projectId ? projectById(projectId) : null;
  if (projectId && !to) return false;
  const stuck = (x: TabTemplate) => !!x.projectId && !projectById(x.projectId) && hasRelativeFolders(x.root);
  if (stuck(tpl)) {
    showNotice(t("app.tabTemplates.notice.moveProjectGone", { name: tpl.name }));
    return false;
  }
  return mutate((cur) =>
    cur.map((x) => {
      if (x.id !== id || stuck(x)) return x;
      const from = x.projectId ? projectById(x.projectId) : null;
      const root = rebaseTemplate(x.root, from ? projectBase(from) : null, to ? projectBase(to) : null);
      return { id: x.id, name: x.name, ...(to ? { projectId: to.id } : {}), root, savedAt: x.savedAt };
    }),
  );
}

export async function projectTemplateCount(projectId: string): Promise<number> {
  const cur = (await readFile()) ?? list;
  return templatesForProject(cur, projectId).length;
}

/** `project_remove` 가 성공한 뒤에만 부른다 */
export async function dropProjectTemplates(projectId: string): Promise<void> {
  if ((await readFile())?.some((x) => x.projectId === projectId) === false) return; // 지울 것이 없으면 쓰지 않는다
  await mutate((cur) => withoutProjectTemplates(cur, projectId));
}

export async function deleteTabTemplate(id: string): Promise<boolean> {
  const tpl = list.find((x) => x.id === id);
  if (!tpl) return false;
  const ok = await askConfirm(t("app.tabTemplates.delete.body", { name: tpl.name }), {
    title: t("app.tabTemplates.delete.title"),
    kind: "warning",
    danger: true,
    okLabel: t("app.tabTemplates.delete.ok"),
  });
  if (!ok) return false;
  return mutate((cur) => withoutTemplate(cur, id));
}

// ── 열기 ──

/** `app/hosts/open.ts` 의 `OPEN_STAGGER_MS` 와 같은 값 */
const OPEN_STAGGER_MS = 120;

export type TemplateOpenWhere =
  | { kind: "newTab" }
  | { kind: "replace"; tabId: string; paneId: string; folder: string; host?: string };

/** 호스트 목록을 아직 못 읽었으면 사라졌다고 보지 않는다 */
function missingTarget(leaf: SavedLeaf, hostsKnown: boolean): string | null {
  if ((leaf.kind === "ssh" || leaf.kind === "sftp") && !leaf.adhoc && leaf.alias && hostsKnown && !lookupHost(leaf.alias)) return leaf.alias;
  if (leaf.kind === "query" && leaf.query?.connId && !findDbConn(leaf.query.connId)) return leaf.query.connId;
  if (leaf.kind === "branches" && leaf.branchGraph?.projectId && !projectById(leaf.branchGraph.projectId)) return t("app.tabTemplates.missing.project");
  if (leaf.kind === "diff" && leaf.diff?.projectId && !projectById(leaf.diff.projectId)) return t("app.tabTemplates.missing.project");
  return null;
}

/** SSH 는 연결 대기로 두지 않는다 — 사람이 방금 연 것이다 */
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
      rememberTarget(host); // 비밀번호 모달이 "어디에 붙는 중인지" 를 말할 수 있게
      const lines = clampScrollback(hostMeta(host).scrollback);
      if (lines !== undefined) pane.scrollback = lines;
    }
    if (i > 0) pane.openDelay = i * OPEN_STAGGER_MS;
    i += 1;
  }
  return node;
}

/** 늘 새 세션으로 찍어 낸다. `opts.firstAi` 를 실은 타일의 id 를 돌려준다(그 잎이 빈 타일이 됐으면 `null`) */
export async function openTabTemplate(
  id: string,
  where: TemplateOpenWhere,
  opts: { firstAi?: FirstAiPatch } = {},
): Promise<string | null> {
  const found = list.find((x) => x.id === id);
  if (!found) return null;
  const tpl = opts.firstAi ? { ...found, root: withFirstAi(found.root, opts.firstAi) } : found;
  const project = tpl.projectId ? projectById(tpl.projectId) : null;
  let base: FolderBase | null = null;
  if (where.kind === "replace") base = { folder: where.folder, remote: where.host ?? (project && isRemote(project) ? project.host : null) };
  else if (project) base = { folder: project.path, remote: isRemote(project) ? project.host : null };
  const node = await buildTree(tpl, base);
  const first = findFirstPane(node);
  // 바꾼 줄을 실은 타일 — 그 줄은 그 잎에만 있다(재개 줄은 대화 id 를 담아 하나뿐)
  const firstAi = opts.firstAi ? (listPanes(node).find((p) => p.autorun === opts.firstAi?.autorun)?.id ?? null) : null;
  if (where.kind === "replace") {
    if (!replaceTileWithTree(where.tabId, where.paneId, node, tpl.name)) return null;
    focusTile(where.tabId, first.id);
    return firstAi;
  }
  const localFolder = base && base.remote === null ? base.folder : undefined;
  const fresh = restoredTab(node, undefined, tpl.name, undefined, localFolder);
  if (project) fresh.projectId = project.id;
  const tab = openTab(fresh);
  focusPane(tab.id, first.id);
  for (const p of listPanes(tab.root)) adoptPane(tab.id, p.id);
  return firstAi;
}

// ── 화면 글자 ──

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

export function chipLabel(chip: TemplateChip): string {
  return t(CHIP_KEY[chip]);
}

/** "AI 2 · SSH · DB" */
export function templateSummary(root: SavedNode): string {
  const leaves = templateLeaves(root);
  const out: string[] = [];
  for (const { chip } of chipCounts(root)) {
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

export function leafChipLabel(leaf: SavedLeaf): string {
  const chip = leafChip(leaf);
  if (chip === "shell" && leaf.kind === "local" && leaf.shell) return shellLabel(leaf.shell, t);
  return chipLabel(chip);
}

const LOGO_ENV: LogoEnv = {
  hostOf(alias) {
    const h = lookupHost(alias);
    if (!h) return null;
    const m = hostMeta(h);
    return { icon: m.icon ?? null, color: m.color?.trim() || null };
  },
  engineIconOf(connId) {
    const d = findDbConn(connId);
    return d ? DB_ENGINE_ICON[d.engine] : null;
  },
};

export function templateLeafLogo(leaf: SavedLeaf): TemplateLogo {
  return leafLogo(leaf, LOGO_ENV);
}

export function templateLeafLabel(leaf: SavedLeaf): string {
  if (leafChip(leaf) === "ai" && leaf.autorun) return aiDisplayName(leaf.autorun) ?? chipLabel("ai");
  return leafChipLabel(leaf);
}

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

export function templateRows(root: SavedNode): { chip: TemplateChip; label: string; target: string }[] {
  return templateLeaves(root).map((leaf) => {
    const chip = leafChip(leaf);
    return { chip, label: leafChipLabel(leaf), target: leafSummary(leaf) };
  });
}

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

export function templateProjectOptions(): { value: string; label: string }[] {
  const sorted = [...projects()].sort((a, b) => a.name.localeCompare(b.name));
  return [{ value: "", label: t("app.tabTemplates.save.noProject") }, ...sorted.map((p) => ({ value: p.id, label: p.name }))];
}

// **사용자 터미널 테마** — 목록 읽기 · 가져오기 모달 상태 · 넣기 · 이름 바꾸기 · 지우기.
//
// 파일(`<설정 루트>/terminal-themes/<id>.json`)을 읽고 쓰는 것은 Rust(`term_themes.rs` — 받은 21색을 다시 검증한다), 형식 판별 ·
// 해석 · 빠진 칸 채우기는 순수 `$lib/term-theme-import`, 그리는 것은 `dialogs/TermThemeDialog.svelte`(설정 › 터미널의
// [가져오기…] · [관리] 단추가 연다). 목록은 설정 상태의 `userTermThemes`(`setUserTermThemes`)에 걸어 `termThemeOf` 가 푼다 —
// 창마다 부팅 때 · 다른 창의 설정 저장을 받아들일 때 다시 읽는다.
// 원본 파일은 `<input type=file>` 로 받아 이 창에서 글자로만 읽는다(경로를 Rust 에 넘기지 않는다 — 앱 아이콘과 같은 방식이라 원격
// 웹 창에서도 그대로 된다).
import { invoke } from "../ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { Key } from "$lib/i18n/keys";
import { stripReason } from "$lib/error-reason";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import { replaceTermPresetAndSave, setTermPreset, setUserTermThemes, settings } from "$lib/settings.svelte.js";
import {
  DEFAULT_TERM_PRESET,
  isLightBackground,
  userTermKey,
  type TermColors,
  type UserTermTheme,
} from "$lib/theme";
import {
  MAX_IMPORT_CHARS,
  cleanThemeName,
  fileStem,
  parseTermTheme,
  type ImportErrorCode,
  type ImportResult,
} from "$lib/term-theme-import";

/** Rust `TermThemeEntry` 한 줄 */
interface TermThemeEntry {
  id: string;
  name: string;
  colors: TermColors;
}

/** 쌓아 둘 수 있는 수 — Rust `term_themes::MAX_THEMES` 와 같다(넘으면 그쪽이 거절한다) */
export const MAX_USER_TERM_THEMES = 200;

function toUser(e: TermThemeEntry): UserTermTheme {
  return { id: e.id, name: e.name, theme: { ...e.colors } };
}

/** 목록을 다시 읽는다 — 실패는 콘솔로만(이미 고른 `user:` 키는 그동안 같은 모드의 Aynx 로 그려진다) */
export async function loadUserTermThemes(): Promise<void> {
  try {
    setUserTermThemes((await invoke<TermThemeEntry[]>("term_theme_list")).map(toUser));
  } catch (e) {
    console.error("[aynx] 터미널 테마 목록을 읽지 못했습니다", e);
  }
}

// ---------------------------------------------------------------------------
// 모달 상태
// ---------------------------------------------------------------------------

/** 가져오기 후보 한 줄 — 고름 · 이름(고칠 수 있다) · 21색 */
export interface ImportCandidate {
  pick: boolean;
  name: string;
  colors: TermColors;
}

export const termThemeDialog = $state({
  /** `null` = 닫힘 · 가져오기 · 관리 */
  mode: null as "import" | "manage" | null,
  /** 붙여넣기 칸 */
  text: "",
  candidates: [] as ImportCandidate[],
  /** 모달 안의 한 줄 — 해석 실패 · 넣기 · 이름 바꾸기 · 지우기 실패 */
  error: null as string | null,
  busy: false,
});

export function termThemeDialogVisible(): boolean {
  return termThemeDialog.mode !== null;
}

export function openTermThemeImport(): void {
  Object.assign(termThemeDialog, { mode: "import", text: "", candidates: [], error: null, busy: false });
}

export function openTermThemeManage(): void {
  Object.assign(termThemeDialog, { mode: "manage", text: "", candidates: [], error: null, busy: false });
  void loadUserTermThemes(); // 폴더에 손으로 넣은 파일도 보이게
}

export function closeTermThemeDialog(): void {
  if (termThemeDialog.busy) return;
  Object.assign(termThemeDialog, { mode: null, text: "", candidates: [], error: null });
}

const ERROR_KEYS: Record<ImportErrorCode, Key> = {
  empty: "settings.terminal.import.error.empty",
  tooBig: "settings.terminal.import.error.tooBig",
  unknown: "settings.terminal.import.error.unknown",
  yaml: "settings.terminal.import.error.yaml",
  json: "settings.terminal.import.error.json",
  plist: "settings.terminal.import.error.plist",
  noSchemes: "settings.terminal.import.error.noSchemes",
  missing: "settings.terminal.import.error.missing",
};

/** 해석 실패 → 사람 말 */
export function importErrorText(r: Extract<ImportResult, { ok: false }>): string {
  return t(ERROR_KEYS[r.error], { fields: (r.missing ?? []).join(", "), mb: String(MAX_IMPORT_CHARS / (1024 * 1024)) });
}

function adopt(text: string, fallback: string): void {
  const r = parseTermTheme(text, fallback);
  if (!r.ok) {
    termThemeDialog.candidates = [];
    termThemeDialog.error = importErrorText(r);
    return;
  }
  termThemeDialog.error = null;
  termThemeDialog.candidates = r.themes.map((th) => ({ pick: true, name: th.name, colors: th.colors }));
}

/** 고른 파일을 읽어 후보로 — 크기는 읽기 전에 본다 */
export async function readThemeFile(file: File): Promise<void> {
  if (file.size > MAX_IMPORT_CHARS * 4) {
    termThemeDialog.candidates = [];
    termThemeDialog.error = t("settings.terminal.import.error.tooBig", { mb: String(MAX_IMPORT_CHARS / (1024 * 1024)) });
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    termThemeDialog.error = t("settings.terminal.import.error.read", { error: String(e) });
    return;
  }
  adopt(text, fileStem(file.name) || t("settings.terminal.import.defaultName"));
}

/** 붙여넣은 글자를 후보로 */
export function parsePasted(): void {
  adopt(termThemeDialog.text, t("settings.terminal.import.defaultName"));
}

/**
 * 고른 후보를 넣는다 — 하나씩 `term_theme_add`(Rust 가 다시 검증 · id 를 정한다). 하나라도 들어가면 목록을 다시 읽고
 * **첫 테마를 곧바로 고른다**(미저장 변경 — 설정 [저장] 이 남긴다 · [취소] 가 되돌린다). 실패한 것은 모달에 남겨 이유를 보인다.
 */
export async function importPicked(): Promise<void> {
  const picked = termThemeDialog.candidates.filter((c) => c.pick);
  if (!picked.length || termThemeDialog.busy) return;
  termThemeDialog.busy = true;
  const added: TermThemeEntry[] = [];
  const failed: ImportCandidate[] = [];
  let lastError = "";
  for (const c of picked) {
    const name = cleanThemeName(c.name);
    if (!name) {
      failed.push(c);
      lastError = t("settings.terminal.import.error.noName");
      continue;
    }
    try {
      added.push(await invoke<TermThemeEntry>("term_theme_add", { name, colors: c.colors }));
    } catch (e) {
      failed.push(c);
      lastError = stripReason(String(e));
    }
  }
  termThemeDialog.busy = false;
  if (added.length) {
    await loadUserTermThemes();
    setTermPreset(userTermKey(added[0].id));
    toast.success(t("settings.terminal.import.done", { n: String(added.length) }));
  }
  if (failed.length) {
    termThemeDialog.candidates = failed;
    termThemeDialog.error = t("settings.terminal.import.error.add", { error: lastError });
    return;
  }
  closeTermThemeDialog();
}

/** 이름 바꾸기 — id(= 설정의 키)는 그대로다. 같은 이름이거나 비면 아무것도 하지 않는다 */
export async function renameUserTermTheme(id: string, raw: string): Promise<void> {
  const name = cleanThemeName(raw);
  const cur = settings.userTermThemes.find((u) => u.id === id);
  if (!cur || !name || name === cur.name) return;
  try {
    await invoke<TermThemeEntry>("term_theme_rename", { id, name });
    termThemeDialog.error = null;
  } catch (e) {
    termThemeDialog.error = t("settings.terminal.import.error.rename", { error: stripReason(String(e)) });
  }
  await loadUserTermThemes();
}

/**
 * 지우기(확인 뒤). 그 테마를 쓰고 있었으면 **그 테마 배경의 모드에 맞는 Aynx**(`aynx-dark` · `aynx-light`)로 돌리고 그 한 칸을
 * 저장한다(다른 미저장 편집은 싣지 않는다 — `replaceTermPresetAndSave`). 테마 프로필에 적힌 키는 고치지 않는다 — 그 프로필을
 * 적용하면 그릴 때 같은 모드의 Aynx 로 떨어진다.
 */
export async function removeUserTermTheme(id: string): Promise<void> {
  const cur = settings.userTermThemes.find((u) => u.id === id);
  if (!cur) return;
  const ok = await askConfirm(t("settings.terminal.import.remove.body", { name: cur.name }), {
    title: t("settings.terminal.import.remove.title"),
    kind: "warning",
    okLabel: t("settings.terminal.import.remove.ok"),
    danger: true,
  });
  if (!ok) return;
  try {
    await invoke("term_theme_remove", { id });
  } catch (e) {
    termThemeDialog.error = t("settings.terminal.import.error.remove", { error: stripReason(String(e)) });
    return;
  }
  termThemeDialog.error = null;
  const fallback = isLightBackground(cur.theme.background) ? "aynx-light" : DEFAULT_TERM_PRESET;
  try {
    await replaceTermPresetAndSave(userTermKey(id), fallback);
  } catch (e) {
    termThemeDialog.error = t("settings.terminal.import.error.remove", { error: stripReason(String(e)) });
  }
  await loadUserTermThemes();
}

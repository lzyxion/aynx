import type { Trigger, TriggerError } from "$lib/triggers";
import { text } from "$lib/settings-codec";
import { MAX_TRIGGERS } from "./options";
import { settings } from "./store.svelte.js";

// ── 트리거 ──

export function removeTrigger(index: number) {
  if (index < 0 || index >= settings.current.triggers.length) return;
  settings.current.triggers.splice(index, 1);
}

/**
 * URL · 툴팁은 입력 중인 글자를 그대로 담는다 — `text()` 로 접으면 칸을 지우는 순간 `undefined` 가 되어
 * 설정 화면이 "종류가 꺼졌다" 로 읽고 칸이 사라진다. 빈 문자열은 저장할 때 `toPayload` 가 뺀다.
 */
export function updateTrigger(index: number, patch: Partial<Trigger>) {
  const t = settings.current.triggers[index];
  if (!t) return;
  if (patch.pattern !== undefined) t.pattern = patch.pattern;
  if ("fg" in patch) t.fg = text(patch.fg);
  if ("bg" in patch) t.bg = text(patch.bg);
  if ("url" in patch) t.url = patch.url ?? undefined;
  if ("tooltip" in patch) t.tooltip = patch.tooltip ?? undefined;
  if (patch.enabled !== undefined) t.enabled = patch.enabled;
}

/** 상한(`MAX_TRIGGERS`)이면 `-1` */
export function insertTrigger(t: Trigger): number {
  if (settings.current.triggers.length >= MAX_TRIGGERS) return -1;
  settings.current.triggers.push({ ...t });
  return settings.current.triggers.length - 1;
}

/** 빠진 키(색 · 링크 · 툴팁)는 그 종류를 끈다는 뜻이다 */
export function replaceTrigger(index: number, t: Trigger): void {
  if (index < 0 || index >= settings.current.triggers.length) return;
  settings.current.triggers[index] = { ...t };
}

export function triggerErrorAt(index: number): TriggerError | null {
  return settings.triggerErrors.find((e) => e.index === index) ?? null;
}

// ── 단축키 오버라이드 ──
// `applySettings` 를 부르지 않는다 — 배선이 매 keydown 마다 `settings.current.keybindings` 를 새로 읽는다.

/** `combo` 가 그 액션의 기본값과 같으면 오버라이드를 지운다 */
export function setKeybinding(id: string, combo: string, defForAction: string) {
  const c = text(combo);
  if (!c || c === defForAction) {
    delete settings.current.keybindings[id];
    // 룬이 delete 를 못 볼 수 있어 참조를 새로 만들어 확실히 반응시킨다.
    settings.current.keybindings = { ...settings.current.keybindings };
    return;
  }
  settings.current.keybindings[id] = c;
  settings.current.keybindings = { ...settings.current.keybindings };
}

export function resetKeybinding(id: string) {
  if (!(id in settings.current.keybindings)) return;
  delete settings.current.keybindings[id];
  settings.current.keybindings = { ...settings.current.keybindings };
}

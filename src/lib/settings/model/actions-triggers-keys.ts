// 설정 화면 **트리거 · 단축키 오버라이드** 편집 (`TriggersSection` · `KeybindingsSection`).
import type { Trigger, TriggerError } from "$lib/triggers";
import { text } from "$lib/settings-codec";
import { MAX_TRIGGERS } from "./options";
import { settings } from "./store.svelte.js";

// ---------------------------------------------------------------------------
// 트리거 편집 (설정 화면)
//
// 앱 토큰·글꼴과 마찬가지로 **즉시 반영**된다 — 터미널의 `$effect` 가 `settings.triggers`
// 를 구독하고 있어 저장을 누르기 전에도 새 출력부터 새 규칙이 적용된다. 요약 줄의 켜기/끄기는 `updateTrigger`,
// 추가 · 편집 하위 화면은 칸을 다 채운 뒤 `insertTrigger` · `replaceTrigger` 로 한 번에 쓴다.
// ---------------------------------------------------------------------------

export function removeTrigger(index: number) {
  if (index < 0 || index >= settings.current.triggers.length) return;
  settings.current.triggers.splice(index, 1);
}

/**
 * 항목 하나의 필드를 고친다 (`undefined` 색 = 안 씀).
 *
 * URL·툴팁은 **입력 중인 글자를 그대로 담는다** — 색과 달리 여기서 `text()` 로 접지
 * 않는다. 접어 버리면 사용자가 칸을 지워 빈 문자열이 되는 순간 값이 `undefined` 가 되고,
 * 설정 화면은 그것을 "종류가 꺼졌다" 로 읽어 칸이 눈앞에서 사라진다. 빈 문자열은
 * "칸은 열려 있고 아직 안 적었다" 는 뜻이고, 저장할 때 `toPayload` 가 키를 뺀다.
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

/**
 * 다 채운 트리거 하나를 목록 끝에 넣는다 (설정 › 트리거의 **추가 하위 화면** [추가]). 반환값은 새 항목의 위치,
 * 상한(`MAX_TRIGGERS`)이면 `-1` — 그때 화면은 [추가] 를 흐리게 두고 이유를 말한다.
 */
export function insertTrigger(t: Trigger): number {
  if (settings.current.triggers.length >= MAX_TRIGGERS) return -1;
  settings.current.triggers.push({ ...t });
  return settings.current.triggers.length - 1;
}

/** 항목 하나를 통째로 바꾼다 (**편집 하위 화면** [저장]). 빠진 키(색 · 링크 · 툴팁)는 그 종류를 끈다는 뜻이다. */
export function replaceTrigger(index: number, t: Trigger): void {
  if (index < 0 || index >= settings.current.triggers.length) return;
  settings.current.triggers[index] = { ...t };
}

/** 이 항목의 정규식 오류 (없으면 `null`) */
export function triggerErrorAt(index: number): TriggerError | null {
  return settings.triggerErrors.find((e) => e.index === index) ?? null;
}

// ---------------------------------------------------------------------------
// 단축키 오버라이드 편집 (설정 화면)
//
// 앱 토큰·트리거와 달리 여기서는 `applySettings` 를 부르지 않는다 — 단축키는 DOM 토큰이
// 아니라 배선(Terminal·+page)이 매 keydown 마다 `settings.current.keybindings` 를 새로
// 읽어 쓰므로, 상태만 바꿔 두면 저장 전에도 곧바로 새 조합이 먹는다.
// ---------------------------------------------------------------------------

/**
 * 액션 하나에 새 조합을 건다(오버라이드). `combo` 가 그 액션의 **기본값과 같으면**
 * 오버라이드를 지운다 — 기본값 추종(webgl·tab_style 과 같은 규칙).
 *
 * `defForAction` 는 호출부(설정 화면)가 `$lib/keybindings` 의 레지스트리에서 뽑아 넘긴다.
 * 이 모듈이 레지스트리를 다시 순회하지 않게 하려는 것뿐이다.
 */
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

/** 액션 하나를 기본값으로 되돌린다 (오버라이드 키 삭제 = 설정 화면의 ↺) */
export function resetKeybinding(id: string) {
  if (!(id in settings.current.keybindings)) return;
  delete settings.current.keybindings[id];
  settings.current.keybindings = { ...settings.current.keybindings };
}

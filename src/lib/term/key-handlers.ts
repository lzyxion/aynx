// 터미널 한 장의 키 가로채기 — 죽은 타일의 Enter · Ctrl+D · 제안 상자 키 · 단축키 레지스트리 · 한국어 IME 229 시임.
// 조합은 `ev.code` 로만 만든다(`$lib/keybindings`) — IME 가 켜지면 키가 229 로 뭉개져도 `ev.code` 는 산다.
import type { Terminal } from "@xterm/xterm";
import { settings } from "$lib/settings.svelte.js";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import { comboFromEvent, resolveBindings } from "$lib/keybindings";
import { lastFinishedBlock } from "$lib/block-history";
import { askAiAboutLastBlock } from "$lib/app/ask-ai.svelte.js";
import type { CopyResult } from "$lib/shell-integration";

export interface KeyHost {
  readonly paneId: string;
  /** 간이 모드(tmux 타일) — 블록에 기대는 액션을 막는다 */
  readonly screenOnly: boolean;
  deadState(): { connecting: boolean } | null;
  /** 종료됨인가(아니면 연결 대기) — Enter 가 어느 쪽으로 다시 붙을지 가른다 */
  readonly ended: unknown;
  reconnectEnded(): Promise<void>;
  connectDeferred(): Promise<void>;
  onclose?: () => void;
  onrequestedit?: () => void;
  /** `true` = 삼켰다 */
  handleSuggestKeys(ev: KeyboardEvent): boolean;
  commands: { jump(dir: -1 | 1): boolean; copyOutput(): Promise<CopyResult> };
  showNote(text: string, ok: boolean): void;
  /** 사람이 친 키의 입구(동시 입력 대상) */
  sendInput(data: string): void;
}

/** 간이 모드에서 꺼지는 액션 id — `keybindings.ts` 의 id(바꾸면 안 된다). 모두 OSC 133 블록에 기댄다. */
const SCREEN_ONLY_BLOCKED: ReadonlySet<string> = new Set([
  "jump-prev",
  "jump-next",
  "copy-output",
  "ask-ai-block",
]);

export function attachKeyHandler(t: Terminal, h: KeyHost): void {
  /**
   * 죽은 타일(종료됨 · 연결 대기)에서만 — `Enter` = 다시 접속, `Ctrl+D` = 닫기. 자동 재연결 중에는 걸지 않는다.
   * 살아 있는 세션의 `Ctrl+D` 는 셸의 EOF 라 절대 건드리지 않는다. 수식 키는 정확히 본다(`Shift+Enter` 는 우리 것이 아니다).
   * 반환 `true` = 내가 삼켰다(xterm 규약과 반대 — 호출부가 뒤집는다).
   */
  const handleDeadPaneKeys = (ev: KeyboardEvent): boolean => {
    const dead = h.deadState();
    if (!dead) return false;

    // 시도 중이면 무시한다(연타 방지).
    if (ev.code === "Enter" && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
      ev.preventDefault();
      if (!dead.connecting) {
        if (h.ended) void h.reconnectEnded();
        else void h.connectDeferred();
      }
      return true;
    }

    if (ev.ctrlKey && ev.code === "KeyD" && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
      ev.preventDefault();
      h.onclose?.();
      return true;
    }

    return false;
  };

  /**
   * 매 keydown 마다 사용자 오버라이드를 다시 읽는다 — 리매핑이 새로고침 없이 먹는다.
   * 전역 조합은 셸로 새지 않게 **삼키기만** 하고 실행은 +page 의 창 핸들러 한 곳이 한다(그쪽도 keydown 을 받는다).
   * 점프 기본값이 `Ctrl+↑/↓` 인 것은 인텔 드라이버가 `Ctrl+Alt+화살표` 를 화면 회전으로 선점할 수 있어서다(그 조합은 타일 크기 조절의 기본값).
   * 반환 `true` = 내가 삼켰다.
   */
  const handleShortcut = (ev: KeyboardEvent): boolean => {
    const combo = comboFromEvent(ev);
    if (!combo) return false;
    const { terminal: termMap, global: globalMap } = resolveBindings(settings.current.keybindings);

    const termAction = termMap.get(combo);
    if (termAction) {
      ev.preventDefault();
      // 간이 모드에서도 키는 삼킨다 — 셸로 새면 tmux 가 그 조합을 가져간다.
      if (h.screenOnly && SCREEN_ONLY_BLOCKED.has(termAction)) {
        h.showNote(tr("pane.term.screen_only"), false);
        return true;
      }
      switch (termAction) {
        case "jump-prev":
          h.commands.jump(-1);
          break;
        case "jump-next":
          h.commands.jump(1);
          break;
        case "copy-output":
          void h.commands.copyOutput();
          break;
        case "edit-remote":
          // 패널 헤더가 없는 1패널 탭의 유일한 원격 편집 진입점이다.
          h.onrequestedit?.();
          break;
        case "ask-ai-block":
          if (lastFinishedBlock(h.paneId) === null) h.showNote(tr("pane.askai.no_block"), false);
          else askAiAboutLastBlock(h.paneId);
          break;
      }
      return true;
    }

    if (globalMap.has(combo)) {
      ev.preventDefault();
      return true;
    }

    return false;
  };

  // xterm.js #6065: 한국어 IME 활성 시 모든 키가 keyCode 229 로 들어와
  // Ctrl+키·Escape 가 죽는다. ev.code 에서 의도를 복구해 직접 보낸다(사람이 친 키라 동시 입력 대상이다).
  t.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== "keydown") return true;
    // 키바인딩보다 먼저 — 그 조합에 다른 액션을 걸어 두었어도 죽은 타일에서는 이쪽이 이긴다(배너가 그렇게 적혀 있다).
    if (handleDeadPaneKeys(ev)) return false;
    // 제안 상자도 키바인딩보다 앞 — 화살표 · Tab · Enter · Escape 는 기본 바인딩에 없고, 상자가 떠 있을 때만 돈다.
    if (h.handleSuggestKeys(ev)) return false;
    if (handleShortcut(ev)) return false;
    if (ev.keyCode === 229) {
      if (ev.ctrlKey && ev.code.startsWith("Key")) {
        // `false` 만 돌려주면 아무도 기본 동작을 막지 않아 브라우저의 것이 샌다(`Ctrl+P` → 인쇄창).
        ev.preventDefault();
        h.sendInput(String.fromCharCode(ev.code.charCodeAt(3) - 64));
        return false;
      }
      if (ev.code === "Escape") {
        ev.preventDefault();
        h.sendInput("\x1b");
        return false;
      }
    }
    return true;
  });
}

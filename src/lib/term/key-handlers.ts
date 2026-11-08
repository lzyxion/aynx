// 터미널 한 장의 키 가로채기 — 죽은 타일의 Enter·Ctrl+D · 제안 상자 키(위임) · 단축키 레지스트리 · 한국어 IME 229 시임.
// `Terminal.svelte` 의 `mount()` 가 옛 자리(`t.open` 앞)에서 `attachKeyHandler` 를 한 번 부른다. 조합은 `ev.code` 로만 만든다(`$lib/keybindings`).
import type { Terminal } from "@xterm/xterm";
import { settings } from "$lib/settings.svelte.js";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import { comboFromEvent, resolveBindings } from "$lib/keybindings";
import { lastFinishedBlock } from "$lib/block-history";
import { askAiAboutLastBlock } from "$lib/app/ask-ai.svelte.js";
import type { CopyResult } from "$lib/shell-integration";

/** 키 가로채기가 타일에서 읽고 부르는 것 — 값은 게터라 그때그때의 값이다 */
export interface KeyHost {
  readonly paneId: string;
  /** 간이 모드(tmux 타일) — 블록에 기대는 액션을 막는다 */
  readonly screenOnly: boolean;
  /** 죽은 상태(종료됨 ?? 연결 대기) — `Terminal` 의 `deadState()` */
  deadState(): { connecting: boolean } | null;
  /** 종료됨 상태인가(아니면 연결 대기) — Enter 가 어느 쪽으로 다시 붙을지 가른다 */
  readonly ended: unknown;
  reconnectEnded(): Promise<void>;
  connectDeferred(): Promise<void>;
  /** 이 타일을 닫아 달라 (`onclose`) */
  onclose?: () => void;
  /** Ctrl+Shift+E — 원격 편집 (`onrequestedit`) */
  onrequestedit?: () => void;
  /** 제안 상자가 떠 있을 때의 키 — `true` = 삼켰다 (`SnippetSuggestController.handleSuggestKeys`) */
  handleSuggestKeys(ev: KeyboardEvent): boolean;
  /** OSC 133 창구 중 단축키가 부르는 둘 */
  commands: { jump(dir: -1 | 1): boolean; copyOutput(): Promise<CopyResult> };
  /** 타일 안 토스트 한 줄 */
  showNote(text: string, ok: boolean): void;
  /** 사람이 친 키의 입구 (`sendInput` — 동시 입력 대상) */
  sendInput(data: string): void;
}

/**
 * 간이 모드에서 **꺼지는** 터미널 액션 id (`keybindings.ts` 의 id — 바꾸면 안 된다).
 * 셋 다 OSC 133 블록 위에 서 있어, 마커가 없는 타일에서는 할 일 자체가 없다.
 */
const SCREEN_ONLY_BLOCKED: ReadonlySet<string> = new Set([
  "jump-prev",
  "jump-next",
  "copy-output",
  // 블록을 AI 타일에 넘기기 — 블록이 영영 생기지 않는 타일이다 (docs/log/2026-09-28-ask-ai-block.md)
  "ask-ai-block",
]);

export function attachKeyHandler(t: Terminal, h: KeyHost): void {
  /**
   * 앱이 가로채는 단축키 — 이제 하드코딩이 아니라 **레지스트리 기반**이다
   * (`$lib/keybindings`, docs/log/2026-09-02-keybindings.md).
   *
   * 매 keydown 마다 `settings.current.keybindings`(사용자 오버라이드)를 새로 읽어
   * `resolveBindings` 로 두 개의 `조합 → 액션 id` 맵을 만든다. 리매핑이 새로고침 없이
   * 바로 먹는 것은 이 "매번 다시 읽기" 덕이다 (파는 비용은 keydown 한 번뿐이라 무시할 만하다).
   *
   * ## 왜 여기서 **전역** 조합까지 삼키는가 (터미널이 전역을 소비하는 이유)
   *
   * xterm 은 포커스를 쥔 동안 대부분의 키를 PTY 로 흘려보낸다. 그대로 두면 `Ctrl+Shift+T`
   * (새 탭) 같은 **전역** 조합도 원격 셸이 제어 시퀀스로 받아 먹어 버린다. 그래서
   * 터미널 맵에 없더라도 **전역 맵에 있으면 `false` 를 돌려 셸로 새지 않게 막는다** —
   * 다만 **실행하지는 않는다.** 전역 액션의 실제 실행은 +page 의 창 핸들러 한 곳에 모아
   * 둔다 (배선이 두 곳으로 갈리면 "어디서 실행됐는지" 를 쫓기 어렵다). 창 핸들러는
   * 터미널이 포커스를 쥔 상태에서도 keydown 을 함께 받으므로, 여기서 삼켜도 그쪽 실행은
   * 그대로 일어난다.
   *
   * ## 왜 `ev.key` 가 아니라 `ev.code` 인가 (IME 안전)
   *
   * 한국어 IME 가 켜져 있으면 모든 키가 `keyCode 229` 로 뭉개져 오지만(xterm #6065 —
   * 아래 시임 참고) `ev.code`(물리 키)는 그대로 살아 있다. `comboFromEvent` 도 `ev.code`
   * 로만 조합을 만들므로, 이 한 갈래가 IME 켜짐/꺼짐 양쪽을 다 덮는다. 그래서 아래 229
   * 시임보다 **먼저** 본다.
   *
   * 점프 기본값이 `Ctrl+↑/↓` 이고 `Ctrl+Alt+↑/↓` 가 **아닌** 이유: Windows 의 인텔
   * 그래픽 드라이버가 `Ctrl+Alt+화살표` 를 화면 회전 핫키로 OS 층에서 선점할 수 있다 (실기 피드백).
   * `Ctrl+Alt+화살표` 는 2026-11-02 사용자 결정으로 **타일 크기 조절**의 기본값이다(전역 조합 — 아래 갈래가 셸로 새지 않게 삼킨다 ·
   * 회전 핫키가 켜진 PC 에서는 설정에서 다시 묶는다). `Ctrl+Shift+←/→` 는 이제 앱이 묶지 않아 셸(PSReadLine 낱말 고르기)로 간다. 셸로 가던 `Ctrl+↑/↓`(`\x1b[1;5A`/`B`)를 점프가
   * 먹지만, 원래 시퀀스는 `Esc [ 1 ; 5 A` 로 여전히 칠 수 있다.
   *
   * ## 반환값 규약 (주의 — xterm 규약과 반대다)
   *
   * 이 함수는 **`true` = 내가 삼켰다**(호출부가 xterm 에 `false` 를 넘겨 PTY 로 안 보냄),
   * **`false` = 관여 안 함**(아래 229 시임·정상 처리로 흘려보냄)이다. 아래 호출부의
   * `if (handleShortcut(ev)) return false;` 가 이 뒤집힘을 흡수한다.
   */
  /**
   * **죽은 타일**(종료됨·연결 대기)에서만 도는 두 키 — `Enter` = 다시 접속, `Ctrl+D` = 닫기.
   * 반환값 규약은 아래 `handleShortcut` 과 같다 (`true` = 내가 삼켰다).
   *
   * ## 왜 살아 있는 세션에서는 `Ctrl+D` 를 절대 건드리지 않는가
   *
   * `Ctrl+D` 는 셸에서 **EOF** 다 — `cat` 을 끝내고, 힙 프롬프트에서 빠져나오고, 로그인
   * 셸을 종료한다. 그 키를 앱이 상시로 가로채면 터미널의 가장 기본적인 관용구 하나가
   * 사라진다. 그래서 가로채는 창은 **세션이 없는 동안**뿐이다: 그때는 어차피 보낼 곳이
   * 없어 (`writeInput` 이 버린다) 셸이 잃는 것이 없고, 반대로 "방금 exit 를 쳤는데 한 번
   * 더 Ctrl+D 를 누르면 타일이 닫힌다" 는 것은 터미널 사용자에게 가장 자연스러운 다음
   * 동작이다. 같은 이유로 `Enter` 도 죽은 동안에만 본다.
   *
   * 어떤 죽은 상태인지는 [`deadState`] 하나가 답한다 — 종료됨(정상 종료·재연결 포기·
   * **첫 접속 실패**)과 연결 대기 **양쪽**에 같은 두 키를 건다. 사용자 입장에서 둘은
   * "아직 붙지 않은 타일" 로 똑같이 보이고, 배너 버튼도 [다시 접속]/[연결] 과 [닫기] 로
   * 짝이 같다. 자동 재연결 중(`reconnect`)에는 걸지 않는다: 그쪽은 곧 스스로 붙으므로
   * Enter 가 끼어들 이유가 없고, 배너에 [지금 재연결] 버튼이 따로 있다.
   *
   * 수식 키를 **정확히** 본다 (`Shift+Enter`·`Ctrl+Shift+D` 는 우리 것이 아니다) —
   * 여기서 넘겨야 아래 `handleShortcut` 이 사용자가 그 조합에 걸어 둔 액션을 볼 수 있다.
   */
  const handleDeadPaneKeys = (ev: KeyboardEvent): boolean => {
    const dead = h.deadState();
    if (!dead) return false;

    // Enter (수식 키 없이) — 다시 접속. 시도 중이면 무시한다 (연타 방지).
    if (ev.code === "Enter" && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
      ev.preventDefault();
      if (!dead.connecting) {
        if (h.ended) void h.reconnectEnded();
        else void h.connectDeferred();
      }
      return true;
    }

    // Ctrl+D — 이 타일을 닫는다 (헤더 × 와 같은 경로. 마지막 패널이면 탭이 닫힌다).
    if (ev.ctrlKey && ev.code === "KeyD" && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
      ev.preventDefault();
      h.onclose?.();
      return true;
    }

    return false;
  };

  const handleShortcut = (ev: KeyboardEvent): boolean => {
    const combo = comboFromEvent(ev);
    if (!combo) return false; // 수식 키 홀로 누름 — 관여 안 함
    const { terminal: termMap, global: globalMap } = resolveBindings(settings.current.keybindings);

    const termAction = termMap.get(combo);
    if (termAction) {
      ev.preventDefault();
      // **명령 이력에 기대는 셋은 tmux 타일에서 꺼져 있다** (간이 모드 —
      // docs/log/2026-09-16-tmux-toggle.md). 조용히 아무 일도 안 일어나면 "눌렀는데
      // 안 된다" 로 보이므로 그 자리에서 이유를 말한다. 키는 그대로 삼킨다(아래 `return
      // true`) — 셸로 새면 tmux 가 그 조합을 자기 것으로 가져간다.
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
          // 이 타일의 마지막 끝난 블록 — 없으면 이 타일 안에서 짧게 말한다(블록은 셸 통합이 있어야 생긴다).
          if (lastFinishedBlock(h.paneId) === null) h.showNote(tr("pane.askai.no_block"), false);
          else askAiAboutLastBlock(h.paneId);
          break;
      }
      return true; // 삼킴 — 셸이 이 키를 받으면 안 된다
    }

    // 전역 조합이면 셸로 새지 않게 삼키기만 한다 — 실행은 +page 의 창 핸들러가 맡는다.
    if (globalMap.has(combo)) {
      ev.preventDefault();
      return true;
    }

    return false; // 우리 조합이 아니다 — 229 시임·정상 처리로 넘긴다
  };

  // xterm.js #6065: 한국어 IME 활성 시 모든 키가 keyCode 229 로 들어와
  // Ctrl+키·Escape 가 죽는다. ev.code 에서 의도를 복구해 직접 보낸다.
  // (이 경로도 사람이 친 키라 동시 입력 대상이다 — Ctrl+C 는 모든 패널에 가야 한다)
  t.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== "keydown") return true;
    // 죽은 타일의 Enter·Ctrl+D 를 **키바인딩 해석보다 먼저** 본다 — 사용자가 그 조합에
    // 다른 액션을 걸어 두었더라도 종료된 타일에서만큼은 이쪽이 이긴다 (배너가 그렇게 적혀 있다).
    if (handleDeadPaneKeys(ev)) return false;
    // 제안 상자는 **키바인딩보다 앞에서** 본다 — 화살표·Tab·Enter·Escape 는 이 앱의
    // 기본 바인딩에 하나도 없고, 상자가 떠 있는 동안에만 도는 데다(`handleSuggestKeys` 머리말) 고른 것이
    // 없으면 곧바로 손을 떼므로 여기서 가로채도 잃는 것이 없다.
    if (h.handleSuggestKeys(ev)) return false;
    if (handleShortcut(ev)) return false;
    if (ev.keyCode === 229) {
      if (ev.ctrlKey && ev.code.startsWith("Key")) {
        // `false` 를 돌려주면 xterm 이 이벤트를 통째로 건너뛰어 아무도 기본 동작을 막지
        // 않는다 → 브라우저의 것이 새어 나온다 (`Ctrl+P` → 인쇄창).
        ev.preventDefault();
        h.sendInput(String.fromCharCode(ev.code.charCodeAt(3) - 64));
        return false;
      }
      if (ev.code === "Escape") {
        // 위와 같은 이유 — 삼킨다고 말한 키의 기본 동작은 여기서 직접 끊어야 한다.
        ev.preventDefault();
        h.sendInput("\x1b");
        return false;
      }
    }
    return true;
  });
}

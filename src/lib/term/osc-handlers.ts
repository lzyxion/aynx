// 터미널 한 장의 OSC 핸들러 몸통 — 52(원격 → 클립보드) · 9/777(프로그램 알림) · 7717(설정 스크립트 끝 신호).
// **거는 자리와 순서는 `Terminal.svelte` 의 `mount()` 가 쥔다**(xterm 은 같은 번호를 나중에 건 것부터 부른다) — 여기는 몸통뿐이다.
// OSC 133/7/9;9 는 셸 통합(`$lib/shell-integration`)의 몫이다.
import type { IDisposable, Terminal } from "@xterm/xterm";
import { settings } from "$lib/settings.svelte.js";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import { writeClipboard } from "$lib/clipboard";
import { osc52Note, parseOsc52 } from "$lib/osc52";
import { parseSetupOsc, SETUP_OSC } from "$lib/setup-script";
import { createRateGate, parseOsc777Notify, parseOsc9Notify, type ProgramNotice } from "$lib/osc-notify";
import { notifyFromProgram } from "$lib/app/osc-notify";

/** OSC 52 가 타일에서 읽는 것 — 게터라 그때그때의 값이다 */
export interface Osc52Host {
  /** 언마운트됐다 — 늦게 온 클립보드 답은 말하지 않는다 */
  readonly disposed: boolean;
  /**
   * 지금 AI CLI 가 도는 타일인가 (`isAgentPane`) — 그러면 성공 토스트를 생략한다. CLI 가 제 "copied" 를
   * 이미 띄웠다 (`osc52Note` · docs/log/2026-10-05-ai-tile-copy-note.md). 쓰기 자체는 그대로 한다
   */
  readonly aiTile: boolean;
  /** 타일 안 토스트 한 줄 (`Terminal` 의 `showNote`) */
  showNote(text: string, ok: boolean): void;
}

/** 프로그램 알림이 타일에서 읽는 것 */
export interface ProgramNotifyHost {
  readonly paneId: string;
  /** 알림 제목에 쓰는 타일 이름 (`paneName`) */
  name(): string;
  /** 지금 보이는 탭에 있는가 */
  readonly visible: boolean;
}

/** 설정 스크립트 끝 신호가 타일에서 읽고 쓰는 것 */
export interface SetupOscHost {
  /** 이 타일이 기다리는 nonce (`null` = 기다리지 않는다) — 받으면 여기서 비운다 */
  nonce: string | null;
  /** 끝 신호를 받았다 (종료 코드) */
  done(code: number): void;
}

/**
 * 원격 복사(OSC 52) 토스트의 **속도 제한** 간격.
 *
 * tmux 복사 모드는 선택이 움직일 때마다 OSC 52 를 낸다. 그대로 말하면 한 번 끌 때마다
 * 토스트가 수십 장 쌓여 화면이 그 얘기만 한다. 시계(`lastRemoteCopyToast`)가 **`attachOsc52` 한 번의
 * 지역**인 것이 곧 "타일당" 이다 — 터미널 하나에 한 번 걸고, 다른 타일에서 온 복사는 이 시계를 보지 않는다.
 * (벨의 250ms 번쩍임 제한과 같은 판단 — docs/log/2026-09-16-finish-notify-block-marks-bell.md)
 */
const REMOTE_COPY_TOAST_GAP_MS = 2000;

// ── OSC 52 — 원격 → 이 PC 의 클립보드 (docs/log/2026-09-23-osc52-osc8.md) ──
//
// **`if (!screenOnly)` 바깥이다.** 셸 통합(OSC 133)은 훅이 심긴 타일에만 붙지만 OSC 52
// 는 셸이 아니라 **그 안에서 도는 아무 프로그램**(vim·tmux)이 보내는 것이라, 훅이 없는
// 타일(`cmd` · tmux 간이 모드 · 아무 원격)에서도 똑같이 와야 한다. 그래서
// `shell-integration.ts`(OSC 7·9 와 나란한 자리)가 아니라 여기에 건다 — 저쪽에 두면
// 간이 모드 타일에서 조용히 죽는다.
//
// 파싱은 순수 모듈(`$lib/osc52`)이 하고, 여기서 정하는 것은 셋이다: 설정 · 토스트 ·
// **읽기 요청 거부**.
export function attachOsc52(t: Terminal, h: Osc52Host): IDisposable {
  /** 이 타일에서 원격 복사 토스트를 마지막으로 말한 시각 (위 `REMOTE_COPY_TOAST_GAP_MS`) */
  let lastRemoteCopyToast = 0;
  return t.parser.registerOscHandler(52, (data) => {
    const parsed = parseOsc52(data);
    // **읽기 요청(`?`)에는 절대 답하지 않는다.** 답하면 원격에서 도는 아무 프로그램이나
    // 이 PC 의 클립보드를 읽어 간다 — 방금 복사해 둔 비밀번호가 그대로 서버로 나가는
    // 유출 통로다. 설정과 무관한 **불변**이라 위의 `osc52Clipboard` 보다 앞에서 끊는다.
    // 그래도 `true` 는 돌려준다 — 화면에 이스케이프 조각을 새게 두느니 삼킨다.
    if (parsed === null || "query" in parsed) return true;
    // 꺼져 있어도 **삼킨다** (위와 같은 이유). 쓰지만 않는다.
    if (!settings.osc52Clipboard) return true;
    void writeClipboard(parsed.text).then((ok) => {
      if (h.disposed || osc52Note(ok, h.aiTile) === null) return;
      // **타일당 2초에 한 번만** 말한다 — tmux 복사 모드는 선택이 움직일 때마다 OSC 52 를
      // 내므로, 한 번 끌 때마다 토스트가 수십 장 쌓인다. 성공 여부와 달리 토스트는
      // "무슨 일이 있었나" 를 알리는 것뿐이라 한 장으로 충분하다.
      const now = Date.now();
      if (now - lastRemoteCopyToast < REMOTE_COPY_TOAST_GAP_MS) return;
      lastRemoteCopyToast = now;
      // 선택 복사와 **일부러 같은 한 줄**이다 — 토스트가 뜨는 타일이 곧 복사가 일어난
      // 곳이라 출처 꼬리표는 값이 없고 틀리면 해롭다 (2026-09-23 사용자 결정).
      h.showNote(tr("pane.term.clipboard.copied"), true);
    });
    return true;
  });
}

// ── OSC 9 · OSC 777 — 프로그램이 보낸 알림 (docs/log/2026-09-26-osc-notify-inline-images.md) ──
//
// OSC 52 와 같은 이유로 **`if (!screenOnly)` 바깥이다** — 셸이 아니라 그 안의 프로그램
// (빌드 스크립트·테스트 러너)이 보내므로 훅 없는 타일(tmux 간이 모드·아무 원격)에서도 와야
// 한다. 파싱·다듬기는 `$lib/osc-notify`, 띄우기는 `app/osc-notify` 이고 여기서 쥐는 것은
// 설정과 **타일당 속도 제한 한 벌**(2초에 한 장, 넘치면 버린다)뿐이다.
//
// **OSC 9 는 번호를 셸 통합과 나눠 쓴다** (`9;9` = 현재 폴더). xterm 은 같은 번호의
// 핸들러를 **나중에 건 것부터** 부르고 `false` 면 앞의 것으로 넘긴다 — 이 핸들러가 위의
// 셸 통합보다 늦게 걸리므로 먼저 보고, 숫자 하위 명령(`9;4` 진행률 · `9;9`)이면 `false` 로
// 넘긴다. 저쪽도 제 몫이 아니면 `false` 라 순서가 뒤집혀도 결과는 같다
// (`osc-notify.test.ts` 가 진짜 xterm 파서로 두 순서를 다 잰다).
//
// 9 를 먼저, 777 을 그다음에 건다(옮기기 전과 같은 순서) — 돌려주는 손잡이 하나가 둘을 같은 순서로 뗀다.
export function attachProgramNotify(t: Terminal, h: ProgramNotifyHost): IDisposable {
  const programNotifyGate = createRateGate();
  const surfaceProgramNotice = (notice: ProgramNotice) => {
    // 꺼져 있어도 알아본 시퀀스는 **삼킨다**(호출부가 `true` 를 돌려준다) — 띄우지만 않는다.
    if (!settings.oscNotify) return;
    if (!programNotifyGate(Date.now())) return;
    notifyFromProgram(h.paneId, h.name(), notice, h.visible);
  };
  const osc9Notify = t.parser.registerOscHandler(9, (data) => {
    const notice = parseOsc9Notify(data);
    if (notice === null) return false; // 하위 명령·빈 본문 — 다음 소비자에게 넘긴다
    surfaceProgramNotice(notice);
    return true;
  });
  const osc777Notify = t.parser.registerOscHandler(777, (data) => {
    const notice = parseOsc777Notify(data);
    if (notice === null) return false; // `notify` 가 아닌 777 은 우리 것이 아니다
    surfaceProgramNotice(notice);
    return true;
  });
  return {
    dispose() {
      osc9Notify.dispose();
      osc777Notify.dispose();
    },
  };
}

// ── OSC 7717 — 설정 스크립트의 끝 신호 (docs/log/2026-09-28-project-agent-setup-script.md) ──
//
// **이 타일이 기다리는 nonce 일 때만** 받는다 — 다른 출력이 같은 모양을 흉내 내도(스크립트를 다시 `cat` 하는 등)
// 그 실행의 값이 아니면 아무 일도 없다. 모양이 맞든 틀리든 삼킨다(화면에 조각이 새지 않게).
export function attachSetupOsc(t: Terminal, h: SetupOscHost): IDisposable {
  return t.parser.registerOscHandler(SETUP_OSC, (data) => {
    const sig = parseSetupOsc(data);
    if (sig && h.nonce !== null && sig.nonce === h.nonce) {
      h.nonce = null;
      h.done(sig.code);
    }
    return true;
  });
}

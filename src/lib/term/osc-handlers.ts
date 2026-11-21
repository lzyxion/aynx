// OSC 52 · 9/777 · 7717 핸들러 몸통. 거는 자리와 순서는 `Terminal.svelte` `mount()` 가 쥔다(xterm 은 같은 번호를 나중에 건 것부터 부른다).
// 셸 통합 밖에 건다 — 셸이 아니라 그 안의 프로그램이 보내므로 훅 없는 타일(`cmd` · tmux 간이 모드)에서도 와야 한다.
import type { IDisposable, Terminal } from "@xterm/xterm";
import { settings } from "$lib/settings.svelte.js";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import { writeClipboard } from "$lib/clipboard";
import { osc52Note, parseOsc52 } from "$lib/osc52";
import { parseSetupOsc, SETUP_OSC } from "$lib/setup-script";
import { createRateGate, parseOsc777Notify, parseOsc9Notify, type ProgramNotice } from "$lib/osc-notify";
import { notifyFromProgram } from "$lib/app/osc-notify";

export interface Osc52Host {
  /** 늦게 온 클립보드 답은 말하지 않는다 */
  readonly disposed: boolean;
  /** AI CLI 타일이면 성공 토스트를 생략한다 — CLI 가 제 "copied" 를 띄운다. 쓰기는 그대로 한다 */
  readonly aiTile: boolean;
  showNote(text: string, ok: boolean): void;
}

export interface ProgramNotifyHost {
  readonly paneId: string;
  name(): string;
  readonly visible: boolean;
  /** 에이전트 타일의 프로그램 알림은 메신저로 보내지 않는다(턴 끝 · 권한 물음과 겹친다) */
  readonly agent: boolean;
}

export interface SetupOscHost {
  /** 받으면 여기서 비운다 */
  nonce: string | null;
  done(code: number): void;
}

/** tmux 복사 모드는 선택이 움직일 때마다 OSC 52 를 낸다 — 타일당(`attachOsc52` 한 번의 지역 시계) 이 간격에 한 장 */
const REMOTE_COPY_TOAST_GAP_MS = 2000;

// ── OSC 52 — 원격 → 이 PC 의 클립보드 ──
export function attachOsc52(t: Terminal, h: Osc52Host): IDisposable {
  let lastRemoteCopyToast = 0;
  return t.parser.registerOscHandler(52, (data) => {
    const parsed = parseOsc52(data);
    // 읽기 요청(`?`)에는 **절대 답하지 않는다** — 원격의 아무 프로그램이 이 PC 클립보드(비밀번호 등)를 읽어 가는 통로다. 설정과 무관한 불변.
    // 그래도 삼킨다(`true`) — 화면에 이스케이프 조각이 새지 않게.
    if (parsed === null || "query" in parsed) return true;
    if (!settings.osc52Clipboard) return true;
    void writeClipboard(parsed.text).then((ok) => {
      if (h.disposed || osc52Note(ok, h.aiTile) === null) return;
      const now = Date.now();
      if (now - lastRemoteCopyToast < REMOTE_COPY_TOAST_GAP_MS) return;
      lastRemoteCopyToast = now;
      // 선택 복사와 일부러 같은 한 줄 — 출처 꼬리표는 달지 않는다.
      h.showNote(tr("pane.term.clipboard.copied"), true);
    });
    return true;
  });
}

// ── OSC 9 · OSC 777 — 프로그램이 보낸 알림 ──
// OSC 9 는 셸 통합과 번호를 나눠 쓴다(`9;9` 폴더 · `9;4` 진행률) — 제 몫이 아니면 `false` 로 넘긴다. 저쪽도 그래서 순서가 뒤집혀도 같다(`osc-notify.test.ts`).
export function attachProgramNotify(t: Terminal, h: ProgramNotifyHost): IDisposable {
  const programNotifyGate = createRateGate();
  const surfaceProgramNotice = (notice: ProgramNotice) => {
    // 꺼져 있어도 알아본 시퀀스는 삼킨다(호출부가 `true`) — 띄우지만 않는다.
    if (!settings.oscNotify) return;
    if (!programNotifyGate(Date.now())) return;
    notifyFromProgram(h.paneId, h.name(), notice, h.visible, h.agent);
  };
  const osc9Notify = t.parser.registerOscHandler(9, (data) => {
    const notice = parseOsc9Notify(data);
    if (notice === null) return false;
    surfaceProgramNotice(notice);
    return true;
  });
  const osc777Notify = t.parser.registerOscHandler(777, (data) => {
    const notice = parseOsc777Notify(data);
    if (notice === null) return false;
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

// ── OSC 7717 — 설정 스크립트의 끝 신호 ──
// 이 타일이 기다리는 nonce 일 때만 받는다(스크립트를 다시 `cat` 해 흉내 내도 무시). 모양이 맞든 틀리든 삼킨다.
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

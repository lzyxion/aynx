import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  blocksOf,
  exportHistory,
  importHistory,
  resetHistories,
  type CommandBlock,
} from "$lib/block-history";
import {
  attachShellIntegration,
  foldStatus,
  paneBadgeInput,
  parseMarker,
  parseOsc7Cwd,
  parseOsc9Cwd,
  statusLabel,
  wslCwdToWindows,
  type PaneStatus,
} from "$lib/shell-integration";
import { translate } from "$lib/i18n/dict";
import type { Tr } from "$lib/session";

/**
 * 셸 통합의 순수 부분(탭 배지 접기·문구·cwd 파서 — docs/log/2026-09-02-osc133.md)과,
 * **상태 기계가 블록을 만드는지**(docs/log/2026-09-08-block-history-store.md).
 *
 * 뒤쪽은 `attachShellIntegration` 을 실제로 돌린다 — xterm 대신 **줄 배열 하나짜리 가짜
 * 터미널**을 준다. 이 모듈이 터미널에서 쓰는 것은 마커(줄 번호)·버퍼 읽기·데코레이션뿐이라
 * 그 셋만 흉내 내면 상태 기계 전체가 그대로 돈다 (DOM 도 렌더러도 필요 없다).
 */

describe("foldStatus", () => {
  it("아무 상태도 없으면 null (= 활동 점 폴백)", () => {
    expect(foldStatus([])).toBeNull();
    expect(foldStatus([null, undefined])).toBeNull();
  });

  it("실행 중이 가장 급하다 — 지난 실패보다 먼저 보인다", () => {
    expect(foldStatus(["fail", "running"])).toBe("running");
    expect(foldStatus(["ok", "fail", "running", null])).toBe("running");
  });

  it("실패가 성공을 이긴다", () => {
    expect(foldStatus(["ok", "fail"])).toBe("fail");
    expect(foldStatus(["fail", "ok", "ok"])).toBe("fail");
  });

  it("전부 성공이면 성공", () => {
    expect(foldStatus(["ok", "ok"])).toBe("ok");
  });

  it("빈 칸이 섞여도 남은 것으로 접는다", () => {
    expect(foldStatus([null, "ok", undefined])).toBe("ok");
    expect(foldStatus([undefined, "fail"])).toBe("fail");
  });

  it("순서가 달라도 답은 같다 (접기는 순서와 무관하다)", () => {
    const set: (PaneStatus | null)[] = ["ok", "fail", null];
    expect(foldStatus(set)).toBe(foldStatus([...set].reverse()));
  });
});

describe("paneBadgeInput — 에이전트가 살아 있는 타일은 running 을 내지 않는다", () => {
  it("에이전트 타일의 running 은 접히지 않는다 (claude 한 명령이 세션 내내 C…D 사이다)", () => {
    expect(paneBadgeInput("running", null, true)).toBeNull();
    expect(foldStatus([paneBadgeInput("running", undefined, true)])).toBeNull();
  });

  it("같은 탭의 다른 타일이 도는 것은 그대로 켠다", () => {
    const tab = [paneBadgeInput("running", null, true), paneBadgeInput("running", null, false)];
    expect(foldStatus(tab)).toBe("running");
  });

  it("에이전트 타일의 안 본 결과(에이전트가 끝나 D 가 왔다)는 남는다", () => {
    expect(paneBadgeInput("running", "fail", true)).toBe("fail");
    expect(paneBadgeInput(null, "fail", true)).toBe("fail");
    expect(foldStatus([paneBadgeInput(null, "ok", true), paneBadgeInput(null, null, false)])).toBe("ok");
  });

  it("에이전트가 아닌 타일은 전과 같다", () => {
    expect(paneBadgeInput("running", "fail", false)).toBe("running");
    expect(paneBadgeInput("ok", null, false)).toBeNull();
    expect(paneBadgeInput(undefined, "ok", false)).toBe("ok");
  });
});

describe("statusLabel", () => {
  // 문구는 **인자로** 들어간다 (`statusLabel` 에는 기본값이 없다) — 단언이 글자를 보므로
  // 여기서는 한국어 사전을 넘긴다.
  const ko: Tr = (key, params) => translate("ko", key, params);

  it("색 하나로만 말하지 않도록 세 상태 모두 한국어 문구를 갖는다", () => {
    expect(statusLabel("running", ko)).toBe("명령 실행 중");
    expect(statusLabel("fail", ko)).toBe("명령이 실패했습니다");
    expect(statusLabel("ok", ko)).toBe("명령이 끝났습니다");
  });

  it("영어 사전도 같은 세 칸을 채운다", () => {
    const en: Tr = (key, params) => translate("en", key, params);
    expect(statusLabel("running", en)).toBe("Command running");
  });
});

/**
 * 현재 폴더 보고 파서 (docs/log/2026-09-08-local-cwd-folder.md).
 *
 * **경로 구분자는 셸이 준 그대로 둔다** — `file:///C:/Users/x` 는 `C:/Users/x` 이고
 * 백슬래시로 바꾸지 않는다. 파일 브라우저가 두 모양을 다 받는 데다, 원격 셸이 보낸 POSIX
 * 경로까지 Windows 모양으로 고치면 오히려 못 쓰는 값이 된다. 여기서 하는 일은 퍼센트
 * 이스케이프 해제 · 호스트 제거 · 드라이브 앞 슬래시 한 개 벗기기뿐이다.
 */
describe("parseOsc7Cwd", () => {
  it("호스트를 떼고 경로만 남긴다", () => {
    expect(parseOsc7Cwd("file://box/home/me/work")).toBe("/home/me/work");
    expect(parseOsc7Cwd("file:///home/me/work")).toBe("/home/me/work");
  });

  it("Windows 드라이브 경로는 앞 슬래시를 벗긴다 (구분자는 그대로)", () => {
    expect(parseOsc7Cwd("file:///C:/Users/x")).toBe("C:/Users/x");
    expect(parseOsc7Cwd("file://host/D:/work")).toBe("D:/work");
  });

  it("로컬 PowerShell 훅이 실제로 내는 모양을 그대로 받는다", () => {
    // `<config_dir>/aynx/integration.ps1` 이 프롬프트마다 붙이는 바로 그 문자열이다
    // (src-tauri/src/shell_integration.rs 의 `PS_SNIPPET` — 호스트는 `localhost`,
    // 구분자는 슬래시). 이 줄이 깨지면 로컬 타일의 📂 가 조용히 홈으로 폴백한다.
    expect(parseOsc7Cwd("file://localhost/C:/Windows")).toBe("C:/Windows");
    expect(parseOsc7Cwd("file://localhost/C:/Users/wl/projects/aynx")).toBe(
      "C:/Users/wl/projects/aynx",
    );
    // 드라이브 루트도 열 수 있는 경로로 남는다 (`C:/` — 앞 슬래시만 벗긴다).
    expect(parseOsc7Cwd("file://localhost/C:/")).toBe("C:/");
  });

  it("퍼센트 이스케이프를 푼다", () => {
    expect(parseOsc7Cwd("file:///home/me/my%20work")).toBe("/home/me/my work");
    expect(parseOsc7Cwd("file:///C:/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8")).toBe("C:/프로젝트");
  });

  it("망가진 이스케이프는 버리지 않고 원문 그대로 둔다", () => {
    expect(parseOsc7Cwd("file:///tmp/100%")).toBe("/tmp/100%");
  });

  it("file:// 이 아니거나 경로가 없으면 우리 것이 아니다", () => {
    expect(parseOsc7Cwd("http://example.com/x")).toBeNull();
    expect(parseOsc7Cwd("file://onlyhost")).toBeNull();
    expect(parseOsc7Cwd("")).toBeNull();
  });

  it("bash·zsh 스니펫이 내는 모양 — 퍼센트 인코딩 없는 날것도 그대로 받는다", () => {
    // `__aynx_cwd` 는 `$PWD` 를 인코딩하지 않고 그대로 적는다 (셸에서 인코딩 루프를 도는
    // 값이 아니다 — src-tauri/src/shell_integration.rs 의 `SNIPPET`). 공백이 든 폴더가
    // 그 규칙의 시험대다: 파서는 이스케이프를 풀되 날것의 공백도 살려야 한다.
    expect(parseOsc7Cwd("file://MYBOOK/home/me/work")).toBe("/home/me/work");
    expect(parseOsc7Cwd("file://MYBOOK/home/a b")).toBe("/home/a b");
    expect(parseOsc7Cwd("file://MYBOOK/tmp")).toBe("/tmp");
    // 호스트가 없는 서버(`hostname` 도 없어 localhost 로 떨어진 경우)도 같은 답.
    expect(parseOsc7Cwd("file://localhost/home/me")).toBe("/home/me");
  });
});

describe("wslCwdToWindows", () => {
  it("`/mnt/<드라이브>` 는 원래의 윈도우 경로로 되돌린다", () => {
    expect(wslCwdToWindows("Ubuntu-24.04", "/mnt/c/Users/wl/projects")).toBe(
      "C:\\Users\\wl\\projects",
    );
    // 드라이브 문자는 대문자 (`/mnt/c` → `C:`)
    expect(wslCwdToWindows("Ubuntu-24.04", "/mnt/d/work")).toBe("D:\\work");
    // 마운트 뿌리 자체와 꼬리 슬래시
    expect(wslCwdToWindows("Ubuntu-24.04", "/mnt/c")).toBe("C:\\");
    expect(wslCwdToWindows("Ubuntu-24.04", "/mnt/c/")).toBe("C:\\");
    expect(wslCwdToWindows("Ubuntu-24.04", "/mnt/c/work/")).toBe("C:\\work");
    // 공백이 든 폴더 이름 (스니펫이 인코딩하지 않으므로 여기까지 날것으로 온다)
    expect(wslCwdToWindows("Ubuntu-24.04", "/mnt/c/My Docs")).toBe("C:\\My Docs");
  });

  it("배포판 안의 경로는 UNC 로 — 구분자를 백슬래시로 바꾸는 유일한 자리", () => {
    expect(wslCwdToWindows("Ubuntu-24.04", "/home/me/src")).toBe(
      "\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\src",
    );
    expect(wslCwdToWindows("Ubuntu-24.04", "/tmp")).toBe("\\\\wsl.localhost\\Ubuntu-24.04\\tmp");
    // 뿌리(`/`) 는 공유 그 자체다
    expect(wslCwdToWindows("Ubuntu-24.04", "/")).toBe("\\\\wsl.localhost\\Ubuntu-24.04");
    expect(wslCwdToWindows("Ubuntu-24.04", "/home/a b/")).toBe(
      "\\\\wsl.localhost\\Ubuntu-24.04\\home\\a b",
    );
    // `/mnt` 아래여도 드라이브 문자 한 글자가 아니면 배포판 안의 진짜 폴더다
    expect(wslCwdToWindows("Ubuntu-24.04", "/mnt/data/x")).toBe(
      "\\\\wsl.localhost\\Ubuntu-24.04\\mnt\\data\\x",
    );
  });

  it("우리가 다룰 값이 아니면 null (폴백이 홈을 연다)", () => {
    expect(wslCwdToWindows("Ubuntu-24.04", "C:\\work")).toBeNull();
    expect(wslCwdToWindows("Ubuntu-24.04", "work")).toBeNull();
    expect(wslCwdToWindows("Ubuntu-24.04", "")).toBeNull();
    expect(wslCwdToWindows("", "/home/me")).toBeNull();
  });
});

describe("parseOsc9Cwd", () => {
  it("`9;<경로>` 만 우리 것이다 (Windows Terminal)", () => {
    expect(parseOsc9Cwd("9;C:\\Users\\x\\work")).toBe("C:\\Users\\x\\work");
    expect(parseOsc9Cwd("9;/home/me")).toBe("/home/me");
  });

  it("URL 로 오면 OSC 7 규칙을 그대로 탄다", () => {
    expect(parseOsc9Cwd("9;file:///C:/Users/x")).toBe("C:/Users/x");
  });

  it("알림(`9;<문구>` 가 아닌 OSC 9)은 건드리지 않는다", () => {
    // iTerm2 계열의 `OSC 9 ; <알림>` — 앞에 `9;` 가 없다.
    expect(parseOsc9Cwd("빌드가 끝났습니다")).toBeNull();
    expect(parseOsc9Cwd("9;")).toBeNull();
    expect(parseOsc9Cwd("9;   ")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 상태 기계 — 블록 이력 (docs/log/2026-09-08-block-history-store.md)
// ---------------------------------------------------------------------------

/**
 * 줄 배열 하나짜리 가짜 터미널.
 *
 * 마커는 **"지금 커서가 있는 줄"** = 다음에 찍힐 줄 번호다 (xterm 의 `registerMarker` 와 같은
 * 뜻). 그래서 A→프롬프트 줄 찍기→C→출력 찍기→D 순서로 흉내 내면 마커 세 개가 실제와 같은
 * 자리에 선다. 줄바꿈(`isWrapped`)은 여기서 시험하지 않는다 — 그 규칙은 `readLineArray` 의
 * 것이고 "출력만 복사" 가 이미 같은 함수를 쓴다.
 *
 * `decorations: true` 를 주면 데코레이션이 **생긴다** (기본은 xterm 이 렌더러 없이 주는
 * `undefined`). 이관 뒤 실패 표시가 다시 걸리는지는 그 자리에서만 볼 수 있다.
 */
function fakeTerm(opts: { decorations?: boolean; rows?: number } = {}) {
  const lines: string[] = [];
  const handlers = new Map<number, (data: string) => boolean>();
  /** `CSI J`(ED) 엿보기 — 화면 지우기가 표시를 걷는지 볼 때 [`ed`] 로 부른다 */
  let edHandler: ((params: (number | number[])[]) => boolean) | null = null;
  /**
   * 화면(뷰포트)의 맨 윗줄 (`baseY`) — 기본 0 은 "스크롤백이 없다". 화면 지우기가 뷰포트와
   * 스크롤백을 가르는지 볼 때만 [`setBaseY`] 로 옮긴다. 화면 높이는 `rows`(기본 100)다.
   */
  let baseY = 0;
  /** 일반 화면인가 대체 화면(vim·less)인가 */
  let bufferType: "normal" | "alternate" = "normal";
  /** 만들어 준 마커들 — 스크롤백 밖으로 밀리는 상황을 [`scrollOut`] 으로 흉내 내려고 든다 */
  const markers: { line: number; isDisposed: boolean }[] = [];
  /**
   * 그려진 데코레이션 (`decorations: true` 일 때만) — 줄·높이·클래스만 본다.
   * `height` 는 블록 띠([`ShellIntegration.bandBlock`])가 재는 값이라 여기서 되읽는다
   * (xterm 의 기본값과 같이 안 주면 1줄).
   */
  const decorations: {
    line: number;
    height: number;
    /** 데코 상자의 시작 칸 — 거터 표식은 오른쪽 끝에 서므로 이 값이 곧 자리다 */
    x: number;
    width: number;
    classes: string[];
    /** `onRender` 가 넣은 글자 (거터 표식) */
    text: string;
    /** `onRender` 가 넣은 말풍선 */
    title: string;
    disposed: boolean;
  }[] = [];
  /** 커서 열. 이 가짜는 줄을 통째로 찍으므로 `B` 의 열은 테스트가 직접 말해 준다 */
  let cursorX = 0;
  /**
   * 커서가 **마지막 찍힌 줄에서 몇 줄 위인가** — 0(기본)이면 다음 줄 첫 칸이다.
   *
   * 줄바꿈으로 끝난 출력과 그렇지 않은 출력을 가르는 유일한 손잡이다 ([`printPartial`]).
   * 거터 표식이 `D` 시점의 커서를 기준으로 자리를 잡으므로 이 차이가 실제로 보인다.
   */
  let cursorBack = 0;
  /** 커서가 지금 있는 줄 (= `baseY + cursorY`) */
  const cursorLine = () => lines.length - cursorBack;
  const term = {
    cols: 80,
    rows: opts.rows ?? 100,
    options: {} as { scrollOnEraseInDisplay?: boolean },
    parser: {
      registerOscHandler(id: number, cb: (data: string) => boolean) {
        handlers.set(id, cb);
        return { dispose: () => handlers.delete(id) };
      },
      registerCsiHandler(id: { final: string }, cb: (params: (number | number[])[]) => boolean) {
        if (id.final === "J") edHandler = cb;
        return { dispose: () => (edHandler = null) };
      },
    },
    // 데코레이션은 렌더러가 필요하다 — 없으면 xterm 도 undefined 를 준다(이 모듈이 그 경우를
    // 이미 다룬다). 그래서 상태 띠는 여기서 그냥 생기지 않는다.
    registerDecoration: (o: {
      marker: { line: number };
      height?: number;
      x?: number;
      width?: number;
    }) => {
      if (!opts.decorations) return undefined;
      const rec = {
        line: o.marker.line,
        height: o.height ?? 1,
        x: o.x ?? 0,
        width: o.width ?? 1,
        classes: [] as string[],
        text: "",
        title: "",
        disposed: false,
      };
      decorations.push(rec);
      const onDispose: (() => void)[] = [];
      return {
        marker: o.marker,
        onRender: (
          cb: (el: {
            classList: { add: (...c: string[]) => void; toggle: (c: string, on: boolean) => void };
            textContent: string;
            title: string;
            dataset: Record<string, string>;
          }) => void,
        ) =>
          cb({
            dataset: {},
            classList: {
              add: (...c: string[]) => rec.classes.push(...c),
              toggle: (c: string, on: boolean) => {
                if (on) rec.classes.push(c);
              },
            },
            set textContent(v: string) {
              rec.text = v;
            },
            get textContent() {
              return rec.text;
            },
            set title(v: string) {
              rec.title = v;
            },
            get title() {
              return rec.title;
            },
          }),
        // 데코가 질 때 딸린 것을 함께 거두는 길 — 거터 표식이 자기 마커를 여기서 버린다.
        onDispose: (cb: () => void) => {
          onDispose.push(cb);
          return { dispose: () => {} };
        },
        dispose: () => {
          if (rec.disposed) return;
          rec.disposed = true;
          for (const cb of onDispose) cb();
        },
      };
    },
    /**
     * xterm 과 같은 뜻 — 커서 줄 기준의 **상대** 자리다 (`registerMarker(cursorYOffset)`).
     * 범위 밖(버퍼 맨 위보다 위)이면 xterm 처럼 **아무것도 안 준다**.
     */
    registerMarker: (offset = 0) => {
      const line = cursorLine() + offset;
      if (line < 0) return undefined;
      const m = {
        line,
        isDisposed: false,
        dispose() {
          m.isDisposed = true;
        },
      };
      markers.push(m);
      return m;
    },
    scrollToLine: () => {},
    buffer: {
      active: {
        get length() {
          return lines.length;
        },
        /** 뷰포트 맨 윗줄 — 기본 0(스크롤백 없음). 커서 줄 계산은 이 값과 무관하게 절대 줄이다 */
        get baseY() {
          return baseY;
        },
        get type() {
          return bufferType;
        },
        /** `B` 가 읽는 열 — 테스트가 [`setCursor`] 로 옮긴다 (프롬프트를 찍은 뒤의 자리) */
        get cursorX() {
          return cursorX;
        },
        get cursorY() {
          return cursorLine() - baseY;
        },
        getLine(y: number) {
          if (y < 0 || y >= lines.length) return undefined;
          return {
            isWrapped: false,
            // 두 번째 인자가 시작 열이다 (xterm 의 `translateToString(trim, start)`)
            translateToString: (_trim?: boolean, start?: number) => lines[y].slice(start ?? 0),
          };
        },
      },
    },
  };
  return {
    term: term as unknown as Terminal,
    /** 셸이 화면에 찍었다 — **줄바꿈으로 끝난다**(커서는 다음 줄 첫 칸) */
    print: (...text: string[]) => {
      lines.push(...text);
      cursorBack = 0;
      cursorX = 0;
    },
    /**
     * 셸이 **줄바꿈 없이** 끝냈다 (`printf foo`) — 커서가 그 줄 위에 남는다.
     * 거터 표식이 `D` 시점의 커서 열을 보고 자리를 정하므로 이 차이가 실제로 갈린다.
     */
    printPartial: (text: string) => {
      lines.push(text);
      cursorBack = 1;
      cursorX = text.length;
    },
    /** 셸이 이스케이프를 보냈다 */
    osc: (id: number, data: string) => handlers.get(id)?.(data),
    /**
     * 프롬프트를 찍고 `B` 를 보냈다 — `prompt` 의 길이가 곧 커서 열이다.
     *
     * 실제 셸에서는 `A` → 프롬프트 출력 → `B` 순서이고 그 셋이 **한 줄 위**에서 일어난다.
     * 이 가짜는 줄을 통째로 밀어 넣으므로 프롬프트만 따로 찍을 수 없다 — 대신 열만 옮겨 두고,
     * 프롬프트 + 명령을 한 줄로 찍는다 (읽는 쪽이 보는 화면은 같다).
     */
    promptEnd: (prompt: string, payload = "B") => {
      cursorX = prompt.length;
      handlers.get(133)?.(payload);
    },
    /** 스크롤백 밖으로 밀렸다 — xterm 이 그 줄의 마커를 스스로 dispose 하는 자리다 */
    scrollOut: () => {
      for (const m of markers) m.isDisposed = true;
    },
    /**
     * `CSI <mode> J` 가 왔다 — 엿보기가 `false` 를 주면(기본 처리를 막지 않으면) xterm 처럼
     * 지운다: `2` 는 뷰포트 줄을 빈 칸으로, `3` 은 여기서는 글자를 건드리지 않는다(이 가짜의
     * 스크롤백 줄은 번호를 유지해야 테스트가 읽힌다 — 마커 폐기는 엿보기 쪽이 한다).
     * 돌려주는 값은 엿보기의 답이다.
     */
    ed: (mode: number) => {
      const handled = edHandler?.([mode]) ?? false;
      if (!handled && mode === 2) {
        for (let i = baseY; i < Math.min(lines.length, baseY + term.rows); i++) lines[i] = "";
      }
      return handled;
    },
    /** ConPTY 의 줄 단위 지우기(`CSI K` 를 줄마다) — 뷰포트 줄을 빈 칸으로 만든다 */
    blankViewport: () => {
      for (let i = baseY; i < Math.min(lines.length, baseY + term.rows); i++) lines[i] = "";
    },
    setBaseY: (y: number) => {
      baseY = y;
    },
    setBufferType: (type: "normal" | "alternate") => {
      bufferType = type;
    },
    /** 살아 있는 데코레이션들 (`decorations: true` 로 만든 가짜에서만 찬다) */
    decorations: () => decorations.filter((d) => !d.disposed),
    /** 아직 안 죽은 마커 수 — 거터 표식이 자기 마커를 거두는지 보는 자다 */
    liveMarkers: () => markers.filter((m) => !m.isDisposed).length,
  };
}

describe("attachShellIntegration — 블록 이력", () => {
  beforeEach(() => resetHistories());

  /** 명령 한 판: 프롬프트(A) → 명령줄 → 실행(C) → 출력 → 종료(D) */
  function runCommand(
    t: ReturnType<typeof fakeTerm>,
    cmd: string,
    output: string[],
    exit = 0,
    cwd?: string,
  ) {
    t.osc(133, "A");
    if (cwd !== undefined) t.osc(7, `file://box${cwd}`);
    t.print(`$ ${cmd}`);
    t.osc(133, "C");
    t.print(...output);
    t.osc(133, `D;${exit}`);
  }

  it("C 가 블록을 열고 D 가 닫는다 — 명령문·cwd·출력·종료 코드가 다 들어온다", () => {
    const t = fakeTerm();
    const seen: CommandBlock[] = [];
    const shell = attachShellIntegration(t.term, () => {}, {
      paneId: "p1",
      onblock: (b) => seen.push(b),
    });

    runCommand(t, "ls -al", ["total 4", "drwx  ."], 0, "/srv/app");

    const blocks = blocksOf("p1");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].commandLine).toBe("$ ls -al");
    expect(blocks[0].cwd).toBe("/srv/app");
    expect(blocks[0].exit).toBe(0);
    expect(blocks[0].running).toBe(false);
    expect(blocks[0].excerpt.head).toEqual(["total 4", "drwx  ."]);
    expect(blocks[0].excerpt.truncated).toBe(false);
    // 닫힐 때 **한 번** 알린다 (Rust 거울로 밀어 올릴 기회다).
    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe(blocks[0].id);
    shell.dispose();
  });

  it("실패한 명령도 같은 블록 하나다 (종료 코드만 다르다)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    runCommand(t, "false", ["boom"], 1);
    expect(blocksOf("p1")[0].exit).toBe(1);
    expect(shell.status()).toBe("fail");
    shell.dispose();
  });

  it("빈 프롬프트(A 만 · Enter 만 누른 줄)는 블록을 만들지 않는다", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    t.osc(133, "A");
    t.print("$ ");
    t.osc(133, "B");
    t.osc(133, "A"); // 그냥 Enter — C 가 없다
    t.print("$ ");
    expect(blocksOf("p1")).toHaveLength(0);
    shell.dispose();
  });

  it("여러 명령이 순서대로 쌓인다 — 각자의 cwd 를 들고", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    runCommand(t, "cd /var", [], 0, "/home/me");
    runCommand(t, "ls", ["log"], 0, "/var");
    const blocks = blocksOf("p1");
    expect(blocks.map((b) => b.commandLine)).toEqual(["$ cd /var", "$ ls"]);
    expect(blocks.map((b) => b.cwd)).toEqual(["/home/me", "/var"]);
    expect(blocks.map((b) => b.id)).toEqual([1, 2]);
    shell.dispose();
  });

  it("이력 자리를 안 주면 블록을 만들지 않는다 (나머지는 그대로 동작한다)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {});
    runCommand(t, "ls", ["a"]);
    expect(blocksOf("p1")).toHaveLength(0);
    expect(shell.last()?.commandLine).toBe("$ ls");
    shell.dispose();
  });

  it("`last()`·`status()`·`tail()` 은 지금까지와 똑같다", () => {
    const t = fakeTerm();
    const seen: (PaneStatus | null)[] = [];
    const shell = attachShellIntegration(t.term, (s) => seen.push(s), { paneId: "p1" });

    runCommand(t, "echo hi", ["hi"]);
    const last = shell.last();
    expect(last?.commandLine).toBe("$ echo hi");
    expect(last?.output).toBe("hi");
    expect(last?.exit).toBe(0);
    expect(last?.running).toBe(false);
    expect(shell.status()).toBe("ok");
    expect(shell.cwd()).toBeNull(); // OSC 7 을 못 봤으면 여전히 null
    expect(shell.tail(2)).toEqual(["$ echo hi", "hi"]);
    // 상태는 **바뀔 때만** 올라간다 (C 에서 running, D 에서 ok — 둘뿐).
    expect(seen).toEqual(["running", "ok"]);
    shell.dispose();
  });

  it("실행 중에는 running 블록이 하나 서 있다 (`D` 를 기다린다)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    t.osc(133, "A");
    t.print("$ sleep 60");
    t.osc(133, "C");
    const [block] = blocksOf("p1");
    expect(block.running).toBe(true);
    expect(block.endedAt).toBeNull();
    expect(block.exit).toBeNull();
    expect(shell.last()?.running).toBe(true);
    shell.dispose();
  });
});

/**
 * 명령문에서 **프롬프트를 뺀다** — `B`(프롬프트 끝)부터 `C` 직전까지가 명령문이다.
 *
 * 이걸 안 하면 결과 줄이 `u@host:~$ make all` 로 보이고 `#make` 매칭도 AI 거울도 프롬프트
 * 글자를 함께 본다 (docs/log/2026-09-08-block-search.md).
 */
describe("commandLine — 프롬프트 제외 (`B`)", () => {
  beforeEach(() => resetHistories());

  it("`B` 를 보면 프롬프트가 빠진다", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });

    t.osc(133, "A");
    t.promptEnd("u@host:~$ ");
    t.print("u@host:~$ make all");
    t.osc(133, "C");
    t.print("빌드 중");
    t.osc(133, "D;0");

    expect(blocksOf("p1")[0].commandLine).toBe("make all");
    expect(shell.last()?.commandLine).toBe("make all"); // `last()` 도 같은 헬퍼를 쓴다
    shell.dispose();
  });

  it("여러 줄 명령이면 뒷줄은 통째로 남는다 (첫 줄만 `B` 의 열부터)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });

    t.osc(133, "A");
    t.promptEnd("$ ");
    t.print("$ echo one \\", "two");
    t.osc(133, "C");
    t.osc(133, "D;0");

    expect(blocksOf("p1")[0].commandLine).toBe("echo one \\\ntwo");
    shell.dispose();
  });

  it("`B` 를 못 봤으면 옛 동작 그대로 — 줄을 통째로 (프롬프트가 붙은 값이 없는 값보다 낫다)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });

    t.osc(133, "A"); // B 없이 바로 명령
    t.print("u@host:~$ make all");
    t.osc(133, "C");
    t.osc(133, "D;0");

    expect(blocksOf("p1")[0].commandLine).toBe("u@host:~$ make all");
    shell.dispose();
  });

  it("점프의 착지점은 여전히 `A` 의 줄이다 (읽는 범위만 바뀌었다)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });

    t.print("환영합니다");
    t.osc(133, "A"); // 1번 줄
    t.promptEnd("$ ");
    t.print("$ ls");
    t.osc(133, "C");
    t.osc(133, "D;0");

    expect(shell.lineOfBlock(blocksOf("p1")[0].id)).toBe(1);
    shell.dispose();
  });
});

/**
 * 블록 → 프롬프트 줄 (`#` 블록 검색의 점프 — docs/log/2026-09-08-block-search.md).
 *
 * 이력은 마커를 일부러 들지 않으므로(직렬화·이관을 위해) 이 답을 아는 자리는 마커를 쥔 이
 * 모듈뿐이다. 재는 것은 둘이다: 살아 있는 블록의 줄 번호가 **A 의 줄**인가, 그리고 **밀려난
 * 블록이 `null` 을 주는가**(그 경우에도 블록 자체는 이력에 남는다).
 */
describe("CommandApi.lineOfBlock", () => {
  beforeEach(() => resetHistories());

  it("블록이 시작한 **프롬프트 줄(A)** 을 준다", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });

    t.print("환영합니다"); // 0번 줄 — 프롬프트보다 앞이다
    t.osc(133, "A"); // 마커는 다음에 찍힐 줄 = 1
    t.print("$ ls");
    t.osc(133, "C");
    t.print("a", "b");
    t.osc(133, "D;0");

    const [block] = blocksOf("p1");
    expect(shell.lineOfBlock(block.id)).toBe(1);
    shell.dispose();
  });

  it("두 명령이면 각자의 줄을 준다 (번호가 섞이지 않는다)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });

    t.osc(133, "A");
    t.print("$ one");
    t.osc(133, "C");
    t.print("out1");
    t.osc(133, "D;0");
    t.osc(133, "A");
    t.print("$ two");
    t.osc(133, "C");
    t.osc(133, "D;1");

    const [first, second] = blocksOf("p1");
    expect(shell.lineOfBlock(first.id)).toBe(0);
    // 줄: 0 `$ one` · 1 `out1` · 2 `$ two` — 두 번째 A 는 2번 줄에 선다
    expect(shell.lineOfBlock(second.id)).toBe(2);
    shell.dispose();
  });

  it("모르는 번호는 `null` (그런 블록이 없다)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    expect(shell.lineOfBlock(999)).toBeNull();
    shell.dispose();
  });

  it("**스크롤백 밖으로 밀리면 `null`** — 그래도 블록은 이력에 남는다 (발췌만 남았다)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    runCommandIn(t, "ls", ["a"]);
    const [block] = blocksOf("p1");
    expect(shell.lineOfBlock(block.id)).not.toBeNull();

    t.scrollOut();
    expect(shell.lineOfBlock(block.id)).toBeNull();
    expect(blocksOf("p1")).toHaveLength(1); // 이력은 마커와 수명이 다르다
    // 두 번째로 물어도 여전히 null 이다 (죽은 항목을 그 자리에서 걷는다)
    expect(shell.lineOfBlock(block.id)).toBeNull();
    shell.dispose();
  });

  it("dispose 뒤에는 아무것도 안 준다", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    runCommandIn(t, "ls", ["a"]);
    const [block] = blocksOf("p1");
    shell.dispose();
    expect(shell.lineOfBlock(block.id)).toBeNull();
  });
});

/** 위 describe 의 `runCommand` 와 같은 한 판 (스코프가 달라 한 번 더 적는다) */
function runCommandIn(t: ReturnType<typeof fakeTerm>, cmd: string, output: string[], exit = 0) {
  t.osc(133, "A");
  t.print(`$ ${cmd}`);
  t.osc(133, "C");
  t.print(...output);
  t.osc(133, `D;${exit}`);
}

/**
 * **이관 뒤 마커 복원** (2026-09-09 · docs/log/2026-09-08-block-history-store.md).
 *
 * 이력만 실어 보내던 때의 반쪽: 새 창에서 `#` 검색이 블록을 찾기는 하는데 고르면 "화면에서
 * 밀려난 블록입니다" 가 떴다 — `SerializeAddon` 이 나르는 것은 셀 내용뿐이라 OSC 133 이
 * 새 창에 도착하지 않고, 그래서 `lineOfBlock` 이 줄을 모른다.
 *
 * 그래서 **거리**를 싣는다: `markerDistances()` 로 커서 줄에서 몇 줄 위인지 적고
 * (`markerDistances` 의 doc-comment 참고 — 기준이 `buffer.length` 가 아닌 이유),
 * 받는 쪽이 버퍼를 다 쓴 뒤 `restoreMarkers()` 로 되심는다. 여기서는 그 왕복을 가짜 터미널
 * 둘로 흉내 낸다 — 소스에서 명령을 돌려 거리를 뜨고, 새 터미널에 같은 화면을 재생한 뒤
 * 되심어 `lineOfBlock` 이 **원래 줄**을 주는지 본다.
 */
describe("이관 — markerDistances · restoreMarkers", () => {
  beforeEach(() => resetHistories());

  /** 소스 창 한 판: 성공 하나·실패 하나. 돌려주는 것은 거리 목록과 그때의 이력이다 */
  function sourcePane() {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "old-1" });
    runCommandIn(t, "one", ["out1"]); // A:0 · 출력:1
    runCommandIn(t, "two", ["boom"], 1); // A:2 · 출력:3 (커서 줄 = 4)
    const distances = shell.markerDistances();
    const history = exportHistory("old-1");
    shell.dispose();
    return { distances, history };
  }

  /** 새 창: 넘어온 이력을 심고, 재생할 줄들을 찍은 뒤 터미널을 연다 */
  function targetPane(
    history: CommandBlock[],
    replay: string[],
    opts: { decorations?: boolean } = {},
  ) {
    importHistory("new-1", history);
    const t = fakeTerm(opts);
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "new-1" });
    t.print(...replay); // = `t.write(restore.buffer)` 가 재생한 화면
    return { t, shell };
  }

  it("거리는 **커서 줄에서 위로** 몇 줄인가다 (죽은 마커는 빠진다)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    runCommandIn(t, "one", ["out1"]);
    runCommandIn(t, "two", ["boom"], 1);

    const [first, second] = blocksOf("p1");
    expect(shell.markerDistances()).toEqual([
      { blockId: first.id, promptFromBottom: 4 }, // A 는 0번 줄, 커서는 4
      { blockId: second.id, promptFromBottom: 2 },
    ]);

    t.scrollOut();
    expect(shell.markerDistances()).toEqual([]);
    shell.dispose();
  });

  it("같은 화면을 재생하면 마커가 **원래 줄**에 다시 선다 (`lineOfBlock` 이 산다)", () => {
    const { distances, history } = sourcePane();
    // 새 창의 터미널에는 OSC 133 이 한 번도 오지 않았다 — 그래서 이 순간의 답은 `null` 이다.
    const { shell } = targetPane(history, ["$ one", "out1", "$ two", "boom"]);
    const [first, second] = blocksOf("new-1");
    expect(shell.lineOfBlock(first.id)).toBeNull();

    expect(shell.restoreMarkers(distances)).toBe(2);
    expect(shell.lineOfBlock(first.id)).toBe(0);
    expect(shell.lineOfBlock(second.id)).toBe(2);
    shell.dispose();
  });

  it("잘려 나간 위쪽 블록은 **건너뛴다** — 그 블록은 지금까지처럼 '밀려난 블록' 이다", () => {
    const { distances, history } = sourcePane();
    // 이관은 스크롤백을 자른다 (`TEAR_SCROLLBACK`). 여기서는 뒤의 두 줄만 도착했다.
    const { shell } = targetPane(history, ["$ two", "boom"]);
    const [first, second] = blocksOf("new-1");

    expect(shell.restoreMarkers(distances)).toBe(1); // 첫 블록은 줄이 음수라 빠진다
    expect(shell.lineOfBlock(first.id)).toBeNull();
    expect(shell.lineOfBlock(second.id)).toBe(0);
    // 그래도 **이력은 남는다** — 발췌만 남았다는 안내가 그대로 뜻을 갖는다.
    expect(blocksOf("new-1")).toHaveLength(2);
    shell.dispose();
  });

  it("커서보다 아래(범위 밖)를 가리키는 값도 건너뛴다 (짐은 남의 창이 만든 JSON 이다)", () => {
    const { history } = sourcePane();
    const { shell } = targetPane(history, ["$ one", "out1", "$ two", "boom"]);
    const [first] = blocksOf("new-1");
    expect(shell.restoreMarkers([{ blockId: first.id, promptFromBottom: -1 }])).toBe(0);
    expect(shell.lineOfBlock(first.id)).toBeNull();
    shell.dispose();
  });

  it("**실패 거터 표시**를 다시 그린다 — 성공한 블록에는 아무것도 안 건다", () => {
    const { distances, history } = sourcePane();
    const { t, shell } = targetPane(history, ["$ one", "out1", "$ two", "boom"], {
      decorations: true,
    });
    shell.restoreMarkers(distances);

    // 실패한 명령(2번 블록 · A 는 2번 줄)에만 띠와 줄 배경이 선다.
    const drawn = t.decorations();
    expect(drawn.map((d) => d.line)).toEqual([2, 2]);
    expect(drawn.map((d) => d.classes)).toEqual([
      ["aynx-cmd-band", "aynx-cmd-fail"],
      ["aynx-fail-row"],
    ]);

    // dispose 는 되심은 데코까지 걷는다 (레코드에 딸리지 않아 수명을 따로 쥔다).
    shell.dispose();
    expect(t.decorations()).toEqual([]);
  });
});

/**
 * **블록 띠** (`bandBlock` · docs/log/2026-09-08-block-search.md 의 "블록 띠 강조").
 *
 * `#` 검색이 점프하면 매치된 글자 몇 개만 색칠되어 어느 블록에 왔는지가 안 읽힌다. 그래서
 * 데코 **하나**로 블록 전체(프롬프트 줄 ~ 마지막 출력 줄)를 두르는데, 그 높이를 재는 규칙이
 * 세 갈래다 — 살아 있는 `D` · 다음 프롬프트(되심은 블록) · 커서 줄(마지막 블록).
 */
describe("블록 띠 (bandBlock)", () => {
  beforeEach(() => resetHistories());

  /** 지금 그려진 띠들 (상태 띠·실패 줄은 뺀다) */
  function bands(t: ReturnType<typeof fakeTerm>) {
    return t.decorations().filter((d) => d.classes.includes("aynx-block-band"));
  }

  it("살아 있는 블록은 **`D` 로** 높이를 잰다 (D 의 줄은 출력이 아니다)", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    runCommandIn(t, "one", ["out1", "out2"]); // A:0 · 출력:1,2 · D:3
    // 셸이 빈 줄을 하나 찍고 다음 프롬프트를 냈다 — 다음 프롬프트로 재면 한 줄이 더 붙는다.
    t.print("");
    t.osc(133, "A"); // A:4

    const [first] = blocksOf("p1");
    expect(shell.bandBlock(first.id)).toBe(true);
    // 재는 것은 자리와 높이뿐이다 — 데코 기록에는 거터 표식용 칸(x·width·글자)도 함께
    // 있으므로 통째로 비교하지 않는다.
    expect(bands(t).map((d) => [d.line, d.height, d.classes])).toEqual([
      [0, 3, ["aynx-block-band"]], // 0~2
    ]);
    shell.dispose();
  });

  it("되심은 블록(`D` 가 없다)은 **다음 프롬프트 직전**까지 두른다", () => {
    const t = fakeTerm();
    const src = attachShellIntegration(t.term, () => {}, { paneId: "old-1" });
    runCommandIn(t, "one", ["out1"]); // A:0
    runCommandIn(t, "two", ["boom"], 1); // A:2
    const distances = src.markerDistances();
    const history = exportHistory("old-1");
    src.dispose();

    // 새 창: 화면만 재생되고 OSC 133 은 오지 않는다 — 마커는 `restoreMarkers` 가 심는다.
    importHistory("new-1", history);
    const t2 = fakeTerm({ decorations: true });
    const shell = attachShellIntegration(t2.term, () => {}, { paneId: "new-1" });
    t2.print("$ one", "out1", "$ two", "boom");
    shell.restoreMarkers(distances);

    const [first, second] = blocksOf("new-1");
    expect(shell.bandBlock(first.id)).toBe(true);
    expect(bands(t2).map((d) => [d.line, d.height])).toEqual([[0, 2]]); // 0~1 (다음 A 는 2)

    // 마지막 블록에는 다음 프롬프트가 없다 — **커서 줄**(내용의 끝 = 3)까지 간다.
    expect(shell.bandBlock(second.id)).toBe(true);
    expect(bands(t2).map((d) => [d.line, d.height])).toEqual([[2, 3]]); // 2~4, 띠는 하나뿐
    shell.dispose();
  });

  it("긴 출력은 **상한(500줄)**에서 멈춘다 — 프롬프트부터 그만큼만", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    t.osc(133, "A");
    t.print("$ big");
    t.osc(133, "C");
    t.print(...Array.from({ length: 600 }, (_, i) => `line ${i}`)); // 아직 `D` 가 안 왔다
    const [block] = blocksOf("p1");
    expect(shell.bandBlock(block.id)).toBe(true);
    expect(bands(t).map((d) => d.height)).toEqual([500]);
    shell.dispose();
  });

  it("마커가 밀려났으면 `false` — 없는 자리에 그리지 않는다", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    runCommandIn(t, "one", ["out1"]);
    const [block] = blocksOf("p1");

    t.scrollOut(); // 스크롤백 밖 — xterm 이 마커를 스스로 dispose 한다
    expect(shell.bandBlock(block.id)).toBe(false);
    expect(bands(t)).toEqual([]);
    // 없는 블록도 마찬가지다 (이력에는 있지만 이 터미널이 모르는 번호)
    expect(shell.bandBlock(9999)).toBe(false);
    shell.dispose();
  });

  it("`clearBand` 가 걷는다 — 두 번 불러도 안전하고, dispose 도 함께 걷는다", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    runCommandIn(t, "one", ["out1"]);
    const [block] = blocksOf("p1");

    shell.bandBlock(block.id);
    expect(bands(t)).toHaveLength(1);
    shell.clearBand();
    expect(bands(t)).toEqual([]);
    shell.clearBand(); // 없는 것을 걷어도 아무 일도 없다

    shell.bandBlock(block.id);
    expect(bands(t)).toHaveLength(1);
    shell.dispose();
    expect(bands(t)).toEqual([]);
  });
});

/**
 * payload 의 **필드 분해**와 **출처 고정** (설계 §5 ② ·
 * docs/log/2026-09-08-block-hooks.md).
 *
 * 우리 스니펫만 `aynx=1` 을 붙인다. 터미널은 처음 본 `A` 의 태그로 소스를 고정하고 다른
 * 태그의 마커를 버린다 — 남의 셸 통합이 함께 서 있어도 블록이 갈라지지 않게 하는 관문이다.
 * **자가 회복은 없다**: 카운터만 센다.
 */
describe("parseMarker", () => {
  it("`;` 로 필드를 나누고 우리 태그를 알아본다", () => {
    expect(parseMarker("A;aynx=1")).toEqual({ kind: "A", fields: ["A", "aynx=1"], tag: "aynx" });
    expect(parseMarker("D;1;aynx=1")).toEqual({
      kind: "D",
      fields: ["D", "1", "aynx=1"],
      tag: "aynx",
    });
  });

  it("태그가 없으면 남의 것이다 (VS Code·iTerm2 는 붙이지 않는다)", () => {
    expect(parseMarker("A").tag).toBe("foreign");
    expect(parseMarker("D;1").tag).toBe("foreign");
    expect(parseMarker("D;1").fields[1]).toBe("1");
  });

  it("`D` 만 오면 코드 칸이 비어 있다 (규약의 기본값 = 성공)", () => {
    expect(parseMarker("D").fields[1]).toBeUndefined();
  });
});

describe("출처 고정 (aynx vs foreign)", () => {
  beforeEach(() => resetHistories());

  it("처음 본 `A` 가 소스를 정하고, 다른 태그는 버린다", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });

    // 우리 훅이 먼저 프롬프트를 냈다.
    t.osc(133, "A;aynx=1");
    t.print("$ ls");
    // 같은 프롬프트에 남의 통합이 A 를 하나 더 낸다 — 통째로 버린다.
    t.osc(133, "A");
    t.osc(133, "C"); // 태그 없는 C 도 버려진다 (블록이 갈라지지 않는다)
    t.osc(133, "C;aynx=1");
    t.print("a");
    t.osc(133, "D;0;aynx=1");

    const blocks = blocksOf("p1");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].commandLine).toBe("$ ls");
    const d = shell.diagnostics();
    expect(d.source).toBe("aynx");
    expect(d.foreignDropped).toBe(2);
    shell.dispose();
  });

  it("남의 것이 먼저 오면 **그쪽이 산다** — 목표는 소스가 정확히 하나인 것이다", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });

    t.osc(133, "A"); // 태그 없는 통합이 먼저 잡았다
    t.print("$ make");
    t.osc(133, "C");
    t.print("built");
    t.osc(133, "D;0");
    // 우리 것이 뒤늦게 끼어들어도 버려진다.
    t.osc(133, "A;aynx=1");

    expect(blocksOf("p1")).toHaveLength(1);
    expect(blocksOf("p1")[0].exit).toBe(0);
    expect(shell.diagnostics().source).toBe("foreign");
    expect(shell.diagnostics().foreignDropped).toBe(1);
    shell.dispose();
  });

  it("같은 줄의 두 번째 `A` 는 **접는다** (둘 다 남의 것이라 태그로 못 가를 때)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });

    t.osc(133, "A");
    t.osc(133, "A"); // 아직 아무것도 안 찍혔다 = 같은 줄 = 같은 프롬프트
    t.print("$ ls");
    t.osc(133, "C");
    t.print("a");
    t.osc(133, "D;0");

    expect(blocksOf("p1")).toHaveLength(1);
    expect(shell.diagnostics().collapsedPrompts).toBe(1);
    // 접었으니 점프 목록에도 프롬프트가 하나뿐이다.
    expect(shell.lineOfBlock(blocksOf("p1")[0].id)).toBe(0);
    shell.dispose();
  });

  it("세션이 갈리면 고정이 풀린다 (`resetSource`) — 재연결·창 이관", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    t.osc(133, "A");
    expect(shell.diagnostics().source).toBe("foreign");

    shell.resetSource();
    expect(shell.diagnostics().source).toBeNull();
    t.osc(133, "A;aynx=1"); // 새 셸의 첫 A 가 다시 소스를 정한다
    expect(shell.diagnostics().source).toBe("aynx");
    shell.dispose();
  });
});

/**
 * **`C` 없이 `D` 만 오는 세션** — PSReadLine 이 없는 PowerShell 이 그렇다 (Enter 핸들러가
 * `C` 를 내는 유일한 자리다). 그때도 블록은 생겨야 한다 — 안 그러면 그 셸의 `#` 검색이
 * 통째로 빈다 (docs/log/2026-09-08-block-hooks.md).
 */
describe("A/B/D 만 오는 훅 (C 없음)", () => {
  beforeEach(() => resetHistories());

  it("`D` 에서 블록을 한 번에 열고 닫는다 — 명령문은 `B` 부터, 출력은 프롬프트 다음 줄부터", () => {
    const t = fakeTerm();
    const seen: CommandBlock[] = [];
    const shell = attachShellIntegration(t.term, () => {}, {
      paneId: "p1",
      onblock: (b) => seen.push(b),
    });

    t.osc(133, "A;aynx=1");
    t.promptEnd("PS> ", "B;aynx=1");
    t.print("PS> dir");
    t.print("Volume in drive C");
    t.osc(133, "D;0;aynx=1");

    const blocks = blocksOf("p1");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].commandLine).toBe("dir");
    expect(blocks[0].exit).toBe(0);
    expect(blocks[0].running).toBe(false);
    expect(blocks[0].excerpt.head).toEqual(["Volume in drive C"]);
    expect(seen).toHaveLength(1);
    // 점프도 된다 — 착지점은 여전히 `A` 의 줄이다.
    expect(shell.lineOfBlock(blocks[0].id)).toBe(0);
    shell.dispose();
  });

  it("빈 프롬프트에 `D` 가 와도 블록은 하나다 (0 이 아닌 코드를 들고)", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    t.osc(133, "A;aynx=1");
    t.print("PS> oops");
    t.osc(133, "D;1;aynx=1");
    expect(blocksOf("p1")).toHaveLength(1);
    expect(blocksOf("p1")[0].exit).toBe(1);
    expect(shell.status()).toBe("fail");
    shell.dispose();
  });
});

// ---------------------------------------------------------------------------
// 지금 도는 명령 보고 (`BlockSink.oncommand`) — docs/log/2026-09-16-ai-tile-identity-from-command.md
//
// 타일 아이콘·이름이 이 신호 하나로 "지금 Claude Code 가 도는 칸" 을 세운다. 지킬 것은 둘:
// **C 에서 명령문이 오르고 D 에서 반드시 내려간다**(안 내려가면 끝난 CLI 이름이 눌어붙는다).
// ---------------------------------------------------------------------------

describe("BlockSink.oncommand — 도는 명령 보고", () => {
  beforeEach(() => resetHistories());

  it("C 에서 명령문, D 에서 null — 블록 이력과 **같은 추출**이다", () => {
    const t = fakeTerm();
    const seen: (string | null)[] = [];
    const shell = attachShellIntegration(t.term, () => {}, {
      paneId: "p1",
      oncommand: (line) => seen.push(line),
    });

    t.osc(133, "A");
    t.promptEnd("PS> ");
    t.print("PS> claude");
    t.osc(133, "C");
    t.print("✳ 안녕하세요");
    t.osc(133, "D;0");

    expect(seen).toEqual(["claude", null]);
    expect(blocksOf("p1")[0].commandLine).toBe("claude");
    shell.dispose();
  });

  it("빈 프롬프트(A 만)는 아무것도 올리지 않는다 — 도는 명령이 없다", () => {
    const t = fakeTerm();
    const seen: (string | null)[] = [];
    const shell = attachShellIntegration(t.term, () => {}, {
      paneId: "p1",
      oncommand: (line) => seen.push(line),
    });
    t.osc(133, "A");
    t.promptEnd("PS> ");
    expect(seen).toEqual([]);
    shell.dispose();
  });

  it("`C` 없이 `D` 만 온 셸(PSReadLine 없음)도 끝은 알린다", () => {
    const t = fakeTerm();
    const seen: (string | null)[] = [];
    const shell = attachShellIntegration(t.term, () => {}, {
      paneId: "p1",
      oncommand: (line) => seen.push(line),
    });
    t.osc(133, "A;aynx=1");
    t.print("PS> dir");
    t.osc(133, "D;0;aynx=1");
    expect(seen).toEqual([null]);
    shell.dispose();
  });
});

/**
 * 실행 시간 표식 — 오래 걸린 명령의 오른쪽 끝에 서는 한 토막
 * (docs/log/2026-09-16-finish-notify-block-marks-bell.md).
 *
 * 재는 것은 **어느 줄에 서는가**와 **임계를 듣는가** 둘이다. 문구 규칙(성패는 색이 말한다)은
 * 순수 모듈 쪽에서 이미 붙들었다 (`finish-notify.test.ts`) — 여기서는 상태 기계가 그 문구를
 * **그 명령이 마지막으로 쓴 줄**에 거는지를 본다. 처음 판에서는 `D` 의 줄(= 다음 프롬프트
 * 줄)에 걸어, 표식이 **다음 명령의 것처럼** 보였다.
 *
 * 시계를 세워 두고 도는 이유: 이제 표식은 **임계를 넘긴 명령에만** 선다. 가짜 터미널의
 * 명령은 한순간에 끝나므로, 시간을 흘려 주지 않으면 그릴 것이 아무것도 없다.
 */
describe("attachShellIntegration — 실행 시간 표식", () => {
  beforeEach(() => {
    resetHistories();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 16, 14, 3, 21));
  });
  afterEach(() => vi.useRealTimers());

  /** 임계 1초(`0` 이면 끔) — 아래 `slow()` 가 2초를 흘려 그 위로 올린다 */
  const attach = (t: ReturnType<typeof fakeTerm>, secs = 1) =>
    attachShellIntegration(t.term, () => {}, { paneId: "p1", markAfterSecs: () => secs });

  /** 임계를 넘기게 시간을 흘린다 (명령이 도는 동안) */
  const slow = () => vi.advanceTimersByTime(2000);

  /** 표식 데코 하나 (없으면 undefined) */
  const markOf = (t: ReturnType<typeof fakeTerm>) =>
    t.decorations().find((d) => d.classes.includes("aynx-block-mark"));

  /** 실패한 줄의 붉은 배경 데코 (말풍선이 걸리는 자리) */
  const failRowOf = (t: ReturnType<typeof fakeTerm>) =>
    t.decorations().find((d) => d.classes.includes("aynx-fail-row"));

  it("줄바꿈으로 끝난 출력 — 마지막 출력 줄에 선다 (D 의 줄이 아니다)", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);

    t.osc(133, "A");
    t.print("$ npm run build"); // 0
    t.osc(133, "C");
    slow();
    t.print("compiling", "done"); // 1, 2 — 커서는 3번 줄 첫 칸
    t.osc(133, "D;1");

    const mark = markOf(t);
    expect(mark?.line).toBe(2); // "done" — 다음 프롬프트가 설 3번 줄이 아니다
    expect(mark?.text).toBe("2.0초"); // 실패도 **시간만** 적는다 — 성패는 색이 말한다
    expect(mark?.classes).toContain("aynx-block-mark-fail");
    shell.dispose();
  });

  it("줄바꿈 없이 끝난 출력 — 커서가 남아 있는 **그 줄**에 선다", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);

    t.osc(133, "A");
    t.print("$ printf foo"); // 0
    t.osc(133, "C");
    slow();
    t.print("첫 줄"); // 1
    t.printPartial("foo"); // 2 — 커서가 이 줄 위에 남는다
    t.osc(133, "D;1");

    expect(markOf(t)?.line).toBe(2);
    shell.dispose();
  });

  it("출력이 없으면 명령 줄 자신에 선다 (그 명령 옆이다)", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);

    t.osc(133, "A");
    t.print("$ sleep 2"); // 0 — 커서는 1번 줄
    t.osc(133, "C");
    slow();
    t.osc(133, "D;1");

    expect(markOf(t)?.line).toBe(0);
    shell.dispose();
  });

  it("버퍼 맨 윗줄이라 위가 없으면 `D` 의 줄로 물러선다 (둘은 같은 줄이다)", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);

    t.osc(133, "A"); // 아무것도 안 찍힌 상태 — 커서는 0번 줄
    t.osc(133, "C");
    slow();
    t.osc(133, "D;1");

    expect(markOf(t)?.line).toBe(0);
    shell.dispose();
  });

  it("오른쪽 끝에 선다 — 상자는 글자 칸 수 + 한 칸", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);

    t.osc(133, "A");
    t.print("$ sleep 2");
    t.osc(133, "C");
    slow();
    t.print("끝");
    t.osc(133, "D;1");

    const mark = markOf(t);
    expect(mark?.width).toBe(5 + 1); // `2.0초` = 라틴 셋 + 두 칸짜리 한 글자 = 다섯 칸
    expect(mark?.x).toBe(80 - (mark?.width ?? 0)); // 가짜 터미널은 80칸
    shell.dispose();
  });

  it("임계가 `0`(끔)이면 아무리 오래 걸려도 안 그린다 (상태 띠는 그대로 선다)", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t, 0);

    t.osc(133, "A");
    t.print("$ sleep 2");
    t.osc(133, "C");
    slow();
    t.osc(133, "D;1");

    expect(markOf(t)).toBeUndefined();
    expect(t.decorations().some((d) => d.classes.includes("aynx-cmd-band"))).toBe(true);
    shell.dispose();
  });

  it("임계 미만이면 **실패에도** 아무것도 안 붙는다 (붉은 띠가 이미 말한다)", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);

    t.osc(133, "A");
    t.print("$ false");
    t.osc(133, "C");
    t.osc(133, "D;1"); // 한순간에 끝났다 — 임계(1초) 아래

    expect(markOf(t)).toBeUndefined();
    expect(failRowOf(t)).toBeDefined(); // 붉은 줄은 그대로 선다
    shell.dispose();
  });

  it("임계를 넘기면 시간이 붙고, 말풍선에 종료 코드와 명령 전문이 들어간다", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);

    t.osc(133, "A");
    t.print("$ npm run build");
    t.osc(133, "C");
    vi.setSystemTime(new Date(2026, 8, 16, 14, 3, 33, 400));
    t.print("done");
    t.osc(133, "D;0");

    const mark = markOf(t);
    expect(mark?.text).toBe("12.4초");
    expect(mark?.classes).not.toContain("aynx-block-mark-fail");
    expect(mark?.title).toContain("종료 코드 0 — 성공");
    expect(mark?.title).toContain("$ npm run build");
    shell.dispose();
  });

  it("종료 코드 말풍선은 **실패의 붉은 띠**에도 붙는다 — 표식이 없는 짧은 실패에서도", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);

    t.osc(133, "A");
    t.print("$ make");
    t.osc(133, "C");
    t.osc(133, "D;3"); // 임계 아래라 표식이 없다

    expect(markOf(t)).toBeUndefined();
    const row = failRowOf(t);
    expect(row?.title).toContain("종료 코드 3 — 0 이면 성공, 아니면 실패");
    expect(row?.title).toContain("$ make");
    // 거터 세로선에도 같은 말풍선이 붙는다 (한 사실을 두 자리에서 다르게 적지 않는다).
    const band = t.decorations().find((d) => d.classes.includes("aynx-cmd-fail"));
    expect(band?.title).toBe(row?.title);
    shell.dispose();
  });

  it("성공한 줄에는 말풍선이 없다 (띠만 조용히 선다)", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);

    t.osc(133, "A");
    t.print("$ true");
    t.osc(133, "C");
    t.osc(133, "D;0");

    const band = t.decorations().find((d) => d.classes.includes("aynx-cmd-ok"));
    expect(band?.title).toBe("");
    shell.dispose();
  });

  it("데코가 지면 우리가 심은 마커도 함께 진다 (명령마다 마커가 새지 않게)", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);

    t.osc(133, "A");
    t.print("$ sleep 2");
    t.osc(133, "C");
    slow();
    t.print("끝");
    t.osc(133, "D;1");

    const before = t.liveMarkers();
    shell.dispose(); // `rec.decorations` 를 전부 걷는다 → 표식의 마커도 따라 죽는다
    expect(t.liveMarkers()).toBe(before - 1);
  });
});

/**
 * **화면 지우기**(`clear`) 뒤 표시가 빈 줄에 남던 버그 (docs/log/2026-09-27-clear-highlights.md).
 *
 * 데코는 마커에 걸리고 마커는 줄이 **빈 칸이 되어도** 산다. 두 모양을 본다:
 * - 원격(ncurses `clear`)·bash `Ctrl+L`: `CSI H CSI 2 J [CSI 3 J]` — `ED 2` 가 뷰포트를 지운다.
 * - Windows(ConPTY): `CSI 3 J` + 줄마다 `CSI K` + `CSI H` — `ED 2` 가 **오지 않는다**(실기).
 */
describe("화면 지우기 — 지워진 줄의 표시를 걷는다", () => {
  beforeEach(() => {
    resetHistories();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const attach = (t: ReturnType<typeof fakeTerm>) =>
    attachShellIntegration(t.term, () => {}, { paneId: "p1", markAfterSecs: () => 1 });

  /** 표시로 그린 것들 (상태 띠 · 실패 줄 · 시간 표식 · 블록 띠) */
  const marks = (t: ReturnType<typeof fakeTerm>) =>
    t.decorations().filter((d) =>
      d.classes.some((c) =>
        ["aynx-cmd-band", "aynx-fail-row", "aynx-block-mark", "aynx-block-band"].includes(c),
      ),
    );

  /** 느린 실패 하나(표식까지 선다) · 성공 하나 */
  function twoCommands(t: ReturnType<typeof fakeTerm>) {
    t.osc(133, "A");
    t.print("$ make");
    t.osc(133, "C");
    vi.advanceTimersByTime(2000);
    t.print("boom");
    t.osc(133, "D;1");
    runCommandIn(t, "ls", ["a b"]);
  }

  it("ED 2 — 뷰포트의 띠·붉은 줄·시간 표식·블록 띠가 걷히고, 기본 지우기는 그대로 돈다", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);
    twoCommands(t);
    const [first] = blocksOf("p1");
    expect(shell.bandBlock(first.id)).toBe(true);
    expect(marks(t).length).toBeGreaterThanOrEqual(5);

    // `clear` 를 쳤다 — 그 명령의 C 까지 오고, 셸이 `CSI H CSI 2 J` 를 낸다.
    t.osc(133, "A");
    t.print("$ clear");
    t.osc(133, "C");
    expect(t.ed(2)).toBe(false); // xterm 의 지우기를 막지 않는다
    t.osc(133, "D;0");

    expect(marks(t)).toEqual([]); // `clear` 자신의 띠도 빈 줄에 서지 않는다
    // 점프는 지워진 명령으로 가지 않는다 · 블록 다리도 끊긴다(밀려난 블록과 같은 대접).
    expect(shell.jump(-1)).toBe(false);
    expect(shell.lineOfBlock(first.id)).toBeNull();
    expect(shell.last()).toBeNull();
    // 이력(발췌)은 남는다 — `clear` 는 화면을 지우지 셸 히스토리를 지우지 않는다.
    expect(blocksOf("p1").map((b) => b.exit)).toEqual([1, 0, 0]);
    shell.dispose();
  });

  it("지운 뒤의 다음 명령은 평소처럼 띠를 받는다", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);
    twoCommands(t);
    t.osc(133, "A");
    t.print("$ clear");
    t.osc(133, "C");
    t.ed(2);
    t.osc(133, "D;0");

    runCommandIn(t, "false", ["nope"], 1);
    expect(marks(t).map((d) => d.classes[0])).toEqual(["aynx-cmd-band", "aynx-fail-row"]);
    expect(shell.jump(-1)).toBe(false); // 살아 있는 프롬프트는 하나(방금 것)뿐이다
    shell.dispose();
  });

  it("ConPTY — `ED 3` 뒤 줄 단위로 지워진 화면은 셸이 돌아올 때(`D`) 걷는다", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);
    twoCommands(t);
    t.osc(133, "A");
    t.print("$ clear");
    t.osc(133, "C");

    expect(t.ed(3)).toBe(false);
    // `J` 를 본 순간은 아직 글자가 있다 — 여기서는 아무것도 걷히지 않는다.
    expect(marks(t).length).toBeGreaterThan(0);
    t.blankViewport(); // 줄마다 `CSI K`
    t.osc(133, "D;0");
    expect(marks(t)).toEqual([]);

    runCommandIn(t, "ls", ["x"]);
    expect(marks(t).map((d) => d.classes)).toEqual([["aynx-cmd-band", "aynx-cmd-ok"]]);
    shell.dispose();
  });

  it("`ED 3` 만 오고 화면이 그대로면 화면의 띠는 남는다 (스크롤백의 것만 걷힌다)", () => {
    const t = fakeTerm({ decorations: true, rows: 3 });
    const shell = attach(t);
    runCommandIn(t, "one", ["out1"]); // A:0 · 1
    runCommandIn(t, "two", ["out2"]); // A:2 · 3
    runCommandIn(t, "three", ["out3"]); // A:4 · 5 (커서 6)
    t.setBaseY(4); // 0~3 줄은 스크롤백, 4~6 이 화면
    const [one, two, three] = blocksOf("p1");

    t.ed(3);
    t.osc(133, "A"); // 셸이 돌아왔다 — 화면 줄은 비지 않았다

    expect(marks(t).map((d) => d.line)).toEqual([4]);
    expect(shell.lineOfBlock(one.id)).toBeNull();
    expect(shell.lineOfBlock(two.id)).toBeNull();
    expect(shell.lineOfBlock(three.id)).toBe(4);
    shell.dispose();
  });

  it("ED 2 는 뷰포트만 — 스크롤백의 띠는 남는다", () => {
    const t = fakeTerm({ decorations: true, rows: 3 });
    const shell = attach(t);
    runCommandIn(t, "one", ["out1"]); // A:0
    runCommandIn(t, "two", ["out2"]); // A:2
    runCommandIn(t, "three", ["out3"]); // A:4
    t.setBaseY(4);

    t.ed(2);
    expect(marks(t).map((d) => d.line)).toEqual([0, 2]);
    shell.dispose();
  });

  it("대체 화면(vim·less)의 지우기는 무시한다 — 마커는 일반 화면의 줄이다", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attach(t);
    twoCommands(t);
    const before = marks(t).length;
    t.setBufferType("alternate");
    t.ed(2);
    t.ed(3);
    t.setBufferType("normal");
    t.osc(133, "A");
    expect(marks(t)).toHaveLength(before);
    shell.dispose();
  });

  it("이관으로 되심은 실패 표시도 걷는다", () => {
    const src = fakeTerm();
    const s1 = attachShellIntegration(src.term, () => {}, { paneId: "old" });
    runCommandIn(src, "boom", ["x"], 1);
    const distances = s1.markerDistances();
    const history = exportHistory("old");
    s1.dispose();

    importHistory("new", history);
    const t = fakeTerm({ decorations: true });
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "new" });
    t.print("$ boom", "x");
    shell.restoreMarkers(distances);
    expect(marks(t)).toHaveLength(2);

    t.ed(2);
    expect(marks(t)).toEqual([]);
    expect(shell.lineOfBlock(blocksOf("new")[0].id)).toBeNull();
    shell.dispose();
  });
});

describe("attachShellIntegration — 블록 출력 전부 (docs/log/2026-09-28-ask-ai-block.md)", () => {
  beforeEach(() => resetHistories());

  function run(t: ReturnType<typeof fakeTerm>, cmd: string, output: string[], exit = 0) {
    t.osc(133, "A");
    t.print(`$ ${cmd}`);
    t.osc(133, "C");
    t.print(...output);
    t.osc(133, `D;${exit}`);
  }

  it("블록마다 C..D 의 논리 줄 전부 — 끝의 빈 줄은 버린다", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    run(t, "make", ["cc a.c", "error: x", ""], 2);
    run(t, "ls", ["a", "b"]);
    const [make, ls] = blocksOf("p1");
    expect(shell.blockOutput(make.id)).toEqual(["cc a.c", "error: x"]);
    expect(shell.blockOutput(ls.id)).toEqual(["a", "b"]);
    shell.dispose();
  });

  it("마커가 밀려났거나 모르는 블록이면 null — 부르는 쪽이 이력의 발췌로 물러선다", () => {
    const t = fakeTerm();
    const shell = attachShellIntegration(t.term, () => {}, { paneId: "p1" });
    run(t, "make", ["x"], 1);
    const [make] = blocksOf("p1");
    expect(shell.blockOutput(999)).toBe(null);
    t.scrollOut();
    expect(shell.blockOutput(make.id)).toBe(null);
    shell.dispose();
  });

  it("실패 줄 단추는 싱크가 단추를 줄 때만 — 가짜 요소(querySelector 없음)에서는 조용히 건너뛴다", () => {
    const t = fakeTerm({ decorations: true });
    const shell = attachShellIntegration(t.term, () => {}, {
      paneId: "p1",
      askButton: { label: () => "AI", hint: () => "", title: () => "", run: () => {} },
    });
    run(t, "false", ["boom"], 1);
    expect(t.decorations().some((d) => d.classes.includes("aynx-fail-row"))).toBe(true);
    shell.dispose();
  });
});

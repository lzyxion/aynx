// 터미널 타일의 **스크롤백 내보내기 · 세션 로그 열기** — `Terminal.svelte` 에서 뗀 어댑터(2026-10-26 분할 3차).
// 저장 대화상자 · 파일 쓰기 · 로그 파일 열기 · 그 결과 알림까지. 타일의 값(xterm · 명세 · 로그 경로)은 게터로 받는다 —
// `term` · `logPath` 는 `mount()` · 세션 수명이 채우는 `let` 이라 값으로 넘기면 낡는다. 부르는 자리는 `Terminal` 의 터미널 창구(`termActions`).
//
// 셋 다 **앱 토스트**(`$lib/toast`)로 말한다 — 타일 안 토스트(`Terminal` 의 `showNote`)가 아니다.
// 기준은 `Terminal.svelte` 의 규칙 그대로다: 저쪽은 "이 화면에서 방금 한 일"(복사·붙여넣기)이라
// 타일 안에 떠야 어느 타일인지가 읽히지만, 여기서 나온 결과는 **디스크의 파일**이고
// 이어지는 몸짓([폴더 열기])이 타일 밖으로 나간다. 무엇보다 앱 토스트만 버튼을 받는다.
// (docs/log/2026-09-17-scrollback-export-and-logs.md)
import type { Terminal } from "@xterm/xterm";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import { paneName, type PaneSpec } from "$lib/session";
import { joinScrollback, scrollbackFileName, scrollbackLines, writeTextFile } from "$lib/scrollback";
import { openLogPath } from "$lib/session-logs";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast as appToast } from "$lib/toast.svelte.js";

/** 타일에서 읽는 것 — 게터라 그때그때의 값이다 */
export interface ScrollbackHost {
  /** 이 타일의 xterm (아직 없거나 정리됐으면 `null`) */
  readonly term: Terminal | null;
  /** 이 타일의 명세 — 저장 파일 이름의 재료 */
  readonly pane: PaneSpec;
  /** 이 세션의 로그 파일 (로깅이 꺼져 있으면 `null`) */
  readonly logPath: string | null;
}

/** 던져진 것에서 사람이 읽을 한 줄을 — 백엔드 오류는 언제나 문자열이다 */
function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

export function createScrollbackActions(h: ScrollbackHost) {
  /**
   * 이 타일의 버퍼 전체를 `.txt` 한 장으로 — 저장 자리는 OS 대화상자가 묻는다.
   *
   * 취소(대화상자에서 `null`)는 **아무 말도 하지 않는다**: 사용자가 방금 스스로 그만둔
   * 일을 다시 알려 줄 이유가 없다.
   */
  async function saveScrollback() {
    const t = h.term;
    if (!t) return;
    const text = joinScrollback(scrollbackLines(t.buffer.active));
    if (text === "") {
      appToast.info(tr("pane.term.scrollback.empty"));
      return;
    }
    const name = scrollbackFileName(paneName(h.pane, tr), new Date());
    let path: string | null = null;
    try {
      path = await saveDialog({
        defaultPath: name,
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
    } catch (e) {
      console.error("[aynx] 저장 대화상자를 열지 못했습니다", e);
    }
    if (path === null) return; // 사용자가 취소했다
    try {
      await writeTextFile(path, text);
    } catch (e) {
      appToast.error(tr("pane.term.scrollback.failed", { reason: errorText(e) }));
      return;
    }
    const saved = path;
    appToast.success(tr("pane.term.scrollback.saved", { path: saved }), {
      action: {
        // 탐색기에서 **그 파일을 고른 채** 연다 — 방금 만든 것이 어느 것인지 묻지 않게.
        label: tr("pane.term.scrollback.reveal"),
        run: () => void revealItemInDir(saved).catch(() => {}),
      },
    });
  }

  /** 이 세션의 로그 파일을 OS 기본 앱으로 (로깅이 꺼져 있으면 메뉴에서 이미 흐리다) */
  async function openThisLog() {
    const path = h.logPath;
    if (path === null) return;
    if (!(await openLogPath(path))) appToast.error(tr("pane.term.log.open_failed"));
  }

  return { saveScrollback, openThisLog };
}

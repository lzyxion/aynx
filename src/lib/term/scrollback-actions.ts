// 스크롤백 내보내기 · 세션 로그 열기. 타일 값은 게터로 받는다 — `term` · `logPath` 는 나중에 채워지는 `let` 이라 값으로 넘기면 낡는다.
// 결과는 앱 토스트로 말한다(타일 안 토스트가 아니다) — [폴더 열기] 단추를 받는 것은 앱 토스트뿐이다.
import type { Terminal } from "@xterm/xterm";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import { paneName, type PaneSpec } from "$lib/session";
import { joinScrollback, scrollbackFileName, scrollbackLines, writeTextFile } from "$lib/scrollback";
import { openLogPath } from "$lib/session-logs";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast as appToast } from "$lib/toast.svelte.js";

export interface ScrollbackHost {
  readonly term: Terminal | null;
  readonly pane: PaneSpec;
  readonly logPath: string | null;
}

/** 백엔드 오류는 언제나 문자열이다 */
function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

export function createScrollbackActions(h: ScrollbackHost) {
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
    if (path === null) return;
    try {
      await writeTextFile(path, text);
    } catch (e) {
      appToast.error(tr("pane.term.scrollback.failed", { reason: errorText(e) }));
      return;
    }
    const saved = path;
    appToast.success(tr("pane.term.scrollback.saved", { path: saved }), {
      action: {
        label: tr("pane.term.scrollback.reveal"),
        run: () => void revealItemInDir(saved).catch(() => {}),
      },
    });
  }

  async function openThisLog() {
    const path = h.logPath;
    if (path === null) return;
    if (!(await openLogPath(path))) appToast.error(tr("pane.term.log.open_failed"));
  }

  return { saveScrollback, openThisLog };
}

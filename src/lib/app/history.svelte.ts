import { showNotice } from "$lib/app/notice";
import { blocksOf } from "$lib/block-history";
import { collectHistory, type HistoryEntry } from "$lib/history-search";
import { t } from "$lib/i18n/i18n.svelte.js";
import { hasSession, listPanes, paneName, writeSessionById } from "$lib/session";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { blocksVersionOf } from "$lib/app/console.svelte.js";
import { focusedPane, residentWindowTabs } from "$lib/app/tabs.svelte.js";

/**
 * 앱 차원 명령 이력 — 팔레트의 `!` 줄 (docs/log/2026-09-17-history-search.md).
 * 쓰는 길은 사람이 친 키와 같은 `write_session` 이다 — 나가는 글은 사용자가 이미 친 명령이고 AI 글자가 들어올 자리가 없다.
 */

/** 다른 창은 보이지 않는다 — 블록 링은 웹뷰마다 따로 산다 */
export function windowHistory(): HistoryEntry[] {
  blocksVersionOf(); // 블록 이력은 비반응형이라 이 버전을 읽어야 `$derived` 가 따라간다
  const panes: { id: string; label: string }[] = [];
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (!hasSession(pane.kind)) continue;
      panes.push({ id: pane.id, label: paneName(pane, t) });
    }
  }
  return collectHistory(panes, blocksOf);
}

/** 기본은 넣기만 한다(`\r` 없음) — 다른 서버 · 폴더에서 돌던 명령일 수 있어 사람이 보고 보낸다 */
export async function insertHistoryCommand(command: string, run = false): Promise<void> {
  const text = typeof command === "string" ? command.trim() : "";
  if (text === "") return;

  const pane = focusedPane();
  if (!pane || !hasSession(pane.kind)) {
    showNotice(t("commands.keys.terminalRequired"));
    return;
  }
  const sessionId = sessionOf(pane.id);
  if (sessionId === null) {
    showNotice(t("commands.snippet.notice.notConnected"));
    return;
  }

  const data = run ? `${text}\r` : text;
  try {
    await writeSessionById(pane.kind, sessionId, data);
  } catch (e) {
    showNotice(
      t("commands.snippet.notice.sendFailed", {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}

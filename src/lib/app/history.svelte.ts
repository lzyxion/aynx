import { showNotice } from "$lib/app/notice";
import { blocksOf } from "$lib/block-history";
import { collectHistory, type HistoryEntry } from "$lib/history-search";
import { t } from "$lib/i18n/i18n.svelte.js";
import { hasSession, listPanes, paneName, writeSessionById } from "$lib/session";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { blocksVersionOf } from "$lib/app/console.svelte.js";
import { focusedPane, residentWindowTabs } from "$lib/app/tabs.svelte.js";

/**
 * **앱 차원 명령 이력** — 팔레트의 `!` 줄이 보는 목록과, 고른 줄을 터미널에 넣는 길
 * (docs/log/2026-09-17-history-search.md).
 *
 * 규칙은 순수 층(`history-search.ts`)에 있다. 여기 있는 것은 그 규칙이 볼 수 없는 두 가지다 —
 * **이 창에 어떤 타일이 있나**([`windowHistory`])와 **지금 포커스된 터미널에 쓰기**
 * ([`insertHistoryCommand`]). `app/snippets.svelte.ts` 와 똑같은 분담이고, 쓰는 길도
 * 똑같다(아래).
 *
 * ## 쓰는 길은 **여느 입력과 같다**
 *
 * `write_session`(로컬·SSH — 세션 서버) — 사람이 키보드로 친 것이 지나는 바로 그 명령이다.
 * 새 통로가 아닌 이유는 스니펫과 같다: 나가는 문자열은 **사용자가 자기 터미널에서 이미 친
 * 것**이고 AI 가 만든 글자가 들어올 자리가 없다 (CLAUDE.md 의 "원시 `send_command` 는 만들지
 * 않는다").
 *
 * ## 기본은 **넣기만** 한다
 *
 * `Enter` 는 `\r` 을 붙이지 않는다 — 셸 프롬프트에 글자가 놓일 뿐이고 실행 여부는 사람이
 * Enter 로 정한다 (인라인 스니펫 제안의 `snippetInsertText` 와 같은 결). 이력에서 고른
 * 명령은 **다른 서버·다른 폴더**에서 돌던 것일 수 있어, 눈으로 한 번 보고 보내는 편이
 * 기본이어야 한다. 곧바로 실행하는 길은 `Shift+Enter` 로 따로 있고 힌트 줄이 그것을 말한다.
 */

/**
 * **이 창의 모든 타일**의 명령 이력 (최신순 · 중복 없음).
 *
 * 활성 탭만이 아니라 `residentWindowTabs()` 전부를 훑는다 — 사람이 `!` 로 찾는 "아까 그 명령" 은 지금
 * 보고 있는 탭에서 돌았을 이유가 없다 (오히려 다른 탭이라 못 찾는 것이 이 기능의 동기다).
 * 다른 **창**은 보이지 않는다: 블록 링은 웹뷰마다 따로 살고, 창을 건너 긁어모으는 통로를
 * 여는 것은 이 기능이 감당할 값이 아니다 (필요해지면 그때 이관과 같은 길을 낸다).
 *
 * `blocksVersionOf()` 를 읽어 **반응형으로 만든다** — 블록 이력은 순수(비반응형) 모듈이라
 * 값이 바뀌어도 `$derived` 가 다시 읽을 계기가 없다. 관제판(`Console.svelte`)이 같은 이유로
 * 같은 값을 읽는다.
 */
export function windowHistory(): HistoryEntry[] {
  blocksVersionOf(); // 블록 버전에 의존 — 명령이 끝나면 목록도 같은 프레임에 따라간다
  const panes: { id: string; label: string }[] = [];
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      // 세션 없는 타일(설정·파일·시작)은 애초에 블록이 없다 — 링을 헛되이 들추지 않는다.
      if (!hasSession(pane.kind)) continue;
      panes.push({ id: pane.id, label: paneName(pane, t) });
    }
  }
  return collectHistory(panes, blocksOf);
}

/**
 * 고른 명령을 **포커스된 터미널에 써 넣는다** — `run` 이 참이면 `\r` 까지 붙인다.
 *
 * 순서는 [`insertSnippet`](`app/snippets.svelte.ts`)의 앞 두 걸음 그대로다: 타일을 먼저 보고
 * (터미널이 아니면 안내 한 줄로 끝난다), 세션을 확인하고, 쓴다. 자리표시자도 범위도 없어
 * `await` 가 중간에 없으므로 "그 사이에 포커스가 옮겨 갔나" 를 다시 볼 자리도 없다.
 *
 * 화면에 **아무것도 메아리치지 않는다** — 터미널에 들어간 글자는 셸이 스스로 그린다.
 */
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
    // 로컬은 이 창 손잡이의 임대를 싣는다(세션 코어 — `writeSessionById`).
    await writeSessionById(pane.kind, sessionId, data);
  } catch (e) {
    showNotice(
      t("commands.snippet.notice.sendFailed", {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}

/**
 * 단축키 프레임워크 — 바인딩 가능한 **액션 레지스트리**와, 사용자 오버라이드를
 * 실제 키 조합으로 풀어 주는 순수 함수들.
 *
 * ## 왜 순수(pure)인가
 *
 * 이 파일에는 Svelte 임포트가 없다. `$state`·`$derived` 같은 룬도 쓰지 않는다.
 * 조합 문자열을 만들고(`comboFromEvent`) 풀고(`resolveBindings`) 사람이 읽을 라벨로
 * 바꾸는(`displayCombo`) 일만 한다 — 그래야 결정적이고, 배선(Terminal·+page)과
 * 설정 화면(SettingsModal)이 **같은 규칙**을 공유하면서도 서로를 끌어들이지 않는다.
 *
 * ## 조합 문자열 형식 (계약)
 *
 * `settings.toml` 의 `[keybindings]` 와 프런트의 `AppSettings.keybindings` 가 주고받는
 * 형식이다. 수식 키 이름(`Ctrl`·`Alt`·`Shift`, **이 고정 순서**) 뒤에 KeyboardEvent 의
 * **`code`**(물리 키) 를 `+` 로 잇는다.
 *
 *   `"Ctrl+ArrowUp"`  ·  `"Ctrl+Shift+KeyC"`  ·  `"Ctrl+Tab"`  ·  `"Ctrl+Comma"`
 *
 * ### `ev.key` 가 아니라 `ev.code` 인 이유 (IME 안전)
 *
 * 한국어 IME 가 켜져 있으면 xterm #6065 처럼 모든 키가 `ev.key === "Process"` /
 * `keyCode 229` 로 뭉개져 온다. 하지만 **`ev.code` 는 물리 키를 그대로 담고 있어**
 * IME 켬/꺼짐과 무관하다. 그래서 매칭·기록 양쪽에서 절대 `ev.key` 를 쓰지 않는다 —
 * 저장되는 조합 문자열도 `KeyC`·`ArrowUp` 같은 code 이름으로만 이뤄진다.
 *
 * Meta(⊞/⌘) 는 v1 에서 **무시**한다 (윈도 키를 앱 단축키로 잡으면 OS 와 다툰다).
 *
 * ## 화면 글자는 여기 없다
 *
 * 액션 이름도, "(없음)" 도 이 파일에는 없다 — 순수 모듈이라 `t()` 를 들일 수 없기
 * 때문이다. 이름은 [`actionLabel`] 이 **문구 키**로 돌려주고, 안 걸린 조합은
 * [`displayCombo`] 가 **빈 문자열**로 돌려준다 (부르는 쪽이 사전을 지난다).
 */

import type { Key } from "$lib/i18n/keys";

/**
 * 액션이 걸리는 층. `terminal` 은 xterm 안에서, `global` 은 창 전역에서 잡는다.
 *
 * `files` 는 **파일 타일이 활성일 때만** 잡는 층이다 (docs/log/2026-10-07-file-tile-dolphin.md) — 보기 바꾸기 ·
 * 경로 입력 · 필터 · 장소 패널. 실행은 그 타일의 창 keydown(`browser/file-keys.ts`)이 하고 전역 리졸버는 이 층을
 * 보지 않는다. 다만 같은 창 keydown 을 전역 층과 **함께** 지나므로, 두 층에 같은 조합이 걸리면 한 번에 둘 다
 * 돈다 — 그래서 충돌 판정([`sharesKeys`])에서는 `files` 와 `global` 을 한 이름공간으로 본다.
 */
export type ActionScope = "terminal" | "global" | "files";

/** 레지스트리의 한 항목 */
export interface ActionDef {
  /** 안정적인 식별자 — `settings.toml` 의 키가 된다 (절대 바꾸지 말 것) */
  id: string;
  scope: ActionScope;
  /** 기본 조합 문자열 (오버라이드가 없을 때 쓴다) */
  def: string;
}

/**
 * 액션의 **화면 이름**이 사는 자리 — 문구가 아니라 [문구 키]다 ([`actionLabel`]).
 *
 * `params` 는 코드가 만들어 내는 `workspace-1`…`-9` 때문에 있다 (번호 하나를 받는 키를
 * 아홉 줄이 나눠 쓴다).
 */
export interface ActionLabel {
  key: Key;
  params?: Record<string, string>;
}

/**
 * 액션 id → **이름 문구 키**. 부르는 쪽이 `t(l.key, l.params)` 로 글자를 만든다.
 *
 * 이 모듈은 순수하다(룬도 `t()` 도 들이지 않는다 — 머리말) 그래서 키만 돌려준다.
 * 키가 `settings.` 네임스페이스인 이유는 **설정 화면과 같은 칸**을 읽기 위해서다:
 * 팔레트·치트시트·설정이 한 액션을 서로 다른 이름으로 부르는 일이 없어야 한다
 * (docs/log/2026-09-17-i18n.md 의 "단축키 이름은 id 로 찾는다").
 *
 * 액션이 하나 늘었는데 사전에 칸이 비는 일은 `i18n.test.ts` 가 id 목록을 훑어 잡는다.
 */
export function actionLabel(id: string): ActionLabel {
  const n = /^workspace-([1-9])$/.exec(id)?.[1];
  if (n) return { key: "settings.keybinding.workspace", params: { n } };
  return { key: `settings.keybinding.${id}` as Key };
}

/**
 * 바인딩 가능한 액션 v1 목록.
 *
 * 기본값을 왜 이렇게 골랐는지는 개별 근거가 있다 — 예컨대 점프가 `Ctrl+↑/↓` 인 것은
 * 인텔 그래픽 드라이버가 `Ctrl+Alt+화살표` 를 화면 회전으로 OS 층에서 선점할 수 있기
 * 때문이다 (`term/key-handlers.ts` 의 doc-comment 참고). 2026-11-02 사용자 결정으로 `Ctrl+Alt+화살표` 는 **타일 크기 조절**의
 * 기본값이 됐다(아래 `expand-*` — 회전 핫키가 켜진 PC 에서는 설정에서 다시 묶는다).
 */
export const ACTIONS: readonly ActionDef[] = [
  // ── 터미널 (xterm 안에서 잡고, 셸로 새지 않게 소비한다) ──────────────────────
  { id: "jump-prev", scope: "terminal", def: "Ctrl+ArrowUp" },
  { id: "jump-next", scope: "terminal", def: "Ctrl+ArrowDown" },
  { id: "copy-output", scope: "terminal", def: "Ctrl+Shift+KeyC" },
  { id: "edit-remote", scope: "terminal", def: "Ctrl+Shift+KeyE" },
  // 이 타일의 **마지막 끝난 블록**을 AI 타일 입력 줄에 붙여 넣는다 (docs/log/2026-09-28-ask-ai-block.md).
  // `X` 인 이유: 목업의 자리표시자 `Ctrl+Shift+Y` 는 이미 "이 폴더의 지난 대화" 이고, 남은 `Ctrl+Shift`
  // 글자 중 `G` 는 브라우저 찾기 막대(`BROWSER_CHROME_COMBOS`)·`V` 는 붙여넣기다. 터미널 층이라 셸로 새지 않게 삼킨다.
  // 같은 조합을 **diff 타일**도 쓴다 — 포커스가 diff 타일에 있으면 그 타일이 제 keydown 에서 코멘트를 넘긴다(터미널 층
  // 조합이라 전역 표에 없어 겹치지 않는다 · docs/log/2026-10-05-diff-tile.md "2단계"). id 는 그대로다.
  { id: "ask-ai-block", scope: "terminal", def: "Ctrl+Shift+KeyX" },
  // ── 전역 (창 어디서든 잡는다 — Terminal 은 소비만 하고 +page 가 실행한다) ─────
  //
  // **id 는 `*-tab` 그대로이고 라벨도 이제 "탭" 이다** (docs/log/2026-09-03-workspaces-v1.md).
  // id 는 `settings.toml` 의 `[keybindings]` 키라 바꾸는 순간 사용자가 이미 저장해 둔
  // 오버라이드가 **조용히 기본값으로 돌아간다** (모르는 id 는 무시되므로 오류도 안 난다).
  // 개념 이름이 바뀌었다고 남의 설정 파일을 깨뜨릴 이유는 없다 — 화면에 보이는 것은 라벨뿐이다.
  { id: "new-tab", scope: "global", def: "Ctrl+Shift+KeyT" },
  { id: "close-tab", scope: "global", def: "Ctrl+Shift+KeyW" },
  // 설정에서 고른 **기본 셸**을 지금 탭에 연다 (`[shell] default` — 안 정했으면
  // 백엔드 기본인 pwsh). 상태바 `>_` 메뉴의 셸 줄과 **같은 경로**라 언제나 타일이 하나 는다(메뉴 없이 기본 셸 곧장):
  // "찾아서 포커스"(로컬 파일) 규칙을 쓰지 않는 이유는 셸이 **여러 개를 나란히 여는 것이
  // 정상**인 유일한 타일이기 때문이다 — 두 번째 셸을 못 열면 단축키의 뜻이 사라진다.
  //
  // `Ctrl+Shift+N`: 위 `new-tab`(새 탭)의 짝으로 읽히는 자리이고, N 을 쓰는 기본값이
  // 달리 없다. Windows Terminal 의 `Ctrl+Shift+N`(새 창)과는 뜻이 다르지만 이 앱에는
  // "새 창" 액션 자체가 없다 (창은 탭을 찢어 만든다 — docs/log/2026-09-02-tear-out.md).
  { id: "new-shell", scope: "global", def: "Ctrl+Shift+KeyN" },
  // **포커스된 타일 하나를 닫는다** — 헤더 `×` 와 정확히 같은 경로다. 무엇이든 닫는다:
  // 로컬 셸·SSH(살아 있든, 접속에 실패했든)·설정·브라우저 타일 전부. 확인창은 없다
  // (× 도 안 묻는다). 마지막 타일이었으면 탭이 함께 닫히는 규칙도 그대로다.
  //
  // `Ctrl+D` 와의 분담: 저쪽은 **세션이 없는 타일**에서만 도는 셸 관용구라(살아 있는 셸에서는
  // EOF 여야 한다) 살아 있는 터미널을 닫지 못한다. 이 액션은 그 구멍을 메운다 — `exit` 가
  // 안 먹는 셸(cmd)이나 붙어 있는 SSH 를 키보드만으로 닫는 유일한 길이다.
  //
  // `Ctrl+Shift+W` 가 아니라 **Q** 인 이유: W 는 이미 탭 닫기다. 브라우저 관습
  // (Ctrl+W = 탭, Ctrl+Shift+W = 창)을 따르면 "작은 것 = W" 여야 하지만 그 자리는 이 앱에서
  // 이미 임자가 있고, 남의 설정 파일에 저장된 오버라이드를 깨면서까지 바꿀 값이 아니다.
  // (Windows Terminal 의 `Ctrl+Shift+W`(창 닫기)와도 뜻이 다르니 겹치지 않는 편이 낫다.)
  { id: "close-tile", scope: "global", def: "Ctrl+Shift+KeyQ" },
  { id: "next-tab", scope: "global", def: "Ctrl+Tab" },
  { id: "prev-tab", scope: "global", def: "Ctrl+Shift+Tab" },
  { id: "split", scope: "global", def: "Ctrl+Shift+KeyD" },
  // 설정은 타일이 아니라 **떠 있는 층(독)을 토글한다** (docs/log/2026-09-08-settings-dock.md).
  { id: "open-settings", scope: "global", def: "Ctrl+Comma" },
  // 호스트만 다르다: 타일이 아니라 **떠 있는 층(독)을 토글한다** — 같은 키로 열고 닫는다
  // (docs/log/2026-09-08-hosts-dock.md). 2026-09-25 부터 독의 칸은 **한 독의 칸들**이다
  // (docs/log/2026-09-25-unified-dock.md): 아래 셋(호스트 H · 프로젝트 J · DB K)은 독을 그 칸으로 열고,
  // 그 칸이 떠 있으면 닫고, 다른 칸이 떠 있으면 여닫이 없이 칸만 바꾼다. 라벨은 그래서
  // "독: 호스트" 처럼 **독의 어느 칸**을 말한다. id 는 `settings.toml` 의 키라 **바꾸지 않는다**
  // (`*-tab` 과 같은 이유: 바꾸면 저장해 둔 오버라이드가 조용히 날아간다).
  //
  // **예외 한 번(2026-10-21 사용자 승인)**: `open-hosts` · `open-projects` 를 `-dock` 으로 옮겼다 — 독 칸 id 를
  // `open-*-dock` 하나로 통일(팔레트 전용 `open-db-dock` · `open-alerts-dock` 과 나란히). 릴리스 · 개발 `settings.toml`
  // 어디에도 두 id 의 오버라이드가 없음을 사용자가 확인해 옛 id 별칭(이관)은 두지 않는다.
  { id: "open-hosts-dock", scope: "global", def: "Ctrl+Shift+KeyH" },
  // 프로젝트 독 — 호스트 독의 형제다 (같은 층 · 같은 토글 규칙 ·
  // docs/log/2026-09-24-projects.md). 처음에는 호스트 독 맨 위의 가짜 폴더였다가 사용자
  // 피드백(2026-09-24, "프로젝트는 호스트 독에 속하지 않는다")으로 자기 독을 얻었다.
  //
  // **`Ctrl+Shift+J` 인 이유**: "P(roject)" 는 팔레트가 쥐고 있고, 남은 `Ctrl+Shift+…` 글자는
  // G·J·U·V·X·Y 뿐이다. G 는 웹뷰의 찾기 막대라 `BROWSER_CHROME_COMBOS` 에서 막는 조합이고,
  // V 는 터미널의 "서식 없이 붙여넣기" 관례, U 는 리눅스 IBus 의 유니코드 입력(세 OS 목표라
  // 피한다)이다. J 는 **H·J·K 가 홈 줄에 나란한** 자리라 여는 독 칸 셋(호스트 H · 프로젝트 J ·
  // DB K)이 손가락 하나 간격으로 모인다. Chromium 의 `Ctrl+Shift+J`(개발자 도구 콘솔)를
  // 가리게 되지만 개발자 도구는 F12 로 그대로 열린다(C·I 도 이미 앱이 쥐고 있어 같은 처지다).
  // Alt 가 없으니 `Ctrl+Alt+…` 규칙과도 무관하다. 토글이라 아래 `bypassesEditGuard` 에 든다.
  { id: "open-projects-dock", scope: "global", def: "Ctrl+Shift+KeyJ" },
  // DB 독 — 독의 DB 칸(2026-10-12 · 쿼리 타일의 연결 목록). 처음에는 단축키 없이 팔레트 줄 하나였다가
  // 2026-10-21 사용자 결정으로 `Ctrl+Shift+K` 를 받았다(팔레트 전용 id 를 그대로 레지스트리로 올렸다).
  //
  // **`Ctrl+Shift+K` 인 이유**: 홈 줄의 H · J 바로 옆이다. 예전 레이아웃 독의 조합이었고, 그 독이 걷힌 뒤로는
  // `BROWSER_CHROME_COMBOS` 가 재사용 전까지 삼키던 자리다(이제 이 액션이 앞에서 잡는다). Chromium 가속키와도,
  // `Ctrl+Alt+…` 규칙과도 겹치지 않는다. 토글이라 아래 `bypassesEditGuard` 에 든다.
  { id: "open-db-dock", scope: "global", def: "Ctrl+Shift+KeyK" },
  // **채팅 독** (2026-10-23 — docs/log/2026-10-23-side-chat-dock.md) — 런처 독의 반대쪽 창 끝에 서는 떠 있는 층을 여닫는다(주 창만).
  // **`Ctrl+Shift+[`(BracketLeft) 인 이유**(2026-11-15 사용자 결정 — 그 전에는 `Ctrl+Shift+'`): 아래 작업안 `Ctrl+Shift+]` 와 한 쌍의
  // 괄호로 외운다 — 채팅 독의 두 갈래가 왼쪽 `[` 채팅 · 오른쪽 `]` 작업안(갈래 단추의 순서와 같다). `Ctrl+Shift+글자` 는 V(붙여넣기 관례) ·
  // S(폐기된 배치 저장 — `BROWSER_CHROME_COMBOS` 가 삼키는 자리)를 빼고 전부 임자가 있고, 기호 중 `.`(파일 열기) · `;`(스니펫) ·
  // `/`(도움말) · `\`(대화 면 넘기기)도 찼다. `[` 는 이 앱의 기본값 어디에도 없고 Chromium 가속키도 아니며 막는 목록에도 없다.
  // **Shift 가 있어야 앱 몫이다** — `Ctrl+[`(Shift 없음)는 터미널에서 ESC 와 같은 키라 묶지 않는다: 조합 문자열이 Shift 를 가르므로
  // (`comboFromEvent`) `Ctrl+BracketLeft` 는 표에 없어 그대로 셸로 간다. 문서 · SQL 편집기 안에서도 먹는다(`Ctrl+Shift+…` 는
  // `appKeepsInEditor` — 편집기의 `Ctrl+Shift+[` 접기는 캡처 단계가 비켜 세운다). 한글 자판에서도 같은 물리 키라 `ev.code` 로 같다.
  // Alt 가 없으니 `Ctrl+Alt+…` 규칙과도 무관하다. 토글이라 아래 `bypassesEditGuard` 에 든다.
  // id 는 `settings.toml` 키라 **바꾸지 않는다**.
  { id: "open-chat-dock", scope: "global", def: "Ctrl+Shift+BracketLeft" },
  // SFTP 브라우저는 **로컬 파일과 달리 "찾아서 포커스" 가 아니다** — 세션을 빌려 오는
  // 타일이라 "어느 터미널의 것인가" 가 정체성의 일부이고, 그래서 언제나 **포커스된 터미널
  // 옆에** 새로 열린다 (docs/log/2026-09-03-sftp-browser-tile.md).
  //
  // **로컬 셸 타일에서도 같은 키다** — 그때 열리는 것은 그 셸이 지금 있는 폴더의 로컬 파일
  // 타일이다 (docs/log/2026-09-08-local-cwd-folder.md). 라벨이 괄호 안에 둘을 다 적는 이유가
  // 그것이다: 하나의 조작이고 대상만 타일을 따라간다. 터미널 타일이 아니면 안내만 한다.
  //
  // 기본값이 **`Ctrl+Shift+F` 에서 `Ctrl+Shift+O` 로 옮겨졌다** — 아래 `find-all`(모든
  // 터미널에서 찾기)에 `Ctrl+Shift+F` 를 넘겨주기 위해서다. 찾기 쪽이 `Ctrl+F`/`Ctrl+Shift+F`
  // 한 쌍으로 읽혀야 뜻이 서는 반면(터미널 앱의 압도적 관례), SFTP 의 `F` 는 "File" 의 첫
  // 글자였을 뿐 관례가 걸린 자리가 아니었다. 새 자리 **O 는 "Open"** 이고, 이 앱의 기본값
  // 어디에도 O 를 쓰는 액션이 없었다 (열기 무리의 N·H·L·A 와 나란히 선다).
  //
  // **id 는 그대로다** (라벨만 로컬 셸까지 아우르게 바꿨다). 이미 `settings.toml` 에
  // `open-sftp` 오버라이드를 저장해 둔 사용자는 아무것도 잃지 않는다 — 오버라이드가 기본값을 이기므로(`effectiveCombo`) 그
  // 사람의 손가락에는 이 이사가 보이지 않는다. 바뀌는 것은 오버라이드가 없는 사람뿐이다.
  { id: "open-sftp", scope: "global", def: "Ctrl+Shift+KeyO" },
  // 로컬 파일 브라우저는 **설정·호스트 쪽 규칙**이다 (찾아서 포커스, 없으면 연다) —
  // 빌릴 세션이 없어 "어느 터미널의 것인가" 라는 정체성 자체가 없고, 이 컴퓨터의 디스크는
  // 하나뿐이라 탭에 두 개를 두어야 할 이유가 단축키 쪽에는 없다 (2026-09-25 부터는
  // 이 단축키도 언제나 새로 연다 — docs/log/2026-09-25-localfs-always-new.md).
  //
  // `Ctrl+Shift+L` 은 위·아래 어느 액션과도 겹치지 않는다 (L 을 쓰는 기본값이 없다).
  { id: "open-localfs", scope: "global", def: "Ctrl+Shift+KeyL" },
  // id 는 `ai-panel` 그대로 — `settings.toml` 의 키라 바꾸면 저장해 둔 오버라이드가 조용히
  // 날아간다 (위 `*-tab` 과 같은 이유). 라벨만 실제로 여는 것의 이름으로 바꾼다.
  { id: "ai-panel", scope: "global", def: "Ctrl+Shift+KeyA" },
  // **세션 목록** — 타일 캔버스 위쪽에서 내려오는 세션 목록 판을 토글한다(2026-10-07). id 는 관리뷰(오른쪽 상태판,
  // docs/log/2026-09-09-management-view.md) → 전체 화면 대시보드 시절의 `open-console` 그대로다 — `settings.toml`
  // 키라 바꾸면 저장해 둔 오버라이드가 조용히 날아간다. 대시보드가 세션 시트와 작업안 타일로 나뉘며 이 키는 자주 ·
  // 짧게 보는 쪽(세션)을 받았고 라벨만 "세션 목록" 이 됐다. `Ctrl+Shift+M` 은 이 앱의 기본값 어디에도 M 을 쓰는
  // 액션이 없어 비어 있고("Monitor" 의 첫 글자), `Ctrl+Alt+…` 규칙과도 무관하다. 토글이라 아래
  // `bypassesEditGuard` 에도 넣는다 — 같은 키로 열고 닫혀야 한다.
  { id: "open-console", scope: "global", def: "Ctrl+Shift+KeyM" },
  // **작업안** — 채팅 독의 작업안 갈래를 토글한다(2026-10-07 대시보드의 작업안 칸 → 작업안 타일 → 2026-10-25 채팅 독의 갈래 ·
  // id 는 `settings.toml` 키라 그대로). 팔레트 줄이 같은 몸통이다(`app/plans.svelte.ts` 의 `togglePlans`).
  //
  // **`Ctrl+Shift+]`(BracketRight) 인 이유**(2026-11-15 사용자 결정 — 그 전에는 잠깐 `Ctrl+Alt+Shift+'`, 더 전에는 기본 조합이 없었다):
  // 작업안은 채팅 독의 갈래라 채팅 독 `Ctrl+Shift+[` 와 한 쌍의 괄호로 외운다 — 왼쪽 `[` 채팅 · 오른쪽 `]` 작업안. 수식 키는 셋까지
  // (키 넷은 싫다 — 사용자). `]` 는 이 앱의 기본값 어디에도 없고 Chromium 가속키도 아니며 막는 목록에도 없다. 채팅 독 키와 같은 까닭으로
  // `Ctrl+]`(Shift 없음 — 터미널의 0x1D, telnet 탈출 등)는 묶지 않아 그대로 셸로 가고, 문서 · SQL 편집기 안에서도 먹는다(`appKeepsInEditor`).
  // 한글 자판에서도 같은 물리 키라 `ev.code` 로 같다. 토글이라 `bypassesEditGuard` 에 든다(기록 보기의 검색 칸에서도 닫힌다).
  { id: "open-plans", scope: "global", def: "Ctrl+Shift+BracketRight" },
  // **이 폴더의 지난 대화** — 포커스된 타일이 있는 폴더(워크트리)의 지난 Claude · Codex 대화를 팔레트 자리에
  // 불러 **그 타일 옆에 분할로** 연다 (docs/log/2026-09-27-folder-conversations.md). 팔레트의 같은 이름 줄도 이
  // 액션이다. `Ctrl+Shift+Y` 인 이유: 남은 `Ctrl+Shift+…` 글자는 G·U·V·X·Y 뿐이고(J 는 프로젝트 독이 가져갔다)
  // G 는 웹뷰 찾기 막대(`BROWSER_CHROME_COMBOS`), V 는 터미널의 "서식 없이 붙여넣기" 관례, U 는 리눅스 IBus 의
  // 유니코드 입력(세 OS 목표라 피한다), X 는 잘라내기 관례와 겹쳐 보인다. Y 는 이 앱의 기본값 어디에도 없고
  // Chromium 가속키와도 겹치지 않는다. Alt 가 없으니 `Ctrl+Alt+…` 규칙과도 무관하다.
  { id: "folder-conversations", scope: "global", def: "Ctrl+Shift+KeyY" },
  // **파일 열기…** — 포커스된 타일의 폴더(터미널 cwd · 파일 타일 · 문서의 폴더 · 프로젝트)를 훑어 고른 파일을
  // 문서 보기로 연다 (docs/log/2026-09-27-doc-tile.md "A — 여는 길"). 팔레트의 같은 이름 줄도 이 액션이다.
  //
  // **`Ctrl+Shift+Period` 인 이유**: 편집기의 관례(`Ctrl+P` · VS Code "Quick Open")는 readline 의 "이전 명령"이라
  // 팔레트가 이미 물러선 자리이고, 남은 `Ctrl+Shift+글자` 는 G·U·V·X 뿐인데 넷 다 위(`folder-conversations`)에서
  // 적은 이유로 피한다. 글자 아닌 키 중 `;`(스니펫) · `/`(치트시트) · `[` `]`(타일 성질) · `,`(설정)는 임자가
  // 있고, `.` 은 이 앱의 기본값 어디에도 없으며 Chromium 가속키 · 셸 관례와도 겹치지 않는다(점 = 파일 이름의
  // 확장자 앞 글자로 외운다). Alt 가 없으니 `Ctrl+Alt+…` 규칙과도 무관하다. 목록 자신이 같은 키로 닫는다(토글).
  { id: "open-file", scope: "global", def: "Ctrl+Shift+Period" },
  // **테마 프로필 전환** — 타일 캔버스 위 가장자리에서 프로필 카드 줄이 내려오고, ←/→ 로 골라 Enter 로 갈아 끼운다
  // (docs/log/2026-09-28-profile-switcher.md). 팔레트의 같은 이름 줄도 이 액션이다. 09-15 로그의 "단축키는 없다" 를
  // 사용자 결정으로 뒤집었다 — 번호를 외우는 키가 아니라 **고르는 줄을 여는** 키라 그때의 반대 이유가 닿지 않는다.
  //
  // **`Ctrl+Shift+U` 인 이유**: 남은 `Ctrl+Shift+글자` 는 G·U·V·X 뿐이다. G 는 웹뷰 찾기 막대(`BROWSER_CHROME_COMBOS`),
  // V 는 터미널의 "서식 없이 붙여넣기" 관례, X 는 잘라내기 관례와 겹쳐 보인다. U 는 위(`folder-conversations`)에서
  // **리눅스 IBus 의 유니코드 입력**이라 피했던 자리다 — 그 겹침은 리눅스 + IBus 에서만 생기고(지금 빌드는 Windows
  // 뿐이다), 이 줄은 설정 › 단축키에서 옮길 수 있으며, 모양 전환은 하루 몇 번 누르는 키라 사용자 결정으로 받는다.
  // Chromium 가속키(`Ctrl+U` 소스 보기는 Shift 가 없다)와는 겹치지 않고, Alt 가 없으니 `Ctrl+Alt+…` 규칙과도 무관하다.
  // 떠 있는 동안에는 카드 줄이 같은 키를 보고 닫는다(토글). id 는 `settings.toml` 키라 **바꾸지 않는다**.
  { id: "switch-profile", scope: "global", def: "Ctrl+Shift+KeyU" },
  { id: "switch-workspace", scope: "global", def: "Ctrl+Shift+KeyG" },
  // **이전·다음 워크스페이스** — 목록 순서로 곧장 옮긴다(끝에서 처음으로 순환 · docs/log/2026-10-05-workspace-next-prev.md).
  // `Ctrl+PageDown`/`Ctrl+PageUp` 은 브라우저·VS Code 의 "탭 넘기기" 관례이고 이 앱의 기본값 어디에도 없다(탭 넘기기는
  // `Ctrl+Tab` 이 쥐었다). 웹뷰엔 탭이 없어 Chromium 쪽 뜻도 비어 있고, 문서 편집기 안에서도 앱이 쥔다
  // (`appKeepsInEditor`). 잃는 것: 터미널 안 프로그램이 받던 `Ctrl+PgUp/PgDn`(터미널 vim 의 탭 넘기기 등) — 설정에서 옮긴다.
  // Alt 가 없으니 `Ctrl+Alt+…` 규칙과도 무관하다. id 는 `settings.toml` 키라 바꾸지 않는다.
  { id: "next-workspace", scope: "global", def: "Ctrl+PageDown" },
  { id: "prev-workspace", scope: "global", def: "Ctrl+PageUp" },
  { id: "toggle-sync", scope: "global", def: "Ctrl+Shift+KeyI" },
  // 프라이버시 잠금(가림막) — 화면 전체를 흐리게 덮고 **볼트도 함께 잠근다**. `Ctrl+Shift+B`
  // 의 B 는 "Blur" 라 외우기 쉽고, 이 앱의 기본값 어디에도 B 를 쓰는 액션이 없어 비어 있다.
  // **켜기만 하는 키다** — 걷는 문은 가림막 위의 관문 하나뿐이다(`Veil.svelte`). id 는
  // `settings.toml` 키라 `toggle-veil` 그대로 둔다(docs/conventions.md 의 "id 는 안 바뀐다").
  // 아래 `bypassesEditGuard` 에도 넣는다 — 포커스가 어느 입력칸·터미널에 있든 켜져야 한다.
  { id: "toggle-veil", scope: "global", def: "Ctrl+Shift+KeyB" },
  // **끝내기** — 독 머리 줄의 끝내기 단추와 같은 일(끝내기 모달 `app/quit-dialog` — 판을 고르는 것이 곧 확인이라 키 하나로 끝나지는
  // 않는다). 원격 창에서는 아무 일도 없다(단추가 없는 것과 같은 판단 — 세 명령도 집 PC 전용이다, `remote/deny.rs`).
  //
  // **`Ctrl+Shift+F4` 인 이유**: `Alt+F4`(창 닫기 — OS) · `Ctrl+F4`(문서 · 탭 닫기 관례)의 "닫는 F4" 무리이고, 둘 다 건드리지
  // 않는다. 남은 `Ctrl+Shift+글자` 는 다 막혀 있고(위 `folder-conversations` · `open-file` 주석) 기능 키는 이 앱의 기본값에
  // F9 · F11(파일 타일)뿐이며 쿼리 트리의 `F4`(DDL 보기)는 수식 키 없는 단독 키라 겹치지 않는다. Chromium 가속키 · 막는 목록에도
  // 없고, Alt 가 없으니 `Ctrl+Alt+…` 규칙과도 무관하다. id 는 `settings.toml` 키라 **바꾸지 않는다**.
  { id: "quit-app", scope: "global", def: "Ctrl+Shift+F4" },
  // 명령 팔레트 — 이 목록의 **나머지 전부로 가는 문**이다 (docs/log/2026-09-03-command-palette.md).
  //
  // 기본값이 **`Ctrl+Shift+P`** 인 것은 VS Code·Windows Terminal 의 관례를 그대로 따른 것이고,
  // 무엇보다 `Ctrl+P` 를 **셸에게 돌려주기 위해서**다: `Ctrl+P` 는 readline 의 "이전 명령"
  // (bash·zsh·psql·python REPL 전부)이라 전역 조합으로 잡아 버리면 터미널 안에서 셸이 그
  // 키를 통째로 잃는다 — 전역 조합은 `handleShortcut` 이 삼켜 pty 로 보내지 않기 때문이다.
  // 팔레트는 한 손이 덜 가는 대신 남의 키를 뺏는 자리에 둘 물건이 아니다. 3-키가 되어도
  // 관례와 겹쳐 오히려 외우기 쉽고, 셸 쪽 `Ctrl+P` 는 원래대로 이력을 거슬러 올라간다.
  { id: "command-palette", scope: "global", def: "Ctrl+Shift+KeyP" },
  // ── 텍스트 찾기 — 터미널 화면·스크롤백 · 포커스된 타일 안 ─────────────────────────────
  //
  // 팔레트(바로 위)와 **다른 물건**이다: 팔레트는 *앱의 기능*을 찾고, 이쪽은 터미널에
  // 실제로 출력된 *텍스트*를 화면과 스크롤백에서 찾는다. 이름이 비슷해 한 무리로 보이지만
  // 찾는 대상이 겹치지 않으므로 키도 따로 둔다.
  //
  // ## `Ctrl+F` 를 전역으로 잡는다 — 팔레트와 **반대 방향**의 판단이다
  //
  // 바로 위 `command-palette` 는 `Ctrl+P` 를 셸에게 돌려주려고 일부러 3-키(`Ctrl+Shift+P`)로
  // 물러섰다. 여기서는 반대로 간다. 전역 조합은 `handleShortcut` 이 삼켜 pty 로 보내지
  // 않으므로 `Ctrl+F` 를 잡는 순간 셸·vim 이 그 키를 통째로 잃는다 — 구체적으로 readline 의
  // `Ctrl+F`(커서 한 칸 전진)와 vim 의 `Ctrl+F`(페이지 다운)다.
  //
  // 그런데도 잡는 이유 둘:
  //  1. **관례의 무게가 반대다.** 터미널 앱에서 찾기는 `Ctrl+F` 가 압도적이다 (Windows
  //     Terminal · VS Code 통합 터미널). `Ctrl+P` 는 셸 쪽 관례가 더 셌지만 `Ctrl+F` 는
  //     터미널 앱 쪽 관례가 더 세다 — 같은 저울로 재서 반대쪽으로 기운 것이다.
  //  2. **잃는 두 키에 대체 수단이 있다.** 커서 전진은 `→`, 페이지 다운은 `PageDown` 이
  //     그대로 한다. 팔레트가 뺏었을 `Ctrl+P`(이전 명령)에는 그런 짝이 없었다.
  //
  // 그래도 이것은 **되돌릴 수 있는 결정**이다 — vim 안에서 사는 사람은 설정 › 단축키에서
  // 이 줄을 비우거나 다른 조합으로 옮기면 `Ctrl+F` 가 곧장 셸로 돌아간다.
  //
  // ## 둘로 나눈 이유 (범위 모드)
  //
  // `find` 는 **포커스된 터미널이 있으면 `@그이름 ` 을 미리 채워** 그 터미널 하나로 범위를
  // 좁힌 채 열린다 (없으면 전체). 눈앞의 화면에서 찾는 것이 압도적으로 흔한 쓰임이라
  // 기본을 그쪽에 둔 것이고, 접두사는 지우면 그만이라 전체로 넓히는 길도 한 동작이다.
  // `find-all` 은 **언제나 전체·빈 질의**다 — "어느 서버였더라" 를 묻는 반대쪽 쓰임이라
  // 포커스가 무엇이든 결과가 같아야 한다.
  //
  // ## `find` = 이 타일 고유의 찾기 · 거르기 (2026-10-19 사용자 결정)
  //
  // 같은 id 하나를 **포커스된 타일의 종류**로 가른다 — 판정은 타일 자신이 하고 문은 하나다(`app/tile-find.ts`). 새 id 를
  // 만들지 않는 이유: settings.toml 에 줄이 늘고, `find` 를 다시 묶어 둔 사람의 조합이 어떤 타일에서만 안 먹는다.
  //  - 터미널(로컬 · SSH · AI 타일의 터미널 면): 위의 범위 칩 검색 그대로.
  //  - AI 타일의 **대화 면**: 대화 기록 안 찾기 띠(`pane/AiFlip` — 밀려 난 터미널의 버퍼를 찾지 않는다).
  //  - 파일 타일: 이름 거르기 줄(`files-filter` 와 같은 일 — `Ctrl+I` 는 별칭으로 남는다).
  //  - 문서 타일: 문서 안 찾기 띠(편집 중이면 편집기의 검색 패널).
  //  - 쿼리 타일: SQL 편집기 안은 편집기의 검색 패널(`editorOwnsKey`), 결과 칸이면 결과 표 찾기, 그 밖이면 스키마 트리 거르기 칸.
  //  - diff 타일: 펼친 패치 안 찾기 띠.
  //  - 그 밖(브랜치 · 작업안 · 보드 · 시작 타일 · 포커스 타일 없음): 모든 터미널 검색.
  // 찾기 띠는 하나의 모양 · 키다(`FindBar` — Enter/F3 다음 · Shift+Enter/Shift+F3 이전 · Esc 닫기). `find-all` 은 여전히
  // 포커스와 무관하게 모든 터미널 검색이다.
  //
  // ## 자리
  //
  // 짝이 `Ctrl+F` / `Ctrl+Shift+F` 인 것도 같은 관례다 (좁게 ↔ 넓게 = Shift 하나).
  // `Ctrl+Shift+F` 는 위 `open-sftp` 가 `Ctrl+Shift+O` 로 비켜 주어 빈 자리가 됐다.
  // 둘 다 Alt 가 없어 인텔 그래픽 드라이버의 화면 회전 핫키(`Ctrl+Alt+화살표`)와 애초에 겹칠 수 없다.
  // ── 스니펫 삽입 (docs/log/2026-09-16-snippets.md) ─────────────────────────────
  //
  // 저장해 둔 명령 하나를 **포커스된 터미널**에 써 넣는다. 액션 하나가 "어느 스니펫" 을
  // 인자로 받을 수 없으므로(`save-layout` 이 저장만 액션인 것과 같은 사정) 이 키는 **고르는
  // 화면을 여는 문**이다 — 명령 팔레트를 **스니펫 접두사(`;`)가 찍힌 채로** 연다
  // (`app/overlays.svelte.ts` 의 `openSnippetPalette`). 목록을 글자로 좁혀 고르고 `Enter` 로
  // 넣는 것이 이 기능의 몸짓이고, 접두사를 지우면 그대로 전체 팔레트가 된다.
  //
  // **`Ctrl+Shift+Semicolon` 인 이유**: 남은 글자 키에 뜻이 닿는 것이 없다 — S 는 레이아웃
  // 저장, N 은 새 터미널, P 는 팔레트, K 는 레이아웃 독이 이미 쥐고 있다. 반대로 `;` 는
  // 이 앱의 기본값 어디에도 없고 Chromium 가속키에도 없으며, 괄호 한 쌍(`[`·`]`)이 타일의
  // 성질 둘을 받은 것과 같은 결로 **글자 아닌 키**를 쓴다. `Ctrl+Alt+…` 규칙과도 무관하다
  // (Alt 가 없으니 인텔 그래픽 드라이버의 화면 회전 핫키와 겹칠 수 없다). 팔레트의 접두사가
  // **같은 글자**인 것도 여기서 온다 (`SNIPPET_QUERY_PREFIX`).
  { id: "insert-snippet", scope: "global", def: "Ctrl+Shift+Semicolon" },
  { id: "find", scope: "global", def: "Ctrl+KeyF" },
  { id: "find-all", scope: "global", def: "Ctrl+Shift+KeyF" },
  // 배치 복원으로 뜬 SSH 타일은 **연결되지 않은 채** 기다린다 (docs/log/2026-09-03-workspace-restore.md).
  // 이 키가 그것들을 한꺼번에 — 120ms 간격의 계단식으로 — 붙인다. 타일마다 [연결] 을
  // 누르는 것이 원래 경로이고, 이 키는 "아침에 앱을 켜고 어제 배치를 통째로 되살리는" 동작이다.
  { id: "reconnect-all", scope: "global", def: "Ctrl+Shift+KeyR" },
  // ── 타일 사이 포커스 이동 (docs/log/2026-09-03-keys-ended-focus.md) ──────────
  //
  // `Alt+화살표` 다. **`Ctrl+Alt+화살표` 가 아닌 이유**는 위 점프 기본값과 같다 — 윈도의
  // 인텔 그래픽 드라이버가 그 조합을 화면 회전 핫키로 OS 층에서 선점할 수 있다(그 조합은 아래 확장이 쓴다 — 2026-11-02).
  // `Alt+화살표` 는 셸에서 거의 쓰이지 않고(bash 의 단어 이동은 `Alt+B`/`Alt+F` 다),
  // 전역 조합이라 터미널이 삼켜 셸로 새지도 않는다.
  { id: "focus-left", scope: "global", def: "Alt+ArrowLeft" },
  { id: "focus-right", scope: "global", def: "Alt+ArrowRight" },
  { id: "focus-up", scope: "global", def: "Alt+ArrowUp" },
  { id: "focus-down", scope: "global", def: "Alt+ArrowDown" },
  // ── 타일 이동 (docs/log/2026-09-04-tiling-move-resize.md) ────────────────────
  //
  // `Alt+Shift+화살표` — **포커스 이동(`Alt+화살표`)에 Shift 를 더한 것**이다. 두 동작의
  // 관계가 그대로 손가락에 남는다: 같은 방향키, 같은 Alt, "가는" 것과 "들고 가는" 것의
  // 차이가 Shift 하나다 (i3·sway·Pop Shell 이 전부 이 관습이다).
  //
  // Hyprland `movewindow` 와 같다 — 떼었다가 그쪽 칸을 쪼개 다시 끼운다 (`movePaneDwindle` · docs/log/2026-11-05-hyprland-tiling.md).
  { id: "move-left", scope: "global", def: "Alt+Shift+ArrowLeft" },
  { id: "move-right", scope: "global", def: "Alt+Shift+ArrowRight" },
  { id: "move-up", scope: "global", def: "Alt+Shift+ArrowUp" },
  { id: "move-down", scope: "global", def: "Alt+Shift+ArrowDown" },
  // ── 타일 크기 조절 — 분할선을 민다 (docs/log/2026-11-05-hyprland-tiling.md) ──
  //
  // **`Ctrl+Alt+화살표` 다(2026-11-02 사용자 결정 — 예전 `Ctrl+Shift+화살표`).** `Ctrl+Shift+←/→` 는 PSReadLine · 셸 · TUI · 글 칸의
  // **낱말 고르기**라 자주 쓰는 키를 앱이 빼앗고 있었다 — 돌려준다(이제 터미널에서는 셸로, 글 칸에서는 낱말 고르기로 간다).
  // 알고 받은 위험: 인텔 그래픽 드라이버의 화면 회전 핫키가 켜진 PC 에서는 OS 가 이 조합을 선점해 앱까지 오지 않는다(최신 드라이버는
  // 대개 꺼져 있다 — 사용자 PC Intel Arc 140V) — 그런 PC 에서는 설정 › 단축키에서 다시 묶는다. 점프(`Ctrl+↑/↓`) · 포커스(`Alt+화살표`)는 그대로.
  // **Windows Terminal 은 크기 조절에 `Alt+Shift+화살표` 를 쓰지만** 여기서는 그 조합을 위의 이동에 줬다 — 이동이 포커스 이동(`Alt+화살표`)과
  // 짝이라 그쪽의 자리값이 더 크다. 둘 다 설정에서 바꿀 수 있다.
  //
  // Hyprland `resizeactive` 와 같다 — 그 축의 가장 가까운 분할선을 방향키 쪽으로 민다 (`resizePaneStep`). id 의 `expand` 는
  // 옛 이름이지만 `settings.toml` 키라 그대로 둔다.
  { id: "expand-left", scope: "global", def: "Ctrl+Alt+ArrowLeft" },
  { id: "expand-right", scope: "global", def: "Ctrl+Alt+ArrowRight" },
  { id: "expand-up", scope: "global", def: "Ctrl+Alt+ArrowUp" },
  { id: "expand-down", scope: "global", def: "Ctrl+Alt+ArrowDown" },
  // ── 타일 최대화 (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md) ─────
  //
  // 포커스 타일 하나를 탭 캔버스 전체로 키웠다가, 같은 키로 원래 배치로 되돌린다.
  // **트리를 건드리지 않는 화면 상태**라 최대화 중에도 세션은 전부 살아 있고, 되돌리면
  // 분할선 비율까지 그대로다.
  //
  // `Ctrl+Shift+Z` 인 이유: 타일 조작 3-키 무리(`Ctrl+Shift+…`) 안에서 Z 를 쓰는 기본값이
  // 달리 없고, "zoom" 의 첫 글자라 외우기 쉽다. `Ctrl+Z`(실행 취소)와는 Shift 하나로
  // 갈리지만 이 앱에는 실행 취소 액션 자체가 없어 뜻이 겹치지 않는다 — 터미널 쪽 `Ctrl+Z`
  // (SIGTSTP)는 전역 레지스트리에 없으므로 그대로 셸로 간다.
  { id: "zoom-tile", scope: "global", def: "Ctrl+Shift+KeyZ" },
  // ── AI 타일 [터미널 | 대화] 넘기기 (2026-10-17 — `pane/AiFlip`) ─────────────
  //
  // 포커스된 AI 타일(Claude Code · Codex)을 같은 타일 안에서 대화 면으로 넘기고, 같은 키로 돌아온다. 화면 상태라 세션은
  // 그대로다. `Ctrl+Shift+\` 인 이유: `Ctrl+Shift+글자` 는 V(붙여넣기)를 빼고 전부 임자가 있고(S · K 는 폐기 조합을 삼키는
  // 자리), 기호 중 `.`(파일 열기) · `;`(스니펫) · `/`(도움말) 도 찼다. `\` 는 비어 있고 브라우저 가속키도 아니다. 한글 자판에선
  // 같은 물리 키가 `₩` 로 찍히지만 `ev.code`(Backslash)로 잡으므로 같다.
  { id: "flip-convo", scope: "global", def: "Ctrl+Shift+Backslash" },
  // ── 단축키 치트시트 (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md) ─
  //
  // 이 레지스트리 전체 + 레지스트리에 없는 고정 키(탐색기 타일·마우스 몸짓)를 한 장에
  // 펴 놓은 오버레이다. 팔레트가 "액션을 실행하는 길" 이라면 이쪽은 **읽는 길**이다.
  //
  // `Ctrl+Shift+Slash`(= Ctrl+?) 는 관례 그대로이고 겹치는 기본값이 없다. 여기에 더해
  // **`?` 단독**(수식 키 없음)도 문을 연다 — 다만 포커스가 터미널·입력칸·인라인 편집이
  // 아닐 때만이다 (그 판정은 `+page` 의 `handleCheatSheetKey`). 레지스트리에 두 조합을
  // 담을 자리가 없어 `?` 쪽은 코드에 고정이고, 설정에서 바꾸는 것은 이 줄 하나다.
  { id: "cheat-sheet", scope: "global", def: "Ctrl+Shift+Slash" },
  // ── 알림 위치로 가기 (docs/log/2026-10-05-go-to-alert.md) ──────────────────
  //
  // 에이전트 알림 배너의 [보기]·[확인하러 가기] 와 같은 일(`openAgentBanner`)을 키 하나로 한다 — 권한 물음이
  // 먼저, 같은 갈래는 최근 것이 먼저. 가면 그 알림이 해결되므로 다시 누르면 다음 알림으로 간다.
  //
  // **`Alt+Backquote` 인 이유**: 왼손 하나로 닿는 두 키 조합이고, 앱의 `Alt` 무리는 화살표·숫자뿐이라 겹치지
  // 않는다. `Ctrl+글자` 는 셸(readline)에 양보하고, `Ctrl+Shift+K` 는 옛 레이아웃 열기 자리라 브라우저 동작만
  // 막아 둔 채 비워 둔다. 일본어 배열에서는 이 자리가 반각/전각 키라 IME 전환과 겹친다 — 설정에서 옮긴다.
  { id: "go-to-alert", scope: "global", def: "Alt+Backquote" },
  // ── 탭 직접 전환 (Alt+1…9) ────────────────────────────────────────
  ...goToTabActions(),
  // ── 파일 타일 (그 타일이 활성일 때만 · docs/log/2026-10-07-file-tile-dolphin.md) ─────────────
  //
  // Dolphin·탐색기의 관례를 그대로 빌린다. 전역 층과 한 창 keydown 을 나눠 쓰므로 전역 기본값과 겹치지 않는
  // 조합만 고른다: 전역은 `Ctrl+Shift+…`·`Alt+…`·`Ctrl+Tab`·`Ctrl+PgUp/PgDn`·`Ctrl+F`·`Ctrl+,` 이고
  // `Ctrl+L`·`Ctrl+I`·`Ctrl+1/2/3`·`F9` 는 비어 있다(`Ctrl+Shift+I` 는 `toggle-sync` — Shift 가 다르다).
  // 터미널의 `Ctrl+L`(화면 지우기)과는 층이 달라 만나지 않는다 — 파일 타일이 활성이면 터미널에 포커스가 없다.
  // 브라우저 가속키와도 겹치지 않는다(웹뷰에는 `Ctrl+L` 의 주소창이 없다).
  //
  // 경로 칸 편집 — 빵부스러기가 경로 입력 칸으로 바뀐다(Esc 로 되돌림).
  { id: "files-location", scope: "files", def: "Ctrl+KeyL" },
  // 보기 셋 — 아이콘 · 간단히 · 자세히 (Dolphin 의 `Ctrl+1/2/3`). 전역의 탭 번호 선택은 `Alt+1…9` 라 겹치지 않는다.
  { id: "files-view-icons", scope: "files", def: "Ctrl+Digit1" },
  { id: "files-view-compact", scope: "files", def: "Ctrl+Digit2" },
  { id: "files-view-details", scope: "files", def: "Ctrl+Digit3" },
  // 장소 패널 켜고 끄기 (Dolphin 의 `F9`). 기능 키라 입력 칸·편집기와 겹칠 일이 없다.
  { id: "files-places", scope: "files", def: "F9" },
  // 필터 줄 — 이름으로 거르기 (Dolphin 의 `Ctrl+I`). 전역의 `Ctrl+Shift+I`(입력 동기화)와는 Shift 가 갈라 놓는다.
  { id: "files-filter", scope: "files", def: "Ctrl+KeyI" },
  // 미리 보기 패널 켜고 끄기 (Dolphin 정보 패널의 `F11`). 웹뷰는 `F11` 에 전체 화면을 걸지 않고, 이 앱 기본값에도 없다.
  { id: "files-preview", scope: "files", def: "F11" },
];

/**
 * `workspace-1` … `workspace-9` 아홉 줄을 만든다 (`Alt+Digit1` … `Alt+Digit9`).
 *
 * 손으로 아홉 줄을 적지 않는 이유는 오타 하나가 곧 **남의 설정 파일에 남는 죽은 id** 가
 * 되기 때문이다. id 형식은 `workspace-<1..9>` 로 못 박고 `+page` 의 디스패치도 같은
 * 정규식으로 읽는다. 9번째까지만 두는 것은 `Digit0` 이 "10번째" 인지 "0번째" 인지가
 * 앱마다 갈려 헷갈리기 때문이다 — 10번째부터는 `Ctrl+Tab`(다음 탭)으로 간다.
 *
 * **id 의 `workspace-` 는 옛 이름 그대로다** — 코드 이름은 2026-09-29 에 tab 으로 바꿨지만 이 id 는
 * `settings.toml` 의 `[keybindings]` 키라 바꾸면 사용자가 저장한 단축키가 조용히 사라진다
 * (docs/log/2026-09-29-workspace-to-tab.md · docs/conventions.md 의 "id 는 안 바뀐다").
 */
function goToTabActions(): ActionDef[] {
  return Array.from({ length: 9 }, (_, i) => ({
    id: `workspace-${i + 1}`,
    scope: "global" as const,
    def: `Alt+Digit${i + 1}`,
  }));
}

/**
 * 액션 id 가 `workspace-<1..9>` 면 그 번호, 아니면 `null`.
 *
 * 위 [`goToTabActions`] 가 만들어 내는 형식과 **같은 정규식**이다 — 디스패치가 아홉 개의
 * `case` 대신 이 한 줄을 지나므로, 형식을 고치면 만드는 쪽과 읽는 쪽이 같은 자리에서 깨진다.
 */
export function tabIndexOf(action: string): number | null {
  const m = /^workspace-([1-9])$/.exec(action);
  return m ? Number(m[1]) : null;
}

/**
 * 이 액션은 **입력칸 안에서도 통하는가** (편집 필드 가드를 지나가는가).
 *
 * 전역 단축키는 앱의 입력칸에서 타이핑 중이면 비켜 준다. 그런데 아래 넷은 **글자 키가
 * 아니고**(`Alt+화살표`·`Alt+Shift+화살표`·`Ctrl+Alt+화살표`(확장 — 2026-11-02 예전 `Ctrl+Shift+화살표`)·`Ctrl+Shift+Q`·`Ctrl+Shift+Z`)
 * 어떤 입력칸도 그 조합에 뜻을 두지 않는다. 막아 두면 오히려 나빴다 — 독의 검색
 * 칸에 커서가 들어가면 `Alt+→` 로 옆 타일에 나갈 수 없어 **타일 하나가 키보드의 함정**이
 * 된다 (docs/log/2026-09-04-tiling-move-resize.md · 2026-09-04-default-shell-close-tile.md).
 *
 * 닫기(`close-tile`)와 최대화(`zoom-tile`)가 같은 무리인 이유도 같다 — 특히 닫기는
 * **나가는 문**이라, 파일 타일 안에서 못 닫으면 키보드만으로 빠져나올 길이 없어진다.
 *
 * `open-hosts-dock`(옛 `open-hosts`)·`open-settings` 는 **토글이 되면서** 이 무리에 들어왔다
 * (docs/log/2026-09-08-hosts-dock.md · docs/log/2026-09-08-settings-dock.md). 호스트 독은
 * 열리는 순간 트리의 **검색 칸에 커서를 놓고**, 설정 모달은 커서를 놓지 않지만 **안이 온통
 * 입력칸**이다 — 어느 쪽이든 가드에 걸어 두면 칸을 하나 만진 뒤에는 같은 키로 닫을 수 없다.
 * 여는 키가 닫지 못하는 토글은 토글이 아니다.
 *
 * 인라인 편집기(이름 변경 칸·기록 중인 단축키 버튼)는 이 목록과 무관하게 **어느 액션에도**
 * 양보하지 않는다 — 그 자리는 조합 자체를 받아 적는 임시 대화다.
 */
export function bypassesEditGuard(action: string): boolean {
  return (
    action === "close-tile" ||
    action === "zoom-tile" ||
    action === "open-hosts-dock" ||
    // 프로젝트 독도 같다 — 열리는 순간 검색 칸에 커서가 가므로 가드에 걸면 같은 키로 못 닫는다.
    action === "open-projects-dock" ||
    // DB 독도 같다 — 연결 목록의 검색 칸을 품으므로 가드에 걸면 칸을 만진 뒤 같은 키로 못 닫는다.
    action === "open-db-dock" ||
    // 채팅 독도 같다 — 입력 칸(다음 단계의 대화 입력)에 커서가 있어도 같은 키로 닫혀야 한다.
    action === "open-chat-dock" ||
    action === "open-settings" ||
    // 세션 시트도 토글이라 여기 든다 — 입력칸을 품지는 않지만, 여는 키가 닫지 못하면
    // 토글이 아니다 (포커스가 어느 입력칸에 있든 같은 키로 닫혀야 한다).
    action === "open-console" ||
    // 작업안도 같다 — 기록 보기의 검색 칸 · 채팅 독 입력 칸에 커서가 있어도 같은 키로 닫혀야 한다(채팅 독과 같은 기준).
    action === "open-plans" ||
    // 테마 프로필 전환도 같다 — 설정 독의 입력칸에 커서가 있어도 모양을 바꿀 수 있어야 하고, 어떤 입력칸도
    // 이 조합에 뜻을 두지 않는다 (docs/log/2026-09-28-profile-switcher.md).
    action === "switch-profile" ||
    // 프라이버시 잠금도 같은 이유다 — 자리를 비우기 직전 포커스가 터미널·입력칸 어디에 있든
    // 이 키로 가림막이 켜져야 한다(걷는 것은 가림막 위의 관문뿐이라 이 키가 닫지는 않는다).
    action === "toggle-veil" ||
    // 끝내기도 같다 — 나가는 문이라 포커스가 어느 입력칸에 있든 열려야 하고, 어떤 입력칸도 이 조합에 뜻을 두지 않는다.
    action === "quit-app" ||
    // 알림 위치로 가기도 같다 — 어느 입력칸도 이 조합에 뜻을 두지 않고, 독 검색 칸에 커서가 있어도 알림으로 가야 한다.
    action === "go-to-alert" ||
    // AI 타일 넘기기도 같다(10-20 실기) — 대화 면의 포커스는 늘 입력 칸이라 가드에 걸면 같은 키로 터미널 면에 돌아오지 못한다.
    action === "flip-convo" ||
    action.startsWith("focus-") ||
    action.startsWith("move-") ||
    action.startsWith("expand-")
  );
}

/** 사용자 오버라이드 저장 형태 — `action-id → 조합 문자열`. 없는 액션은 기본값을 쓴다 */
export type Overrides = Record<string, string>;

/** id → ActionDef 빠른 조회 (레지스트리는 불변이라 한 번만 만든다) */
const BY_ID: ReadonlyMap<string, ActionDef> = new Map(ACTIONS.map((a) => [a.id, a]));

/**
 * 이 code 가 **수식 키 자체**인가. 기록 중 수식 키만 눌렀을 때 조합을 만들지 않으려고 쓴다
 * (`comboFromEvent` 가 이때 `null` 을 돌려준다 → 설정 화면은 계속 다음 키를 기다린다).
 */
function isModifierCode(code: string): boolean {
  return (
    code === "ControlLeft" ||
    code === "ControlRight" ||
    code === "ShiftLeft" ||
    code === "ShiftRight" ||
    code === "AltLeft" ||
    code === "AltRight" ||
    code === "MetaLeft" ||
    code === "MetaRight"
  );
}

/**
 * 키 이벤트 → 조합 문자열. 수식 키만 눌렸으면 `null` (기록이 홀로 눌린 수식 키를 무시).
 *
 * 수식 순서는 **`Ctrl` → `Alt` → `Shift`** 로 고정한다. `ev.code` 로만 물리 키를 읽는다
 * (위 doc-comment 의 IME 근거). Meta 는 v1 에서 보지 않는다.
 */
export function comboFromEvent(ev: {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  code: string;
}): string | null {
  if (!ev.code || isModifierCode(ev.code)) return null;
  const parts: string[] = [];
  if (ev.ctrlKey) parts.push("Ctrl");
  if (ev.altKey) parts.push("Alt");
  if (ev.shiftKey) parts.push("Shift");
  parts.push(ev.code);
  return parts.join("+");
}

/**
 * **WebView2(Edge)의 브라우저 가속키** 중, 기본 동작이 화면을
 * 눈에 띄게 망가뜨리는 조합들 (docs/log/2026-09-08-browser-accelerators.md).
 *
 * 이 앱은 웹뷰 안에 살지만 **브라우저가 아니다** — 인쇄할 문서도, 저장할 페이지도, 볼 소스도
 * 없다. 그런데 앱이 어떤 조합에 뜻을 두지 않으면 그 자리는 자동으로 Edge 의 것이 되어,
 * 포커스가 터미널 밖(시작 화면·호스트/파일 타일·body)에 있을 때 `Ctrl+P` 한 번이 **인쇄
 * 대화상자**를 띄운다. 모달이 전파를 끊거나 단축키를 해제했어도 기본 동작은 막아야 한다.
 * 앱에 묶인 조합은 전파를 유지해서 앱 동작만 실행하고, 문서 편집기의 검색·저장은 편집기에 양보한다.
 *
 * ## 목록에 넣는 기준 — 셋 다 맞아야 한다
 *
 * 1. WebView2/Edge 가 가로채는 크롬(chrome) 가속키이고,
 * 2. 이 앱에는 브라우저 기본 동작이 필요 없으며,
 * 3. 기본 동작이 화면에 **눈에 보이게** 튀어나온다(대화상자·막대·패널).
 *
 * ## 일부러 넣지 않은 것: 새로고침과 개발자 도구
 *
 * `Ctrl+R`·`F5`(새로고침)와 `F12`·`Ctrl+Shift+I`(개발자 도구)는 **개발이 그것에 기대고 있다**
 * — CDP 검증 도구(`scripts/dev/`)와 손으로 하는 재현이 둘 다 이 키로 돈다. 막으면 잃는 것이
 * 얻는 것보다 크다. (`Ctrl+Shift+I` 는 `toggle-sync` 에 묶여 있어 어차피 앞에서 걸린다.)
 */
const BROWSER_CHROME_COMBOS: ReadonlySet<string> = new Set([
  "Ctrl+KeyP", // 인쇄 대화상자 — 이 버그의 발단이다 (두 번째 목격)
  "Ctrl+Shift+KeyP", // 시스템 인쇄 대화상자 (기본값은 팔레트라 보통 앞에서 걸린다)
  "Ctrl+KeyS", // 페이지 저장 (파일 대화상자)
  "Ctrl+Shift+KeyS", // 폐기된 배치 저장 조합: 브라우저/셸로 흘리지 않는다.
  "Ctrl+KeyO", // 파일 열기 (파일 대화상자 → 웹뷰가 그 파일로 이동한다)
  "Ctrl+KeyU", // 소스 보기
  "Ctrl+KeyJ", // 다운로드
  "Ctrl+KeyH", // 방문 기록
  "Ctrl+KeyF", // 찾기 막대 — 앱 검색이 꺼졌거나 모달 안이어도 브라우저로 넘기지 않는다
  "Ctrl+KeyG", // 찾기 막대 — 다음 찾기
  "Ctrl+Shift+KeyG", // 찾기 막대 — 이전 찾기
  "F3", // 찾기 막대 — 다음 찾기
  "Shift+F3", // 찾기 막대 — 이전 찾기
]);

/**
 * 이 조합이 [위 목록](BROWSER_CHROME_COMBOS)의 브라우저 가속키인가 — `true` 면 부르는 쪽이
 * 브라우저 기본 동작을 끊는다. 같은 조합의 앱·편집기 동작은 별도로 처리한다.
 */
export function isBrowserChromeCombo(combo: string): boolean {
  return BROWSER_CHROME_COMBOS.has(combo);
}

// ---------------------------------------------------------------------------
// 편집 필드 판정 — 키 가드와 네이티브 우클릭 메뉴가 **같은 뜻**으로 쓴다
// ---------------------------------------------------------------------------

/**
 * `EventTarget` 을 **요소처럼 쓸 수 있는 것**으로 좁힌다.
 *
 * `instanceof HTMLElement` 를 쓰지 않는다 — 이 모듈은 vitest 의 `node` 환경에서도 도는
 * 순수 모듈이라 DOM 전역이 없다(있는 척하면 판정 자체를 테스트할 수 없다). 여기서 필요한
 * 것은 `tagName`·`closest`·`isContentEditable` 셋뿐이므로 그 셋의 존재만 본다.
 * SVG 요소도 `closest` 를 갖지만 `isContentEditable` 이 없고 `tagName` 이 소문자라 아래
 * 판정에 걸리지 않는다.
 */
interface ElementLike {
  tagName: string;
  isContentEditable?: boolean;
  /** `<input>` 의 `type` — 진짜 DOM 은 소문자로 고르고 없거나 모르는 값이면 `"text"` 를 준다 */
  type?: unknown;
  closest(selector: string): unknown;
}

function asElement(target: EventTarget | null): ElementLike | null {
  const el = target as unknown as Partial<ElementLike> | null;
  if (!el || typeof el.closest !== "function" || typeof el.tagName !== "string") return null;
  return el as ElementLike;
}

/**
 * 이 타깃이 "편집 필드" 라서 전역 단축키를 양보해야 하는가.
 *
 * 앱 자신의 입력칸(호스트 이름·설정·트리거 패턴 등)에서 타이핑 중이면 단축키가 가로채면 안
 * 된다. **다만 xterm 의 숨은 `textarea`(`.xterm` 안)는 예외** — 터미널이 포커스를 쥔 채로도
 * 전역 단축키가 먹어야 하고, 터미널의 `customKeyEventHandler` 는 이미 그 조합을 PTY 로 안
 * 보내기로 삼킨 뒤 창까지 흘려보낸다.
 *
 * (예전에는 `app/keys.svelte.ts` 안에 있었다. [`shouldBlockNativeContextMenu`] 가 **같은
 * 뜻의 예외**를 필요로 해서 이리로 내려왔다 — 둘이 갈리면 우클릭만 되고 키는 안 되는(또는
 * 그 반대인) 조용한 어긋남이 생긴다.)
 *
 * ## "편집 필드" = **글자를 치는 곳**뿐이다 (docs/log/2026-09-25-editable-target.md)
 *
 * `<textarea>` · `contenteditable` · **글자를 받는 `<input>`**(text·search·password·email·
 * url·tel·number·날짜/시각, `type` 이 없는 것)만 센다. 예전에는 `<input>` 이면 전부였고, 그래서
 * 설정의 **스위치(체크박스)** 에 포커스가 있으면 `Ctrl+Shift+P` 가 먹지 않았다 — 팔레트로 설정
 * 줄에 간 바로 그 순간 다시 팔레트를 부를 수 없었다. 체크박스·라디오·슬라이더·버튼·색·파일
 * 칸과 `<select>` 는 `Ctrl`/`Alt` 조합에 아무 뜻을 두지 않으므로 여기서 빠진다.
 *
 * 대신 그 컨트롤들이 **스스로 쓰는 맨 키**(Space·Enter·화살표, `<select>` 의 글자 찾기)는
 * [`isControlOwnedKey`] 가 따로 지킨다 — 가드를 넓게 되돌리는 대신 그 자리만 좁게 본다.
 *
 * 판정은 거부 목록([`NON_TEXT_INPUT_TYPES`])이다 — 목록에 없는 `type` 은 글자를 받는 칸으로
 * 친다(모르는 칸에서 단축키가 글자를 뺏는 쪽보다 단축키가 한 번 쉬는 쪽이 덜 아프다).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = asElement(target);
  if (!el) return false;
  if (el.closest(".xterm")) return false; // 터미널은 편집 필드로 치지 않는다
  // IME 포커스 주인(`data-ime-proxy` — launcher 의 숨은 입력칸)도 아니다: xterm 의 textarea 와 같은
  // 까닭으로 입력칸이다(IME 는 편집 요소가 포커스일 때만 켜진다). 글자를 치는 칸이 아니라 목록의
  // 키보드 몸이라 전역 단축키가 그대로 먹어야 한다 (docs/log/2026-09-25-launcher.md 3절).
  if (el.closest("[data-ime-proxy]")) return false;
  const tag = el.tagName;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has(inputType(el));
  return tag === "TEXTAREA" || el.isContentEditable === true;
}

/**
 * **단축키에서는 터미널처럼 다루는 글 칸**인가(2026-11-02 사용자 결정) — AI 타일 대화 면의 입력 칸(`FlipComposer` 의 `terminalKeys` →
 * `data-terminal-keys`)만. 대화 면은 포커스가 늘 그 칸이라 글 칸 가드에 걸려 전역 단축키(새 탭 · 탭 전환 · 나누기 · 팔레트 …)가 먹지 않았다 —
 * 그 칸만 가드에서 빼 터미널(`.xterm`)과 같은 판정을 받는다. 글 편집 키(`Ctrl+C/V/X/Z/Y/A` · `Ctrl+←/→` · `Ctrl+Shift+←/→` 낱말 고르기 ·
 * Home/End · Enter)는 기본 전역 조합에 없어 칸이 그대로 받는다. 터미널 층(`scope: "terminal"` — 점프 · 출력 복사 …)은 xterm 의 키 처리기만
 * 보므로 이 칸에서 돌지 않는다. 권한 · 질문 카드의 글 칸 · 찾기 띠 · 사이드 채팅 입력 칸 같은 다른 글 칸은 예전처럼 가드된다.
 *
 * [`isEditableTarget`] 자체는 바꾸지 않는다 — 우클릭 메뉴 판정([`shouldBlockNativeContextMenu`])은 이 칸에서도 웹뷰의 글 칸 메뉴를 둔다.
 */
export function isTerminalKeysInput(target: EventTarget | null): boolean {
  const el = asElement(target);
  return !!el && !!el.closest("[data-terminal-keys]");
}

/**
 * 글자를 받지 **않는** `<input>` 의 `type` 들 — [`isEditableTarget`] 에서 빠지고
 * [`isControlOwnedKey`] 가 대신 본다. (`hidden` 은 포커스를 받을 수 없어 적지 않는다.)
 */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "checkbox",
  "radio",
  "range",
  "button",
  "submit",
  "reset",
  "image",
  "color",
  "file",
]);

/** `<input>` 의 `type` — 문자열이 아니면(흉내 낸 타깃 등) 진짜 DOM 의 기본값처럼 `"text"` */
function inputType(el: ElementLike): string {
  return typeof el.type === "string" ? el.type.toLowerCase() : "text";
}

/**
 * 글자를 받지 않는 폼 컨트롤이 **스스로 쓰는 맨 키** — 체크박스·라디오의 Space, 버튼의
 * Enter, 라디오 무리·슬라이더의 화살표·Home/End·PageUp/Down.
 */
const CONTROL_KEYS: ReadonlySet<string> = new Set([
  "Space",
  "Enter",
  "NumpadEnter",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * 이 키는 **포커스된 폼 컨트롤의 것**인가 — `true` 면 전역 키 처리는 손대지 않고(기본 동작도
 * 끊지 않고) 비켜 준다.
 *
 * [`isEditableTarget`] 이 체크박스·`<select>` 를 놓아준 대신 서는 좁은 그물이다. 기본값의 전역
 * 조합은 모두 `Ctrl`/`Alt` 를 쥐고 있어 이 판정에 걸리지 않지만, 설정 › 단축키에서는 맨
 * 화살표·Home/End·`Shift+글자` 도 기록할 수 있다(`isBindableKey`) — 그런 조합이 체크박스의
 * Space 나 슬라이더의 화살표, `<select>` 의 글자 찾기를 가로채지 않게 한다. 그래서 `Ctrl`·`Alt`
 * 가 섞인 키는 **언제나 앱의 것**이고(컨트롤이 뜻을 두지 않는다), 없으면:
 *
 * - **`<select>`** — 기능 키(F1…)를 뺀 전부. 닫힌 목록은 글자를 치면 그 글자로 시작하는
 *   항목으로 뛰므로(글자 찾기) `?` 같은 글자도 그 칸의 것이다.
 * - **나머지 컨트롤**(체크박스·라디오·슬라이더·버튼·색·파일) — [`CONTROL_KEYS`] 뿐. 그 밖의
 *   글자(`?` 치트시트 등)는 이 컨트롤에 뜻이 없으니 앱이 받는다.
 *
 * 터미널(`.xterm`) 안은 여기서도 컨트롤이 아니다 — 터미널의 규칙은 바뀌지 않는다.
 * `Alt+↑/↓`(목록 펼치기)는 타일 포커스 이동(`focus-*`)이 이전부터 쥐고 있고 그대로 둔다 —
 * 목록은 Space·F4 로도 펼쳐진다.
 */
export function isControlOwnedKey(
  target: EventTarget | null,
  ev: { ctrlKey: boolean; altKey: boolean; code: string },
): boolean {
  if (ev.ctrlKey || ev.altKey) return false;
  const el = asElement(target);
  if (!el || el.closest(".xterm")) return false;
  if (el.tagName === "SELECT") return !/^F\d{1,2}$/.test(ev.code);
  if (el.tagName === "INPUT" && NON_TEXT_INPUT_TYPES.has(inputType(el))) {
    return CONTROL_KEYS.has(ev.code);
  }
  return false;
}

/**
 * **여기서 웹뷰의 기본 우클릭 메뉴를 막아야 하는가**
 * (docs/log/2026-09-08-native-context-menu.md — [`isBrowserChromeCombo`] 의 형제 규칙이다).
 *
 * 창 전역에서 막는 것이 기본이고 예외가 둘뿐이다:
 *
 * 1. **앱이 이미 자기 메뉴를 세웠다** (`defaultPrevented`) — 타일 머리줄·탭·호스트 줄·파일
 *    줄·터미널이 자기 버블 단계에서 `preventDefault` 한 뒤 창까지 흘려보낸다. 그때 여기서
 *    또 손대면 하는 일이 없으므로 `false` 다. (거꾸로 읽으면 **창 리스너는 반드시 버블
 *    단계**여야 한다는 뜻이다 — 캡처로 달면 앱 메뉴보다 먼저 돌아 이 판정이 언제나
 *    "막는다" 가 된다.)
 * 2. **편집 필드** ([`isEditableTarget`]) — 마우스만 쓰는 사용자에게 잘라내기·복사·붙여넣기
 *    를 남겨 둘 유일한 자리다. xterm 의 숨은 textarea 는 여기서도 편집 필드가 아니다
 *    (터미널은 자기 우클릭 뜻이 따로 있다).
 * 3. **문서 편집기**(`.cm-editor` — [`isInDocEditor`]) 안 어디든 — 글 칸(`contenteditable`)은 2 가 이미
 *    받지만, 줄 번호 거터 · 글 끝 아래 빈 곳도 편집기의 일부라 같은 메뉴가 떠야 한다
 *    (docs/log/2026-09-27-doc-edit.md "F2").
 */
export function shouldBlockNativeContextMenu(
  target: EventTarget | null,
  defaultPrevented: boolean,
): boolean {
  if (defaultPrevented) return false;
  if (isInDocEditor(target)) return false;
  return !isEditableTarget(target);
}

// ---------------------------------------------------------------------------
// 문서 편집기의 키 경계 (docs/log/2026-09-27-doc-edit.md "F2")
// ---------------------------------------------------------------------------

/** 이 타깃이 **문서 편집기**(CodeMirror — `.cm-editor`) 안인가 */
export function isInDocEditor(target: EventTarget | null): boolean {
  const el = asElement(target);
  return !!el && !!el.closest(".cm-editor");
}

/**
 * 편집기 안에서도 **앱이 쥐는** 조합인가 — 작업면을 다루는 키들이다:
 *
 * - `Ctrl+Shift+…` 전부(탭 · 타일 · 독 · 팔레트 · 전체 검색 · `Ctrl+Shift+Tab` …) — 묶인 것만(편집기의 `Ctrl+Shift+←/→` 낱말 고르기는
 *   기본으로 묶이지 않아 편집기의 것)
 * - `Ctrl+Alt+화살표`(타일 크기 조절 — 2026-11-02) — 편집기의 커서 더하기(`Mod-Alt-↑/↓`)보다 앱이 이긴다
 * - `Alt+화살표`(타일 포커스) · `Alt+Shift+화살표`(타일 이동) — 편집기의 줄 옮기기 · 줄 복제(`Alt+↑/↓`,
 *   `Shift+Alt+↑/↓`)보다 앱이 이긴다. 타일 하나가 키보드의 함정이 되지 않게(설정 칸의 `bypassesEditGuard` 와
 *   같은 까닭).
 * - `Ctrl+Tab` · `Ctrl+PageUp/PageDown` — 탭 넘기기 계열
 * - 팔레트 키(`paletteCombo` — 사용자가 다시 묶었을 수 있어 부르는 쪽이 준다)
 *
 * 나머지(`Ctrl+D` · `Ctrl+F` · `Ctrl+Z/Y` · `Ctrl+A` · `Ctrl+S` · 맨 글자 · Escape …)는 편집기의 것이다.
 * `Ctrl+Alt+화살표` 밖의 `Ctrl+Alt+…` 는 여기 없다.
 */
export function appKeepsInEditor(combo: string, paletteCombo: string | null): boolean {
  if (paletteCombo !== null && combo === paletteCombo) return true;
  if (combo.startsWith("Ctrl+Shift+")) return true;
  if (/^Alt\+(Shift\+)?Arrow(Left|Right|Up|Down)$/.test(combo)) return true;
  if (/^Ctrl\+Alt\+Arrow(Left|Right|Up|Down)$/.test(combo)) return true;
  return combo === "Ctrl+Tab" || combo === "Ctrl+PageUp" || combo === "Ctrl+PageDown";
}

/**
 * **이 키는 문서 편집기의 것인가** — `true` 면 앱 전역 키 층은 실행하지 않고 비켜 준다
 * (편집기 밖이면 언제나 `false` — 예전 규칙 그대로).
 *
 * 편집기 안에서 앱이 쥐는 것은 [`appKeepsInEditor`] 계열 **이면서 실제로 액션에 묶인**(`bound`) 조합뿐이다 —
 * 묶이지 않은 `Ctrl+Shift+…` 까지 빼앗으면 앱은 아무것도 안 하는데 편집기만 그 키를 잃는다.
 */
export function editorOwnsKey(
  target: EventTarget | null,
  combo: string,
  opts: { bound: boolean; paletteCombo: string | null },
): boolean {
  if (!isInDocEditor(target)) return false;
  return !(opts.bound && appKeepsInEditor(combo, opts.paletteCombo));
}

/** code → 사람이 읽을 낱말. 목록에 없으면 code 를 그대로 보여 준다 */
const CODE_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Esc",
  Backspace: "⌫",
  Delete: "Del",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

/** 한 조각(code)을 사람이 읽을 낱말로. `KeyC`→`C`, `Digit1`→`1`, 나머지는 표에서 */
function labelPart(part: string): string {
  if (part === "Ctrl" || part === "Alt" || part === "Shift") return part;
  if (part.startsWith("Key") && part.length === 4) return part.slice(3); // KeyC → C
  if (part.startsWith("Digit") && part.length === 6) return part.slice(5); // Digit1 → 1
  if (part.startsWith("Numpad")) return `Num ${part.slice(6)}`; // Numpad1 → Num 1
  if (/^F\d{1,2}$/.test(part)) return part; // F1…F12
  return CODE_LABELS[part] ?? part;
}

/**
 * 조합 문자열을 사람이 읽을 라벨로. `"Ctrl+Shift+KeyC"` → `"Ctrl+Shift+C"`,
 * `"Ctrl+ArrowUp"` → `"Ctrl+↑"`.
 *
 * **빈 값이면 빈 문자열이다** — "(없음)" 같은 글자는 여기서 짓지 않는다. 이 모듈은
 * 순수해서 사전을 들일 수 없고(파일 머리말), 안 걸린 칸을 뭐라고 부를지는 화면마다
 * 다르기 때문이다 (설정 화면은 `settings.keys.unbound` 를 쓴다 — `settings/combo.ts`).
 * 부르는 쪽은 대개 [`effectiveCombo`] 의 결과를 넘기므로 이 갈래에 닿지 않는다
 * (모르는 id 일 때만 `null` 이다).
 */
export function displayCombo(combo: string | null | undefined): string {
  if (!combo) return "";
  return combo.split("+").map(labelPart).join("+");
}

/** 한 액션에 **지금 걸린** 조합 (오버라이드 우선, 없으면 기본값). 모르는 id 면 `null` */
export function effectiveCombo(id: string, overrides: Overrides): string | null {
  const def = BY_ID.get(id);
  if (!def) return null;
  const o = overrides[id];
  if (o && o.trim() !== "") return o;
  // 폐기 override가 가리킨 조합에 새 기본 동작을 자동으로 붙이지 않는다. ID 목록은 settings-codec에 보존한다.
  return [overrides["open-layouts"], overrides["save-layout"]].includes(def.def) ? null : def.def;
}

/** 액션 하나가 기본값에서 벗어났는가 (설정 화면의 ↺ 활성 판정) */
export function isOverridden(id: string, overrides: Overrides): boolean {
  const o = overrides[id];
  const def = BY_ID.get(id);
  return !!def && !!o && o.trim() !== "" && o !== def.def;
}

export interface ResolvedBindings {
  /** 터미널 층: 조합 → 액션 id */
  terminal: Map<string, string>;
  /** 전역 층: 조합 → 액션 id */
  global: Map<string, string>;
  /** 파일 타일 층: 조합 → 액션 id (`browser/file-keys.ts` 가 본다) */
  files: Map<string, string>;
  /** 액션 id → 지금 걸린 조합 (모든 액션 포함) */
  effective: Record<string, string>;
}

/**
 * 오버라이드를 각 층의 `조합 → 액션 id` 맵으로 푼다.
 *
 * 같은 층에서 두 액션이 같은 조합을 가지면(충돌) 맵에는 **나중 것이 남는다**(last-wins).
 * UI 경고용 충돌 목록은 `conflicts()` 가 따로 낸다 — 여기서 조용히 이겨도 사용자가
 * 알 수 있게.
 */
export function resolveBindings(overrides: Overrides = {}): ResolvedBindings {
  const terminal = new Map<string, string>();
  const global = new Map<string, string>();
  const files = new Map<string, string>();
  const effective: Record<string, string> = {};
  const maps = { terminal, global, files };

  for (const action of ACTIONS) {
    const combo = effectiveCombo(action.id, overrides);
    if (!combo) continue;
    effective[action.id] = combo;
    maps[action.scope].set(combo, action.id); // last-wins
  }
  return { terminal, global, files, effective };
}

/** 한 조합에 묶인 여러 액션 (같은 층 안에서만 충돌로 본다) */
export interface Conflict {
  scope: ActionScope;
  combo: string;
  /** 이 조합을 공유하는 액션 id 들 (2개 이상) */
  ids: string[];
}

/**
 * 두 층이 **같은 키 이름공간**을 나눠 쓰는가 — 같은 층이거나, `files` 와 `global` 의 짝이다
 * (둘 다 창 keydown 을 지나므로 같은 조합이면 한 번에 둘 다 돈다 — [`ActionScope`] 주석).
 */
export function sharesKeys(a: ActionScope, b: ActionScope): boolean {
  if (a === b) return true;
  return (a === "files" && b === "global") || (a === "global" && b === "files");
}

/**
 * 같은 이름공간에서 **한 조합에 2개 이상**의 액션이 걸린 경우를 모은다 (UI 경고용).
 * 막지는 않는다 — 경고만 한다. 터미널 층은 따로다(터미널 map 과 전역 map 은 서로 다른 진입점에서
 * 조회되므로 같은 조합이어도 뜻이 갈리지 않는다). `files` 층은 전역과 한 이름공간이라
 * ([`sharesKeys`]) 그 묶음에는 전역 액션도 함께 세되, **파일 액션이 하나라도 낀 조합만** 그 층으로 적는다
 * (전역끼리의 충돌은 `global` 묶음이 이미 적는다).
 */
export function conflicts(overrides: Overrides = {}): Conflict[] {
  const out: Conflict[] = [];
  for (const scope of ["terminal", "global", "files"] as const) {
    const byCombo = new Map<string, string[]>();
    for (const action of ACTIONS) {
      if (!sharesKeys(action.scope, scope)) continue;
      if (scope === "global" && action.scope !== "global") continue;
      const combo = effectiveCombo(action.id, overrides);
      if (!combo) continue;
      const list = byCombo.get(combo);
      if (list) list.push(action.id);
      else byCombo.set(combo, [action.id]);
    }
    for (const [combo, ids] of byCombo) {
      if (ids.length < 2) continue;
      if (scope === "files" && !ids.some((id) => BY_ID.get(id)?.scope === "files")) continue;
      out.push({ scope, combo, ids });
    }
  }
  return out;
}

/** 이 액션의 조합이 같은 이름공간([`sharesKeys`])의 다른 액션과 겹치는가 (설정 화면 행별 경고용) */
export function conflictsWith(id: string, overrides: Overrides = {}): string[] {
  const def = BY_ID.get(id);
  if (!def) return [];
  const combo = effectiveCombo(id, overrides);
  if (!combo) return [];
  return ACTIONS.filter(
    (a) => a.id !== id && sharesKeys(a.scope, def.scope) && effectiveCombo(a.id, overrides) === combo,
  ).map((a) => a.id);
}

/** 레지스트리를 층별로 (설정 화면이 층마다 한 무리로 나눠 그린다) */
export function actionsByScope(scope: ActionScope): ActionDef[] {
  return ACTIONS.filter((a) => a.scope === scope);
}

/**
 * **UI 아이콘 생성기** — Material Symbols Rounded(굵기 400) 묶음에서 우리가 고른 것만 뽑아
 * `src/lib/ui-icons.generated.ts` 를 만든다 (docs/log/2026-09-15-lucide-ui-icons.md).
 *
 *     npm run gen:ui-icons        (`npm run gen:icons` 가 이것까지 함께 돌린다)
 *
 * ## 왜 따로인가 — 로고 생성기(`gen-host-icons.mjs`)와 무엇이 다른가
 *
 * 저 스크립트가 뽑는 것은 **사용자가 호스트에 골라 붙이는 컬러 로고**다 (우분투 주황 ·
 * 도커 파랑). 여기서 뽑는 것은 **앱 자신의 크롬이 늘 그리는 아이콘**이라 색 규칙이 정반대다
 * — 전부 `currentColor` 로, 부모가 정한 글자색을 입는다. 두 종류가 한 파일에 섞이면
 * "이 아이콘은 색을 지켜야 하나 따라야 하나" 가 호출부마다 갈린다 (`host-icons.ts` 머리
 * 주석의 표와 같은 나눔이다).
 *
 * 생성하는 **이유**는 저쪽과 같다: 런타임에 Iconify API 를 부르지 않고(오프라인 서버에 붙는
 * 터미널이다 · Tauri CSP 를 열어야 한다), 수천 개짜리 묶음을 통째로 번들하지 않으며, 생성
 * 파일을 **저장소에 커밋**해 `npm i` 없이 체크아웃만 해도 아이콘이 그려지게 한다. 그래서
 * `@iconify-json/*` 는 **devDependency** 다.
 *
 * ## 왜 한 세트인가 · 왜 Material Symbols 인가
 *
 * 상태바 선두단은 글꼴이 그리는 유니코드 기호(`⌨ ▣ ⌕ ⚙ ▤`)와 손으로 딴 SVG 도형이 섞여
 * 있었다 — 굵기·크기·광학 중심이 제각각이라 한 줄에 세우면 눈에 띄게 어긋난다. 유니코드
 * 기호는 **글꼴이 바뀌면 모양도 바뀌고**(OS·글꼴 설정) 어떤 것은 아예 없다. 그래서 한 세트로
 * 모았고(처음엔 Lucide), 2026-11-04 사용자 결정으로 Material Symbols Rounded 굵기 400 으로 옮겼다 —
 * 앱 크롬이 Material 3 쪽(톤 역할 색 · 탭 상태 글리프)으로 간 뒤라 그림도 같은 결로 맞춘다. 라이선스는 Apache-2.0.
 *
 * **남는 것:** Material 에 같은 뜻의 그림이 없는 셋은 Lucide(`git-branch` · `git-compare` · `cursor-bar`),
 * 게이지 · 마우스 · tmux · `file-symlink` · `folder-symlink` 는 손그림(아래 [`HAND`]), MCP 는 로고 세트.
 *
 * ## 아이콘을 더하려면
 *
 * 1. 아래 [`WANTED`] 에 `[우리 이름, "material-symbols:아이콘"]` 한 줄을 더한다. 고르는 순서는
 *    `<이름>-outline-rounded` → `<이름>-rounded` → `<이름>` (별칭은 `loadSet` 이 푼다). **우리 이름은 코드가
 *    쓰는 키**다 (`<UiIcon name="terminal" />`) — 저장 형식은 아니지만 호출부가 글자로
 *    적으므로 바꾸면 그 자리들을 함께 고친다.
 * 2. `npm run gen:ui-icons` 를 돌리고 생성 파일을 함께 커밋한다.
 * 3. 이름이 없으면 스크립트가 **그 자리에서 멈춘다** (조용히 빠뜨리면 화면에서만 사라져
 *    한참 뒤에 발견된다).
 *
 * ## 굵기
 *
 * Material 은 **면으로 그린 path** 라 굵기라는 값이 없다(세트의 굵기 400 그대로). 남는 선 그림(Lucide · 손그림)은 원본의
 * `stroke-width="2"` 를 그대로 그린다 — 1.75 로 줄이면 Material 400 과 결이 어긋난다. 그리는 쪽도 덮지 않는다.
 *
 * ## 꽉 찬 변형
 *
 * WANTED 셋째 칸 `{ filled: "아이콘" }` 이면 같은 세트의 그 그림을 `filledBody` 로 함께 뽑는다 — `UiIcon` 의 `filled` 가 쓴다
 * (윤곽 아이콘 사이에서 폴더가 한눈에 갈리게 · [이어받기] 단추의 재생 삼각형).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lockedVersion } from "./locked-version.mjs";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src/lib/ui-icons.generated.ts");

/**
 * 쓰는 아이콘 묶음. `license` 는 패키지의 `package.json` 에서 읽어 생성 파일 머리에 그대로
 * 적는다 — 출처를 손으로 적으면 패키지를 올릴 때 조용히 낡는다.
 */
const SETS = {
  "material-symbols": "@iconify-json/material-symbols",
  /** Material 에 같은 뜻의 그림이 없는 다섯만 (위 "남는 것") */
  lucide: "@iconify-json/lucide",
  /**
   * 컬러 로고 세트지만 **단색 윤곽 하나뿐인 로고**만 여기서 빌린다(지금은 MCP 하나). 그런 로고는
   * 칠이 없는(검정 기본) `path` 라, WANTED 셋째 칸 `{ fill: true }` 로 `currentColor` 칠을 입힌다.
   */
  logos: "@iconify-json/logos",
};

/**
 * `[우리 이름, "세트:아이콘"]` — 앱 크롬이 그리는 아이콘 **전부**다 (2026-09-15 에 독·시작
 * 화면·팔레트·단축키 도움말·설정 섹션까지 옮겨 오면서 "아직 옛 기호인 곳" 이 없어졌다).
 *
 * 우리 이름을 세트의 이름과 굳이 다르게 두는 자리가 있다 (`layout` ← `grid-view`,
 * `console` ← `dashboard`, `ai` ← `star-shine`): **우리 쪽 뜻**으로
 * 부르면 나중에 더 맞는 그림을 찾았을 때 호출부를 건드리지 않고 이 표 한 줄만 고치면 된다.
 *
 * **한 뜻은 한 이름이다** — `folder`·`layout`·`settings` 는 상태바와 타일 머리줄·`+` 메뉴가
 * 함께 쓴다. 같은 말을 두 그림으로 그리던 자리(`+` 메뉴의 `LAYOUT_D` 비대칭 3분할 ↔ 띠의
 * `layout-grid`)가 여기서 하나로 합쳐졌다.
 */
const WANTED = [
  // 옛 상태바 선두단 여덟 칸의 그림 (2026-10-18 부터 독의 동작 그림 — `src/lib/dock.ts` 의 `DOCK_ACTION_ICONS` · 상태바에는 독 입구만)
  ["terminal", "material-symbols:terminal-outline-rounded"],
  ["server", "material-symbols:dns-outline-rounded"],
  /**
   * 프로젝트 독 — **코드 표식이 붙은 폴더** (docs/log/2026-09-24-projects.md). 프로젝트는 저장소
   * 폴더 하나라 폴더가 몸이고, 표식이 "그냥 폴더(로컬 파일)가 아니라 저장소" 를 가른다 —
   * 옆 칸 `folder`(로컬 파일)와 한눈에 갈려야 한다.
   */
  ["project", "material-symbols:folder-code-outline-rounded"],
  ["folder", "material-symbols:folder-outline-rounded", { filled: "folder-rounded" }],
  ["layout", "material-symbols:grid-view-outline-rounded"],
  ["command", "material-symbols:keyboard-command-key-outline-rounded"],
  ["settings", "material-symbols:settings-outline-rounded"],
  ["console", "material-symbols:dashboard-outline-rounded"],

  // 타일 머리줄 (`src/lib/pane/PaneHeader.svelte`) — `⋯ 📁 ⤢ ×` 와 표식 둘
  ["more", "material-symbols:more-horiz-outline-rounded"],
  ["maximize", "material-symbols:open-in-full-outline-rounded"],
  ["restore", "material-symbols:close-fullscreen-outline-rounded"],
  ["close", "material-symbols:close-outline-rounded"],
  /** 동시 입력 포함 표식(✓) · `+` 메뉴와 탭 메뉴의 "지금 이것" 표식도 같은 그림이다 */
  ["check", "material-symbols:check-outline-rounded"],
  // 독 알림 칸 바닥 줄 (`src/lib/Dock.svelte`) — [모두 읽음] · [알림 지우기](휴지통은 아래 `trash` 를 같이 쓴다) (2026-10-24)
  ["check-check", "material-symbols:done-all-outline-rounded"],
  // 설정의 밝기 모드 선택
  ["sun", "material-symbols:light-mode-outline-rounded"],
  ["moon", "material-symbols:dark-mode-outline-rounded"],
  /** AI 읽기 허용 표식(✦) — 반짝이는 별 셋이 이 앱에서 "AI" 를 뜻한다 */
  ["ai", "material-symbols:star-shine-outline-rounded"],
  /**
   * **AI 권한** 그림 — 단계 자체는 아래 게이지 글리프(`ai-gauge-*`)가 말하고(10-23 — 단계마다 다른 그림이던 `ai-schema` · `ai-approve` ·
   * `ai-auto` · `ai-all` 은 게이지로 바뀌며 걷었다), 여기 하나는 그림 하나로 말하는 자리다: `ai-off`(쿼리 타일 묻기 끔 — 로컬 타일의
   * "AI 읽기" 칩 그림 `ai-read` 는 10-23 에 그 칩이 AI 권한 칩(게이지)으로 합쳐지며 걷었다). 위 `ai`(✦ — "이것은 AI 다", AI 타일 자신)와
   * **뜻이 다르다**: 이쪽은 "AI 가 여기서 무엇을 할 수 있는가" 다. 같은 그림을 다른 이름으로 쓰는
   * 자리(`header-always`·`show-hidden` = visibility · `zap`·`bell-visual` = bolt)는 그대로 둔다 — 한 뜻은 한
   * 이름이고, 뜻이 다르면 그림이 같아도 이름을 따로 둔다(나중에 한쪽만 그림을 바꿀 수 있게).
   */
  ["ai-off", "material-symbols:block-outline-rounded"],
  /**
   * **AI 권한 게이지 글리프**(2026-10-23) — 머리줄 칩의 미니 게이지(`AiGaugeMini.svelte` 의 `bars` — 세로 막대 넷)를 메뉴 아이콘 한 칸에.
   * 끝 수가 게이지 자리(`ai-gauge.ts` — 0 = 끔 · 1~4 = 찬 막대 수)이고 이름은 `gaugeIconName` 이 고른다. 타일 ⋯ 메뉴의 "AI 권한…" 줄 · 호스트 목록의 AI 권한 표식이
   * 쓴다(호스트 단계 · DB 단계 모두 자리로). 손으로 그린다(아래 [`HAND`]).
   */
  ["ai-gauge-0", "hand:ai-gauge-0"],
  ["ai-gauge-1", "hand:ai-gauge-1"],
  ["ai-gauge-2", "hand:ai-gauge-2"],
  ["ai-gauge-3", "hand:ai-gauge-3"],
  ["ai-gauge-4", "hand:ai-gauge-4"],

  // 탭 스트립의 `+` (`src/lib/Tabs.svelte`) — `new-tab`(네모 안의 +)은 `+` 메뉴와 함께 걷었다
  ["plus", "material-symbols:add-outline-rounded"],
  /** 옆목록을 여는 `▸`(타일 ⋯ 메뉴) · 브라우저 경로 구분 · 트리 접힘 */
  ["chevron", "material-symbols:chevron-right-outline-rounded"],
  /**
   * 아래로 펼치는 고르개의 `▾` (`Dropdown.svelte` · `Combobox.svelte`) — 네이티브
   * `<select>` 가 스스로 그리던 그 삼각형의 자리다 (docs/log/2026-09-20-host-form-tabs.md
   * 의 "네이티브 select · datalist → Dropdown · Combobox"). 위 `chevron`(오른쪽)과 뜻이
   * 갈린다: 저쪽은 **옆으로 열리는 것**이고 이것은 **아래로 펼쳐지는 것**이다.
   */
  ["chevron-down", "material-symbols:keyboard-arrow-down-outline-rounded"],
  /** 동시 입력 켜짐(탭의 `⇶`) — 한 입력이 여러 타일로 갈라져 나간다 */
  ["sync", "material-symbols:keyboard-double-arrow-right-outline-rounded"],

  // 타일 앞자리 (`src/lib/PaneIcon.svelte`) — 컬러 로고 세트에 대응물이 없는 둘
  //   (`settings` 는 위 상태바 칸과 같은 이름을 나눠 쓴다)
  ["home", "material-symbols:home-outline-rounded"],

  // 타일 ⋯ 메뉴 · 터미널 우클릭 메뉴 (`src/lib/pane/pane-menu.ts` 의 `icon`)
  //   — 한 정의가 두 메뉴를 그린다. `close`·`check`·`folder` 는 위와 같은 이름을 나눠 쓴다.
  ["split-h", "material-symbols:view-column-2-outline-rounded"],
  ["split-v", "material-symbols:view-agenda-outline-rounded"],
  /** 포트 포워딩 — 두 방향으로 오가는 화살표 (예전 글리프 `⇉` 의 뜻 그대로) */
  ["forward", "material-symbols:swap-horiz-outline-rounded"],
  ["edit", "material-symbols:edit-outline-rounded"],
  ["copy", "material-symbols:content-copy-outline-rounded"],
  ["paste", "material-symbols:content-paste-outline-rounded"],
  /** 모두 선택 — 점선 상자(`select-all`) */
  ["select-all", "material-symbols:select-all-outline-rounded"],
  ["erase", "material-symbols:ink-eraser-outline-rounded"],
  /** 영구 삭제 — 지난 대화 ⋯ 메뉴의 위험 항목(되돌릴 수 없는 것 — 비우기 `erase` 와 가른다) */
  ["trash", "material-symbols:delete-outline-rounded"],
  /** 보관 — 라이브러리의 보관함 칩 · 앨범 메뉴 */
  ["archive", "material-symbols:archive-outline-rounded"],
  /** 정리 — 끝난 앨범의 worktree · ref 를 치운다(영구 삭제 `trash` 와 가른다) */
  ["cleanup", "material-symbols:cleaning-services-outline-rounded"],
  /** 보관한 앨범 복원 — 되돌림 화살표(창 크기의 `restore` 와 다른 뜻이라 이름을 가른다) */
  ["album-restore", "material-symbols:settings-backup-restore-rounded"],
  /** 링크 열기 — 앱 **밖**으로 나간다 */
  ["external", "material-symbols:open-in-new-outline-rounded"],
  /** 새 창으로 분리 — 나가는 곳이 브라우저가 아니라 **이 앱의 새 창**이라 그림을 가른다 */
  ["window", "material-symbols:web-asset-outline-rounded"],
  /** 자물쇠 — 볼트·호스트 비밀번호 줄 · 가림막 (아래 `lock-open` 이 열린 짝이다) */
  ["lock", "material-symbols:lock-outline-rounded"],
  /**
   * 볼트에 담긴 **키 암호구** 한 줄 (설정 › 보안 — docs/log/2026-09-19-vault.md).
   * 같은 목록의 비밀번호 줄은 위 `lock` 을 나눠 쓴다: 둘 다 "담긴 비밀" 이지만 대상이
   * 서버(자물쇠)와 **내 디스크의 키 파일**(열쇠)로 갈려, 그 차이가 목록에서 눈에 보여야 한다.
   */
  ["key", "material-symbols:key-outline-rounded"],
  /**
   * 스니펫으로 저장 — **끼워 두는 책갈피**다 (docs/log/2026-09-16-snippets.md).
   * `save`(디스켓)를 쓰지 않은 이유: 이 앱에서 저장은 파일로 나가는 일이 아니라 "이름 붙여
   * 아껴 둔다" 는 뜻이고, 그 결이 책갈피에 더 가깝다. 터미널 우클릭 메뉴와 팔레트의 저장
   * 줄이 **같은 그림**을 쓴다.
   */
  ["bookmark", "material-symbols:bookmark-outline-rounded"],
  /**
   * 스크롤백 저장 — **파일 한 장으로 내려보낸다**
   * (docs/log/2026-09-17-scrollback-export-and-logs.md). 바로 위 `bookmark` 주석이 비켜 둔
   * 그 자리가 여기다: 스니펫은 "이름 붙여 아껴 둔다" 지만 이것은 정말로 파일로 나간다.
   * 디스켓(`save`)이 아니라 아래 화살표가 붙은 문서인 이유는, 같은 메뉴의 `file-text`
   * (세션 로그 열기)와 **한 벌로 읽혀야** 하기 때문이다 — 하나는 내보내고 하나는 연다.
   */
  ["file-down", "material-symbols:file-save-outline-rounded"],
  /** 세션 로그 열기 — 앱이 쌓아 둔 **글자 파일** 하나 */
  ["file-text", "material-symbols:description-outline-rounded"],

  // 탐색기 툴바 (`src/lib/browser/BrowserToolbar.svelte` · `Breadcrumb.svelte`) —
  //   파일 타일과 호스트 독이 나눠 쓰는 위 한 줄. `chevron`(오른쪽)은 탭 `+` 메뉴의
  //   옆목록 손잡이·빵부스러기 구분자와 **같은 칸**이다.
  ["chevron-left", "material-symbols:chevron-left-outline-rounded"],
  ["up", "material-symbols:arrow-upward-outline-rounded"],
  /** 새로고침 — **다시 읽는다**. 되돌리기(`reset`)와 뜻이 달라 그림도 가른다 */
  ["refresh", "material-symbols:refresh-outline-rounded"],

  // 호스트 독 줄 끝 (`src/lib/Sidebar.svelte`) — 보기 전환 토글 한 자리
  //   (`settings` 는 상태바와 같은 이름을 나눠 쓴다)
  /** 아이콘 보기 — 띠의 `layout`(`grid-view`)과 붙어 설 일이 없어 격자 둘을 나눠 둔다 */
  ["grid", "material-symbols:grid-on-outline-rounded"],
  ["list", "material-symbols:list-outline-rounded"],

  // 독 머리줄 (`src/lib/Dock.svelte`)
  /** 설정을 이 탭에 타일로 고정 — 라벨("타일로 고정") 그대로의 압정 */
  ["pin", "material-symbols:keep-outline-rounded"],
  /** 문서 타일의 [고정 해제] — 고정(`pin`)의 반대 */
  ["pin-off", "material-symbols:keep-off-outline-rounded"],

  // 명령 팔레트 (`src/lib/CommandPalette.svelte`) — 명령 줄은 액션 id 로
  //   상태바(`STATUS_ITEMS`)의 그림을 그대로 빌려 오고, 나머지는 `command` 폴백이다.
  /** 탭 줄 앞자리(예전 `🗂`) — 창 안의 한 화면 */
  ["tab", "material-symbols:tab-outline-rounded"],
  /** 모양 프로필 줄 앞자리 — 색을 고르는 판 (docs/log/2026-09-15-theme-profiles.md) */
  ["palette", "material-symbols:palette-outline-rounded"],

  // 설정 섹션 (`src/lib/settings/*`) · 호스트 폼 · 아이콘 고르개
  /** 기본값으로 되돌리기(`↺`) — `refresh`(다시 읽기)와 **다른 뜻**이다 */
  ["reset", "material-symbols:replay-outline-rounded"],
  // "이 폴더의 지난 대화" — 상태바 칸 · 고르는 목록 머리 · 타일 ⋯ 메뉴 · 팔레트 줄
  // (docs/log/2026-09-27-folder-conversations.md). 처음엔 `rotate-ccw-clock` 이었으나 새로고침처럼 읽혀 말풍선 둘로 바꿨다.
  ["conversations", "material-symbols:forum-outline-rounded"],
  /** 접힌 안내를 여는 ⓘ (`InfoNote`) */
  ["info", "material-symbols:info-outline-rounded"],
  /** 경고 한 줄 앞의 `⚠` */
  ["warning", "material-symbols:warning-outline-rounded"],
  /** 맨 느낌표 `!` — 업데이트 실패 칩(`UpdateChip`). 삼각형 경고 표지판은 경보처럼 무거워 보였다(2026-11-12 사용자) */
  ["exclaim", "material-symbols:priority-high-rounded"],
  /** 폴더 고르개를 여는 "찾아보기…" — 닫힌 `folder` 와 갈라 둔다 (여는 몸짓이다) */
  ["folder-open", "material-symbols:folder-open-outline-rounded", { filled: "folder-open-rounded" }],

  // 파일 타일 툴바 (`src/lib/SftpBrowser.svelte`)
  /** 밖에서 온 파일을 이 폴더로 (원격이면 업로드, 로컬이면 가져오기) */
  ["upload", "material-symbols:upload-outline-rounded"],

  // 호스트 목록 줄의 표식 (`src/lib/browser/HostList.svelte`)
  /**
   * 경유 호스트(`ProxyJump`)를 거쳐 붙는 호스트 — **가는 길**이지 링크가 아니다.
   * `link`(사슬)를 쓰지 않은 이유: 이 앱에서 사슬은 아직 아무 뜻도 없는데, 브라우저 문법에서
   * 곧바로 "누르면 어디로 간다" 로 읽힌다. 그림이 뜻하는 것은 **중간에 한 번 들른다** 이다.
   */
  ["route", "material-symbols:route-outline-rounded"],
  /**
   * **사람이 연 세션** — 관제판 호스트별 목록의 첫 칸. 짝은 `ai`(sparkles)이고, 둘이 나란히
   * 서서 "지금 이 서버에서 움직이는 것이 나인가 AI 인가" 한 질문에 답한다
   * (docs/log/2026-09-21-console-host-groups.md). `users`(여럿)가 아니라 `user`(하나)인
   * 이유는 그 줄이 **세션 하나**이기 때문이다.
   */
  ["user", "material-symbols:person-outline-rounded"],
  /**
   * 호스트 목록 정렬 버튼 (`src/lib/Sidebar.svelte` — docs/log/2026-09-23-host-history.md).
   * 버튼은 **지금** 순서를 그린다: 이름순이면 가나다, 최근순이면 시계.
   */
  ["sort-name", "material-symbols:sort-by-alpha-outline-rounded"],
  ["sort-recent", "material-symbols:schedule-outline-rounded"],
  /**
   * 작업안 실행 목록 정렬 (`src/lib/console/ExecList.svelte` — 2026-11-01). 지금 순서를 그린다: 최근 먼저 = 시계 + 아래 화살표,
   * 오래된 먼저 = 시계 + 위 화살표.
   */
  ["sort-newest", "material-symbols:arrow-downward-outline-rounded"],
  ["sort-oldest", "material-symbols:arrow-upward-outline-rounded"],

  // 상태바 **후미 전역 신호** (`src/lib/StatusBar.svelte` — docs/log/2026-09-21-statusbar-signals.md).
  //   `lock` 은 위 칸과 같은 이름을 나눠 쓴다 — 한 뜻은 한 그림이다.
  /** 자동 승인 켜짐 — 사람을 기다리지 않고 **번개처럼** 지나간다 */
  ["zap", "material-symbols:bolt-outline-rounded"],
  /**
   * 볼트가 **열려 있다** — 같은 신호의 잠긴 짝은 위 `lock` 이다. 두 그림이 한 자리에서
   * 갈아 끼워지므로 같은 세트라야 자물쇠 고리의 각도가 어긋나지 않는다.
   */
  ["lock-open", "material-symbols:lock-open-outline-rounded"],
  /**
   * 알림 센터 — 상태바 **맨 끝**의 늘 서 있는 종 (docs/log/2026-09-25-notification-center.md).
   * 승인 대기와 지난 알림(명령 끝남·턴 끝남·전송)을 한 상자에 모아 여는 입구다.
   */
  ["bell", "material-symbols:notifications-outline-rounded"],
  /**
   * 독 머리 아이콘 줄의 **종료**(= 모든 세션 종료… — 트레이 메뉴와 같은 길, 2026-10-18 통합 독). `close`(×)는 독 · 모달을 닫는 그림이라
   * 창을 떠나는 단추와 갈라 전원 표식을 쓴다.
   */
  ["power", "material-symbols:power-settings-new-outline-rounded"],
  /**
   * 시작 화면(launcher) 맨 위의 **검색 칸 모양 단추** — 누르면 명령 팔레트가 뜬다
   * (docs/log/2026-09-25-launcher.md). 팔레트 자신의 아이콘(`palette`)이 아니라 돋보기인 까닭은
   * 그 자리가 "찾는 칸" 으로 읽혀야 하기 때문이다.
   */
  ["search", "material-symbols:search-outline-rounded"],
  /**
   * 상태바의 **독 칸** — 호스트 · 프로젝트 · 레이아웃 세 칸을 하나로 합친 입구
   * (docs/log/2026-09-25-unified-dock.md). 왼쪽에 붙어 여닫히는 판 그대로의 그림이다 — 셋 중
   * 하나(서버 랙·폴더·격자)를 골라 쓰면 나머지 둘의 문이 아닌 것처럼 읽힌다.
   */
  ["dock", "material-symbols:left-panel-open-outline-rounded"],

  // 파일·호스트 목록 **줄 앞자리** (`src/lib/browser/FileList.svelte` · `HostIcon.svelte`의
  //   `fallback="folder"`) — docs/log/2026-09-25-duotone-glyphs.md. 손으로 딴 채움 도형
  //   (`FOLDER_D`·`FILE_D`·`LINK_D`)을 걷고 크롬과 같은 세트로 옮겼다. 폴더는 위
  //   `folder` 를 나눠 쓰고 **꽉 찬 그림**(`UiIcon` 의 `filled`)으로 그려 한눈에 갈린다.
  ["file", "material-symbols:draft-outline-rounded"],
  /** 파일을 가리키는 심볼릭 링크 — 일반 파일(`file`)과 같은 윤곽 + `folder-symlink` 와 같은 맞물린 고리(2026-11-04 사용자 선택) */
  ["file-symlink", "hand:file-symlink"],
  /**
   * 디렉터리를 가리키는 심볼릭 링크 — 들어갈 수 있는 링크라 일반 폴더와 같은 꽉 찬 몸 · 같은 색에 맞물린 고리를 뚫는다(2026-11-04 사용자 선택).
   * 화살표는 "이동" 으로 읽혀 고리로 갔다(채팅 연결 칩의 `link` 와 같은 말). Material 에 고리가 든 폴더가 없어 손으로 합쳤다.
   */
  ["folder-symlink", "hand:folder-symlink"],
  /**
   * 줄 오른쪽 끝의 **내보내기 손잡이** — 상자 밖으로 나가는 화살표(예전 `EXPORT_D` 와 같은
   * 모양). 위 `external`(`open-in-new`)을 쓰지 않은 이유: 그것은 "링크 열기" 의 그림이고,
   * 앞자리의 링크 글리프와도 결이 겹친다 — 손잡이는 "잡아 끌어 **밖으로** 낸다" 로만 읽혀야 한다.
   */
  ["export", "material-symbols:logout-outline-rounded"],
  /**
   * 파일 타일의 **보기 전환** 단추 (`src/lib/SftpBrowser.svelte`) — 지금 보기가 트리일 때의 그림
   * (docs/log/2026-09-25-file-tree-view.md). 들어가기 보기는 위 `list` 를 나눠 쓴다.
   */
  ["list-tree", "material-symbols:account-tree-outline-rounded"],
  /**
   * 타일 안 **옆 패널 여닫기** — 쿼리 타일의 트리(스키마) 패널 · 문서 타일의 목차 곁 패널 토글(`src/lib/QueryView.svelte` ·
   * `src/lib/DocView.svelte` · 2026-10-20 사용자 실기). 좁은 문서 타일의 목차 드롭다운은 패널이 아니라 `list-tree` 그대로다.
   * 그림은 위 `dock` 과 같은 `left-panel-open` 이지만 뜻이 달라(창의 독 ↔ 타일 안 옆 패널) 이름을 나눈다(위 "한 뜻은 한 이름" 의 반대 경우 — 한 그림 두 뜻).
   */
  ["side-panel", "material-symbols:left-panel-open-outline-rounded"],
  /** 브랜치 그래프 타일의 그림 (`src/lib/PaneIcon.svelte` · docs/log/2026-09-29-branch-graph.md) */
  ["git-branch", "lucide:git-branch"],
  /** diff 타일의 그림 (`src/lib/PaneIcon.svelte` · docs/log/2026-10-05-diff-tile.md) */
  ["git-compare", "lucide:git-compare"],

  // 설정 › 앱 테마의 고르는 칩 (`src/lib/settings/AppThemeSection.svelte` 의 `CHOICE_ICONS`).
  // 월페이퍼 배치 — 늘려 채우기 · 줄여 맞추기 · 반복(위 `grid` 를 나눠 쓴다) · 가운데
  ["fit-cover", "material-symbols:fit-screen-outline-rounded"],
  ["fit-contain", "material-symbols:fullscreen-exit-outline-rounded"],
  ["fit-center", "material-symbols:center-focus-strong-outline-rounded"],
  /** 상태바 자리 — "그 가장자리로" 붙는 화살표 (선이 곧 띠다) */
  ["edge-left", "material-symbols:keyboard-tab-rtl-outline-rounded"],
  ["edge-top", "material-symbols:vertical-align-top-outline-rounded"],
  ["edge-bottom", "material-symbols:vertical-align-bottom-outline-rounded"],
  ["edge-right", "material-symbols:keyboard-tab-outline-rounded"],
  /** 탭 모양 — 알약 · 평면(활성 탭의 밑줄) */
  ["tab-pill", "material-symbols:pill-outline-rounded"],
  ["tab-flat", "material-symbols:format-underlined-outline-rounded"],
  /** 상태바 모양 — 평면 띠(가는 선) · 둥근 패널(둥근 사각) · 감싸기(모서리를 감싸는 둥근 괄호) */
  ["bar-flat", "material-symbols:remove-outline-rounded"],
  ["bar-panel", "material-symbols:rectangle-outline-rounded"],
  ["bar-hug", "material-symbols:crop-free-outline-rounded"],
  /** 크롬 재질 — 평면(사각) · 글래스(번지는 점들) */
  ["material-flat", "material-symbols:square-outline-rounded"],
  ["material-glass", "material-symbols:blur-on-outline-rounded"],
  /** 타일 배치 — 나선(크기가 줄어드는 칸들 · `console` 과 같은 그림, 뜻이 달라 이름을 따로) · 집중 */
  ["tiling-spiral", "material-symbols:dashboard-outline-rounded"],
  ["tiling-focus", "material-symbols:center-focus-weak-outline-rounded"],
  /** 타일 헤더 — 늘 · 타일이 여럿일 때만 · 숨김 */
  ["header-always", "material-symbols:visibility-outline-rounded"],
  ["header-multi", "material-symbols:view-column-2-outline-rounded"],
  ["header-never", "material-symbols:visibility-off-outline-rounded"],
  /** 색 테마 — 월페이퍼에서 색 뽑기 · 랜덤 */
  ["pipette", "material-symbols:colorize-outline-rounded"],
  ["shuffle", "material-symbols:shuffle-outline-rounded"],
  /** 터미널 커서 모양 — 블록 · 밑줄 · 막대 */
  ["cursor-block", "material-symbols:square-outline-rounded"],
  ["cursor-underline", "material-symbols:format-underlined-outline-rounded"],
  ["cursor-bar", "lucide:text-cursor"],
  /** 터미널 우클릭 — 메뉴 (붙여넣기 쪽은 위 `paste` 를 나눠 쓴다) */
  ["menu", "material-symbols:menu-outline-rounded"],
  /** 터미널 벨 — 시각(테두리 번쩍) · 시각+소리 · 끔 */
  ["bell-visual", "material-symbols:bolt-outline-rounded"],
  ["bell-sound", "material-symbols:notifications-active-outline-rounded"],
  ["bell-off", "material-symbols:notifications-off-outline-rounded"],
  /** 메신저 알림 보낼 때 — 자리를 비웠을 때만 (언제나 쪽은 위 `bell` 을 나눠 쓴다) · 독 실행 판의 화면 잠금 칸도 나눠 쓴다(2026-10-23) */
  ["away", "material-symbols:coffee-outline-rounded"],

  // 설정 왼쪽 메뉴 (`src/lib/settings-index.ts` 의 `icon`) — 나머지 칸은 위 이름을 나눠 쓴다
  //   (일반 `settings` · 앱 테마 `palette` · 터미널 `terminal` · 트리거 `zap` · AI 에이전트 `ai` ·
  //   알림 `bell` · 보안 `lock`)
  ["keyboard", "material-symbols:keyboard-outline-rounded"],
  /** 스니펫 — 저장해 둔 명령 조각 */
  ["snippet", "material-symbols:data-object-outline-rounded"],
  /**
   * MCP — Model Context Protocol 공식 로고(`M` 자처럼 꺾인 띠). `logos` 세트의 단색 로고를 빌린다.
   * 획이 아니라 **칠**로 그린 도형이라 `{ fill: true }` 로 글자색을 입힌다.
   */
  ["mcp", "logos:model-context-protocol-icon", { fill: true }],
  /** 자동 승인 — 조건을 통과한 것만 대신 승인한다 */
  ["shield-check", "material-symbols:verified-user-outline-rounded"],
  /** 설정 › 보안 상태 줄의 "마스터 암호 없음" 칩 — 보호가 없다는 사실(위 방패와 짝 · 2026-10-21) */
  ["shield-off", "material-symbols:gpp-bad-outline-rounded"],
  /** 설정 › 보안 상태 줄의 자동 잠금 칩 — 무입력 N분이면 잠김(2026-10-21) */
  ["clock", "material-symbols:schedule-outline-rounded"],
  /** 작업안 — 승인 · 실행을 기다리는 할 일 목록(상태바 작업안 칸 · 작업안 타일 머리줄). 자동 승인의 방패와 가른다 */
  ["list-checks", "material-symbols:checklist-outline-rounded"],
  /**
   * **오케스트레이션 로고** — 헤드폰(2026-10-31 사용자 결정 · 2026-11-04 Material `headphones` 로 교체). 설정 메뉴 · 팔레트 · 알림 줄 ·
   * 폰 시트 · 타일 메뉴 · 런처 독 칸의 정적 자리. 상태를 말하는 자리(탭 글리프 · 재생 막대)는 `orchestration/EqBars.svelte` 가 그린다.
   * `EqBars` 의 헤드폰도 이 `body` 를 그대로 그린다.
   */
  ["orchestra", "material-symbols:headphones-outline-rounded"],

  // 파일 타일 — Dolphin 방향 개편 (docs/log/2026-10-07-file-tile-dolphin.md). 아이콘 보기는 위 `grid`, 자세히는 `list`
  /** 간단히 보기 — 위→아래로 흐르고 열이 옆으로 는다 */
  ["view-compact", "material-symbols:view-week-outline-rounded"],
  /** 필터 줄 (`Ctrl+I`) */
  ["filter", "material-symbols:filter-alt-outline-rounded"],
  /** 숨김 파일 보이기 */
  ["show-hidden", "material-symbols:visibility-outline-rounded"],
  /** 새 폴더 */
  ["folder-plus", "material-symbols:create-new-folder-outline-rounded"],
  /** 장소 패널 — 바탕 화면 · 다운로드 · 드라이브 (홈은 `home`, 문서는 `file-text`, `/` 는 `server`) */
  ["monitor", "material-symbols:desktop-windows-outline-rounded"],
  ["download", "material-symbols:download-outline-rounded"],
  ["hard-drive", "material-symbols:hard-drive-outline-rounded"],
  /** 호스트 폼의 DB 칸 — DB 연결 프리셋 줄 (쿼리 타일 3단계) */
  ["database", "material-symbols:database-outline-rounded"],
  /**
   * 쿼리 타일의 [실행] 단추 (`src/lib/QueryView.svelte`) — 재생 삼각형. 번개(`zap`)는 상태바의 **자동 승인**
   * 신호라 "실행" 에 같은 그림을 쓰면 뜻이 겹친다(한 그림은 한 뜻). 기본은 윤곽 그림이다 — 칠한 삼각형은 옆 12px
   * 아이콘들보다 무거워 보인다. 꽉 찬 변형은 앨범 [이어받기] 원 단추(`orchestration/player/Home.svelte`)만 쓴다.
   */
  ["play", "material-symbols:play-arrow-outline-rounded", { filled: "play-arrow-rounded" }],
  ["pause", "material-symbols:pause-outline-rounded"],
  ["stop", "material-symbols:stop-outline-rounded"],
  /** 쿼리 타일의 [스크립트 실행] 단추 — 글이 적힌 두루마리(여러 문장을 차례로). 파일 타일 자세히 보기의 `list` 와 가른다 */
  ["scroll-text", "material-symbols:receipt-long-outline-rounded"],
  /** 미리 보기 패널 켜고 끄기 (`F11`) — 오른쪽 패널. 장소 패널(`F9`)에는 단추가 없다 */
  ["preview", "material-symbols:right-panel-open-outline-rounded"],

  // 문서 타일 도구줄 (`src/lib/DocView.svelte`) — 아이콘만 서고 이름은 툴팁이다. `list-tree`(목차) · `pin`/`pin-off` ·
  //   `edit` · `external` · `check`(편집 종료) · `split-h`(나란히)는 위와 같은 이름을 나눠 쓴다.
  /** 마크다운 **원문** — 원문 보기 토글 · 편집 중 [원문만] · 좁은 타일의 [원문] 탭이 한 그림이다 */
  ["view-source", "material-symbols:code-outline-rounded"],
  /**
   * 마크다운을 **그린 결과** — 미리 보기 토글 · 편집 중 [미리 보기만] · [미리 보기] 탭. 펼친 책(`menu-book`) — `visibility` 를 쓰는
   * `show-hidden` 과 뜻이 달라 이름을 따로 둔다(위 AI 권한 주석의 규칙). 파일 타일의 `preview`
   * (오른쪽 패널을 여닫는다)와도 다르다 — 이쪽은 패널이 아니라 **보는 방식**이다.
   */
  ["view-rendered", "material-symbols:menu-book-outline-rounded"],
  /**
   * 문서 편집의 [저장] — 이번엔 정말로 **파일에 쓴다**. 위 `bookmark`·`file-down` 주석이 디스켓을 비켜 간
   * 까닭(이 앱의 "저장" 이 파일로 나가는 일이 아니었다)이 여기서는 서지 않는다.
   */
  ["save", "material-symbols:save-outline-rounded"],
  /** 저장하지 않은 편집 버리기 — 기본값으로 되돌리기(`reset`)와 뜻이 달라 그림을 가른다 */
  ["undo", "material-symbols:undo-outline-rounded"],
  /**
   * 편집 중 나란히 보기의 [스크롤 맞추기] — 두 칸을 **묶는다**. 위 `route` 주석이 사슬을 비켜 간 까닭은
   * "누르면 어디로 간다" 로 읽힌다는 것이었는데, 여기는 눌린 상태(`aria-pressed`)를 가진 토글이라
   * 링크로 읽힐 자리가 아니다.
   */
  ["scroll-sync", "material-symbols:link-outline-rounded"],

  // 마크다운 알림(`> [!NOTE]` … — `src/lib/MarkdownBlocks.svelte`) 머리 줄. NOTE 는 위 `info`, WARNING 은 위 `warning`
  //   을 나눠 쓴다 — GitHub 의 알림 그림과 같은 짝이다.
  /** TIP — 전구 */
  ["alert-tip", "material-symbols:lightbulb-outline-rounded"],
  /** IMPORTANT — 느낌표 말풍선 */
  ["alert-important", "material-symbols:feedback-outline-rounded"],
  /** CAUTION — 팔각 경고(멈춤 표지) — WARNING 의 세모보다 한 단계 센 그림 */
  ["alert-caution", "material-symbols:report-outline-rounded"],

  // 문서 안 검색 띠(`src/lib/DocView.svelte`) — `search` · `chevron-down`(다음) · `close` 는 위 이름을 나눠 쓴다
  /** 이전 일치 — `chevron-down`(다음)의 짝 */
  ["chevron-up", "material-symbols:keyboard-arrow-up-outline-rounded"],
  /** 대소문자 구분 토글 — VS Code 찾기 칸의 `Aa` 와 같은 그림 */
  ["case-sensitive", "material-symbols:match-case-outline-rounded"],

  // mermaid 다이어그램 확대 · 축소(`src/lib/MermaidView.svelte`) — 가운데 배율 단추는 글자(%)라 그림이 없다
  /** 한 단계 크게 */
  ["zoom-in", "material-symbols:zoom-in-outline-rounded"],
  /** 한 단계 작게 */
  ["zoom-out", "material-symbols:zoom-out-outline-rounded"],

  // 쿼리 결과 [표 | 차트] 전환 · 차트 종류(`src/lib/query/ResultGrid.svelte` · `ResultChart.svelte`)
  /** 결과를 표로 */
  ["table", "material-symbols:table-outline-rounded"],
  /** 선 차트 */
  ["chart-line", "material-symbols:show-chart-outline-rounded"],
  /** 막대 차트 */
  ["chart-column", "material-symbols:bar-chart-outline-rounded"],
  /** 산점도 */
  ["chart-scatter", "material-symbols:scatter-plot-outline-rounded"],
  /** 원격 접속(원격 웹 클라이언트 — 설정 › 원격 접속 · 상태바 "원격 접속 중" 칩) — 모니터와 폰 */
  ["remote", "material-symbols:devices-outline-rounded"],

  // 로컬 자원 모니터(타일 머리줄 자원 칩 · 사용량 화면의 자원 칸 — `src/lib/pane/HeaderChips.svelte` · `console/ResourceBoard.svelte`)
  /** CPU · 메모리 */
  ["cpu", "material-symbols:memory-outline-rounded"],
  /** 메모리(램 모듈) — 상태바 자원 고리의 메모리 쪽 안쪽 마크(`StatusBar.svelte`) */
  ["memory", "material-symbols:memory-alt-outline-rounded"],

  /**
   * tmux 칩(타일 머리줄) · 호스트 줄의 tmux 표시 — tmux 를 띄우면 보이는 모습 그대로: 좌우로 나뉜 창 + 맨 아래 칠한 상태줄.
   * 어느 세트에도 tmux 가 없어 손으로 그렸다(아래 [`HAND`], 2026-11-04 사용자 선택).
   */
  ["tmux", "hand:tmux"],
  /**
   * 마우스 클릭 — 단축키 칩(`Keys.svelte`)이 `클릭` · `우클릭` · `더블클릭` 낱말 대신 그린다(2026-10-25). 누르는 단추 쪽 위 칸을
   * 채운다. Lucide 의 `mouse-left` · `mouse-right` 는 단추를 몸통 밖의 점으로 적어 16px 칩에서 어느 쪽인지 안 읽혀 손으로 그렸다.
   * 더블클릭은 왼쪽 아이콘 + 칩이 CSS 로 붙이는 작은 `2`(`theme.css` 의 `.keycap-mouse`)라 아이콘을 따로 두지 않는다.
   */
  ["mouse-left", "hand:mouse-left"],
  ["mouse-right", "hand:mouse-right"],
  // 문서 타일 본문 우클릭 메뉴(`doc-menu.ts`) — 편집 · 서식 옆목록 (2026-10-25). 실행 취소는 위 `undo` 를 같이 쓴다
  ["redo", "material-symbols:redo-outline-rounded"],
  ["cut", "material-symbols:content-cut-outline-rounded"],
  ["format", "material-symbols:text-format-outline-rounded"],
  ["paragraph", "material-symbols:format-paragraph-outline-rounded"],
  ["insert", "material-symbols:add-box-outline-rounded"],
  ["bold", "material-symbols:format-bold-outline-rounded"],
  ["italic", "material-symbols:format-italic-outline-rounded"],
  ["strikethrough", "material-symbols:format-strikethrough-outline-rounded"],
  ["code", "material-symbols:code-outline-rounded"],
  ["link", "material-symbols:link-outline-rounded"],
  ["heading-1", "material-symbols:format-h1-outline-rounded"],
  ["heading-2", "material-symbols:format-h2-outline-rounded"],
  ["heading-3", "material-symbols:format-h3-outline-rounded"],
  ["list-ordered", "material-symbols:format-list-numbered-outline-rounded"],
  ["quote", "material-symbols:format-quote-outline-rounded"],
  ["code-block", "material-symbols:code-blocks-outline-rounded"],
  // 폰 상태줄의 사이드 채팅 단추(말풍선 하나 — 지난 대화의 `conversations` 는 말풍선 둘) · 폰 입력 칸의 그림 고르기(2026-11-01)
  ["chat", "material-symbols:chat-bubble-outline-rounded"],
  ["image-plus", "material-symbols:add-photo-alternate-outline-rounded"],
  // 사이드 채팅 `[+]` › 파일 업로드(2026-11-14 — 클립)
  ["attach-file", "material-symbols:attach-file-rounded"],
];

/**
 * **손으로 그린 아이콘** — 세트에 맞는 그림이 없을 때만. 24 격자 · 굵기 2 · 둥근 끝 · `currentColor` 로 그려
 * 한 줄에 세워도 갈리지 않게 한다. 출처가 앱 자신이라 머리 크레딧에는 넣지 않는다.
 */
const HAND = {
  tmux: {
    body:
      `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v12"/></g>` +
      `<path fill="currentColor" d="M3 15h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`,
  },
  /** Material `draft-outline-rounded` 윤곽 그대로 + 안에 Material `link-rounded`(-45도 · 0.576배 · 중심 12,14.4 로 구운 좌표) */
  "file-symlink": {
    body:
      `<path fill="currentColor" d="M6 22q-.825 0-1.412-.587T4 20V4q0-.825.588-1.412T6 2h7.175q.4 0 .763.15t.637.425l4.85 4.85q.275.275.425.638t.15.762V20q0 .825-.587 1.413T18 22zm7-14V4H6v16h12V9h-4q-.425 0-.712-.288T13 8M6 4v5zv16z"/>` +
      `<path fill="currentColor" d="M12 18.473Q11.155 19.318 9.964 19.318Q8.772 19.317 7.927 18.473Q7.082 17.629 7.082 16.436Q7.083 15.244 7.927 14.4L9.149 13.178Q9.322 13.005 9.557 13.005Q9.791 13.005 9.964 13.178Q10.136 13.351 10.137 13.586Q10.137 13.82 9.964 13.993L8.742 15.215Q8.233 15.724 8.233 16.436Q8.233 17.149 8.742 17.658Q9.251 18.167 9.964 18.167Q10.676 18.167 11.185 17.658L12.407 16.436Q12.58 16.263 12.815 16.263Q13.05 16.263 13.222 16.436Q13.394 16.61 13.395 16.844Q13.396 17.079 13.222 17.251ZM11.185 16.029Q11.012 16.202 10.778 16.202Q10.544 16.201 10.371 16.029Q10.198 15.857 10.198 15.622Q10.199 15.387 10.371 15.215L12.815 12.771Q12.988 12.598 13.222 12.598Q13.457 12.598 13.629 12.771Q13.801 12.944 13.802 13.179Q13.803 13.413 13.629 13.585ZM14.851 15.622Q14.678 15.795 14.444 15.795Q14.21 15.794 14.036 15.622Q13.863 15.45 13.864 15.215Q13.864 14.98 14.036 14.807L15.258 13.585Q15.767 13.076 15.767 12.364Q15.767 11.651 15.258 11.142Q14.749 10.633 14.036 10.633Q13.324 10.633 12.815 11.142L11.593 12.364Q11.42 12.537 11.185 12.536Q10.951 12.536 10.778 12.364Q10.605 12.191 10.605 11.956Q10.606 11.721 10.778 11.549L12 10.327Q12.845 9.482 14.037 9.482Q15.229 9.482 16.073 10.327Q16.917 11.172 16.918 12.364Q16.919 13.556 16.073 14.4Z"/>`,
  },
  /** Material `folder-rounded` 윤곽 + `link-rounded`(-45도 · 0.72배 · 중심 12,13.2 로 구운 좌표) 구멍(`evenodd`) — 뒤 배경이 고리로 비친다 */
  "folder-symlink": {
    body:
      `<path fill="currentColor" fill-rule="evenodd" d="M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h5.175q.4 0 .763.15t.637.425L12 6h8q.825 0 1.413.588T22 8v10q0 .825-.587 1.413T20 20z` +
      `M12 18.291Q10.944 19.348 9.454 19.347Q7.965 19.347 6.909 18.291Q5.852 17.236 5.853 15.746Q5.853 14.255 6.909 13.2L8.436 11.673Q8.653 11.456 8.946 11.456Q9.239 11.456 9.454 11.673Q9.67 11.889 9.671 12.182Q9.672 12.476 9.454 12.691L7.927 14.218Q7.291 14.855 7.291 15.746Q7.291 16.637 7.927 17.273Q8.563 17.909 9.454 17.909Q10.345 17.909 10.982 17.273L12.509 15.746Q12.725 15.529 13.019 15.529Q13.312 15.529 13.527 15.746Q13.743 15.962 13.744 16.255Q13.745 16.548 13.527 16.764ZM10.982 15.236Q10.765 15.453 10.473 15.452Q10.18 15.452 9.964 15.236Q9.747 15.021 9.748 14.727Q9.748 14.434 9.964 14.218L13.018 11.164Q13.235 10.947 13.528 10.947Q13.821 10.947 14.036 11.164Q14.252 11.38 14.253 11.673Q14.254 11.966 14.036 12.182ZM15.564 14.727Q15.347 14.944 15.055 14.943Q14.762 14.943 14.546 14.727Q14.329 14.512 14.33 14.218Q14.33 13.924 14.546 13.709L16.073 12.182Q16.709 11.545 16.709 10.654Q16.709 9.763 16.073 9.127Q15.437 8.491 14.546 8.491Q13.655 8.491 13.018 9.127L11.491 10.654Q11.275 10.871 10.982 10.87Q10.689 10.87 10.473 10.654Q10.256 10.439 10.257 10.145Q10.257 9.852 10.473 9.636L12 8.109Q13.056 7.052 14.546 7.052Q16.036 7.052 17.091 8.109Q18.147 9.165 18.148 10.655Q18.149 12.145 17.091 13.2Z"/>`,
  },
  ...mouseGlyphs(),
  ...gaugeGlyphs(),
};

/**
 * `mouse-left` · `mouse-right` — Lucide `mouse` 와 같은 몸통(14×20 · 둥근 끝 7) + 가운데 세로선 + 단추 칸을 가르는 가로선, 누르는
 * 쪽 위 칸(몸통의 둥근 머리 반쪽 ~ 가로선)을 `currentColor` 로 칠한다. 칠한 칸도 같은 획으로 두른다.
 */
function mouseGlyphs() {
  const shell = `<rect width="14" height="20" x="5" y="2" rx="7"/><path d="M12 2v8M5 10h14"/>`;
  const glyph = (button) =>
    `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">` +
    shell +
    `<path fill="currentColor" d="${button}"/></g>`;
  return {
    "mouse-left": { body: glyph("M12 2a7 7 0 0 0-7 7v1h7z") },
    "mouse-right": { body: glyph("M12 2a7 7 0 0 1 7 7v1h-7z") },
  };
}

/**
 * `ai-gauge-0` ~ `ai-gauge-4` — 미니 게이지의 막대 넷(폭 4 · 사이 2 · 둥근 끝)을 24 격자에. 찬 막대는 `currentColor` 칠, 빈 막대는 같은 색
 * 28%(미니 게이지의 빈 칸 `color-mix(… 28%)` 와 같은 짙기). 막대는 **획이 아니라 칠**이다 — 폭 4 막대의 윤곽선은 14px 에서 속이 메워져
 * 찬 막대와 갈리지 않는다.
 */
function gaugeGlyphs() {
  const xs = [1, 7, 13, 19];
  const out = {};
  for (let at = 0; at <= 4; at++) {
    const bars = xs
      .map((x, i) => {
        const filled = i + 1 <= at;
        return `<rect x="${x}" y="5" width="4" height="14" rx="1.5"${filled ? "" : ` fill-opacity=".28"`}/>`;
      })
      .join("");
    out[`ai-gauge-${at}`] = { body: `<g fill="currentColor" stroke="none">${bars}</g>` };
  }
  return out;
}

/**
 * 세트 하나를 읽어 `{ icons, width, height, license, version }` 로. Material 의 `*-outline-rounded` 는 상당수가 별칭이라 풀어 둔다 —
 * 회전 · 뒤집기가 붙은 별칭은 `body` 만 옮기면 다른 그림이 되므로 풀지 않는다(이름 없음으로 아래에서 멈춘다).
 */
function loadSet(pkg) {
  const meta = require(`${pkg}/package.json`);
  const json = JSON.parse(readFileSync(require.resolve(`${pkg}/icons.json`), "utf8"));
  const icons = { ...json.icons };
  for (const [alias, def] of Object.entries(json.aliases ?? {})) {
    if (json.icons[def.parent] && Object.keys(def).length === 1) icons[alias] = json.icons[def.parent];
  }
  return {
    icons,
    width: json.width ?? 24,
    height: json.height ?? 24,
    license: meta.license ?? "(license 필드 없음)",
    // 로고 생성기와 **같은 규칙** — 락파일이 말하는 버전이지 설치본의 버전이 아니다
    // (`scripts/locked-version.mjs` 머리말).
    version: lockedVersion(pkg, meta.version),
  };
}

const sets = Object.fromEntries(Object.entries(SETS).map(([k, pkg]) => [k, loadSet(pkg)]));
sets.hand = { icons: HAND, width: 24, height: 24 };

const rows = [];
const seen = new Set();
for (const [name, ref, opts] of WANTED) {
  if (seen.has(name)) throw new Error(`이름이 겹칩니다: ${name}`);
  seen.add(name);
  const [setName, iconName] = ref.split(":");
  const set = sets[setName];
  if (!set) throw new Error(`모르는 세트: ${ref}`);
  const icon = set.icons[iconName];
  // 조용히 빠뜨리지 않는다 — 화면에서만 사라지면 한참 뒤에야 발견된다.
  if (!icon) throw new Error(`${ref} 를 찾을 수 없습니다 (세트에 그 이름이 없다)`);
  const left = icon.left ?? 0;
  const top = icon.top ?? 0;
  const width = icon.width ?? set.width;
  const height = icon.height ?? set.height;
  const filled = opts?.filled ? set.icons[opts.filled] : null;
  if (opts?.filled && !filled) throw new Error(`${setName}:${opts.filled} 를 찾을 수 없습니다 (${name} 의 꽉 찬 변형)`);
  rows.push(
    `  ${JSON.stringify(name)}: {\n` +
      `    source: ${JSON.stringify(ref)},\n` +
      `    viewBox: ${JSON.stringify(`${left} ${top} ${width} ${height}`)},\n` +
      `    body: ${JSON.stringify(opts?.fill ? `<g fill="currentColor" stroke="none">${icon.body}</g>` : icon.body)},\n` +
      (filled ? `    filledBody: ${JSON.stringify(filled.body)},\n` : "") +
      `  },`,
  );
}

const credits = Object.entries(SETS)
  .map(([k, pkg]) => ` *   - \`${k}\` — ${pkg} v${sets[k].version} · 라이선스 ${sets[k].license}`)
  .join("\n");

const out = `/**
 * **자동 생성 파일 — 손으로 고치지 마세요.**
 *
 *     npm run gen:ui-icons     (scripts/gen-ui-icons.mjs)
 *
 * Material Symbols Rounded 묶음(과 Lucide 몇 · 단색 로고 · 손그림)에서 \`scripts/gen-ui-icons.mjs\` 의 \`WANTED\` 목록에 적힌 것만 뽑아 온
 * **앱 크롬용 단색 아이콘**이다. 아이콘을 더하고 빼는 방법은 그 스크립트의 머리 주석에 있다.
 *
 * 출처:
 *
${credits}
 *
 * \`body\` 는 원본 그대로다(칠로 그린 단색 로고만 \`<g fill="currentColor">\` 로 한 겹 감싼다) — Material 은 \`fill="currentColor"\` 의 면,
 * Lucide 는 \`stroke="currentColor"\` · \`fill="none"\` · \`stroke-width="2"\` 의 획이고, 그중 무엇도 여기서 바꾸지 않는다. 색은
 * **부모가 정한 글자색**을 따라간다(\`currentColor\`).
 *
 * 사용자가 호스트에 골라 붙이는 **컬러 로고**는 여기 오지 않는다 —
 * \`host-icons.generated.ts\` 쪽이고, 그쪽은 원본 색을 지킨다.
 */

/** 생성된 UI 아이콘 하나 */
export interface UiIcon {
  /** 어느 묶음의 무엇인가 (\`"material-symbols:terminal-outline-rounded"\`) — 출처 추적용 */
  source: string;
  /** 이 아이콘의 viewBox (대개 \`"0 0 24 24"\`) */
  viewBox: string;
  /** SVG 안쪽 마크업 그대로 (\`currentColor\`) */
  body: string;
  /** 꽉 찬 변형의 마크업 — WANTED 에 적은 몇 개만 (\`UiIcon\` 의 \`filled\`) */
  filledBody?: string;
}

export const UI_ICONS: Readonly<Record<string, UiIcon>> = {
${rows.join("\n")}
};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`wrote ${OUT} (${rows.length} icons, ${out.length} bytes)`);

<script lang="ts">
  import { workspaceList, workspaceMainWindow } from "$lib/app/workspaces.svelte.js";
  import { canDeleteWorkspace } from "$lib/workspaces/sidebar";
  import { untrack } from "svelte";
  import {
    fuzzyMatch,
    hostLabel,
    hostMeta,
    hostSearchText,
    hostsInGroup,
    type GroupMeta,
    type HostEntry,
  } from "$lib/hosts";
  import HostIcon from "$lib/HostIcon.svelte";
  import ProjectIcon from "$lib/ProjectIcon.svelte";
  import { folderIcon, iconRef } from "$lib/host-icons";
  import {
    CONVERSATION_QUERY_WORDS,
    conversationMatches,
    conversationQuery,
    type ConversationPaletteEntry,
  } from "$lib/agent-sessions";
  import type { UsagePaletteEntry } from "$lib/agent-usage";
  import {
    ACTIONS,
    actionLabel,
    comboFromEvent,
    displayCombo,
    effectiveCombo,
    type Overrides,
  } from "$lib/keybindings";
  import { locale, t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { tabDisplayTitle, type TabSpec } from "$lib/session";
  import UiIcon from "$lib/UiIcon.svelte";
  import { DOCK_ACTION_ICONS, LAUNCHER_SEGMENTS } from "$lib/dock";
  import { chatDockAvailable } from "$lib/app/chat-dock.svelte.js";
  import { placeDefaultPalette, type CanvasRect } from "$lib/launcher";
  import {
    looksLikeAddress,
    parseQuickConnect,
    quickConnectLabel,
    type QuickConnectTarget,
  } from "$lib/quick-connect";
  import {
    shouldOfferSave,
    snippetSaveLabel,
    SNIPPET_QUERY_PREFIX,
    type SnippetPaletteEntry,
  } from "$lib/snippets";
  import {
    historyPaletteEntries,
    relativeTime,
    HISTORY_QUERY_PREFIX,
    type HistoryEntry,
  } from "$lib/history-search";
  import { blockMarkTitle } from "$lib/finish-notify";
  import { isRemote as remoteWindow } from "$lib/app/window.svelte.js";
  import { recentHosts, type HostHistory } from "$lib/host-history";
  import {
    isRemote,
    projectSearchText,
    projectTail,
    sortProjects,
    type Project,
  } from "$lib/projects";
  import type { ThemeProfile } from "$lib/theme-profiles";
  import Keys from "$lib/Keys.svelte";
  import {
    SETTINGS_INDEX,
    settingPath,
    settingSearchText,
    type SettingsIndexEntry,
  } from "$lib/settings-index";

  /**
   * 명령 팔레트 — 한 줄 입력으로 **호스트·그룹·탭·명령**을 한꺼번에 찾는다
   * (docs/log/2026-09-03-command-palette.md).
   *
   * ## 이 컴포넌트는 **아무것도 실행하지 않는다**
   *
   * 접속도, 타일 삽입도, 탭 전환도 여기서 하지 않는다 — 고른 것을 콜백으로
   * 올려 보내는 것이 전부다(`onconnect`·`onopengroup`·`onselecttab`·`onrunaction`).
   * 이유가 셋이다.
   *
   *  1. **규칙이 두 벌 생기지 않는다.** 그룹 전체 열기의 6개 확인, 접속의 계단 지연,
   *     스크롤백 상속, 동시 입력 편입 — 이런 규칙은 전부 `+page` 의 함수 안에 있다.
   *     팔레트가 직접 열기 시작하면 그 규칙들을 여기에 **다시** 적어야 하고, 그 순간부터
   *     드래그로 연 것과 팔레트로 연 것이 조용히 달라진다.
   *  2. **팔레트는 상태를 모른다.** 어느 타일이 활성인지, 지금 탭이 무엇인지는
   *     `+page` 만 안다. 그것을 여기로 끌어오면 목록을 그리는 일과 배치를 바꾸는 일이
   *     한 파일에서 뒤섞인다.
   *  3. 그래서 이 파일은 **순수하게 고르는 화면**이다 — 입력·필터·정렬·키보드 이동뿐이다.
   *
   * ## 열고 닫기
   *
   * 상위가 `{#if paletteOpen}` 로 **마운트/언마운트**한다. 그래서 "열 때 입력 자동 포커스"
   * 와 "닫을 때 질의 비우기" 를 따로 배선하지 않는다 — 질의는 이 컴포넌트의 지역 상태라
   * 언마운트되면 같이 사라지고, 포커스는 마운트 `$effect` 한 번이면 된다.
   */

  let {
    hosts,
    groupMeta = {},
    tabs,
    themeProfiles = [],
    snippets = [],
    history = [],
    hostHistory = {},
    projects = [],
    conversations = [],
    conversationsLoading = false,
    onopenconversation,
    onviewconversation,
    usage = [],
    noAgents = false,
    onopenusage,
    onopenproject,
    onopenprojectnew,
    seed = "",
    mirror = null,
    measureCanvas,
    activeTabId,
    keybindings,
    onclose,
    onconnect,
    onconnectnew,
    onquickconnect,
    onopengroup,
    onapplythemeprofile,
    oninsertsnippet,
    onsavesnippet,
    onmanagesnippets,
    oninserthistory,
    onselecttab,
    onrunaction,
    onopensetting,
  }: {
    /** `+page` 의 `hostCache` 그대로 — 사이드바가 보여 주는 것과 **같은 스냅숏**이다 */
    hosts: HostEntry[];
    /**
     * 그룹 경로 → 그 폴더의 메타 (`sessions.toml` 의 `[groups."경로"]` — 아이콘 · 색).
     *
     * 세션 타일에서 폴더에 우분투 로고를 붙였으면 여기서도 그 로고가 보여야 한다 — 같은
     * 폴더가 화면마다 다른 얼굴이면 고른 뜻이 없다. 비어 있어도 되고(상위가 아직 못 읽었다),
     * 그러면 줄은 예전처럼 테마 색 기본 폴더를 그린다.
     */
    groupMeta?: Record<string, GroupMeta>;
    /** 탭 목록 (탭 바가 그리는 것과 같은 배열·같은 순서) */
    tabs: TabSpec[];
    /**
     * 저장된 **모양 프로필** 목록 (docs/log/2026-09-15-theme-profiles.md).
     *
     * 목록 상태와 같은 이유로 프롭이다 — 팔레트는 스스로 아무것도 읽지 않는다(머리말).
     */
    themeProfiles?: readonly ThemeProfile[];
    /**
     * **스니펫 줄들** — 이미 걸러져 온다 (docs/log/2026-09-16-snippets.md).
     *
     * 다른 목록과 달리 원본 타입(`Snippet`)이 아니라 **팔레트가 그릴 네 칸**만 받는다
     * (`snippetPaletteEntries`). 되돌려 줄 것이 `id` 하나뿐이라 구조를 알 이유가 없고,
     * "지금 포커스가 어느 호스트인가" 에 따른 범위 거르기도 순수 층의 규칙이라 상위가
     * 그것을 지난 결과를 내려 준다 — 팔레트는 포커스를 모른다(머리말).
     */
    snippets?: readonly SnippetPaletteEntry[];
    /**
     * **이 창에서 실제로 돈 명령들** — 최신순·중복 없음 (docs/log/2026-09-17-history-search.md).
     *
     * 스니펫과 같은 이유로 프롭이다: 어느 타일이 열려 있고 그 타일을 뭐라고 부르는지는 앱
     * 상태이고, 팔레트는 그것을 모른다(머리말). 여기 오는 것은 이미 모아 접은 목록
     * (`windowHistory`)이고 팔레트가 하는 일은 **질의로 좁혀 그리는 것**뿐이다.
     */
    history?: readonly HistoryEntry[];
    /**
     * **호스트별 접속 이력** — 빈 질의일 때 맨 위 "최근" 묶음을 세운다
     * (docs/log/2026-09-23-host-history.md).
     *
     * 창 사본(`app/host-history.svelte.ts`)을 여기서 직접 읽지 않고 프롭으로 받는 것은
     * 스니펫과 같은 이유다 — 팔레트는 스스로 아무것도 읽지 않는다(머리말).
     */
    hostHistory?: HostHistory;
    /**
     * **프로젝트** 목록 (docs/log/2026-09-24-projects.md) — 창 사본(`app/projects.svelte.ts`)을
     * 상위가 내려 준다(이력과 같은 이유 — 팔레트는 스스로 아무것도 읽지 않는다).
     */
    projects?: readonly Project[];
    /**
     * **지난 대화** — `대화 ` 로 좁힌 질의에서만 선다 (docs/log/2026-09-26-agent-sessions.md). 이미 접은
     * 줄들(`conversationPaletteEntries`)을 상위가 내려 준다 — 팔레트는 읽지 않는다(머리말).
     */
    conversations?: readonly ConversationPaletteEntry[];
    /** 목록을 아직 읽는 중 — 비어 있을 때 "읽는 중…" 한 줄을 세운다 */
    conversationsLoading?: boolean;
    /** 대화 `Enter` = 재개(열려 있으면 그 타일로) · `Shift+Enter` = 새 대화로 계속(`fork`) */
    onopenconversation?: (agent: string, id: string, fork: boolean) => void;
    /**
     * 대화 `Ctrl+Enter`(또는 `Ctrl`+클릭) = **기록 보기** — 읽기 전용 시트(docs/log/2026-09-27-conversation-viewer.md).
     * `Ctrl` 은 대화 줄에서 비어 있던 수식이다(`Shift` 가 새 대화로 계속). 경로가 사라진 대화도 기록은 볼 수 있다.
     */
    onviewconversation?: (agent: string, id: string) => void;
    /**
     * **사용량** — 에이전트마다 한 줄("Claude Code 사용량 — 7일 83% · 12분 전 기준"), 값이 있는 에이전트만
     * (docs/log/2026-09-26-agent-usage.md). 접어 둔 줄을 상위가 내려 준다(머리말 — 팔레트는 읽지 않는다).
     */
    usage?: readonly UsagePaletteEntry[];
    /** 설정에서 에이전트를 모두 껐다 — `ai-panel`(에이전트 열기) 명령 줄을 세우지 않는다(상위가 내려 준다) */
    noAgents?: boolean;
    /** 사용량 줄 `Enter` — 사용량 화면을 연다 */
    onopenusage?: () => void;
    /** 프로젝트 `Enter` — 지금 탭의 활성 타일 옆에 연다 (독의 더블클릭과 **같은 함수**) */
    onopenproject?: (p: Project) => void;
    /** 프로젝트 Ctrl/Shift+Enter — 지금 탭에 타일로 연다 */
    onopenprojectnew?: (p: Project) => void;
    /**
     * 열릴 때 **입력칸에 미리 찍혀 있는 질의** (`;` 처럼 접두사 하나인 것이 보통이다).
     *
     * `SearchOverlay` 의 `seed` 와 같은 규약이다 — 이 컴포넌트는 `{#if}` 로 마운트되므로
     * **열릴 때 한 번**만 뜻이 있고, 그 뒤로는 사용자가 친 글자가 주인이다.
     */
    seed?: string;
    /**
     * **거울 모드**의 질의(`paletteMirror` — `null` = 보통). 이 값이 있는 동안 질의는 이것을 따르고
     * 입력칸은 포커스를 가져가지 않는다. `null` 이 되는 순간 입력칸이 포커스를 받는다(아래 `$effect`).
     */
    mirror?: string | null;
    /**
     * 판의 기준 상자 — 타일 캔버스의 지금 사각형을 재는 함수(`tileCanvasRect`). 어디서 열든 이 자리 하나다(시작 화면 검색 칸에
     * 겹쳐 펼치던 `anchor` 는 2026-10-28 칸과 함께 걷었다 — docs/log/2026-10-28-start-widgets.md).
     * 판은 그 가로 가운데 · 위 + 캔버스 높이의 12% 에 선다(상태바가 어느 가장자리든 타일 영역 기준).
     * 창 크기가 바뀌면 다시 잰다. 없거나 `null` 을 돌려주면 CSS 자리(창 위 12vh 가운데).
     */
    measureCanvas?: () => CanvasRect | null;
    /** 지금 보고 있는 탭 (목록에서 "현재" 표시용) */
    activeTabId: string | null;
    /** 단축키 오버라이드 — 명령 줄 오른쪽의 조합 표시에 쓴다 (`settings.keybindings`) */
    keybindings: Overrides;
    /** Escape · 바깥 클릭 · 항목 실행 뒤 — 상위가 `paletteOpen = false` 로 받는다 */
    onclose: () => void;
    /** 호스트 `Enter` — **지금 탭**의 활성 타일 옆에 연다 */
    onconnect: (host: HostEntry) => void;
    /** 호스트 `Shift+Enter` — **새 탭**에서 연다 */
    onconnectnew: (host: HostEntry) => void;
    /**
     * **빠른 접속** — 설정에 없는 대상 하나를 올린다
     * (docs/log/2026-09-16-quick-connect-and-host-keys.md). 자리 잡기는 `onconnect` 와 같은
     * 길이라 여기서도 대상만 올린다 (이 파일은 아무것도 실행하지 않는다 — 머리말).
     */
    onquickconnect?: (target: QuickConnectTarget) => void;
    /** 그룹 전체 열기 — 경로만 올린다 (어느 타일 옆인지는 상위가 정한다) */
    onopengroup: (path: string) => void;
    /** 모양 프로필 적용 — 프로필 id 하나 (설정 화면의 select 와 **같은 함수**다) */
    onapplythemeprofile?: (id: string) => void;
    /** 스니펫 삽입 — 스니펫 id 하나 (설정의 [삽입] 과 **같은 함수** `insertSnippet`) */
    oninsertsnippet?: (id: string) => void;
    /**
     * **지금 친 글자를 스니펫으로 저장** — 저장 대화상자를 여는 문
     * (docs/log/2026-09-16-snippets.md). 팔레트는 여전히 아무것도 만들지 않는다: 올려 보내는
     * 것은 명령 문자열 하나이고, 이름을 짓고 범위를 고르고 파일에 남기는 일은 전부 위에 있다.
     */
    onsavesnippet?: (command: string) => void;
    /** "스니펫 관리…" — 설정 독의 스니펫 섹션을 연다 (목록이 비어 있어도 들어갈 길이다) */
    onmanagesnippets?: () => void;
    /**
     * 이력 한 줄을 **포커스된 터미널에 넣는다** — `run` 이 참이면 `\r` 까지
     * (`Shift+Enter`). 올려 보내는 것은 명령 문자열 하나이고, 어디에 쓸지·쓸 데가 있는지를
     * 판정하는 일은 전부 `insertHistoryCommand` 안에 있다 (이 파일은 아무것도 실행하지
     * 않는다 — 머리말).
     */
    oninserthistory?: (command: string, run: boolean) => void;
    onselecttab: (tabId: string) => void;
    /** 액션 id 하나 — 상위의 `runAction` 이 **키 디스패처와 같은 코드**로 실행한다 */
    onrunaction: (id: string) => void;
    /**
     * 설정 줄 — 섹션 id 와 그 안 줄의 DOM id(없으면 섹션만). 여는 일은 상위의
     * `openSettingsAt` 하나다 (docs/log/2026-09-25-palette.md · 색인은 `settings-index.ts`).
     */
    onopensetting?: (section: string, anchor: string | null) => void;
  } = $props();

  /**
   * 목록의 한 줄. 네 종류가 한 배열에 섞여 들어가고 머리글은 **종류가 바뀌는 자리**에
   * 자동으로 생긴다 (섹션마다 배열을 따로 두면 ↑↓ 이동이 섹션 경계에서 끊긴다).
   */
  type PaletteItem =
    | { kind: "quick"; key: string; target: QuickConnectTarget; label: string }
    | { kind: "host"; key: string; host: HostEntry }
    /**
     * **최근 접속한 호스트** — 빈 질의일 때만 맨 위에 선다. 줄의 생김새와 여는 길은 `host`
     * 와 **같다**(같은 `onconnect`/`onconnectnew`). 종류를 따로 둔 이유는 머리글 하나다:
     * 머리글이 **종류가 바뀌는 자리**에 서므로, 같은 `host` 로 두면 "최근" 과 "호스트" 가
     * 한 묶음으로 붙어 경계가 사라진다. 같은 호스트가 아래 "호스트" 묶음에도 한 번 더
     * 서므로 키 접두사(`r:`)를 달리한다.
     */
    | { kind: "recent"; key: string; host: HostEntry }
    /** 프로젝트 한 줄 (docs/log/2026-09-24-projects.md) — 호스트 묶음 바로 뒤에 선다 */
    | { kind: "project"; key: string; project: Project }
    | { kind: "group"; key: string; path: string; count: number }
    | { kind: "tab"; key: string; tab: TabSpec }
    | { kind: "theme"; key: string; profile: ThemeProfile }
    /**
     * 스니펫 한 줄. `id` 가 `null` 이면 **"스니펫 관리…"** 줄이다 — 종류를 따로 만들지 않은
     * 이유는 머리글이 **종류가 바뀌는 자리**에 생기기 때문이다 (위 주석). 별도 종류로 두면
     * 목록 끝에 "스니펫" 머리글이 한 번 더 서고, 그 줄은 같은 묶음의 마지막 칸이다.
     */
    | {
        kind: "snippet";
        key: string;
        id: string | null;
        label: string;
        detail: string;
        /**
         * **저장 줄**이면 저장할 명령(= 지금 친 글자). 있는 줄은 이것 하나뿐이고, 있으면
         * `id` 는 `null` 이다 (docs/log/2026-09-16-snippets.md).
         *
         * `id === null` 만으로는 "관리…" 줄과 구분되지 않아 칸을 하나 더 둔다 — 종류
         * (`kind`)를 새로 만들지 않는 이유는 그때와 같다: 머리글이 **종류가 바뀌는 자리**에
         * 생기므로 "스니펫" 머리글이 한 번 더 서 버린다.
         */
        save?: string;
      }
    /**
     * **명령 이력 한 줄** (`!`). 스니펫 줄과 같은 결로 **이미 그릴 글자로 접어** 둔다 —
     * 뒷글자(타일 이름 + 상대 시각)도 말풍선(종료 코드)도 사전을 지나야 만들어지는 값이라
     * `{#each}` 안에서 만들면 같은 계산이 매 프레임 돈다.
     *
     * `command` 가 빈 문자열이면 **빈 상태 줄**이다 (이력이 하나도 없다). 종류를 따로 만들지
     * 않은 이유는 스니펫의 "관리…" 줄과 같다 — 머리글은 **종류가 바뀌는 자리**에 서므로,
     * 별도 종류로 두면 "명령 이력" 머리글 아래에 또 다른 머리글이 선다. 진짜 이력 줄의
     * 명령문은 절대 비지 않는다 (`collectHistory` 가 걸러 낸다).
     */
    | {
        kind: "history";
        key: string;
        command: string;
        tail: string;
        /** 네이티브가 아니라 앱 말풍선으로 뜬다 (`tooltip.svelte.ts` 가 `title` 을 가로챈다) */
        title: string;
        /** 종료 코드가 0 이 아니다 — 뒷글자 앞에 붉은 `✗` 를 세운다 */
        failed: boolean;
        /** 종료 코드가 0 이다 — 흐린 `✓`. 못 읽었거나 실행 중이면 **둘 다 거짓**이다 */
        ok: boolean;
      }
    /**
     * **지난 대화 한 줄** (`대화 `). `entry` 가 `null` 이면 빈 상태 줄(읽는 중 · 없음) — 이력의 빈 줄과
     * 같은 이유로 종류를 따로 만들지 않는다. 폴더가 사라진 대화(`missing`)도 누를 수 없다.
     */
    | { kind: "conversation"; key: string; entry: ConversationPaletteEntry | null; tail: string; empty: string }
    /** **사용량 한 줄** — 에이전트마다. 누르면 사용량 화면 */
    | { kind: "usage"; key: string; entry: UsagePaletteEntry }
    | { kind: "action"; key: string; id: string; label: string; combo: string }
    /**
     * **설정 한 줄** — 정적 색인(`SETTINGS_INDEX`)의 항목. `path` 는 이미 번역된 조각들
     * ("설정" · "터미널" · "벨")이고 줄은 그것을 `›` 로 잇는다 (docs/log/2026-09-25-palette.md).
     */
    | { kind: "setting"; key: string; entry: SettingsIndexEntry; path: string[] };

  /** 종류 → 머리글 **문구 키** (`{#each}` 가 그릴 때 `t()` 를 지난다) */
  const SECTION_LABEL: Record<PaletteItem["kind"], Key> = {
    quick: "commands.palette.section.quick",
    recent: "commands.palette.section.recent",
    host: "commands.palette.section.host",
    project: "commands.palette.section.project",
    group: "commands.palette.section.group",
    tab: "commands.palette.section.workspace", // i18n 키는 옛 이름 그대로 (docs/conventions.md 용어표)
    theme: "commands.palette.section.theme",
    snippet: "commands.palette.section.snippet",
    history: "commands.palette.section.history",
    conversation: "commands.palette.section.conversation",
    usage: "commands.palette.section.usage",
    action: "commands.palette.section.action",
    setting: "commands.palette.section.setting",
  };

  /**
   * 한 번에 그리는 최대 줄 수.
   *
   * 호스트가 수백 개인 `~/.ssh/config` 도 드물지 않은데, 빈 질의에서 그 전부를 DOM 에
   * 올리면 팔레트가 뜨는 첫 프레임이 눈에 띄게 늦는다. 어차피 40줄 아래는 스크롤해야
   * 보이고, 그 지경이면 사용자는 스크롤 대신 **글자를 더 친다** — 그게 팔레트의 사용법이다.
   */
  const MAX_ITEMS = 40;

  /**
   * 명령 줄의 앞자리 아이콘 — **독의 그림을 그대로 빌려 온다**
   * (docs/log/2026-09-15-lucide-ui-icons.md · 2026-10-18 통합 독 — 예전에는 상태바 메뉴 칸 표였다).
   *
   * 같은 일(새 터미널·호스트·로컬 파일·설정·작업안)을 독에서 누르든 팔레트에서
   * 고르든 **한 그림**이어야 한다 — 표를 여기에 다시 적으면 한쪽만 고치는 사고가 난다.
   * 목록에 없는 나머지 명령은 `command`(팔레트 자신의 그림)로 떨어진다.
   */
  // 동작 그림(`DOCK_ACTION_ICONS`) 뒤에 독의 칸 표를 적는다 — 칸 명령(호스트 · 프로젝트 · DB · 알림)은 그 칸의 그림이다.
  const ACTION_ICON = new Map([
    ...DOCK_ACTION_ICONS,
    ...LAUNCHER_SEGMENTS.map((s) => [s.action ?? s.paletteId ?? "", s.icon] as const),
  ]);

  /**
   * 질의. 초깃값이 `seed` 인 것은 **마운트 한 번**의 이야기다 (`seed` 주석 · `SearchOverlay`
   * 와 같은 `untrack` 규약) — 그 뒤로는 사용자가 친 글자가 주인이다.
   */
  let query = $state(untrack(() => seed));
  /**
   * 하이라이트된 줄. 목록이 줄어들면 범위를 벗어날 수 있어 **읽을 때 [`sel`] 로 죈다** —
   * 여기에 바로 죄어 넣으면 질의를 지웠을 때 커서가 엉뚱한 곳에 남는다.
   */
  let selRaw = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  /**
   * 판의 좌표 — 캔버스를 창 크기가 바뀔 때마다 다시 잰다(예전 CSS 자리도 창을 따라 움직였다).
   */
  let vw = $state(0);
  let vh = $state(0);
  const placed = $derived.by(() => {
    if (vw <= 0 || vh <= 0) return null;
    const canvas = measureCanvas?.() ?? null;
    return canvas ? placeDefaultPalette(canvas, vw, vh) : null;
  });

  /**
   * **거울 모드**(`mirror` ≠ `null` — `paletteMirror` 주석): launcher 의 숨은 입력칸이 IME 조합을 쥐고
   * 있는 동안 질의는 그 칸의 값을 따라가고, 입력칸은 포커스를 가져가지 않는다(조합 중에 포커스가
   * 옮겨 가면 Chromium 이 조합을 취소한다 — docs/log/2026-09-25-launcher.md 3절).
   */
  $effect(() => {
    if (mirror !== null) query = mirror;
  });

  /**
   * 열리는 순간 입력으로 — 팔레트는 키보드가 먼저 닿는 화면이다. 거울 모드면 거울이 걷히는 순간
   * 가져간다. 커서는 끝에 둔다(실어 온 글자 뒤에 이어 친다).
   */
  $effect(() => {
    if (mirror !== null || !inputEl) return;
    inputEl.focus();
    const end = inputEl.value.length;
    inputEl.setSelectionRange(end, end);
  });

  /**
   * 질의 앞의 한 글자로 **찾을 곳을 좁힌다**.
   *
   * `>` 명령 · `@` 탭 · `#` 그룹 · `;` 스니펫, 없으면 전부. 앞의 세 글자는 다른
   * 도구의 관습 그대로다 — 새로 외울 것을 만들지 않는 편이 낫고, 접두사는 어디까지나
   * **지름길**이라 몰라도 팔레트는 그대로 동작한다 (접두사 없는 질의가 모든 섹션을 훑는다).
   *
   * 넷째(`;` · [`SNIPPET_QUERY_PREFIX`])만 관습이 아니라 **단축키와 같은 글자**다:
   * `Ctrl+Shift+;` 가 이 접두사를 찍은 채 팔레트를 연다 (docs/log/2026-09-16-snippets.md).
   *
   * 다섯째(`!` · [`HISTORY_QUERY_PREFIX`])는 다시 관습이다 — 셸의 `!!`·`!$` 가 가리키는 것이
   * 정확히 이 목록(지난 명령)이다 (docs/log/2026-09-17-history-search.md).
   */
  const parsed = $derived.by(() => {
    // 낱말 접두사(`대화 ` · `conv `)가 먼저다 — 글자 하나 접두사와 겹치지 않는다.
    const convo = conversationQuery(query);
    if (convo !== null) return { scope: "conv", q: convo };
    const raw = query.trimStart();
    const head = raw[0];
    if (
      head === ">" ||
      head === "@" ||
      head === "#" ||
      head === SNIPPET_QUERY_PREFIX ||
      head === HISTORY_QUERY_PREFIX
    ) {
      return { scope: head, q: raw.slice(1).trim() };
    }
    return { scope: "", q: raw.trim() };
  });

  /**
   * 이 섹션을 지금 질의에서 보여 주는가 (접두사가 없으면 전부 본다).
   *
   * **스니펫에만 접두사를 새로 판 이유**는 그 반대다 — 외울 글자가 느는 것이 아니라, 이미
   * 있는 단축키(`Ctrl+Shift+;`)가 여는 화면이 곧 이 좁힌 목록이라 글자와 키가 **같은 것**을
   * 가리킨다. 스니펫은 수십 개가 쌓이는 것이 정상이라 좁히는 값도 크다.
   *
   * **명령 이력만은 접두사가 없으면 아예 안 뜬다** (다른 섹션과 반대다). 이유는 양이다 —
   * 타일당 200 블록이 쌓이고 모아 놓으면 수백 줄이라, 접두사 없는 질의에 섞어 두면
   * `web` 한 글자에 호스트 줄이 이력 줄에 파묻힌다. 게다가 이력은 **같은 글자가 이미 다른
   * 섹션에 있을 때** 가장 시끄럽다(스니펫 = 저장해 둔 명령, 이력 = 실제로 돈 명령). `!` 는
   * "지금은 지난 명령을 찾는 중" 이라는 표시이고, 그 표시가 있어야 목록의 뜻이 하나로 선다.
   */
  function wants(kind: PaletteItem["kind"]): boolean {
    const s = parsed.scope;
    // 지난 대화도 이력처럼 **접두사가 있어야** 선다 — 수백 개 제목이 호스트·명령 줄을 밀어낸다.
    if (s === "") return kind !== "history" && kind !== "conversation";
    if (s === "conv") return kind === "conversation";
    // 설정 줄도 `>` 에 선다 — "무엇을 한다" 의 목록이라 명령과 층이 같다(명령 묶음 바로 뒤).
    if (s === ">") return kind === "action" || kind === "setting";
    if (s === "@") return kind === "tab";
    if (s === SNIPPET_QUERY_PREFIX) return kind === "snippet";
    if (s === HISTORY_QUERY_PREFIX) return kind === "history";
    return kind === "group";
  }

  /**
   * **빠른 접속 줄** — 친 글자가 접속 대상으로 읽히면 목록 맨 위에 선다
   * (docs/log/2026-09-16-quick-connect-and-host-keys.md).
   *
   * 조건 넷이다.
   *
   *  1. **접두사 없는 질의**여야 한다 (`>`·`@`·`#` 는 각자의 뜻이 있다).
   *  2. **이미 있는 별칭이 아니다** — `web-01` 이 목록에 있는데 "빠른 접속: web-01" 이 그
   *     위에 서면 Enter 한 번이 엉뚱한 곳으로 간다 (그쪽은 설정의
   *     `HostName`·`User`·`ProxyJump` 를 쓰고 이쪽은 아무것도 안 쓴다).
   *  3. 문법을 통과한다 (`parseQuickConnect`).
   *  4. **주소처럼 보이거나**(`looksLikeAddress`) **찾은 호스트가 하나도 없다.** 이 넷째가
   *     ②의 연장이다 — `web-01` 을 찾느라 `web` 까지 친 순간에도 문법은 통과하기 때문에,
   *     그 표시가 없으면 목록 맨 위가 매 글자마다 빠른 접속으로 바뀐다.
   *
   * 맨 위인 이유: 이 줄이 뜬다는 것은 사용자가 주소를 쳤거나 목록에 아무것도 없다는 뜻이고,
   * 그때 원하는 것은 대개 그 접속이다.
   */
  const quickTarget = $derived.by((): QuickConnectTarget | null => {
    if (parsed.scope !== "") return null;
    const q = parsed.q;
    if (q === "") return null;
    if (hosts.some((h) => h.name.toLowerCase() === q.toLowerCase())) return null;
    if (!looksLikeAddress(q) && hosts.some((h) => fuzzyMatch(q, hostSearchText(h)))) return null;
    // 프로젝트가 걸려도 같은 이유로 물러선다 — `api` 를 쳐서 `api` 프로젝트를 찾는 중인데 맨 위가
    // "빠른 접속: api" 면 Enter 한 번이 엉뚱한 곳으로 간다 (docs/log/2026-09-24-projects.md).
    if (!looksLikeAddress(q) && projects.some((p) => fuzzyMatch(q, projectSearchText(p)))) return null;
    return parseQuickConnect(q);
  });

  /**
   * 호스트 줄의 정렬 등급 — 낮을수록 위다.
   *
   * `fuzzyMatch` 는 별칭·접속정보·그룹·태그를 **한 문자열로 이어** 부분수열로 보므로
   * (`hostSearchText`), 통과 여부만으로는 "이름이 정확히 그것인 호스트" 와 "태그 어딘가에
   * 글자들이 흩어져 있는 호스트" 가 같은 값이 된다. 별칭을 정확히/앞에서부터 맞춘 것을
   * 위로 올려야 `web-01` 을 치고 곧바로 Enter 를 누를 수 있다.
   *
   * 같은 등급 안에서는 **입력 순서**(= `~/.ssh/config` 등장 순서)가 그대로 남는다
   * (`Array.prototype.sort` 는 안정 정렬이다). 파일을 고쳐 순서를 정할 수 있어야 한다는
   * 규칙은 그룹 전체 열기와 같다 (`hostsInGroup`).
   */
  function hostRank(h: HostEntry, q: string): number {
    if (q === "") return 2;
    const name = h.name.toLowerCase();
    const needle = q.toLowerCase().replace(/\s+/g, "");
    if (name === needle) return 0;
    if (name.startsWith(needle)) return 1;
    return 2;
  }

  /**
   * `hostCache` 에 실제로 등장하는 그룹 경로 — **조상 경로까지** 포함한다.
   *
   * 호스트들의 `group` 값이 `prod/web`·`prod/db` 뿐이어도 `prod` 는 화면에 존재하는
   * 폴더다(사이드바가 그렇게 그린다). 여는 쪽(`hostsInGroup`)도 하위 그룹을 포함하므로
   * `prod` 전체 열기는 말이 되고, 조상을 빼면 `#prod` 로 딱 그 폴더를 열 수가 없어진다.
   * 그래서 경로를 `/` 로 쪼개 앞에서부터 누적한 것을 전부 후보로 둔다.
   */
  const groupPaths = $derived.by(() => {
    const out = new Set<string>();
    for (const h of hosts) {
      const g = (hostMeta(h).group ?? "").trim();
      if (g === "") continue;
      const segs = g.split("/").filter((s) => s.trim() !== "");
      let acc = "";
      for (const seg of segs) {
        acc = acc === "" ? seg : `${acc}/${seg}`;
        out.add(acc);
      }
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  });

  /**
   * 팔레트에 띄우는 액션 목록 — 레지스트리에서 **두 종류를 뺀다**.
   *
   *  - `command-palette` 자기 자신: 이미 열려 있는 것을 목록에서 또 여는 줄은 뜻이 없다.
   *  - 파일 타일 층(`scope: "files"`): 그 타일이 활성일 때만 뜻이 있고, 실행도 그 타일의 키 처리
   *    (`browser/file-keys.ts`)가 한다 — 팔레트가 열리면 타일이 포커스를 잃는다.
   *  - `quit-app`: 원격 창이면 — 끝내기 모달의 세 명령이 집 PC 전용이다.
   *  - `ai-panel`: 설정에서 에이전트를 모두 껐을 때만(`noAgents`) — 열 에이전트가 없다.
   *  - `workspace-1`…`workspace-9`: 바로 아래 **탭 섹션**이 같은 일을 하되
   *    번호가 아니라 **이름**으로 한다. 둘 다 두면 목록의 절반이 "탭 n로" 로
   *    채워져 정작 이름으로 찾는 줄을 밀어낸다.
   */
  const paletteActions = $derived(
    ACTIONS.filter((a) => a.scope !== "files" && a.id !== "command-palette" && !/^workspace-[1-9]$/.test(a.id)
      && (!["switch-workspace", "next-workspace", "prev-workspace"].includes(a.id) || workspaceMainWindow())
      && (a.id !== "ai-panel" || !noAgents)
      // 채팅 독은 주 창에만 있다(2026-10-23 — 보조 창 · 원격 창에는 독이 마운트되지 않는다)
      && (a.id !== "open-chat-dock" || chatDockAvailable())
      // 끝내기는 원격 창에 없다(독의 끝내기 단추와 같은 판단 — 세 명령이 집 PC 전용이다)
      && (a.id !== "quit-app" || !remoteWindow)),
  );

  /**
   * **팔레트에만 서는 명령** — 단축키 레지스트리에 없다(기본 조합이 없고 설정 › 단축키에도 서지 않는다). 남은 `Ctrl+Shift`
   * 글자가 없어서다(`keybindings.ts` 의 `open-file` 주석). 줄의 생김새 · 실행 길은 여느 명령 줄과 같다(`onrunaction` →
   * `runAction`) — 조합 칸만 빈다. 브랜치 그래프: docs/log/2026-09-29-branch-graph.md.
   */
  const PALETTE_ONLY: readonly { id: string; key: Key }[] = [
    { id: "branch-graph", key: "commands.palette.action.branchGraph" },
    // 쿼리 타일 — DB 연결 고르기 모달(2026-10-12 · `app/query.svelte.ts` 의 `openDbPicker`)
    { id: "open-db", key: "commands.palette.action.openDb" },
    // 독의 알림 칸(2026-10-18) — 전용 단축키가 없는 칸이라 팔레트 줄 하나뿐이다(`dock.ts` 의 `paletteId` · 칸 없이 여는 길 — 상태바 독 단추 ·
    // 가장자리 호버 — 도 이 칸이다). DB 칸은 2026-10-21 `Ctrl+Shift+K` 를 받아 레지스트리(`ACTIONS`)로 올라갔다.
    { id: "open-alerts-dock", key: "commands.palette.action.alertsDock" },
    { id: "new-workspace", key: "app.workspaces.new" },
    { id: "rename-workspace", key: "app.workspaces.edit" },
    { id: "delete-workspace", key: "app.workspaces.delete" },
    // 오케스트레이션(2026-10-15 · 2b) — 키바인딩 없음(id 결정은 사용자 몫). (3차 6단계) 첫 줄의 이름은 그때그때 — 맡긴 저장소면 "이 저장소에서
    // AI 타일 열기", 아니면 "이 저장소 맡기기…"(`orchestrationStartLabel` — 아래 목록 짓기). · Run 보드(목록 · orphaned 포함)
    { id: "orchestration-start", key: "orch.start.openAiTile" },
    { id: "orchestration-board", key: "orch.palette.board" },
  ];

  /**
   * 액션의 검색 대상 문자열 — **지금 언어의 이름 + 영문 id**.
   *
   * 이름만 훑으면 한국어 화면에서 `>set` 이 "설정 열기" 를 못 찾는다(부분수열이 아니다).
   * 팔레트를 치는 손은 대개 영문 자판이 켜진 상태라, id(`open-settings`) 를 같이 훑는
   * 것이 실제 사용에 맞는다 — 한글로 "설정" 을 쳐도 이름 쪽에서 걸리므로 둘 다 산다.
   * (영어 화면에서는 이름과 id 가 대개 같은 낱말이라 이 겹침이 손해가 아니다.)
   */
  function actionSearchText(id: string, label: string): string {
    return `${label} ${id}`;
  }

  /** 지금 질의로 걸러 정렬한 줄들 (섹션 순서: 호스트 → 그룹 → 탭 → 명령) */
  const items = $derived.by(() => {
    const q = parsed.q;
    const out: PaletteItem[] = [];

    if (quickTarget) {
      const target = quickConnectLabel(quickTarget);
      out.push({
        kind: "quick",
        key: `q:${target}`,
        target: quickTarget,
        label: t("commands.palette.quick.row", { target }),
      });
    }

    // **최근** — 아무것도 치지 않았을 때만 맨 위에 선다 (docs/log/2026-09-23-host-history.md).
    // 편집기의 "최근 파일" 과 같은 자리다: 팔레트를 열자마자 Enter 한 번이면 방금 붙었던
    // 곳으로 돌아간다(첫 줄이 곧 선택이다). 한 글자라도 치면 사라진다 — 그때부터는 찾는
    // 중이고, 최근 호스트도 아래 "호스트" 묶음에서 다른 호스트와 똑같이 걸린다(순위를 따로
    // 올리지 않는다 — 친 글자와 맞는 정도가 먼저다). 이력이 비면 묶음도, 빈 상태 줄도 없다.
    if (query.trim() === "") {
      for (const h of recentHosts(hosts, hostHistory)) {
        out.push({ kind: "recent", key: `r:${h.name}`, host: h });
      }
    }

    if (wants("host")) {
      const matched = hosts.filter((h) => fuzzyMatch(q, hostSearchText(h)));
      const ranked = matched
        .map((h, i) => ({ h, rank: hostRank(h, q), i }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i);
      for (const { h } of ranked) out.push({ kind: "host", key: `h:${h.name}`, host: h });
    }

    // **프로젝트** — 이름·경로·호스트 별칭으로 걸린다. 호스트 뒤인 이유: 팔레트를 여는 가장
    // 흔한 용건은 여전히 호스트이고, 같은 글자가 둘에 걸리면(`aynx` 호스트와 `aynx` 프로젝트)
    // 익숙한 쪽이 먼저 서야 Enter 가 놀라지 않는다. 순서는 이름순이다.
    if (wants("project")) {
      for (const p of sortProjects(projects, "name", {})) {
        if (!fuzzyMatch(q, projectSearchText(p))) continue;
        out.push({ kind: "project", key: `p:${p.id}`, project: p });
      }
    }

    if (wants("group")) {
      for (const path of groupPaths) {
        if (!fuzzyMatch(q, path)) continue;
        out.push({
          kind: "group",
          key: `g:${path}`,
          path,
          count: hostsInGroup(hosts, path).length,
        });
      }
    }

    if (wants("tab")) {
      for (const tab of tabs) {
        if (!fuzzyMatch(q, tabDisplayTitle(tab, t))) continue;
        out.push({ kind: "tab", key: `w:${tab.id}`, tab });
      }
    }


    if (wants("theme")) {
      for (const profile of themeProfiles) {
        // 이름만이 아니라 **"테마 프로필 <이름>"** 전체를 훑는다 — 접두사를 새로 만들지
        // 않았으므로(다른 목록과 같은 판단), 묶음 이름을 그대로 쳐서 목록을 좁힐 수 있어야 한다.
        if (!fuzzyMatch(q, `${t("commands.palette.section.theme")} ${profile.name}`)) continue;
        out.push({ kind: "theme", key: `t:${profile.id}`, profile });
      }
    }

    if (wants("snippet")) {
      // 줄마다 훑는 글자가 `keywords` 한 덩어리다 (이름·명령 미리보기·설명·별칭을 이어 둔
      // 것 — `snippetPaletteEntries`). 목록은 **이미 범위로 걸러져** 왔다.
      // 훑는 글자 앞에 **묶음 이름**을 붙인다 ("스니펫" 을 치면 다 나온다) — 순수 층은
      // 화면 언어를 모르므로(`snippetPaletteEntries`) 그 낱말은 여기서 얹는다.
      const snippetWord = t("commands.palette.section.snippet");
      for (const e of snippets) {
        if (!fuzzyMatch(q, `${snippetWord} ${e.keywords}`)) continue;
        out.push({
          kind: "snippet",
          key: `s:${e.id}`,
          id: e.id,
          label: t("commands.palette.snippet.row", { name: e.name }),
          detail: e.detail,
        });
      }
      // **저장 줄** — `;` 로 좁혀 놓고 명령을 통째로 친 사람에게 그것을 남길 길을 준다
      // (docs/log/2026-09-16-snippets.md). 조건은 순수 규칙 하나다 (`shouldOfferSave`):
      // 세 글자 이상이고 같은 명령의 스니펫이 아직 없을 때. 접두사를 **요구하는** 이유는
      // 이 줄이 검색 결과가 아니라 만드는 조작이라, 접두사 없는 전체 팔레트에서 매 질의마다
      // 서면 시끄럽기 때문이다 (`;` 는 "스니펫 이야기 중" 이라는 표시다).
      //
      // 관리 줄보다 **앞**이다: 지금 친 글자를 곧바로 남기는 것이 더 가까운 다음 걸음이고,
      // 설정으로 가는 문은 늘 맨 끝에 있어야 자리를 외울 수 있다.
      const known = snippets.map((s) => s.command);
      if (parsed.scope === SNIPPET_QUERY_PREFIX && shouldOfferSave(q, known)) {
        out.push({
          kind: "snippet",
          key: "s:save",
          id: null,
          label: t("commands.palette.snippet.save", { command: snippetSaveLabel(q) }),
          detail: t("commands.palette.snippet.saveTail"),
          save: q,
        });
      }
      // 관리 줄은 **묶음의 맨 끝**이고, 위가 하나도 없어도 선다 — 스니펫이 아직 없는 사람이
      // `;` 를 쳤을 때 "결과가 없습니다" 만 남으면 만들러 갈 길이 화면에 없다.
      // 관리 줄이 걸리는 글자들 — 라벨만 훑으면 `>snip` 같은 영문 질의에서 사라진다
      // (액션 줄이 이름 + 영문 id 를 함께 훑는 것과 같은 이유 · `actionSearchText`).
      const manage = t("commands.palette.snippet.manage");
      if (fuzzyMatch(q, `${manage} ${t("commands.palette.snippet.manageKeywords")}`)) {
        out.push({
          kind: "snippet",
          key: "s:manage",
          id: null,
          label: manage,
          detail: t("commands.palette.snippet.manageTail"),
        });
      }
    }

    if (wants("history")) {
      // 목록은 **이미 모아 접혀** 왔다 (`windowHistory` — 최신순·중복 없음). 여기서 하는
      // 일은 좁히고 그릴 글자로 바꾸는 것뿐이고, 훑는 글자는 **명령문 하나**다
      // (`historyPaletteEntries` 주석). 같은 `fuzzyMatch` 를 넘겨 다른 섹션과 규칙이
      // 갈리지 않게 한다.
      const now = Date.now();
      for (const e of historyPaletteEntries(q, history, fuzzyMatch)) {
        out.push({
          kind: "history",
          // 같은 명령은 목록에 하나뿐이라 명령문이 그대로 키다 (중복 제거를 이미 지났다).
          key: `!:${e.command}`,
          command: e.command,
          tail: t("commands.palette.history.tail", {
            pane: e.paneLabel,
            when: relativeTime(e.startedAt, now, t),
          }),
          // 말풍선은 거터 표식·붉은 띠와 **같은 함수**다 — 종료 코드가 숫자로 사는 유일한
          // 자리가 거기이고(`blockOutcomeLabel` 주석), 화면에는 `exit N` 을 적지 않는다.
          title: blockMarkTitle(
            { commandLine: e.command, startedAt: e.startedAt, endedAt: e.endedAt, exit: e.exit },
            t,
          ),
          failed: e.exit !== null && e.exit !== 0,
          ok: e.exit === 0,
        });
      }
      // **빈 상태 줄** — 이력이 통째로 비었을 때만 선다 (질의에 안 걸린 것과 다른 사실이다:
      // 그때는 `palette.empty` 가 맞다). 여기서 말해야 할 것은 "왜 비어 있나" 이고, 답은
      // 셸 통합(OSC 133)이 켜진 타일에서만 블록이 모인다는 것이다.
      if (history.length === 0) {
        out.push({
          kind: "history",
          key: "!:empty",
          command: "",
          tail: "",
          title: "",
          failed: false,
          ok: false,
        });
      }
    }

    if (wants("conversation")) {
      const now = Date.now();
      for (const e of conversations) {
        // 부분 글자 — 부분수열이면 긴 제목이 거의 다 걸린다(`conversationMatches` 주석)
        if (!conversationMatches(q, e)) continue;
        const state =
          e.state === "open"
            ? t("commands.palette.conversation.open")
            : e.state === "missing"
              ? t("commands.palette.conversation.missing")
              : relativeTime(e.updatedAt, now, t);
        // aynx 밖에서 열린 대화 — 줄에 경고색 알약("밖에서 열림")으로 선다. Enter 는 재개 대신 대시보드의 그 줄로
        // 데려간다(`openConversationById` — 거기서 한 번 묻는다). docs/log/2026-09-26-project-start-screen.md 실기 ②.
        out.push({ kind: "conversation", key: `c:${e.key}`, entry: e, tail: `${e.scope} · ${state}`, empty: "" });
      }
      if (conversations.length === 0) {
        out.push({
          kind: "conversation",
          key: "c:empty",
          entry: null,
          tail: "",
          empty: t(conversationsLoading ? "commands.palette.conversation.loading" : "commands.palette.conversation.empty"),
        });
      }
    }

    // **사용량** — 찾는 중일 때만(빈 질의에서 두 줄이 늘 서면 명령 줄을 민다). 줄 글자 + 낱말("사용량 한도 usage")로 걸린다.
    if (wants("usage") && q !== "") {
      const words = t("commands.palette.usage.keywords");
      for (const e of usage) {
        if (!fuzzyMatch(q, `${e.label} ${words}`)) continue;
        out.push({ kind: "usage", key: e.key, entry: e });
      }
    }

    if (wants("action")) {
      for (const a of paletteActions) {
        const name = actionLabel(a.id);
        const label = t(name.key, name.params);
        if (!fuzzyMatch(q, actionSearchText(a.id, label))) continue;
        out.push({
          kind: "action",
          key: `a:${a.id}`,
          id: a.id,
          label,
          combo: displayCombo(effectiveCombo(a.id, keybindings)),
        });
      }
      for (const a of PALETTE_ONLY) {
        if (a.id.endsWith("-workspace") && !workspaceMainWindow()) continue;
        const label = t(a.key);
        if (!fuzzyMatch(q, actionSearchText(a.id, label))) continue;
        out.push({ kind: "action", key: `a:${a.id}`, id: a.id, label, combo: "" });
      }
    }

    // **설정** — 정적 색인에서 경로 글자(설정 · 섹션 · 소제목 · 이름) + 영문 id 로 걸린다.
    // 명령 **뒤**다: 같은 글자가 둘에 걸리면("터미널") 곧바로 하는 일이 먼저 서야 Enter 가
    // 놀라지 않고, 설정은 대개 이름을 끝까지 쳐서 찾는다. 빈 질의에서는 안 뜬다 — 예순 줄이
    // 목록을 채우면 명령 줄이 `MAX_ITEMS` 에 잘린다(찾는 중일 때만 뜻이 있는 목록이다).
    if (wants("setting") && q !== "") {
      const tr = (k: Key) => t(k);
      const root = t("commands.palette.setting.root");
      for (const entry of SETTINGS_INDEX) {
        if (!fuzzyMatch(q, `${root} ${settingSearchText(entry, tr)}`)) continue;
        out.push({
          kind: "setting",
          key: `set:${entry.section}:${entry.anchor ?? ""}`,
          entry,
          path: [root, ...settingPath(entry, tr)],
        });
      }
    }

    return out.slice(0, MAX_ITEMS);
  });

  /** 범위 안으로 죈 선택 위치 (빈 목록이면 `-1`) */
  const sel = $derived(items.length === 0 ? -1 : Math.min(selRaw, items.length - 1));

  /** 질의가 바뀌면 선택을 맨 위로 — 걸러낸 뒤의 1등이 곧 Enter 의 대상이어야 한다 */
  $effect(() => {
    void query;
    selRaw = 0;
  });

  /** 하이라이트가 목록 밖으로 나가지 않게 따라 스크롤한다 (↑↓ 로만 움직여도 보이게) */
  $effect(() => {
    const i = sel;
    if (i < 0 || !listEl) return;
    const row = listEl.querySelectorAll<HTMLElement>("[data-row]")[i];
    row?.scrollIntoView({ block: "nearest" });
  });

  /** 이 줄 위에 섹션 머리글을 그리는가 (= 앞줄과 종류가 다른 첫 줄) */
  function isSectionHead(i: number): boolean {
    return i === 0 || items[i - 1].kind !== items[i].kind;
  }

  /**
   * 한 줄을 실행한다. **여기서 하는 일은 콜백 호출과 닫기뿐**이다 (파일 머리말 참고).
   *
   * `alt`(변형 동작 — 어느 조합인지는 [`isVariant`])에 뜻이 있는 것은 **셋뿐**이다 — 호스트·
   * 프로젝트(지금 탭에 열기)와 명령 이력(넣고 곧바로 실행). 나머지 종류에서는 무시한다(있지도
   * 않은 두 번째 동작을 만들어 내는 것보다, 같은 키가 그냥 기본 동작을 하는 편이 예측 가능하다).
   */
  /**
   * 대화 줄의 `Ctrl` — 기록 보기. 재개와 달리 경로가 사라진 대화(`missing`)에서도 된다(파일은 남아 있다).
   * 처리했으면 `true`.
   */
  function viewIfAsked(item: PaletteItem, ev: { ctrlKey: boolean; shiftKey: boolean }): boolean {
    if (item.kind !== "conversation" || item.entry === null || !ev.ctrlKey || ev.shiftKey || !onviewconversation) {
      return false;
    }
    const { agent, id } = item.entry;
    onclose();
    onviewconversation(agent, id);
    return true;
  }

  function workspaceDeleteDisabled(item: PaletteItem): boolean {
    return item.kind === "action" && item.id === "delete-workspace" && !canDeleteWorkspace(workspaceList().length);
  }

  function run(item: PaletteItem, alt = false) {
    if (workspaceDeleteDisabled(item)) return;
    // 빈 상태 줄은 **누를 것이 아니다** — 닫지도 않는다 (`;` 의 관리 줄과 달리 갈 곳이
    // 없다). 닫기보다 **먼저** 보는 이유는 그것이 요점이기 때문이다: 팔레트가 닫히면
    // 사람은 자기가 무언가를 실행한 줄 안다.
    if (item.kind === "history" && item.command === "") return;
    if (item.kind === "conversation" && (item.entry === null || item.entry.state === "missing")) return;
    onclose();
    switch (item.kind) {
      case "quick":
        onquickconnect?.(item.target);
        break;
      case "host":
      case "recent":
        if (alt) onconnectnew(item.host);
        else onconnect(item.host);
        break;
      case "project":
        if (alt) onopenprojectnew?.(item.project);
        else onopenproject?.(item.project);
        break;
      case "group":
        onopengroup(item.path);
        break;
      case "tab":
        onselecttab(item.tab.id);
        break;
      case "theme":
        onapplythemeprofile?.(item.profile.id);
        break;
      // `id === null` 은 "스니펫 관리…" 줄이다 (위 [`PaletteItem`] 주석). 넣는 쪽은 id 만
      // 올려 보낸다 — 실제로 쓰는 일(범위 재확인·자리표시자 묻기·`write_*`)은 상위의
      // `insertSnippet` 하나에 있다 (이 파일은 아무것도 실행하지 않는다 — 머리말).
      case "snippet":
        if (item.save !== undefined) onsavesnippet?.(item.save);
        else if (item.id === null) onmanagesnippets?.();
        else oninsertsnippet?.(item.id);
        break;
      // `alt`(Shift+Enter) 가 **여는 줄 말고 뜻을 갖는 유일한 자리**다 — 넣기만 할지 곧바로
      // 실행할지. 같은 키에 두 뜻을 두는 것이 괜찮은 이유는 힌트가 줄마다 적히기 때문이다
      // (`variantHint` · 바닥 줄의 `enterHint`): 화면에 적힌 것과 키가 하는 일이 언제나 같다.
      case "history":
        oninserthistory?.(item.command, alt);
        break;
      case "conversation":
        if (item.entry) onopenconversation?.(item.entry.agent, item.entry.id, alt);
        break;
      case "usage":
        onopenusage?.();
        break;
      case "action":
        onrunaction(item.id);
        break;
      case "setting":
        onopensetting?.(item.entry.section, item.entry.anchor ?? null);
        break;
    }
  }

  /**
   * 이 줄에서 **변형 동작**을 누른 것인가 — `run` 의 `alt` 로 간다.
   *
   * - 호스트·최근·프로젝트: `Ctrl+Enter`(목업의 힌트) **또는** 예전부터 있던 `Shift+Enter` —
   *   호스트는 새 탭, 프로젝트는 지금 탭에 타일로 연다. 각각 `onconnectnew`/`onopenprojectnew`로 간다.
   * - 명령 이력: `Shift+Enter` **만** — 넣고 곧바로 실행이다. `Ctrl` 은 여기서 뜻이 없고,
   *   실행 여부가 걸린 자리라 모르는 조합을 "실행" 쪽으로 읽지 않는다(그냥 넣기).
   * - 나머지: 변형이 없다 — 어떤 수식키든 기본 동작이다.
   */
  function isVariant(item: PaletteItem, ev: { shiftKey: boolean; ctrlKey: boolean }): boolean {
    if (item.kind === "history" || item.kind === "conversation") return ev.shiftKey;
    if (item.kind === "host" || item.kind === "recent" || item.kind === "project") {
      return ev.shiftKey || ev.ctrlKey;
    }
    return false;
  }

  /**
   * 고른 줄 오른쪽에 적는 **변형 힌트** — 수식키 이름과 뜻. 변형이 없는 줄은 `null`
   * (그 줄에는 `↵` 하나만 선다). 적힌 조합이 곧 [`isVariant`] 가 받는 조합이다.
   */
  function variantHint(item: PaletteItem): { mod: string; label: string } | null {
    if (item.kind === "history") {
      return item.command === "" ? null : { mod: "Shift", label: t("commands.palette.history.hint.shiftEnter") };
    }
    if (item.kind === "project") return { mod: "Ctrl", label: t("commands.palette.hint.here") };
    if (item.kind === "host" || item.kind === "recent") {
      return { mod: "Ctrl", label: t("commands.palette.hint.newTab") };
    }
    // 열려 있는 대화는 Enter 가 그 타일로 가는 것뿐이다 — 새 대화로 계속은 대시보드에서
    if (item.kind === "conversation" && (item.entry?.state === "ok" || item.entry?.state === "elsewhere")) {
      return { mod: "Shift", label: t("commands.palette.conversation.hint.shiftEnter") };
    }
    return null;
  }

  /**
   * 팔레트 안의 키. 창 전역 단축키는 입력칸에 포커스가 있는 동안 `+page` 의
   * `isEditableTarget` 가드에 막혀 오지 않으므로(그게 맞다 — 타이핑 중에 분할이 일어나면
   * 곤란하다), **팔레트를 닫는 조합만은 여기서 직접** 본다. 그래야 `Ctrl+Shift+P` 가 토글로
   * 동작하고, 사용자가 그 조합을 다른 것으로 바꿔 두었어도 그대로 따라간다.
   */
  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 창의 Escape 사슬이 뒤이어 다른 모달까지 닫지 않게
      onclose();
      return;
    }

    const combo = comboFromEvent(ev);
    if (combo && combo === effectiveCombo("command-palette", keybindings)) {
      ev.preventDefault();
      onclose();
      return;
    }

    const n = items.length;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (n > 0) selRaw = (sel + 1) % n; // 끝에서 처음으로 감싼다
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (n > 0) selRaw = (sel - 1 + n) % n;
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const item = items[sel];
      if (item && !viewIfAsked(item, ev)) run(item, isVariant(item, ev));
    }
  }

  /**
   * 바닥 줄의 `↵` 뒷글자 — **`!` 를 친 동안에는 다른 말**이다.
   *
   * 다른 섹션에서 `Enter` 는 "실행"(접속·전환·적용)이지만 이력 줄에서는 **넣기만** 하고,
   * `Shift+Enter` 는 "새 탭에서 열기" 가 아니라 "넣고 실행" 이다. 힌트를 고정해 두면 같은
   * 키가 화면에 적힌 것과 다른 일을 하게 되고, 그 차이가 **실행하느냐 마느냐**라 흘려 둘
   * 자리가 아니다 (이력의 명령은 다른 서버에서 돌던 것일 수 있다).
   */
  const historyScope = $derived(parsed.scope === HISTORY_QUERY_PREFIX);
  const enterHint = $derived(
    t(
      historyScope
        ? "commands.palette.history.hint.enter"
        : parsed.scope === "conv"
          ? "commands.palette.conversation.hint.enter"
          : "commands.palette.hint.enter",
    ),
  );

  /**
   * 호스트 줄의 흐린 뒷글자 — **그룹 경로**가 있으면 그것, 없으면 접속 정보(`user@host:port`).
   *
   * 그룹을 앞세우는 이유는 이름이 겹치는 호스트를 가르는 단서가 대개 폴더이기 때문이다
   * (`web-01` 이 `prod` 에도 `stage` 에도 있다). 그룹이 없는 호스트는 가를 것이 없으니
   * 그 자리에 접속 대상을 보여 주는 편이 낫다 — 어느 쪽이든 줄 오른쪽 끝은 늘 "이게 어느
   * 것인지" 를 말한다.
   */
  function hostHint(h: HostEntry): string {
    const g = (hostMeta(h).group ?? "").trim();
    return g !== "" ? g : hostLabel(h);
  }
</script>

<!--
  바깥을 누르면 닫는다. 앱의 다른 모달들과 같은 `.overlay`/`.palette` 층위를 쓰되, 팔레트는
  화면 **위쪽 1/4** 에 뜬다 — 목록이 아래로 자라는 화면이라 가운데 정렬이면 글자를 칠 때마다
  입력칸이 위아래로 움직인다.
-->
<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div
  class="overlay"
  class:placed={placed !== null}
  role="presentation"
  onmousedown={(ev) => {
    if (ev.target === ev.currentTarget) onclose();
  }}
>
  <div
    class="palette glass-raised"
    style={placed
      ? `left:${placed.left}px;top:${placed.top}px;width:${placed.width}px;max-height:${placed.maxHeight}px`
      : undefined}
    role="dialog"
    aria-modal="true"
    aria-label={t("commands.palette.aria")}
    tabindex="-1"
    onkeydown={onKeydown}
  >
    <!-- 검색 줄 — 48px, 돋보기 + 테두리 없는 입력칸. 아래 머리카락 선이 목록과 가른다 -->
    <div class="search">
      <UiIcon name="search" size={16} />
      <input
        class="q"
        type="text"
        bind:this={inputEl}
        bind:value={query}
        placeholder={t("commands.palette.placeholder")}
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        aria-label={t("commands.palette.search.aria")}
      />
    </div>

    <div class="results" bind:this={listEl}>
      {#if items.length === 0}
        <p class="empty">{t("commands.palette.empty")}</p>
      {:else}
        {#each items as item, i (item.key)}
          {#if isSectionHead(i)}
            <p class="section">{t(SECTION_LABEL[item.kind])}</p>
          {/if}
          <button
            type="button"
            data-row
            data-action={item.kind === "action" ? item.id : undefined}
            disabled={workspaceDeleteDisabled(item)}
            data-recent={item.kind === "recent" ? "" : undefined}
            class="row"
            class:sel={i === sel}
            class:inert={workspaceDeleteDisabled(item) || (item.kind === "history" && item.command === "") ||
              (item.kind === "conversation" && (item.entry === null || item.entry.state === "missing"))}
            title={workspaceDeleteDisabled(item) ? t("app.workspaces.deleteDisabled") : item.kind === "history" && item.title !== "" ? item.title : null}
            onmouseenter={() => (selRaw = i)}
            onclick={(ev) => {
              if (!viewIfAsked(item, ev)) run(item, isVariant(item, ev));
            }}
          >
            {#if item.kind === "quick"}
              <!--
                앞자리는 상태바의 SSH 칸과 **같은 그림**(`server`)이다 — 이 줄이 여는
                것도 결국 SSH 타일 하나이므로 다른 아이콘을 지어낼 이유가 없다.
              -->
              <span class="lead"><UiIcon name="server" size={14} /></span>
              <span class="label">{item.label}</span>
              <span class="tail">{t("commands.palette.quick.tail")}</span>
            {:else if item.kind === "host" || item.kind === "recent"}
              {@const meta = hostMeta(item.host)}
              <!-- 고른 아이콘, 없으면 호스트 독과 같은 기본 서버 랙(`--folder`, 호스트 색이 있으면 그 색) -->
              <span class="lead">
                <HostIcon icon={meta.icon} size={14} fallback="server" color={meta.color} />
              </span>
              <span class="label">{item.host.name}</span>
              <span class="tail">{hostHint(item.host)}</span>
            {:else if item.kind === "project"}
              <span class="lead"><ProjectIcon project={item.project} size={14} /></span>
              <span class="label">{item.project.name}</span>
              <span class="tail"
                >{isRemote(item.project)
                  ? t("commands.palette.project.tail.remote", {
                      host: item.project.host,
                      tail: projectTail(item.project.path),
                    })
                  : t("commands.palette.project.tail.local", {
                      tail: projectTail(item.project.path),
                    })}</span
              >
            {:else if item.kind === "group"}
              <!--
                사람이 고른 아이콘이 있으면 그것, 없으면 테마 색 SVG 폴더 — 세션 타일의
                폴더 줄과 **같은 규칙·같은 컴포넌트**다 (`folderIcon` · `fallback="folder"`).
              -->
              <span class="lead"><HostIcon
                  icon={folderIcon(groupMeta[item.path]?.icon)}
                  size={14}
                  fallback="folder"
                  color={groupMeta[item.path]?.color || null}
                /></span
              >
              <span class="label">{item.path}</span>
              <span class="tail">{t("commands.palette.group.tail", { count: item.count })}</span>
            {:else if item.kind === "tab"}
              <span class="lead"><UiIcon name="tab" size={14} /></span>
              <span class="label">{tabDisplayTitle(item.tab, t)}</span>
              <span class="tail"
                >{item.tab.id === activeTabId ? t("commands.palette.workspace.current") : ""}</span
              >
            {:else if item.kind === "theme"}
              <!-- 모양 한 벌 — 그림은 팔레트(색을 고르는 판) 하나다 -->
              <span class="lead"><UiIcon name="palette" size={14} /></span>
              <span class="label">{t("commands.palette.theme.row", { name: item.profile.name })}</span>
              <span class="tail">{t("commands.palette.theme.tail")}</span>
            {:else if item.kind === "snippet"}
              <!--
                스니펫 줄의 그림은 **터미널**이다 — 이 줄이 하는 일이 포커스된 터미널에 글자를
                써 넣는 것이라, 상태바의 "새 터미널" 과 같은 그림을 쓴다. 관리 줄만 설정이고
                (가는 곳이 설정 › 스니펫이다), 저장 줄은 터미널 우클릭 메뉴의 "스니펫으로
                저장" 과 **같은 책갈피**다 — 한 일에 한 그림이다.
              -->
              <span class="lead">
                <UiIcon
                  name={item.save !== undefined
                    ? "bookmark"
                    : item.id === null
                      ? "settings"
                      : "terminal"}
                  size={14}
                />
              </span>
              <span class="label">{item.label}</span>
              <span class="tail preview" class:mono={item.id !== null}>{item.detail}</span>
            {:else if item.kind === "history"}
              <!--
                앞자리는 `reset`(`replay`) — 되감아 다시 쓴다는 그림이다. 스니펫의
                `terminal` 과 일부러 다르게 둔다: 둘 다 터미널에 글자를 넣지만 하나는
                **저장해 둔 것**이고 하나는 **지난 것**이라, 섞여 보이면 고르는 뜻이 흐려진다.
              -->
              <span class="lead"><UiIcon name="reset" size={14} /></span>
              {#if item.command === ""}
                <span class="label muted">{t("commands.palette.history.empty")}</span>
              {:else}
                <span class="label mono">{item.command}</span>
                <!--
                  성패는 **기호와 색**으로만 말한다 — 숫자 종료 코드는 말풍선 안에 있다
                  (`blockOutcomeLabel` 의 "`exit` 라는 낱말을 화면에서 뺀다"). 실행 중이거나
                  코드를 못 읽었으면 아무것도 안 붙는다: 없는 성패를 지어내지 않는다.
                -->
                {#if item.ok || item.failed}
                  <span class="tail glyph" class:fail={item.failed} aria-hidden="true"
                    >{item.failed ? "✗" : "✓"}</span
                  >
                {/if}
                <span class="tail">{item.tail}</span>
              {/if}
            {:else if item.kind === "conversation"}
              <!-- 앞자리는 그 에이전트의 로고 — 대시보드의 지난 대화 줄과 같은 그림 -->
              {#if item.entry}
                <span class="lead"><HostIcon icon={iconRef(item.entry.agent)} size={14} /></span>
                <span class="label" class:fallback={item.entry.fallback}>{item.entry.title}</span>
                {#if item.entry.state === "elsewhere"}
                  <span
                    class="elsewhere"
                    data-conversation-elsewhere
                    title={t("board.convo.elsewhere.title", { when: relativeTime(item.entry.updatedAt, Date.now(), t) })}
                    >{t("commands.palette.conversation.elsewhere")}</span
                  >
                {/if}
                <span class="tail">{item.tail}</span>
              {:else}
                <span class="lead"><UiIcon name="reset" size={14} /></span>
                <span class="label muted">{item.empty}</span>
              {/if}
            {:else if item.kind === "usage"}
              <!-- 사용량 줄 — 앞자리는 그 에이전트의 로고 -->
              <span class="lead"><HostIcon icon={iconRef(item.entry.agent)} size={14} /></span>
              <span class="label" data-usage-entry={item.entry.agent}>{item.entry.label}</span>
            {:else if item.kind === "setting"}
              <!-- 설정 줄 — 그림은 상태바의 설정 칸과 같다. 경로는 `›` 로 잇는다 -->
              <span class="lead"><UiIcon name="settings" size={14} /></span>
              <span class="label">{item.path.join(" › ")}</span>
            {:else}
              <span class="lead"
                ><UiIcon
                  name={ACTION_ICON.get(item.id) ?? "command"}
                  size={14}
                /></span
              >
              <span class="label">{item.label}</span>
              <span class="tail">{#if item.combo}<Keys combo={item.combo} />{/if}</span>
            {/if}
            <!--
              고른 줄에만 서는 **키 힌트** — 변형(호스트 `Ctrl ↵ 새 탭` · 프로젝트 `Ctrl ↵ 지금 탭에` · 이력 `Shift ↵ 넣고 실행`)이
              있으면 그것, 그리고 `↵`. 누를 것이 없는 줄(이력의 빈 상태)에는 서지 않는다.
            -->
            {#if i === sel && !workspaceDeleteDisabled(item) && !(item.kind === "history" && item.command === "") && !(item.kind === "conversation" && (item.entry === null || item.entry.state === "missing"))}
              {@const v = variantHint(item)}
              <span class="keys" data-keys>
                {#if item.kind === "conversation" && item.entry && onviewconversation}
                  <Keys combo="Ctrl+↵" /><span class="kl">{t("commands.palette.conversation.hint.ctrlEnter")}</span>
                {/if}
                {#if v}
                  <Keys combo="{v.mod}+↵" /><span class="kl">{v.label}</span>
                {/if}
                <Keys combo="↵" />
              </span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    <!--
      바닥 줄 — 왼쪽은 키(↑↓ 이동 · ↵ 실행 · Esc 닫기), 오른쪽은 **범위 접두사**. 접두사는 예전
      힌트 줄에 있던 것 그대로다(글자 하나로 범위를 좁힌다 — Tab 으로 좁히는 길은 없다).
    -->
    <div class="foot" data-palette-foot>
      <span class="grp"><Keys combo="↑↓" />{t("commands.palette.foot.move")}</span>
      <span class="grp"><Keys combo="↵" />{enterHint}</span>
      <span class="grp"><Keys combo="Esc" />{t("commands.palette.foot.close")}</span>
      <span class="prefixes">
        <span class="grp"><code>&gt;</code>{t("commands.palette.hint.action")}</span>
        <span class="grp"><code>@</code>{t("commands.palette.hint.tab")}</span>
        <span class="grp"><code>#</code>{t("commands.palette.hint.group")}</span>
        <span class="grp"><code>{SNIPPET_QUERY_PREFIX}</code>{t("commands.palette.hint.snippet")}</span>
        <span class="grp"><code>{HISTORY_QUERY_PREFIX}</code>{t("commands.palette.hint.history")}</span>
        <span class="grp"
          ><code>{CONVERSATION_QUERY_WORDS[locale() === "ko" ? 0 : 1]}</code>{t("commands.palette.hint.conversation")}</span
        >
      </span>
    </div>
  </div>
</div>

<style>
  /* 앱의 다른 모달과 같은 덮개(`--bg-overlay` 가림막)다 — 다만 팔레트는 위쪽에 붙는다 (위 주석) */
  .overlay {
    position: fixed;
    inset: 0;
    /* `+page` 의 `.overlay` 와 같은 최상층. 팔레트는 그 위에 뜨는 유일한 화면이라
       한 단계 더 올린다 (Escape 순서도 팔레트가 맨 먼저다). */
    z-index: 110;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 12vh var(--space-4) var(--space-4);
    background: var(--bg-overlay);
    /* 배경색만 페이드(전역 `overlay-fade-in`) — 막의 `opacity` 는 안쪽 글래스 판의 흐림을 끈다(theme.css 모달 등장 절) */
    animation: overlay-fade-in 160ms ease-out;
  }

  /*
   * **등장** (10-17) — 판이 위에서 살짝 내려오며 커진다(판은 위쪽에 서서 목록이 아래로 자라므로 위 가운데 기준).
   * 설정 모달 등장과 같은 곡선 · 채움 없음이라 끝나면 transform 이 남지 않는다. 닫힘은 그대로 즉시다.
   * 지난 대화 고르개(`FolderConversations`)도 같은 모양이다.
   */
  .palette {
    transform-origin: 50% 0;
    animation: palette-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  /* 글래스 — 판의 `opacity` 대신 판 색 · 선 · 그림자와 내용만 페이드(theme.css `glass-surface-in`) */
  @media (prefers-reduced-motion: no-preference) {
    :global(:root[data-material="glass"]) .palette {
      --glass-in-from: translateY(-8px) scale(0.98);
      animation-name: glass-surface-in;
    }
    :global(:root[data-material="glass"]) .palette > :global(*) {
      animation: glass-content-in 200ms ease-out;
    }
  }

  @keyframes palette-in {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.98);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay,
    .palette {
      animation: none;
    }
  }

  /* 좌표를 셈했다 — 타일 캔버스 기준 자리(`placeDefaultPalette`). 판이 그 좌표에 직접 선다(인라인 `style`).
     위 `.overlay` 의 12vh 가운데는 캔버스를 못 잰 때의 물러설 자리다 */
  .overlay.placed {
    display: block;
    padding: 0;
  }

  .overlay.placed .palette {
    position: absolute;
    max-width: none;
  }

  /* 뜬 면 — **불투명**(`-solid`)이다: 터미널 글자 위에 뜨므로 창 투명도 슬라이더를 내려도
     뒤 글자가 목록 사이로 비치면 안 된다 (토큰층 문서의 "투명도" 절). 안쪽 여백은 조각마다
     따로 둔다 — 검색 줄과 바닥 줄이 판 끝까지 머리카락 선을 긋는다. */
  .palette {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--palette-w);
    max-height: 70vh;
    overflow: hidden;
    /* 재질 글래스면 중 층 유리 판(`--glass-float` — theme.css 재질 절) */
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--line);
    /* 떠 있는 면 — 큰 면 모서리(2026-10-29 — 10 → `--radius-surface`, docs/conventions.md) */
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }

  .search {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 48px;
    padding: 0 var(--space-4);
    color: var(--fg-3);
    border-bottom: 1px solid var(--line);
  }

  /* 입력칸은 테두리·바탕이 없다 — 검색 줄 전체가 입력칸의 얼굴이고, 캐럿이 포커스를 말한다 */
  .q {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    padding: 0;
    font-family: var(--font-ui);
    font-size: var(--t-md);
    color: var(--fg-1);
    background: transparent;
    border: 0;
    outline: none;
  }

  .q::placeholder {
    color: var(--fg-3);
  }

  .results {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: var(--space-1) var(--space-2) var(--space-2);
  }

  .section {
    margin: 0;
    padding: var(--space-3) var(--space-3) var(--space-1); /* 좌우 = 줄 안쪽 여백 — 머리글이 줄 아이콘과 같은 x */
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    color: var(--fg-3);
  }

  .empty {
    margin: 0;
    padding: var(--space-6) var(--space-2);
    font-size: var(--t-sm);
    text-align: center;
    color: var(--fg-3);
  }

  /* 줄 하나 — 마우스 hover 와 ↑↓ 하이라이트가 **같은 표시**다 (선택 줄은 언제나 하나뿐).
     선택 판이 이 화면의 **유일한 강조**다(`--accent-soft` — 토큰층의 "강조색은 셋뿐").
     판은 알약(`--radius-row` — 2026-10-29 C안)이고 좌우 여백 `--space-3` 이 아이콘 · 키 힌트를 곡선 밖에 둔다 */
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 32px;
    padding: 0 var(--space-3);
    font: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius-row);
    cursor: pointer;
  }

  .row.sel {
    background: var(--accent-soft);
  }

  /* `display:flex` — 안에 글자 기호가 오든 SVG 가 오든 같은 자리에 가운데로 선다.
     단색 아이콘은 흐림 회색, 컬러 로고·폴더 색는 제 색 그대로다. */
  .lead {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    color: var(--fg-3);
  }


  /* 누를 것이 없는 줄(이력의 빈 상태) — 손가락 커서를 내려놓는다 */
  .row.inert {
    cursor: default;
  }
  .row:disabled {
    opacity: 0.45;
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 이력 줄의 왼쪽은 **명령문 원문**이라 터미널과 같은 글꼴로 읽힌다 */
  .label.mono {
    font-family: var(--font-mono);
  }

  .label.muted {
    color: var(--fg-3);
  }

  /* 지난 대화의 합성 제목(에이전트 · 브랜치) — 대시보드 줄과 같은 말 */
  .label.fallback {
    color: var(--fg-2);
    font-style: italic;
  }

  .tail {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* 지난 대화 줄의 "밖에서 열림" — 대시보드 · 시작 화면의 알약과 같은 경고색 */
  .elsewhere {
    flex: 0 0 auto;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 18px;
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    border-radius: 999px;
  }

  /* 성패 기호 — 성공은 다른 뒷글자와 같은 흐린 색, 실패만 눈에 띈다 (거터 표식과 같은
     규칙: 색이 성패를 말하고 낱말은 적지 않는다). */
  .tail.glyph {
    line-height: 1;
  }

  .tail.glyph.fail {
    color: var(--err);
  }

  /* 스니펫 줄의 뒷글자는 **명령 미리보기**라 다른 줄의 뒷글자보다 훨씬 길다(최대 60자).
     `.tail` 은 줄어들지 않는 칸이라 그대로 두면 긴 명령 하나가 이름을 화면 밖으로 밀어낸다 —
     줄의 절반까지만 차지하고 넘치면 스스로 말줄임한다. */
  .tail.preview {
    min-width: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 고른 줄의 키 힌트 — 뒷글자 오른쪽 끝 */
  .keys {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .keys .kl {
    margin-right: var(--space-2);
  }

  /* 접두사 글자는 칩이 아니라 **글자 하나**다 — 누르는 키가 아니라 치는 글자이고, 칩 다섯을
     더 세우면 560px 바닥 줄이 넘친다(첫 캡처에서 `! 이력` 이 잘렸다). */
  .foot code {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .foot {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: 36px;
    padding: 0 var(--space-4);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    border-top: 1px solid var(--line);
    overflow: hidden;
  }

  .foot .grp {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  /* 접두사 묶음은 오른쪽 끝 — 좁으면 이쪽이 먼저 잘린다(키 셋이 먼저다) */
  .prefixes {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    margin-left: auto;
    min-width: 0;
    overflow: hidden;
  }
</style>

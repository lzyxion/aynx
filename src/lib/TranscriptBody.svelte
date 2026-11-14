<script lang="ts">
  /**
   * **기록 보기의 몸** — 대화 하나의 항목 목록 · 쪽 넘기기 · (켜면) 따라가기. 기록 보기 시트(`ConversationViewer`)와 AI 타일의
   * 대화 면(`pane/AiFlip`)이 같이 쓴다(2026-10-17 — 시트에서 몸만 떼어 냈다. 그림 · 규칙은 그대로다).
   *
   * - 오래된 것이 위, 최신이 아래. 열면 맨 아래에서 시작하고 "이전 메시지 더 보기" 가 한 쪽씩 앞에 붙인다(커서 — Rust 가 끝에서
   *   거꾸로 읽는다). 쪽을 받는 길은 부르는 쪽이 준다(`fetchPage` — 로컬 · 원격 · Run 작업자). 이 컴포넌트는 그 길을 모른다.
   * - **본문은 글자로만 그린다** — `{@html}` 이 없다. 에이전트 말의 마크다운은 순수 층(`$lib/transcript`)이 블록과 토막으로만
   *   나누고(그리기는 `MarkdownBlocks` — 코드 블록은 `CodeView` 의 판 · [복사] 단추 · 사이드 채팅 · 타일 대화 면은 머리 띠 — 아래 `codeActions`), `http`/`https` 링크는 **그냥 클릭**에 OS 기본
   *   브라우저로 연다 — 글자가 곧 링크이고(칩 없음), 출처 이름표(괄호 묶음 · 문장 끝 뒤 링크)만 모델이 단 그 자리의 사이트 이름 칩이 된다(괄호는 지움 · 주소는 툴팁 — 2026-11-01 (나)안 · 칩 제자리 ·
   *   2026-11-01 D안 · 처음 2026-10-25 — `linkStyle="chip"` ·
   *   `openLink` · 원격 창은 폴리필이 그 브라우저의 새 탭으로). 생각은 싣지 않는다(Rust 가
   *   내지 않는다), 도구는 한 줄(이름 — 요약)이고 누르면 입력 · 출력 발췌가 펼쳐진다. 본문은 이 컴포넌트의 상태에만 있고 사라지면 버린다.
   * - **따라가기**(`follow` 가 참인 동안만 — 대화 면이 보일 때): `followMs` 마다 최신 쪽을 다시 받아 꼬리에 이어 붙인다
   *   (`mergeLatestPage` — 겹침을 찾아 그 뒤만 바꾼다 · 열쇠는 이어 써서 펼침이 따라간다 · 겹침이 없으면 최신 쪽으로 갈아 끼운다).
   *   맨 아래를 보고 있었으면 아래로 따라가고, 위로 올려 읽는 중이면 자리를 지킨다. 꺼지면 시계도 선다(숨은 면은 읽지 않는다).
   * - **보내는 중 말풍선**(`pending` — 타일 대화 면의 입력 칸이 막 보낸 글): 목록 끝에 흐린 사용자 말로 그리고, 기록에 같은 글의
   *   사용자 말이 **새로** 나타나면(처음 본 때보다 그 글의 줄 수가 늘면 — 같은 글을 두 번 보내도 헷갈리지 않게) 걷고 `onsettled` 로
   *   알린다. 끝내 안 나타나면 걷는 일은 부르는 쪽의 시계 몫이다. 새 말풍선이 서면 맨 아래로 간다.
   * - **대화 모양 · 작업 중 표시**(`chat` · `activity` — 타일의 대화 면만, 10-17 목업 ③ B): 내 말은 오른쪽 말풍선, 에이전트가 일하는
   *   동안 끝의 결과 없는 도구 줄에 스피너(`runningToolIndexes`), 쓰는 중(`running`)이면 맨 아래 점 셋. 시트는 둘 다 끈 채(지난
   *   대화를 읽는 판 — 폭이 좁고 "지금" 이 없다).
   * - **지금 턴 꼬리**(`live` — 사이드 채팅 v2, 2026-10-23): 기록 뒤에 그 턴의 줄(사람 말 · 모델 글 · 도구 — 같은 그림)과 부르는 쪽의 카드
   *   (`liveCard(key)` — 권한 묻기 · 알림)를 붙인다. 따라가기는 쓰지 않고, 부르는 쪽이 턴이 끝날 때 `refresh` 를 하나 올리면 최신 쪽을
   *   **한 번** 받아 잇고(`mergeLatestPage`) `onrefreshed(ok)` 로 알린다 — 부르는 쪽은 그 뒤에 꼬리를 걷는다(겹침 · 빈 박자 없이).
   *   턴이 도는 동안 받은 쪽은 이미 그 턴의 앞부분을 품고 있어 `hold` 로 그 자리에서 잘라 그린다(`liveCut` — 받은 항목은 그대로 쥔다).
   * - **다이어그램**(`diagrams` — 사이드 채팅 2026-10-23 · 타일 대화 면 2026-10-24): 에이전트 말의 ```mermaid 를 그림으로(`MarkdownBlocks`
   *   의 `diagrams` — `MermaidView` 의 strict 출력). 시트는 끈 채 원문 코드 블록이다. 자라는 꼬리 글(`LiveRow.streaming`)은 닫히지 않은
   *   울타리를 떼어(`splitOpenFence`) 여느 코드 블록으로 그린다 — 닫히는 순간(또는 턴이 끝나 `streaming` 이 걷히면) 그 블록이 그림이
   *   되고, 그 뒤의 조각은 이미 닫힌 블록의 글을 바꾸지 않으므로 다시 그리지 않는다(`MermaidView` 는 같은 글이면 캐시).
   *   ```svg 도 같은 길로 그림이 된다(`SvgView` — `<img>` 하나 · 2026-10-24).
   * - **그림**(`images` — 사이드 채팅 · 타일 대화 면, 2026-10-24): 에이전트 말의 `![alt](경로)` 를 불러 그린다(`MarkdownBlocks` 의 `images` — 문서 보기
   *   타일과 같은 `doc-images` 규칙: 스킴 없는 경로만 · 그림 확장자 · 10 MB · `<img>` + `blob:`). 이 컴포넌트는 보이는 에이전트 말(받은 쪽 +
   *   꼬리)의 그림 주소를 모아 `images.sync` 로 올리기만 하고, 읽기 · 캐시 · 경로 풀기는 부르는 쪽(`SideChatFace` · `pane/AiFlip` 의
   *   `DocImageCache`)이 쥔다. 시트는 넘기지 않는다(그림은 `[그림: alt]` 글자).
   * - **사람 말의 그림**(`pictures` — 타일 대화 면, 2026-10-24): Claude 붙여넣기 · 끌어 놓은 파일 · Codex 첨부는 기록 줄에 바로(base64 ·
   *   데이터 URL) 실린다. 쪽은 그 자리(`item.pictures`)만 싣고, 이 컴포넌트는 보이는 사람 말의 자리를 `pictures.sync` 로 올려 받은 `blob:` 을
   *   말풍선 안에 그린다(읽기 · 캐시는 부르는 쪽의 `ConvImageCache`). 우클릭은 같은 그림 메뉴(링크 복사 없음). 못 그리는 것만 "이미지 N개" 칩.
   * - **경로 링크**(`paths` — 타일 대화 면 2026-11-11 · 사이드 채팅 2026-11-12): 에이전트 말의 파일 경로(`MarkdownBlocks` 의 `paths` 그대로 —
   *   판정은 거기, 푸는 일 · 여는 일은 부르는 쪽 `pane/AiFlip` · `SideChatFace`). 프로듀서 채팅 · 시트는 넘기지 않는다.
   * - **코드 블록 머리 띠**(`codeActions` — 사이드 채팅 · 타일 대화 면, 2026-11-12): 에이전트 말의 코드 블록에 [복사] · [터미널에 넣기](`MarkdownBlocks` 의
   *   `codeActions` 그대로 — 넣는 일은 부르는 쪽 `SideChatFace` · `pane/AiFlip` → `app/code-to-term`). **닫힌 블록에만** 선다 — 자라는 꼬리 글은 닫히지 않은
   *   울타리를 떼어(`splitOpenFence` — 다이어그램과 같은 자르기) 그 몫에는 넘기지 않는다(반쯤 쓴 명령을 넣지 않게). 시트 · 프로듀서 채팅은 넘기지 않는다.
   * - **사람 말 복사**(`copyable` — 타일 대화 면 · 사이드 채팅, 2026-11-14 목업 F1): 사람 말풍선 바로 아래 한 줄 오른쪽 끝에 복사 아이콘 단추.
   *   자리는 늘 잡아 두고(대화가 들썩이지 않게) 말풍선 · 그 줄에 마우스가 오르거나 포커스가 있을 때만 보인다. 말풍선은 `tabindex=-1` 이라
   *   폰에서 한 번 누르면 포커스가 서서 단추가 나오고 다른 곳을 누르면 숨는다. 복사하는 것은 말풍선의 글(`unwrapPasted` — 화면 글 그대로)뿐 —
   *   첨부 · 그림 칩 · "보내는 중" 같은 표식은 넣지 않는다. 알림은 앱 토스트. 시트 · 프로듀서 채팅은 켜지 않는다.
   *   같은 `copyable` 이 **에이전트 답 복사**도 켠다 — 한 턴(사람 말 하나 뒤의 에이전트 줄 전부)의 마지막 에이전트 줄 아래 한 줄 **왼쪽 끝**에 같은 단추 하나.
   *   글은 그 턴의 에이전트 말(마크다운 원문 · 코드 울타리 그대로)만 빈 줄로 잇고 도구 줄 · 권한 카드는 뺀다(`agentTurnCopies`). 답을 아직 쓰는 턴에는 없다.
   */
  import { tick, untrack, type ComponentProps, type Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import MarkdownBlocks from "$lib/MarkdownBlocks.svelte";
  import { splitOpenFence } from "$lib/markdown";
  import { imageSrcsOfTexts } from "$lib/doc-images";
  import type { DocImageState } from "$lib/doc-images.svelte";
  import type { PathMatch } from "$lib/path-links";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { TranscriptItem, TranscriptPage, TranscriptPicture } from "$lib/context";
  import { filesBesidePics, type SentPic } from "$lib/pane/composer-attachments";
  import ImageMenu from "$lib/ImageMenu.svelte";
  import { imageMenuActions, inlineImageName, type ImageMenuAction } from "$lib/image-menu";
  import { runImageAction } from "$lib/image-actions";
  import { isRemote } from "$lib/ipc";
  import { writeClipboard } from "$lib/clipboard";
  import { toast } from "$lib/toast.svelte.js";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import {
    linkChip,
    liveCut,
    mergeLatestPage,
    parseMarkdown,
    prependItems,
    runningToolIndexes,
    pillToolOpen,
    toolFlag,
    toolHeadline,
    unwrapPasted,
    agentTurnCopies,
    hiddenImageCount,
    withoutImagePlaceholders,
    pictureKey,
    userPictures,
    type LiveRow,
  } from "$lib/transcript";
  import { sentMatches } from "$lib/pane/ai-flip-keys";

  let {
    convKey,
    fetchPage,
    failureOf,
    follow = false,
    followMs = 2000,
    emptyText,
    column = false,
    bodyEl = $bindable(null),
    onloaded,
    pending = [],
    onsettled,
    chat = false,
    activity = null,
    live = [],
    liveCard,
    hold = null,
    refresh = 0,
    onrefreshed,
    diagrams = false,
    images,
    pictures,
    agentHead,
    toolPills,
    userMark,
    turnBreak,
    notes = [],
    noteCard,
    paths,
    codeActions,
    copyable = false,
    exportDoc,
  }: {
    /** 대화의 열쇠 — 바뀌면(열림 포함) 처음부터. `null` 이면 아무것도 읽지 않는다 */
    convKey: string | null;
    /** 한 쪽을 받는다 — `before` 가 없으면 최신 쪽 */
    fetchPage: (before: number | null) => Promise<TranscriptPage>;
    /** 실패를 화면 글자로 */
    failureOf: (e: unknown) => string;
    /** 따라가기 — 참인 동안만 최신 쪽을 다시 읽는다 */
    follow?: boolean;
    followMs?: number;
    /** 항목이 없을 때의 한 줄(없으면 기본 문구) */
    emptyText?: string;
    /** 넓은 면에서 글 줄을 가운데 한 단으로(타일의 대화 면) */
    column?: boolean;
    bodyEl?: HTMLElement | null;
    /** 첫 쪽을 받아 맨 아래로 내린 뒤(성공 · 실패 모두) */
    onloaded?: (ok: boolean) => void;
    /** 보내는 중인 글(목록 끝의 흐린 말풍선) — 기록에 나타나면 걷힌다 · `files` = 함께 보낸 첨부 이름(입력 칸 칩) */
    pending?: { id: number; text: string; files?: readonly string[]; pics?: readonly SentPic[] }[];
    /** 그 보낸 글이 기록에 나타났다 */
    onsettled?: (id: number) => void;
    /** 대화 모양 — 내 말은 오른쪽 말풍선(타일의 대화 면). 시트는 끈다 */
    chat?: boolean;
    /**
     * 그 대화를 지금 쓰는 에이전트의 상태(훅 신호 — 타일의 대화 면만). `running` 이면 끝의 결과 없는 도구에 스피너 · 맨 아래 점 셋,
     * `permission` 이면 스피너만(그 도구가 허락을 기다린다). `null`(시트 — 지난 대화)이면 둘 다 없다.
     */
    activity?: "running" | "permission" | "idle" | null;
    /**
     * 기록 사이에 끼우는 앱의 덩이(타일 대화 면 — 질문 카드의 "답을 보냈습니다" 요약 · 2026-11-02) — `at`(ms) 보다 늦지 않은 마지막 기록 줄 뒤에 선다
     * (더 늦은 줄이 없으면 끝 · 받은 쪽보다 이르면 맨 앞). 그림은 `noteCard(key)`. `user` 면 사람 말풍선과 같은 판(`.item.user` — 대화 모양이면
     * 오른쪽 말풍선)에 담는다(질문 카드의 답 요약 — 2026-11-02 A안).
     */
    notes?: readonly { key: string; at: number; user?: boolean }[];
    noteCard?: Snippet<[string]>;
    /** 지금 턴의 줄(사이드 채팅 v2) — 기록 뒤에 붙는다 */
    live?: readonly LiveRow[];
    /** `item` 없는 꼬리 줄의 그림(권한 카드 · 알림) */
    liveCard?: Snippet<[string]>;
    /** 쪽을 받는 순간 지금 턴과 겹칠 몫을 자를 근거(`liveCut`) — 받는 때에만 읽는다 */
    hold?: { userText: string | null } | null;
    /** 올라가면 최신 쪽을 한 번 받는다(턴이 끝났다) */
    refresh?: number;
    /** 그 한 번이 끝났다 — 받았나 */
    onrefreshed?: (ok: boolean) => void;
    /** 에이전트 말의 ```mermaid 를 다이어그램으로(사이드 채팅 · 타일 대화 면). 끄면 여느 코드 블록 */
    diagrams?: boolean;
    /**
     * 에이전트 말의 그림 불러오기(사이드 채팅 · 타일 대화 면) — `state` · `broken` 은 `MarkdownBlocks` 의 `images` 그대로, `sync` 는 지금 보이는 에이전트
     * 말의 그림 주소들(바뀔 때마다). 없으면 그림은 대체 글자
     */
    images?: {
      state(src: string): DocImageState;
      broken(src: string): void;
      sync(srcs: readonly string[]): void;
      /** 그림 우클릭 메뉴의 원본(`DocImageCache.source` — `MarkdownBlocks` 의 `images.source`) */
      source?(src: string): { path: string; mime: string; read: () => Promise<ArrayBuffer> } | null;
    };
    /** 사람 말에 바로 실린 그림(타일 대화 면 — `ConvImageCache`). 없으면 그 그림은 "이미지 N개" 칩 */
    pictures?: {
      state(p: TranscriptPicture): DocImageState;
      broken(p: TranscriptPicture): void;
      sync(ps: readonly TranscriptPicture[]): void;
      source(p: TranscriptPicture): { mime: string; read: () => Promise<ArrayBuffer> } | null;
    };
    /**
     * 에이전트 말 덩어리의 머리(프로듀서 채팅 — 2026-10-30 · 목업 `CoordChat`): 사람 말 뒤 첫 에이전트 글 · 도구 줄 앞에 한 줄(캐릭터 · 이름)을
     * 그리고 그 덩어리를 머리 오른쪽으로 들여 쓴다. 인자 = 이 덩어리가 지금 응답 중인 마지막 덩어리인가. 없으면 예전 그대로(사이드 채팅 · 시트)
     */
    agentHead?: Snippet<[boolean]>;
    /**
     * 이어진 도구 줄을 **알약**으로 묶는다(프로듀서 채팅) — 부르는 쪽이 묶음을 짓는다(이름 → 글자 · 같은 것끼리 `×n`). 알약을 누르면 그 도구 줄이
     * 펼쳐진다(예전 도구 줄 그대로). 없으면 예전 그대로
     */
    toolPills?: {
      group(tools: readonly { name: string | null; input: string | null; state: "ok" | "err" | "running" }[]): {
        label: string;
        base: string;
        state: "ok" | "err" | "running";
        count: number;
        indexes: number[];
      }[];
      title?(base: string): string | null;
    };
    /**
     * **사람 말 표지**(프로듀서 채팅 — 2단계 단계 4 · 앱이 깨움): 받은 쪽의 줄 전부를 받아 줄마다 `{pill}`(그 줄을 말풍선 대신 가운데 점선 알약으로 —
     * 기록이 맞는 깨움) · `{note}`(말풍선 그대로 + 흐린 표지 — 꼴만 맞고 앱 기록 없음) · `null`. 없으면 예전 그대로
     */
    userMark?: (items: readonly TranscriptItem[]) => readonly ({ pill: string } | { note: string } | { hide: true } | null)[];
    /** **턴 끝 경계**(프로듀서 채팅) — 에이전트 줄 뒤에 오는 사람 말(알약 포함) 앞에 가는 선 한 줄. 인자 = 직전 에이전트 줄의 시각. 없으면 경계 없음 */
    turnBreak?: (at: number | null) => string;
    /** 에이전트 말의 경로 링크(타일 대화 면 — 이 파일 머리말). 없으면 예전 그대로 */
    paths?: { title: (m: PathMatch) => string | null; open: (m: PathMatch) => void };
    /** 에이전트 말 코드 블록의 [복사] · [터미널에 넣기](사이드 채팅 · 타일 대화 면 — 이 파일 머리말). 없으면 예전 그대로 */
    codeActions?: ComponentProps<typeof MarkdownBlocks>["codeActions"];
    /** 사람 말풍선 아래의 [복사] 단추(타일 대화 면 · 사이드 채팅 — 이 파일 머리말). 끄면 예전 그대로 */
    copyable?: boolean;
    /** 에이전트 답 [문서로 내보내기](`copyable` 의 턴 끝 단추 줄 · [복사] 오른쪽) — 그 턴의 글(복사와 같은 글) · 단추 아래 자리. 없으면 단추 없음 */
    exportDoc?: (text: string, anchor: { x: number; y: number }) => void;
  } = $props();

  /**
   * 에이전트 답 복사 — 한 턴의 마지막 에이전트 줄 id → 그 턴의 글(`agentTurnCopies`). 끝 턴은 답을 다 쓴 뒤에만: 에이전트가 일하는 중
   * (`activity` 의 running · permission) · 자라는 꼬리 글이 있으면 없다. 보내는 중 말풍선이 있으면 그 앞 턴은 끝난 것이다.
   */
  const agentCopies = $derived.by(() => {
    if (!copyable) return new Map<string, string>();
    const seq = [
      ...shown.map((x) => ({ id: `h${x.k}`, item: x.item })),
      ...live.flatMap((r) => (r.item ? [{ id: `l${r.key}`, item: r.item }] : [])),
    ];
    const busy = activity === "running" || activity === "permission" || live.some((r) => r.streaming);
    return agentTurnCopies(seq, shownPending.length > 0 || !busy);
  });

  /** 사람 말 · 에이전트 답의 글만 클립보드로 — 결과는 앱 토스트(원격 웹도 같은 웹 API · 같은 토스트) */
  async function copyMessage(text: string) {
    const ok = await writeClipboard(text);
    if (ok) toast.success(t("board.viewer.copy.done"));
    else toast.error(t("board.viewer.copy.fail"));
  }

  /** 도구 이름 → 보일 이름. 이름표가 있는 것만 번역(Codex 사이드 채팅의 `imageGeneration` — 나머지는 CLI 의 이름 그대로) */
  const toolLabel = (name: string | null) =>
    name === null ? t("board.viewer.tool.result") : name === "imageGeneration" ? t("board.viewer.tool.imageGeneration") : name;

  /** 맨 아래에서 이만큼 안이면 "맨 아래를 보고 있다" */
  const STICK_PX = 32;

  /** 받은 항목 — 열쇠는 받은 차례(앞에 붙어도 펼침 상태가 따라간다) */
  let items = $state<{ k: number; item: TranscriptItem }[]>([]);
  let cursor = $state<number | null>(null);
  let loading = $state(false);
  let loadingOlder = $state(false);
  let failed = $state<string | null>(null);
  let open = $state<Set<number>>(new Set());
  let nextKey = 0;
  /** 늦게 온 옛 답이 새 대화를 덮지 않게 */
  let seq = 0;
  /** 따라가기 한 번이 도는 중 — 겹쳐 부르지 않는다 */
  let polling = false;
  /**
   * 맨 아래에 붙어 있나 — 사람이 스크롤하면 그때 다시 잰다. 붙어 있는 동안 글 줄의 높이가 늘면(새 말 · 늦게 그려지는 코드 블록 ·
   * 펼친 도구) 맨 아래로 따라간다(아래 `ResizeObserver`). 처음 열면 붙어 있다.
   */
  let stuck = true;
  let colEl = $state<HTMLElement | null>(null);
  /** 그리는 기록의 끝(`null` = 전부) — 턴이 도는 동안 받은 쪽만 자른다(`hold`) */
  let cut = $state<number | null>(null);
  const shown = $derived(cut === null ? items : items.slice(0, cut));

  /** 사람 말풍선 판에 담을 덩이들 */
  const noteUser = $derived(new Set(notes.filter((n) => n.user).map((n) => n.key)));

  /** 앱의 덩이 자리 — 기록 줄 열쇠 뒤 · 맨 앞 · 끝(`notes` 머리말) */
  const notePlace = $derived.by(() => {
    const after = new Map<number, string[]>();
    const head: string[] = [];
    const tail: string[] = [];
    if (notes.length === 0 || !noteCard) return { after, head, tail };
    const last = shown.length > 0 ? shown[shown.length - 1].k : null;
    for (const n of [...notes].sort((a, b) => a.at - b.at)) {
      let k: number | null = null;
      for (const x of shown) {
        const a = x.item.at;
        if (a === null) continue;
        if (a <= n.at) k = x.k;
        else break;
      }
      if (k === null) (shown.length === 0 ? tail : head).push(n.key);
      else if (k === last) tail.push(n.key);
      else after.set(k, [...(after.get(k) ?? []), n.key]);
    }
    return { after, head, tail };
  });

  // 보이는 에이전트 말(받은 쪽 + 꼬리)의 그림 주소 → 부르는 쪽 캐시(새 것은 읽고 사라진 것은 거둔다 — `DocImageCache.sync`)
  $effect(() => {
    if (!images) return;
    const texts: string[] = [];
    for (const { item } of shown) if (item.role === "assistant" && item.text) texts.push(item.text);
    for (const r of live) if (r.item?.role === "assistant" && r.item.text) texts.push(r.item.text);
    const srcs = imageSrcsOfTexts(texts);
    untrack(() => images.sync(srcs));
  });
  // 보이는 사람 말의 그림 자리 → 부르는 쪽 캐시
  $effect(() => {
    if (!pictures) return;
    const ps = userPictures([...shown.map((x) => x.item), ...live.flatMap((r) => (r.item ? [r.item] : []))]);
    untrack(() => pictures.sync(ps));
  });

  /** 에이전트 말의 링크 열기 — 주소는 `MarkdownBlocks` 가 `isWebUrl` 로 이미 걸렀다(문서 보기 타일의 `openLink` 와 같다) */
  function openLink(href: string) {
    void openUrl(href).catch((e: unknown) => {
      console.error(`[aynx] 링크를 열지 못했습니다: ${href}`, e);
    });
  }

  /** 그림 우클릭 메뉴 — 손잡이는 여는 순간 지역 값으로 묶는다(docs/conventions.md 의 "메뉴를 닫는 코드" — `MarkdownBlocks` 와 같다) */
  let picMenu = $state<{ x: number; y: number; run: (a: ImageMenuAction) => void } | null>(null);
  function openPicMenu(ev: MouseEvent, p: TranscriptPicture, i: number) {
    const el = ev.currentTarget instanceof HTMLImageElement ? ev.currentTarget : null;
    const source = pictures?.source(p);
    if (!el || !source) return;
    ev.preventDefault(); // 앱 메뉴 — 창 전역의 네이티브 메뉴 막기가 비켜 선다
    ev.stopPropagation();
    const target = { kind: "inline" as const, name: inlineImageName(source.mime, i), ...source };
    picMenu = { x: ev.clientX, y: ev.clientY, run: (a) => runImageAction(a, target, el) };
  }
  const cutNow = (xs: { item: TranscriptItem }[]) =>
    liveCut(
      xs.map((x) => x.item),
      untrack(() => hold),
      sentMatches,
    );

  const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
  const toBottom = () => {
    if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
    stuck = true;
  };

  $effect(() => {
    const col = colEl;
    if (!col || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stuck && bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
    });
    ro.observe(col);
    return () => ro.disconnect();
  });

  const wrap = (xs: TranscriptItem[]) => xs.map((item) => ({ k: nextKey++, item }));
  const fetchNow = (before: number | null) => untrack(() => fetchPage)(before);
  const failText = (e: unknown) => untrack(() => failureOf)(e);

  /** 대화가 바뀌면(열림 포함) 처음부터 — 최신 쪽을 받아 맨 아래로 */
  $effect(() => {
    const key = convKey;
    items = [];
    cut = null;
    cursor = null;
    failed = null;
    open = new Set();
    loadingOlder = false;
    stuck = true;
    if (!key) {
      loading = false;
      return;
    }
    const mine = ++seq;
    loading = true;
    void (async () => {
      await tick();
      let ok = false;
      try {
        const page = await fetchNow(null);
        if (mine !== seq) return;
        items = wrap(page.items);
        cursor = page.cursor;
        cut = cutNow(items);
        ok = true;
      } catch (e) {
        if (mine === seq) failed = failText(e);
      } finally {
        if (mine === seq) loading = false;
      }
      await tick();
      if (mine !== seq) return;
      toBottom();
      untrack(() => onloaded)?.(ok);
    })();
  });

  /** 더 오래된 쪽 — 보던 자리가 그대로 남게 늘어난 높이만큼 스크롤을 민다 */
  async function loadOlder(): Promise<void> {
    if (convKey === null || cursor === null || loadingOlder) return;
    const mine = seq;
    loadingOlder = true;
    try {
      const page = await fetchNow(cursor);
      if (mine !== seq) return;
      const before = bodyEl ? bodyEl.scrollHeight - bodyEl.scrollTop : 0;
      stuck = false; // 앞에 붙여 늘어난 높이로 맨 아래까지 끌려가지 않게 — 아래에서 자리를 맞춘 뒤 스크롤이 다시 잰다
      items = prependItems(wrap(page.items), items);
      cursor = page.cursor;
      await tick();
      if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight - before;
    } catch (e) {
      if (mine === seq) failed = failText(e);
    } finally {
      if (mine === seq) loadingOlder = false;
    }
  }

  /** 따라가기 한 번 — 최신 쪽을 받아 꼬리에 잇는다. 비켜 섰나(`busy` — 다른 읽기가 돈다) · 받았나 */
  async function poll(): Promise<"busy" | "ok" | "fail"> {
    if (loading || loadingOlder || polling || convKey === null) return "busy";
    const mine = seq;
    polling = true;
    try {
      const page = await fetchNow(null);
      if (mine !== seq) return "busy";
      const el = bodyEl;
      const stick = !el || stuck || atBottom(el);
      const cur = items;
      const m = cur.length === 0 ? null : mergeLatestPage(cur.map((x) => x.item), page.items);
      if (m === null) {
        // 처음 받는 것(첫 읽기가 실패했었다) · 겹침 없음 — 최신 쪽으로 갈아 끼운다
        if (cur.length > 0 || page.items.length > 0) {
          items = wrap(page.items);
          cursor = page.cursor;
          open = new Set();
        }
      } else {
        const fresh = page.items.slice(m.skip);
        const tail = fresh.map((item, i) => {
          const old = cur[m.at + i];
          if (!old) return { k: nextKey++, item };
          return JSON.stringify(old.item) === JSON.stringify(item) ? old : { k: old.k, item };
        });
        const same = tail.length === cur.length - m.at && tail.every((x, i) => x === cur[m.at + i]);
        if (!same) items = [...cur.slice(0, m.at), ...tail];
      }
      cut = cutNow(items);
      failed = null;
      if (stick) {
        await tick();
        if (mine === seq) toBottom();
      }
      return "ok";
    } catch (e) {
      // 받은 것이 있으면 그대로 두고 다음 번에 다시 — 없을 때만 한 줄
      if (mine === seq && items.length === 0) failed = failText(e);
      return "fail";
    } finally {
      polling = false;
    }
  }

  // ── 턴 끝의 한 번(`refresh` — 사이드 채팅 v2) ─────────────────────────────────────────

  /** CLI 가 기록 파일에 마지막 줄을 적을 틈 */
  const REFRESH_DELAY_MS = 250;
  /** 다른 읽기가 도는 동안 다시 보는 간격 · 횟수 */
  const REFRESH_RETRY_MS = 300;
  const REFRESH_TRIES = 20;
  let lastRefresh = untrack(() => refresh);
  $effect(() => {
    const r = refresh;
    if (r === lastRefresh) return;
    lastRefresh = r;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async (left: number) => {
      if (stop) return;
      if (untrack(() => convKey) === null) {
        untrack(() => onrefreshed)?.(false);
        return;
      }
      const got = await poll();
      if (stop) return;
      if (got === "busy" && left > 0) {
        timer = setTimeout(() => void run(left - 1), REFRESH_RETRY_MS);
        return;
      }
      untrack(() => onrefreshed)?.(got === "ok");
    };
    timer = setTimeout(() => void run(REFRESH_TRIES), REFRESH_DELAY_MS);
    return () => {
      stop = true;
      if (timer !== null) clearTimeout(timer);
    };
  });

  $effect(() => {
    if (!follow || convKey === null) return;
    const ms = followMs;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      if (stop) return;
      await poll();
      if (!stop) timer = setTimeout(run, ms);
    };
    // 다시 보이게 된 순간 한 번 곧바로(첫 읽기가 도는 중이면 `poll` 이 비켜 선다)
    timer = setTimeout(run, 0);
    return () => {
      stop = true;
      if (timer !== null) clearTimeout(timer);
    };
  });

  /** 도는 도구의 열쇠 — 에이전트가 일하는 동안(실행 · 권한 대기)만. 꼬리가 있으면 기록 쪽 도구는 돌지 않는다(꼬리가 제 것을 안다) */
  const running = $derived.by(() => {
    if ((activity !== "running" && activity !== "permission") || live.length > 0) return new Set<number>();
    return new Set(runningToolIndexes(shown.map((x) => x.item)).map((i) => shown[i].k));
  });

  /** 꼬리 도구의 펼침 */
  let openLive = $state<Set<string>>(new Set());
  function toggleLive(key: string): void {
    const next = new Set(openLive);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    openLive = next;
  }

  // ── 에이전트 머리 · 도구 알약(프로듀서 채팅 — `agentHead` · `toolPills`) ─────────────────────────

  /** 받은 쪽 + 꼬리를 한 줄로(열쇠 `h<k>` · `l<key>`) — 머리 · 알약 묶음의 경계는 둘을 건너 이어진다 */
  const flat = $derived.by(() => {
    if (!agentHead && !toolPills && !turnBreak) return [];
    return [
      ...shown.map((x) => ({ id: `h${x.k}`, item: x.item as TranscriptItem | null, spinning: running.has(x.k) })),
      ...live.map((r) => ({ id: `l${r.key}`, item: r.item, spinning: r.spinning ?? false })),
    ];
  });

  /** 받은 쪽 줄의 사람 말 표지(`userMark`) — 줄 열쇠 → 표지 */
  const marks = $derived.by(() => {
    const m = new Map<number, { pill: string } | { note: string } | { hide: true }>();
    if (!userMark) return m;
    const out = userMark(shown.map((x) => x.item));
    shown.forEach((x, i) => {
      const v = out[i];
      if (v) m.set(x.k, v);
    });
    return m;
  });

  /** 턴 끝 경계를 세울 줄(에이전트 줄 뒤의 사람 말) → 직전 에이전트 줄의 시각 */
  const breaks = $derived.by(() => {
    const out = new Map<string, number | null>();
    if (!turnBreak) return out;
    let agentAt: number | null | undefined = undefined;
    for (const f of flat) {
      const role = f.item?.role;
      if (!role) continue;
      if (role === "user") {
        if (agentAt !== undefined) out.set(f.id, agentAt);
        agentAt = undefined;
      } else {
        agentAt = f.item?.at ?? agentAt ?? null;
      }
    }
    return out;
  });

  /** 머리를 세울 줄(사람 말 뒤 첫 에이전트 글 · 도구) · 마지막 머리 */
  const heads = $derived.by(() => {
    const out = new Set<string>();
    let last: string | null = null;
    if (!agentHead) return { set: out, last };
    let afterUser = true;
    for (const f of flat) {
      const role = f.item?.role;
      if (!role) continue;
      if (role === "user") {
        afterUser = true;
        continue;
      }
      if ((role === "assistant" || role === "tool") && afterUser) {
        out.add(f.id);
        last = f.id;
        afterUser = false;
      }
    }
    return { set: out, last };
  });

  /** 알약 묶음 — 줄 열쇠 → (묶음 id · 그 묶음의 첫 줄인가 · 알약 차례), 묶음 id → 알약들 */
  const pillRuns = $derived.by(() => {
    const at = new Map<string, { run: string; first: boolean; pill: number }>();
    const runs = new Map<string, ReturnType<NonNullable<typeof toolPills>["group"]>>();
    if (!toolPills) return { at, runs };
    let cur: { id: string; tool: NonNullable<TranscriptItem["tool"]>; spinning: boolean }[] = [];
    const flush = () => {
      if (cur.length === 0) return;
      const run = cur[0].id;
      const pills = toolPills.group(
        cur.map((c) => {
          const flag = toolFlag(c.tool);
          const state: "ok" | "err" | "running" =
            flag === "error" || flag === "denied" ? "err" : c.spinning || c.tool.output === null ? "running" : "ok";
          return { name: c.tool.name, input: c.tool.input, state };
        }),
      );
      runs.set(run, pills);
      pills.forEach((p, pi) => p.indexes.forEach((i) => at.set(cur[i].id, { run, first: i === 0, pill: pi })));
      cur = [];
    };
    for (const f of flat) {
      if (f.item?.role === "tool" && f.item.tool) cur.push({ id: f.id, tool: f.item.tool, spinning: f.spinning });
      else if (f.item !== null) flush();
    }
    flush();
    return { at, runs };
  });

  /** 펼친 알약(`묶음:차례`) */
  let openPills = $state<Set<string>>(new Set());
  function togglePill(key: string): void {
    const next = new Set(openPills);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    openPills = next;
  }
  /** 이 도구 줄을 예전 줄로 그리나(알약 모드면 그 알약을 펼쳤을 때만) */
  const toolShown = (id: string) => {
    const p = pillRuns.at.get(id);
    return !p || openPills.has(`${p.run}:${p.pill}`);
  };
  /** 알약을 펼쳐 보인 실패한 도구 줄은 처음부터 펼친다(`pillToolOpen` — 까닭이 보이게) */
  const toolOpen = (id: string, item: TranscriptItem | null, toggled: boolean) => pillToolOpen(item?.tool, pillRuns.at.has(id), toggled);

  /** 꼬리에 새 사람 말이 서면 맨 아래로(보낸 글이 보이게) */
  let lastLiveUser = "";
  $effect(() => {
    const last = live.length > 0 ? live[live.length - 1] : null;
    if (!last || last.item?.role !== "user" || last.key === lastLiveUser) return;
    lastLiveUser = last.key;
    void tick().then(toBottom);
  });

  // ── 보내는 중 말풍선 ──────────────────────────────────────────────────────────

  /** 그 글과 맞는 사용자 말의 수 */
  const sentCount = (text: string) => items.filter((x) => x.item.role === "user" && sentMatches(text, x.item.text)).length;
  /** 말풍선 id → 처음 본 때의 그 수 */
  const baseline = new Map<number, number>();
  const shownPending = $derived.by(() => {
    const out: { id: number; text: string; files?: readonly string[]; pics?: readonly SentPic[] }[] = [];
    for (const p of pending) {
      if (!baseline.has(p.id)) baseline.set(p.id, sentCount(p.text));
      if (sentCount(p.text) > (baseline.get(p.id) ?? 0)) continue;
      out.push(p);
    }
    return out;
  });
  /** 기록에 나타난 것을 알린다 · 새 말풍선이 서면 맨 아래로 */
  let lastPendingTop = -1;
  $effect(() => {
    const shown = new Set(shownPending.map((p) => p.id));
    for (const p of pending) if (!shown.has(p.id)) untrack(() => onsettled)?.(p.id);
    for (const id of [...baseline.keys()]) if (!pending.some((p) => p.id === id)) baseline.delete(id);
    const top = pending.reduce((m, p) => Math.max(m, p.id), -1);
    if (top > lastPendingTop) {
      lastPendingTop = top;
      void tick().then(toBottom);
    }
  });

  function toggle(k: number): void {
    const next = new Set(open);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    open = next;
  }

  const fmtAt = (ms: number | null) => (ms === null ? undefined : new Date(ms).toLocaleString());
</script>

{#snippet row(
  item: TranscriptItem,
  expanded: boolean,
  ontoggle: () => void,
  spinning: boolean,
  dim = false,
  note: string | null = null,
  streaming = false,
  files: readonly string[] = [],
  mark: { pill: string } | { note: string } | { hide: true } | null = null,
  copyText: string | null = null,
  sentPics: readonly SentPic[] = [],
)}
  {#if item.role === "user" && mark && "hide" in mark}
    <!-- 같은 깨움을 꼬리가 지금 그린다(도는 깨움 턴 — F5 직후) — 기록 쪽은 그리지 않는다(턴이 끝나 꼬리가 걷히면 기록 알약이 선다) -->
  {:else if item.role === "user" && mark && "pill" in mark}
    <!-- 앱이 깨움(프로듀서 채팅 — 기록이 맞는 깨움만) — 사람 말풍선 대신 가운데 점선 알약 -->
    <li class="item wake-pill" data-item="wake" title={fmtAt(item.at)}>
      <span class="wake-in"><UiIcon name="bell" size={13} /><span>{mark.pill}</span></span>
    </li>
  {:else if item.role === "user"}
    {@const chip = linkChip(item.link)}
    {@const pics = pictures ? (item.pictures ?? []) : []}
    {@const hidden = hiddenImageCount(item, !!pictures, (p) => pictures?.state(p).status === "fail")}
    <!-- 그림이 모두 그려지면 맨 앞의 `[Image #N]` 자리표는 뗀다(판정은 여기 — 불러오기 실패는 화면만 안다 · `withoutImagePlaceholders`) -->
    {@const shownText = item.text ? withoutImagePlaceholders(unwrapPasted(item.text), item.images > 0 && pics.length > 0 && hidden === 0) : ""}
    {@const utext = copyable ? shownText : ""}
    {#if chip}
      <!-- 앱 연결 머리글이 알린 연결(사이드 채팅) — 말풍선 위의 작은 칩 · 세션 id 는 없다 -->
      <li class="item linkchip" data-item="link" data-link={chip.key === "board.viewer.unlinked" ? "off" : "on"}>
        <span>{t(chip.key, { label: chip.label })}</span>
      </li>
    {/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <li class="item user" class:pending={dim} class:copyable={utext.trim() !== ""} data-item="user" title={fmtAt(item.at)} tabindex={copyable ? -1 : undefined}>
      {#if shownText}<p class="utext">{shownText}</p>{/if}
      {#if pics.length > 0}
        <div class="upics">
          {#each pics as p, i (pictureKey(p))}
            {@const st = pictures?.state(p)}
            {#if st?.status === "ok"}
              <img
                class="upic"
                src={st.url}
                alt={inlineImageName(p.mime, i)}
                oncontextmenu={(ev) => openPicMenu(ev, p, i)}
                onerror={() => pictures?.broken(p)}
              />
            {/if}
          {/each}
        </div>
      {/if}
      {#if sentPics.length > 0}
        <!-- 막 보낸 그림(이 창의 입력 칸 미리보기 — 기록에 들면 위 `pictures` 가 같은 자리에 선다 · 꼬리가 걷혀 둘이 함께 서지 않는다) -->
        <div class="upics">
          {#each sentPics as sp, i (i)}<img class="upic" src={sp.url} alt={sp.name} data-sent-pic />{/each}
        </div>
      {/if}
      {#if hidden > 0}<span class="chip">{t("board.viewer.images", { n: hidden })}</span>{/if}
      <!-- 보낼 때의 이름 칩(꼬리 — 그림으로 그린 것은 빼고) · 기록의 파일 첨부 꼬리(Rust 가 글에서 떼어 `files` 로 — 표시만) -->
      {#each [...(item.files ?? []), ...filesBesidePics(files, sentPics)] as f, i (i)}<span class="chip file" data-sent-file><UiIcon name="file" size={14} /><span>{f}</span></span>{/each}
      {#if item.truncated}<span class="cut">{t("board.viewer.truncated")}</span>{/if}
      {#if note}<span class="cut">{note}</span>{/if}
      {#if mark && "note" in mark}<span class="cut" data-wake-unrecorded>{mark.note}</span>{/if}
      {#if utext.trim() !== ""}{@render msgCopy(utext, "user")}{/if}
    </li>
  {:else if item.role === "assistant"}
    {@const parts = streaming && (diagrams || codeActions) ? splitOpenFence(item.text ?? "") : { done: item.text ?? "", open: null }}
    <!-- 자라는 글이면 닫히지 않은 울타리를 떼어 여느 코드 블록으로(다이어그램 · 코드 블록 단추는 닫힌 몫만 — 이 파일 머리말) -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <li class="item assistant" data-item="assistant" tabindex={copyable ? -1 : undefined}>
      <MarkdownBlocks blocks={parseMarkdown(parts.done)} compact {diagrams} {images} linkImages={!!images} onlink={openLink} linkClick="plain" linkStyle="chip" {paths} {codeActions} />
      {#if parts.open !== null}<MarkdownBlocks blocks={parseMarkdown(parts.open)} compact {images} linkImages={!!images} onlink={openLink} linkClick="plain" linkStyle="chip" {paths} />{/if}
      {#if item.truncated}<span class="cut">{t("board.viewer.truncated")}</span>{/if}
      {#if copyText !== null}{@render msgCopy(copyText, "agent")}{/if}
    </li>
  {:else if item.role === "interrupted"}
    <!-- 끊긴 턴(Claude 끊김 표식 · Codex turn_aborted) — 사이드 채팅 꼬리의 "중단함" 과 같은 한 줄 -->
    <li class="item stopped" data-item="interrupted" title={fmtAt(item.at)}>{t("board.viewer.interrupted")}{#if copyText !== null}{@render msgCopy(copyText, "agent")}{/if}</li>
  {:else if item.tool}
    {@const h = toolHeadline(item.tool)}
    {@const flag = toolFlag(item.tool)}
    <li class="item tool" class:err={flag === "error"} class:denied={flag === "denied"} data-item="tool">
      <button
        type="button"
        class="tline"
        aria-expanded={expanded}
        data-tool={h.name ?? ""}
        onclick={ontoggle}
      >
        {#if spinning}
          <!-- 아직 결과가 없는 끝의 도구 — 도는 중(타일 대화 면 · 에이전트가 일하는 동안만) -->
          <span class="spin" data-tool-running aria-hidden="true"></span>
        {/if}
        <span class="chev" aria-hidden="true"
          ><UiIcon name={expanded ? "chevron-down" : "chevron"} size={12} /></span
        >
        <span class="tname">{toolLabel(h.name)}</span>
        {#if h.summary}<span class="tsum">— {h.summary}</span>{/if}
        {#if flag === "denied"}<span class="tflag denied" data-tool-denied>{t("board.viewer.tool.denied")}</span>
        {:else if flag === "error"}<span class="tflag">{t("board.viewer.tool.error")}</span>{/if}
      </button>
      {#if expanded}
        <div class="tbody" data-tool-body>
          {#if item.tool.input}
            <p class="tlabel">{t("board.viewer.tool.input")}</p>
            <pre class="code small">{item.tool.input}</pre>
            {#if item.tool.inputTruncated}<span class="cut">{t("board.viewer.truncated")}</span>{/if}
          {/if}
          {#if item.tool.output !== null}
            <p class="tlabel">{t("board.viewer.tool.output")}</p>
            <pre class="code small">{item.tool.output}</pre>
            {#if item.tool.outputTruncated}<span class="cut">{t("board.viewer.truncated")}</span>{/if}
          {:else}
            <p class="tlabel">{t("board.viewer.tool.pending")}</p>
          {/if}
        </div>
      {/if}
      {#if copyText !== null}{@render msgCopy(copyText, "agent")}{/if}
    </li>
  {/if}
{/snippet}

{#snippet msgCopy(text: string, side: "user" | "agent")}
  <!-- 말 복사(`copyable`) — 사람 말은 말풍선 바로 아래 오른쪽 끝(자리는 말풍선의 아래 여백), 에이전트 답은 그 턴의 마지막 줄 아래 왼쪽 끝 -->
  <span class="mcopy" class:user={side === "user"} data-msg-copy={side}>
    <button
      type="button"
      class="mcopy-btn"
      title={t("board.viewer.copy")}
      aria-label={t("board.viewer.copy")}
      onclick={() => void copyMessage(text)}><UiIcon name="copy" size={14} /></button
    >
    {#if side === "agent" && exportDoc}
      <!-- [문서로 내보내기](`exportDoc` — 부르는 쪽이 상자를 연다) — [복사] 바로 오른쪽 -->
      <button
        type="button"
        class="mcopy-btn"
        title={t("files.doc.export")}
        aria-label={t("files.doc.export")}
        data-msg-export
        onclick={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect();
          exportDoc?.(text, { x: r.left, y: r.bottom + 4 });
        }}><UiIcon name="upload" size={14} /></button
      >
    {/if}
  </span>
{/snippet}

{#snippet lead(id: string)}
  {#if turnBreak && breaks.has(id)}
    <li class="item turn-break" data-item="turn-break"><span class="rule"></span>{turnBreak(breaks.get(id) ?? null)}<span class="rule"></span></li>
  {/if}
  {#if agentHead && heads.set.has(id)}
    <li class="item agent-head" data-item="agent-head">{@render agentHead(heads.last === id && activity === "running")}</li>
  {/if}
  {@const p = pillRuns.at.get(id)}
  {#if p && p.first}
    {@const pills = pillRuns.runs.get(p.run) ?? []}
    <li class="item pills" data-item="pills">
      {#each pills as pill, pi (pi)}
        {@const key = `${p.run}:${pi}`}
        <button
          type="button"
          class="pill"
          class:err={pill.state === "err"}
          class:run={pill.state === "running"}
          aria-expanded={openPills.has(key)}
          title={toolPills?.title?.(pill.base) ?? undefined}
          data-tool-pill={pill.label}
          onclick={() => togglePill(key)}
        >
          {#if pill.state === "running"}<span class="spin" aria-hidden="true"></span>
          {:else if pill.state === "err"}<span class="mark err" aria-hidden="true">!</span>
          {:else}<span class="mark" aria-hidden="true">✓</span>{/if}
          <span class="pill-label">{pill.label}{pill.count > 1 ? ` ×${pill.count}` : ""}</span>
        </button>
      {/each}
    </li>
  {/if}
{/snippet}

<!-- 몸 — 키보드로도 스크롤한다(↑↓ · PageUp/PageDown) -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="body" class:column class:chat class:avatars={!!agentHead} tabindex="0" bind:this={bodyEl} data-viewer-body onscroll={() => bodyEl && (stuck = atBottom(bodyEl))}>
  <div class="col" bind:this={colEl}>
    {#if loading}
      <p class="quiet" data-viewer-loading>{t("board.viewer.loading")}</p>
    {:else if failed && items.length === 0 && live.length === 0}
      <p class="quiet" data-viewer-error>{failed}</p>
    {:else if items.length === 0 && shownPending.length === 0 && live.length === 0}
      <p class="quiet" data-viewer-empty>{emptyText ?? t("board.viewer.empty")}</p>
    {:else}
      {#if convKey !== null}
      <div class="older">
        {#if failed}
          <!-- 이전 쪽을 못 받았다(원격 세션이 사라졌다 등) — 받은 것은 두고 한 줄 -->
          <span class="quiet" data-viewer-error>{failed}</span>
        {:else if cursor !== null}
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            data-viewer-older
            disabled={loadingOlder}
            onclick={() => void loadOlder()}
            >{loadingOlder ? t("board.viewer.olderLoading") : t("board.viewer.older")}</button
          >
        {:else}
          <span class="quiet" data-viewer-start>{t("board.viewer.start")}</span>
        {/if}
      </div>
      {/if}
      <ol class="items" data-viewer-items>
        {#each notePlace.head as nk (nk)}
          <li class="item" class:card={!noteUser.has(nk)} class:user={noteUser.has(nk)} data-item="note">{@render noteCard?.(nk)}</li>
        {/each}
        {#each shown as { k, item } (k)}
          {@render lead(`h${k}`)}
          {#if item.role !== "tool" || toolShown(`h${k}`)}
            {@render row(item, toolOpen(`h${k}`, item, open.has(k)), () => toggle(k), running.has(k), false, null, false, [], marks.get(k) ?? null, agentCopies.get(`h${k}`) ?? null)}
          {/if}
          {#each notePlace.after.get(k) ?? [] as nk (nk)}
            <li class="item" class:card={!noteUser.has(nk)} class:user={noteUser.has(nk)} data-item="note">{@render noteCard?.(nk)}</li>
          {/each}
        {/each}
        {#each notePlace.tail as nk (nk)}
          <li class="item" class:card={!noteUser.has(nk)} class:user={noteUser.has(nk)} data-item="note">{@render noteCard?.(nk)}</li>
        {/each}
        {#each live as r (r.key)}
          {@render lead(`l${r.key}`)}
          {#if r.item && r.item.role === "tool" && !toolShown(`l${r.key}`)}
            <!-- 알약에 접힌 꼬리 도구 줄 -->
          {:else if r.item}
            {@render row(
              r.item,
              toolOpen(`l${r.key}`, r.item, openLive.has(r.key)),
              () => toggleLive(r.key),
              r.spinning ?? false,
              r.dim ?? false,
              r.note ?? null,
              r.streaming ?? false,
              r.files ?? [],
              null,
              agentCopies.get(`l${r.key}`) ?? null,
              r.sentPics ?? [],
            )}
          {:else if liveCard}
            <li class="item card" data-item="live-card">{@render liveCard(r.key)}</li>
          {/if}
        {/each}
        {#each shownPending as p (p.id)}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <li class="item user pending" class:copyable={copyable && p.text.trim() !== ""} data-item="pending" aria-busy="true" tabindex={copyable ? -1 : undefined}>
            {#if p.text.trim() !== ""}<p class="utext">{p.text}</p>{/if}
            {#if (p.pics ?? []).length > 0}
              <div class="upics">
                {#each p.pics ?? [] as sp, i (i)}<img class="upic" src={sp.url} alt={sp.name} data-sent-pic />{/each}
              </div>
            {/if}
            {#each filesBesidePics(p.files ?? [], p.pics ?? []) as f, i (i)}<span class="chip file" data-sent-file><UiIcon name="file" size={14} /><span>{f}</span></span>{/each}
            <span class="cut">{t("pane.flip.sending")}</span>
            {#if copyable && p.text.trim() !== ""}{@render msgCopy(p.text, "user")}{/if}
          </li>
        {/each}
        {#if activity === "running"}
          <!-- 에이전트가 쓰는 중(훅 신호 '실행 중') — 점 셋이 차례로. 끝 · 대기 · 권한 대기면 없다 -->
          <li class="item typing" data-item="typing" role="status" aria-label={t("pane.flip.typing")}>
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </li>
        {/if}
      </ol>
    {/if}
  </div>
</div>

{#if picMenu}
  <ImageMenu actions={imageMenuActions("inline", isRemote)} x={picMenu.x} y={picMenu.y} onclose={() => (picMenu = null)} onpick={picMenu.run} />
{/if}

<style>
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-3) var(--space-5) var(--space-5);
    outline: none;
  }

  /* 타일의 대화 면 — 넓어도 글 줄은 읽기 좋은 폭의 한 단(목업 ①') */
  .body.column .col {
    max-width: 760px;
    margin: 0 auto;
  }

  .quiet {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .older {
    display: flex;
    justify-content: center;
    padding: var(--space-1) 0 var(--space-3);
  }

  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* 도구 줄은 이어 붙는다 — 한 턴의 호출 여럿이 한 덩어리로 읽히게 */
  .item.tool + .item.tool {
    margin-top: calc(-1 * var(--space-3));
  }

  .item {
    min-width: 0;
    font-size: var(--t-sm);
    line-height: 1.6;
  }

  /* 사용자 말 — 조용한 판 하나(강조색을 쓰지 않는다) */
  .item.user {
    align-self: stretch;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-hover);
    border-radius: var(--radius-md);
  }

  /* 말풍선은 누르면(폰) 포커스만 받는다 — 테두리는 그리지 않는다(아래 복사 단추가 그 표시) */
  .item.user:focus,
  .item.assistant:focus {
    outline: none;
  }

  /*
   * 말 복사(`copyable` — 목업 F1): 단추 자리는 늘 잡아 두고(높이 22 — 대화가 들썩이지 않게) 단추만 비친다 — 그 말(줄)에 마우스가 오르거나,
   * 포커스가 그 안에 있을 때(폰에서 한 번 누름 · Tab). 사람 말은 말풍선 바로 아래 오른쪽 끝(말풍선의 아래 여백에 띄운다 — 판 밖),
   * 에이전트 답은 그 턴의 마지막 줄 안 맨 아래 왼쪽 끝.
   */
  .item.user.copyable {
    position: relative;
    margin-bottom: 20px;
  }

  .mcopy {
    display: flex;
    height: 22px;
    margin-top: 2px;
  }

  .mcopy.user {
    position: absolute;
    top: 100%;
    right: 0;
  }

  .mcopy {
    gap: 2px;
  }

  .mcopy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--fg-3);
    background: transparent;
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .mcopy-btn:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .item:hover .mcopy-btn,
  .item:focus-within .mcopy-btn {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .mcopy-btn {
      transition: none;
    }
  }

  /* 보내는 중 — 같은 판을 흐리게(기록에 나타나면 진짜 말로 바뀐다) */
  .item.user.pending {
    opacity: 0.6;
  }

  /*
   * 대화 모양(`chat` — 타일의 대화 면, 목업 ③ B): 내 말은 오른쪽 말풍선(최대 78% · 강조색의 옅은 판 · 오른쪽 아래 모서리만 작게),
   * 에이전트 글은 왼쪽 그대로. 시트(지난 대화 읽기)는 예전 판 그대로다.
   */
  .body.chat .item.user {
    align-self: flex-end;
    max-width: 78%;
    background: color-mix(in srgb, var(--accent) 18%, var(--surface-raised-solid));
    border-radius: 12px 12px 4px 12px;
  }

  /*
   * 에이전트 머리(`agentHead` — 프로듀서 채팅 · 목업 `CoordChat`): 머리 한 줄(캐릭터 · 이름) 아래로 그 덩어리의 글 · 도구 · 알약 · 카드를
   * 캐릭터 폭만큼 들여 쓴다. 사람 말은 오른쪽 말풍선 그대로.
   */
  .body.avatars .item.assistant,
  .body.avatars .item.tool,
  .body.avatars .item.pills,
  .body.avatars .item.stopped,
  .body.avatars .item.typing {
    margin-left: 42px;
  }

  .item.agent-head + .item {
    margin-top: calc(-1 * var(--space-3));
  }

  /* 도구 알약 — 이어진 도구 줄 묶음(✓ 이름 ×n · 도는 것은 고리 · 실패는 빨강) */
  .item.pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--surface-hover);
    border: 1px solid transparent;
    border-radius: 999px;
    cursor: pointer;
  }

  .pill:hover,
  .pill[aria-expanded="true"] {
    color: var(--fg-1);
    border-color: var(--line-strong);
  }

  .pill.run {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--accent) 22%, var(--surface-raised-solid));
  }

  .pill.err {
    color: var(--err);
    background: color-mix(in srgb, var(--err) 12%, var(--surface-raised-solid));
  }

  .pill .mark {
    color: var(--ok, var(--fg-2));
  }

  .pill .mark.err {
    color: var(--err);
    font-weight: var(--fw-semibold);
  }

  /* 도는 도구 — 작은 고리(움직임 줄이기면 서 있는 고리) */
  .spin {
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    border: 2px solid color-mix(in srgb, var(--fg-2) 25%, transparent);
    border-top-color: var(--fg-1);
    border-radius: 50%;
    animation: tb-spin 0.8s linear infinite;
  }

  /* 쓰는 중 — 점 셋이 차례로 */
  .item.typing {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 16px;
    padding-left: 2px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fg-2);
    opacity: 0.25;
    animation: tb-dot 1.2s infinite;
  }

  .dot:nth-child(2) {
    animation-delay: 0.15s;
  }

  .dot:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes tb-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes tb-dot {
    0%,
    80%,
    100% {
      opacity: 0.25;
    }
    40% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }

    .dot {
      animation: none;
      opacity: 0.6;
    }
  }

  .utext {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* 사람 말의 그림 — 말풍선 폭 안 · 높이를 줄여 대화를 덮지 않게 */
  .upics {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }

  .upic {
    display: block;
    max-width: 100%;
    max-height: 240px;
    object-fit: contain;
    border-radius: var(--radius-sm);
  }

  .chip {
    display: inline-block;
    margin-top: var(--space-1);
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--bg-chip);
    border-radius: var(--radius-sm);
  }

  /* 보낸 첨부 이름 칩 — 입력 칸 칩(`FlipComposer` 의 `.att` · `.thumb.icon`)과 같은 `file` 그림 14 · 간격 `--space-1`(2026-11-14) */
  .chip.file {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-right: var(--space-1);
    vertical-align: middle;
  }

  .cut {
    display: inline-block;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-style: italic;
  }

  /* 에이전트 말 — 판 없이 글자만 */
  .item.assistant > :global(*) {
    margin: 0 0 var(--space-2);
  }

  .item.assistant > :global(:last-child) {
    margin-bottom: 0;
  }

  .code {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    overflow-x: auto;
    white-space: pre;
  }

  .code.small {
    max-height: 240px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* 도구 — 한 줄(이름 — 요약), 누르면 펼친다 */
  .tline {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    height: 24px;
    padding: 0 var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    text-align: left;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .tline:hover {
    background: var(--surface-hover);
    color: var(--fg-1);
  }

  .tline:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .chev {
    flex: 0 0 auto;
    display: inline-flex;
    color: var(--fg-3);
  }

  .tname {
    flex: 0 0 auto;
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
  }

  .tsum {
    flex: 0 1 auto;
    min-width: 0;
    font-family: var(--font-mono);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tflag {
    flex: 0 0 auto;
    color: var(--err);
  }

  .item.tool.err .tname {
    color: var(--err);
  }

  /* 거절됨 — 실패가 아니다(사람 · 규칙이 막았다): 빨강 없이 조용한 글자 */
  .tflag.denied {
    color: var(--fg-3);
  }

  /* 연결 칩 — 사람 말 위의 작은 조용한 표지(대화 모양이면 말풍선과 같은 오른쪽) */
  .item.linkchip {
    display: flex;
    margin-bottom: calc(-1 * var(--space-3));
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--fg-3);
  }

  .item.linkchip > span {
    padding: 0 var(--space-2);
    background: var(--bg-chip);
    border-radius: var(--radius-sm);
  }

  .body.chat .item.linkchip {
    justify-content: flex-end;
  }

  /* 앱이 깨움(프로듀서 채팅 — 목업 CoordChat) — 가운데 점선 알약 */
  .item.wake-pill {
    display: flex;
    justify-content: center;
  }

  .wake-in {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    padding: 6px 12px;
    font-size: var(--t-xs);
    color: var(--fg-2);
    border: 1px dashed var(--line-strong);
    border-radius: 999px;
    overflow-wrap: anywhere;
  }

  .wake-in :global(svg) {
    flex: 0 0 auto;
    color: var(--accent);
  }

  /* 턴 끝 경계(프로듀서 채팅) — 가는 선 사이의 조용한 한 줄 */
  .item.turn-break {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .item.turn-break .rule {
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  /* 끊긴 턴 — 조용한 한 줄 */
  .item.stopped {
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-style: italic;
  }

  .tbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-1) 0 var(--space-2) var(--space-5);
  }

  .tlabel {
    margin: var(--space-1) 0 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }
</style>

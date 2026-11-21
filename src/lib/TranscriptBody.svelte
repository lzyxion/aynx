<script lang="ts">
  /**
   * 기록 보기의 몸 — 기록 시트 · AI 타일 대화 면 · 사이드 채팅 · 프로듀서 채팅이 같이 쓴다.
   *
   * - 본문은 글자로만 그린다 — `{@html}` 을 쓰지 않는다. 본문은 이 컴포넌트의 상태에만 있고 사라지면 버린다.
   * - 생각은 싣지 않는다(Rust 가 내지 않는다).
   * - 코드 블록 단추(`codeActions` — [복사] · [터미널에 넣기])는 닫힌 블록에만 선다 — 자라는 꼬리 글의 닫히지 않은 울타리
   *   (`splitOpenFence`)에는 넘기지 않는다(반쯤 쓴 명령을 넣지 않게).
   * - 말 복사(`copyable`)는 화면의 글만 — 첨부 · 그림 칩 · "보내는 중" 같은 표식은 넣지 않는다. 답을 아직 쓰는 턴에는 없다.
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
    linkChips,
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
  }: {
    /** 바뀌면(열림 포함) 처음부터 · `null` 이면 아무것도 읽지 않는다 */
    convKey: string | null;
    /** `before` 가 없으면 최신 쪽 */
    fetchPage: (before: number | null) => Promise<TranscriptPage>;
    failureOf: (e: unknown) => string;
    /** 참인 동안만 최신 쪽을 다시 읽는다 — 숨은 면은 읽지 않는다 */
    follow?: boolean;
    followMs?: number;
    emptyText?: string;
    column?: boolean;
    bodyEl?: HTMLElement | null;
    onloaded?: (ok: boolean) => void;
    /** 기록에 나타나면 걷힌다 — 끝내 안 나타나면 걷는 일은 부르는 쪽의 시계 몫이다 */
    pending?: { id: number; text: string; files?: readonly string[]; pics?: readonly SentPic[] }[];
    onsettled?: (id: number) => void;
    chat?: boolean;
    activity?: "running" | "permission" | "idle" | null;
    /** `at`(ms) 보다 늦지 않은 마지막 기록 줄 뒤에 선다 · `user` 면 사람 말풍선 판에 담는다 */
    notes?: readonly { key: string; at: number; user?: boolean }[];
    noteCard?: Snippet<[string]>;
    live?: readonly LiveRow[];
    liveCard?: Snippet<[string]>;
    /** 턴이 도는 동안 받은 쪽은 그 턴의 앞부분을 품고 있어 이것으로 잘라 그린다(`liveCut`) — 받는 때에만 읽는다 */
    hold?: { userText: string | null } | null;
    /** 올라가면 최신 쪽을 한 번 받는다 — 부르는 쪽은 `onrefreshed` 뒤에 꼬리를 걷는다 */
    refresh?: number;
    onrefreshed?: (ok: boolean) => void;
    diagrams?: boolean;
    images?: {
      state(src: string): DocImageState;
      broken(src: string): void;
      sync(srcs: readonly string[]): void;
      source?(src: string): { path: string; mime: string; read: () => Promise<ArrayBuffer> } | null;
    };
    pictures?: {
      state(p: TranscriptPicture): DocImageState;
      broken(p: TranscriptPicture): void;
      sync(ps: readonly TranscriptPicture[]): void;
      source(p: TranscriptPicture): { mime: string; read: () => Promise<ArrayBuffer> } | null;
    };
    /** 인자 = 이 덩어리가 지금 응답 중인 마지막 덩어리인가 */
    agentHead?: Snippet<[boolean]>;
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
    /** `pill` = 기록이 맞는 앱의 깨움(말풍선 대신 알약) · `note` = 꼴만 맞고 앱 기록 없음 */
    userMark?: (items: readonly TranscriptItem[]) => readonly ({ pill: string } | { note: string } | { hide: true } | null)[];
    /** 인자 = 직전 에이전트 줄의 시각 */
    turnBreak?: (at: number | null) => string;
    paths?: { title: (m: PathMatch) => string | null; open: (m: PathMatch) => void };
    /** 닫힌 블록에만 넘긴다(머리말) */
    codeActions?: ComponentProps<typeof MarkdownBlocks>["codeActions"];
    copyable?: boolean;
  } = $props();

  /** 보내는 중 말풍선이 있으면 그 앞 턴은 끝난 것이다 */
  const agentCopies = $derived.by(() => {
    if (!copyable) return new Map<string, string>();
    const seq = [
      ...shown.map((x) => ({ id: `h${x.k}`, item: x.item })),
      ...live.flatMap((r) => (r.item ? [{ id: `l${r.key}`, item: r.item }] : [])),
    ];
    const busy = activity === "running" || activity === "permission" || live.some((r) => r.streaming);
    return agentTurnCopies(seq, shownPending.length > 0 || !busy);
  });

  async function copyMessage(text: string) {
    const ok = await writeClipboard(text);
    if (ok) toast.success(t("board.viewer.copy.done"));
    else toast.error(t("board.viewer.copy.fail"));
  }

  /** 이름표가 있는 것만 번역 — 나머지는 CLI 의 이름 그대로 */
  const toolLabel = (name: string | null) =>
    name === null ? t("board.viewer.tool.result") : name === "imageGeneration" ? t("board.viewer.tool.imageGeneration") : name;

  const STICK_PX = 32;

  /** 열쇠는 받은 차례 — 앞에 붙어도 펼침 상태가 따라간다 */
  let items = $state<{ k: number; item: TranscriptItem }[]>([]);
  let cursor = $state<number | null>(null);
  let loading = $state(false);
  let loadingOlder = $state(false);
  let failed = $state<string | null>(null);
  let open = $state<Set<number>>(new Set());
  let nextKey = 0;
  /** 늦게 온 옛 답이 새 대화를 덮지 않게 */
  let seq = 0;
  let polling = false;
  /** 사람이 스크롤하면 다시 잰다 — 붙어 있는 동안 높이가 늘면(늦게 그려지는 코드 블록 등) 맨 아래로 따라간다 */
  let stuck = true;
  let colEl = $state<HTMLElement | null>(null);
  /** `null` = 전부 */
  let cut = $state<number | null>(null);
  const shown = $derived(cut === null ? items : items.slice(0, cut));

  const noteUser = $derived(new Set(notes.filter((n) => n.user).map((n) => n.key)));

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

  $effect(() => {
    if (!images) return;
    const texts: string[] = [];
    for (const { item } of shown) if (item.role === "assistant" && item.text) texts.push(item.text);
    for (const r of live) if (r.item?.role === "assistant" && r.item.text) texts.push(r.item.text);
    const srcs = imageSrcsOfTexts(texts);
    untrack(() => images.sync(srcs));
  });
  $effect(() => {
    if (!pictures) return;
    const ps = userPictures([...shown.map((x) => x.item), ...live.flatMap((r) => (r.item ? [r.item] : []))]);
    untrack(() => pictures.sync(ps));
  });

  /** 주소는 `MarkdownBlocks` 가 `isWebUrl` 로 이미 걸렀다 */
  function openLink(href: string) {
    void openUrl(href).catch((e: unknown) => {
      console.error(`[aynx] 링크를 열지 못했습니다: ${href}`, e);
    });
  }

  /** 손잡이는 여는 순간 지역 값으로 묶는다(docs/conventions.md 의 "메뉴를 닫는 코드") */
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

  async function loadOlder(): Promise<void> {
    if (convKey === null || cursor === null || loadingOlder) return;
    const mine = seq;
    loadingOlder = true;
    try {
      const page = await fetchNow(cursor);
      if (mine !== seq) return;
      const before = bodyEl ? bodyEl.scrollHeight - bodyEl.scrollTop : 0;
      stuck = false; // 앞에 붙여 늘어난 높이로 맨 아래까지 끌려가지 않게
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

  /** `busy` = 다른 읽기가 돌아 비켜 섰다 */
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
      if (mine === seq && items.length === 0) failed = failText(e);
      return "fail";
    } finally {
      polling = false;
    }
  }

  // ── 턴 끝의 한 번 ──

  /** CLI 가 기록 파일에 마지막 줄을 적을 틈 */
  const REFRESH_DELAY_MS = 250;
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
    timer = setTimeout(run, 0);
    return () => {
      stop = true;
      if (timer !== null) clearTimeout(timer);
    };
  });

  /** 꼬리가 있으면 기록 쪽 도구는 돌지 않는다 — 꼬리가 제 것을 안다 */
  const running = $derived.by(() => {
    if ((activity !== "running" && activity !== "permission") || live.length > 0) return new Set<number>();
    return new Set(runningToolIndexes(shown.map((x) => x.item)).map((i) => shown[i].k));
  });

  let openLive = $state<Set<string>>(new Set());
  function toggleLive(key: string): void {
    const next = new Set(openLive);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    openLive = next;
  }

  // ── 에이전트 머리 · 도구 알약 ──

  /** 머리 · 알약 묶음의 경계는 받은 쪽과 꼬리를 건너 이어진다 */
  const flat = $derived.by(() => {
    if (!agentHead && !toolPills && !turnBreak) return [];
    return [
      ...shown.map((x) => ({ id: `h${x.k}`, item: x.item as TranscriptItem | null, spinning: running.has(x.k) })),
      ...live.map((r) => ({ id: `l${r.key}`, item: r.item, spinning: r.spinning ?? false })),
    ];
  });

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

  /** `묶음:차례` */
  let openPills = $state<Set<string>>(new Set());
  function togglePill(key: string): void {
    const next = new Set(openPills);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    openPills = next;
  }
  const toolShown = (id: string) => {
    const p = pillRuns.at.get(id);
    return !p || openPills.has(`${p.run}:${p.pill}`);
  };
  const toolOpen = (id: string, item: TranscriptItem | null, toggled: boolean) => pillToolOpen(item?.tool, pillRuns.at.has(id), toggled);

  let lastLiveUser = "";
  $effect(() => {
    const last = live.length > 0 ? live[live.length - 1] : null;
    if (!last || last.item?.role !== "user" || last.key === lastLiveUser) return;
    lastLiveUser = last.key;
    void tick().then(toBottom);
  });

  // ── 보내는 중 말풍선 ──

  const sentCount = (text: string) => items.filter((x) => x.item.role === "user" && sentMatches(text, x.item.text)).length;
  /** 처음 본 때의 그 수보다 늘어야 걷는다 — 같은 글을 두 번 보내도 헷갈리지 않게 */
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
    <!-- 같은 깨움을 꼬리가 지금 그린다 — 기록 쪽은 그리지 않는다 -->
  {:else if item.role === "user" && mark && "pill" in mark}
    <li class="item wake-pill" data-item="wake" title={fmtAt(item.at)}>
      <span class="wake-in"><UiIcon name="bell" size={13} /><span>{mark.pill}</span></span>
    </li>
  {:else if item.role === "user"}
    {@const chips = linkChips(item.link)}
    {@const pics = pictures ? (item.pictures ?? []) : []}
    {@const hidden = hiddenImageCount(item, !!pictures, (p) => pictures?.state(p).status === "fail")}
    <!-- `[Image #N]` 자리표를 떼는 판정은 여기 — 불러오기 실패는 화면만 안다 -->
    {@const shownText = item.text ? withoutImagePlaceholders(unwrapPasted(item.text), item.images > 0 && pics.length > 0 && hidden === 0) : ""}
    {@const utext = copyable ? shownText : ""}
    {#if chips.length > 0}
      <li class="item linkchip" data-item="link" data-link={chips[0].key === "board.viewer.unlinked" ? "off" : "on"}>
        {#each chips as chip, i (i)}<span>{t(chip.key, { label: chip.label })}</span>{/each}
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
        <div class="upics">
          {#each sentPics as sp, i (i)}<img class="upic" src={sp.url} alt={sp.name} data-sent-pic />{/each}
        </div>
      {/if}
      {#if hidden > 0}<span class="chip">{t("board.viewer.images", { n: hidden })}</span>{/if}
      {#each [...(item.files ?? []), ...filesBesidePics(files, sentPics)] as f, i (i)}<span class="chip file" data-sent-file><UiIcon name="file" size={14} /><span>{f}</span></span>{/each}
      {#if item.truncated}<span class="cut">{t("board.viewer.truncated")}</span>{/if}
      {#if note}<span class="cut">{note}</span>{/if}
      {#if mark && "note" in mark}<span class="cut" data-wake-unrecorded>{mark.note}</span>{/if}
      {#if utext.trim() !== ""}{@render msgCopy(utext, "user")}{/if}
    </li>
  {:else if item.role === "assistant"}
    {@const parts = streaming && (diagrams || codeActions) ? splitOpenFence(item.text ?? "") : { done: item.text ?? "", open: null }}
    <!-- 다이어그램 · 코드 블록 단추는 닫힌 몫에만 — 머리말 -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <li class="item assistant" data-item="assistant" tabindex={copyable ? -1 : undefined}>
      <MarkdownBlocks blocks={parseMarkdown(parts.done)} compact {diagrams} {images} linkImages={!!images} onlink={openLink} linkClick="plain" linkStyle="chip" {paths} {codeActions} />
      {#if parts.open !== null}<MarkdownBlocks blocks={parseMarkdown(parts.open)} compact {images} linkImages={!!images} onlink={openLink} linkClick="plain" linkStyle="chip" {paths} />{/if}
      {#if item.truncated}<span class="cut">{t("board.viewer.truncated")}</span>{/if}
      {#if copyText !== null}{@render msgCopy(copyText, "agent")}{/if}
    </li>
  {:else if item.role === "interrupted"}
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
  <span class="mcopy" class:user={side === "user"} data-msg-copy={side}>
    <button
      type="button"
      class="mcopy-btn"
      title={t("board.viewer.copy")}
      aria-label={t("board.viewer.copy")}
      onclick={() => void copyMessage(text)}><UiIcon name="copy" size={14} /></button
    >
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
            <!-- 알약에 접혔다 -->
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

  .item.tool + .item.tool {
    margin-top: calc(-1 * var(--space-3));
  }

  .item {
    min-width: 0;
    font-size: var(--t-sm);
    line-height: 1.6;
  }

  .item.user {
    align-self: stretch;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-hover);
    border-radius: var(--radius-md);
  }

  /* 폰에서 누르면 포커스만 받는다 — 복사 단추가 그 표시다 */
  .item.user:focus,
  .item.assistant:focus {
    outline: none;
  }

  /* 말 복사 — 단추 자리는 늘 잡아 두고(대화가 들썩이지 않게) 단추만 비친다 */
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

  .item.user.pending {
    opacity: 0.6;
  }

  .body.chat .item.user {
    align-self: flex-end;
    max-width: 78%;
    background: color-mix(in srgb, var(--accent) 18%, var(--surface-raised-solid));
    border-radius: 12px 12px 4px 12px;
  }

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

  /* 입력 칸 칩(`FlipComposer` 의 `.att`)과 같은 그림 크기 · 간격 */
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

  /* 거절됨은 실패가 아니다(사람 · 규칙이 막았다) — 빨강 없이 */
  .tflag.denied {
    color: var(--fg-3);
  }

  .item.linkchip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
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

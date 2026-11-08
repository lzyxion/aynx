// **문서 타일의 목차 상태** — `DocView.svelte` 에서 그대로 옮긴 컨트롤러(2026-10-27 분할 6차).
// `DocView` 가 하나 만들고(`createDocOutline` — 그린 보기인가 · 블록 · 파일 · 글 · 목차 켬 · 타일 폭 · 본문 상자는 게터로) 값은 게터로 읽는다.
//
// 쥐는 것: 목차 줄(`outlineOf`) · 자리가 서는가 · 좁은 타일인가(`isNarrowOutline`) · 곁 패널이 열렸나 · 지금 절(`currentSection` —
// rAF 로 묶어 잰다) · 목차에서 방금 고른 자리(`picked` — 사람이 직접 밀면 놓는다) · 좁은 타일의 드롭다운 자리와 단추 손잡이.
// 규칙은 순수 `doc-outline.ts`, 목록 그림은 `DocOutline.svelte`.
//
// **`$effect` · 관찰자 · 리스너는 여기 없다** — 타일 폭 `ResizeObserver`(타일 폭은 편집 보기도 읽어 `DocView` 에 산다) · 본문 스크롤 ·
// 휠 · 누름 리스너 · 본문 내용 상자 `ResizeObserver` · 다시 재기 효과 · 드롭다운 닫기 효과 · 그림 틀 거두기(`onDestroy`)는 `DocView` 의
// 원래 자리 · 원래 순서 그대로 남아 이 컨트롤러의 `scheduleTrack` · `releasePick` · `closeOutlineDrop` · `dispose` 를 부른다.
import { t } from "$lib/i18n/i18n.svelte.js";
import { currentSection, isNarrowOutline, outlineOf, type OutlineItem } from "$lib/doc-outline";
import { DROPDOWN_GAP } from "$lib/dropdown";
import type { MdBlock } from "$lib/markdown";
import type { TextFile } from "$lib/fs-backend";

/** `DocView` 가 넘기는 값 — **게터**라 그때그때의 값이다(생성 시점 사본이 아니다). */
export interface DocOutlineHost {
  /** 마크다운을 그려서 보이는 중인가 */
  readonly rendered: boolean;
  /** 그린 블록 */
  readonly blocks: MdBlock[];
  readonly file: TextFile | null;
  readonly text: string;
  /** 목차 곁 패널을 켰는가(프롭 `outline`) */
  readonly outline: boolean;
  /** 타일 폭 — 못 쟀으면 0 */
  readonly tileWidth: number;
  readonly bodyEl: HTMLDivElement | null;
  readonly rootEl: HTMLDivElement | null;
  /** 그 앵커의 제목으로 스크롤(본문 상자만) */
  scrollToAnchor(a: string): boolean;
}

/** 목차 하나를 만든다 — 상태는 이 안에 살고 읽기는 게터로 */
export function createDocOutline(host: DocOutlineHost) {
  /** 최상위 제목들 — 그린 보기일 때만(원문 · 편집 · 코드 파일이면 빈 목록) */
  const outlineItems = $derived<OutlineItem[]>(host.rendered ? outlineOf(host.blocks) : []);
  /** [목차] 자리가 서는가 — 그린 마크다운에 글이 있을 때. 제목이 없으면 단추는 서되 흐리다(툴팁이 까닭을 말한다) */
  const outlineSlot = $derived(host.rendered && host.file !== null && !host.file.binary && host.text !== "");
  const narrow = $derived(isNarrowOutline(host.tileWidth));
  const hasOutline = $derived(outlineSlot && outlineItems.length > 0);
  const panelOpen = $derived(host.outline && hasOutline && !narrow);
  /** 지금 읽는 절 — `outlineItems` 의 자리, 첫 제목 위면 `-1` */
  let curIdx = $state(-1);
  /** 목차에서 방금 고른 자리 — 사람이 직접 스크롤(휠 · 끌기 · 키)하면 놓는다(`currentSection` 의 `picked`) */
  let picked: number | null = null;
  let trackFrame = 0;
  const curName = $derived(
    curIdx >= 0 && outlineItems[curIdx] ? outlineItems[curIdx].text || "—" : t("files.doc.outline"),
  );

  /** 좁은 타일의 목차 드롭다운 자리(단추 아래) — `null` 이면 닫힘 */
  let outlineDrop = $state<{ x: number; y: number; w: number; maxH: number } | null>(null);
  let outlineButton = $state<HTMLButtonElement | null>(null);

  /** 사람이 직접 민다 — 고른 자리를 놓는다 */
  function releasePick() {
    picked = null;
  }

  /** 언마운트 — 걸린 그림 틀을 거둔다 */
  function dispose() {
    if (trackFrame) cancelAnimationFrame(trackFrame);
  }

  /** 다음 그림 틀에 한 번 — 스크롤 사건마다 재지 않는다 */
  function scheduleTrack() {
    if (trackFrame) return;
    trackFrame = requestAnimationFrame(() => {
      trackFrame = 0;
      track();
    });
  }

  /** 지금 절을 잰다 — 목차를 보이지 않을 때(넓은 타일에 패널 닫힘)는 재지 않는다 */
  function track() {
    const items = outlineItems;
    const bodyEl = host.bodyEl;
    if (!bodyEl || !hasOutline || (!panelOpen && !narrow)) {
      if (!hasOutline) curIdx = -1;
      return;
    }
    // 위 좌표는 앵커 스크롤과 같은 셈(본문 내용 기준) — 고른 절로 간 뒤 그 절이 기준선을 지난 것으로 잡힌다
    const base = bodyEl.getBoundingClientRect().top - bodyEl.scrollTop;
    const bySlug = new Map<string, HTMLElement>();
    for (const h of bodyEl.querySelectorAll<HTMLElement>("[data-slug]")) {
      const slug = h.dataset.slug;
      if (slug && !bySlug.has(slug)) bySlug.set(slug, h);
    }
    const tops = items.map((it) => {
      const el = bySlug.get(it.slug);
      return el ? el.getBoundingClientRect().top - base : Number.POSITIVE_INFINITY;
    });
    curIdx = currentSection(
      { tops, scrollTop: bodyEl.scrollTop, clientHeight: bodyEl.clientHeight, scrollHeight: bodyEl.scrollHeight },
      picked,
    );
  }

  /** 목차의 줄을 골랐다 — 앵커 링크와 같은 스크롤, 그리고 본문으로 포커스(↑↓ · PgUp/PgDn 이 바로 산다) */
  function pickOutline(it: OutlineItem) {
    picked = it.index;
    host.scrollToAnchor(it.slug);
    scheduleTrack();
    host.rootEl?.focus({ preventScroll: true });
  }

  function openOutlineDrop() {
    const r = outlineButton?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(320, window.innerWidth - 16);
    const y = r.bottom + DROPDOWN_GAP;
    outlineDrop = {
      x: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
      y,
      w,
      maxH: Math.max(160, Math.min(420, window.innerHeight - y - 8)),
    };
  }

  function closeOutlineDrop() {
    outlineDrop = null;
  }

  /** Esc — 닫고 단추로 돌아간다(바깥 클릭 닫기는 포커스를 옮기지 않는다) */
  function escapeOutlineDrop() {
    closeOutlineDrop();
    outlineButton?.focus();
  }

  return {
    get outlineItems() {
      return outlineItems;
    },
    get outlineSlot() {
      return outlineSlot;
    },
    get narrow() {
      return narrow;
    },
    get hasOutline() {
      return hasOutline;
    },
    get panelOpen() {
      return panelOpen;
    },
    get curIdx() {
      return curIdx;
    },
    get curName() {
      return curName;
    },
    get outlineDrop() {
      return outlineDrop;
    },
    /** 좁은 타일의 드롭다운 단추(`bind:this`) */
    get outlineButton() {
      return outlineButton;
    },
    set outlineButton(v: HTMLButtonElement | null) {
      outlineButton = v;
    },
    releasePick,
    dispose,
    scheduleTrack,
    pickOutline,
    openOutlineDrop,
    closeOutlineDrop,
    escapeOutlineDrop,
  };
}

export type DocOutlineController = ReturnType<typeof createDocOutline>;

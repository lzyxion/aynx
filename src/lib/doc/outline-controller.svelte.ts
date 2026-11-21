// 문서 타일의 목차 상태 — `DocView` 가 하나 만든다. `$effect` · 관찰자 · 리스너는 `DocView` 가 쥔다.
// 좁은가 · 곁 패널이 보이는가는 받기만 한다 — 양옆 곁 패널의 폭 규칙은 `docPanelLayout`(`doc-side-panels.ts`) 한 곳이 정한다.
import { t } from "$lib/i18n/i18n.svelte.js";
import { currentSection, outlineOf, type OutlineItem } from "$lib/doc-outline";
import { DROPDOWN_GAP } from "$lib/dropdown";
import type { MdBlock } from "$lib/markdown";
import type { TextFile } from "$lib/fs-backend";

/** 게터라 그때그때의 값이다(생성 시점 사본이 아니다) */
export interface DocOutlineHost {
  readonly rendered: boolean;
  readonly blocks: MdBlock[];
  readonly file: TextFile | null;
  readonly text: string;
  readonly narrow: boolean;
  readonly outlineShown: boolean;
  readonly bodyEl: HTMLDivElement | null;
  readonly rootEl: HTMLDivElement | null;
  scrollToAnchor(a: string): boolean;
}

export function createDocOutline(host: DocOutlineHost) {
  const outlineItems = $derived<OutlineItem[]>(host.rendered ? outlineOf(host.blocks) : []);
  /** 제목이 없어도 자리는 선다 — 단추가 흐린 채 툴팁이 까닭을 말한다 */
  const outlineSlot = $derived(host.rendered && host.file !== null && !host.file.binary && host.text !== "");
  const narrow = $derived(host.narrow);
  const hasOutline = $derived(outlineSlot && outlineItems.length > 0);
  const panelOpen = $derived(host.outlineShown && hasOutline && !narrow);
  /** 첫 제목 위면 `-1` */
  let curIdx = $state(-1);
  /** 목차에서 방금 고른 자리 — 사람이 직접 스크롤하면 놓는다 */
  let picked: number | null = null;
  let trackFrame = 0;
  const curName = $derived(
    curIdx >= 0 && outlineItems[curIdx] ? outlineItems[curIdx].text || "—" : t("files.doc.outline"),
  );

  let outlineDrop = $state<{ x: number; y: number; w: number; maxH: number } | null>(null);
  let outlineButton = $state<HTMLButtonElement | null>(null);

  function releasePick() {
    picked = null;
  }

  function dispose() {
    if (trackFrame) cancelAnimationFrame(trackFrame);
  }

  function scheduleTrack() {
    if (trackFrame) return;
    trackFrame = requestAnimationFrame(() => {
      trackFrame = 0;
      track();
    });
  }

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

  function pickOutline(it: OutlineItem) {
    picked = it.index;
    host.scrollToAnchor(it.slug);
    scheduleTrack();
    host.rootEl?.focus({ preventScroll: true });
  }

  /** 단추가 도구줄 맨 끝이라 상자의 오른쪽 변을 단추 오른쪽 변에 맞춘다 */
  function openOutlineDrop() {
    const r = outlineButton?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(320, window.innerWidth - 16);
    const y = r.bottom + DROPDOWN_GAP;
    outlineDrop = {
      x: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)),
      y,
      w,
      maxH: Math.max(160, Math.min(420, window.innerHeight - y - 8)),
    };
  }

  function closeOutlineDrop() {
    outlineDrop = null;
  }

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

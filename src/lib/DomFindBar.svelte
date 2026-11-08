<script lang="ts">
  /**
   * **보이는 글자 안 찾기** — 상자(`root`) 안의 글자 노드를 훑어 찾고 CSS Custom Highlight 로 칠하는 찾기 띠(2026-10-19 — 문서 타일
   * `DocView` 의 찾기를 그대로 떼어 냈다). 문서 타일 · AI 타일의 대화 면(`pane/AiFlip`) · diff 타일의 패치(`DiffView`)가 쓴다. 그림과
   * 키는 `FindBar`, 훑기 · 칠은 `doc-find-dom.ts`(DOM 을 한 글자도 바꾸지 않는다 — 그린 블록 · 선택 · 스크롤이 그대로다), 규칙은
   * `doc-find.ts` 의 순수 함수다.
   *
   * - 부르는 쪽이 [`show`] 로 연다(`find` 액션 — `app/tile-find.ts`). 찾을 상자가 없으면 `false`(앱이 터미널 검색으로 넘어간다).
   * - 질의 · 대소문자가 바뀌면 그림 틀에 한 번 다시 찾고 지금 보는 자리 뒤 첫 일치를 골라 보이게 민다. 상자 안이 다시 그려지면
   *   (자동 새로고침 · 따라가기 · 늦게 그려지는 덩어리 — `MutationObserver`) 고른 번호를 지키고 밀지 않는다. 상자가 바뀌면(보기 전환 ·
   *   다른 파일) 그 상자로 다시 찾는다.
   * - 지금 일치로 미는 것은 스크롤 상자(`scroller`)만이다(`scrollIntoView` 는 조상까지 민다).
   * - 닫으면 칠을 걷고 질의는 남긴다(다시 열면 같은 글로 바로 찾는다). 포커스를 어디로 돌릴지는 `onclose`.
   * - 훑지 않는 곳: 거터 · 그림 · 수식 · mermaid · 단추 · 입력 칸 · `data-find-skip`(`doc-find-dom.ts` 의 `SKIP`).
   */
  import { onDestroy, tick, untrack } from "svelte";
  import FindBar from "$lib/FindBar.svelte";
  import { firstFrom, revealOffset, stepMatch } from "$lib/doc-find";
  import { clearFind, findRanges, paintFind } from "$lib/doc-find-dom";

  let {
    root,
    scroller,
    label,
    onclose,
  }: {
    /** 훑을 상자 — 없으면 열 수 없다 */
    root: HTMLElement | null;
    /** 지금 일치를 보이게 밀 스크롤 상자(없으면 밀지 않는다) — 찾을 때마다 묻는다(보기마다 상자가 다를 수 있다) */
    scroller: () => HTMLElement | null;
    /** 띠의 이름 · 칸의 자리 글 */
    label: string;
    /** 닫혔다(`Esc` · [닫기]) — 부르는 쪽이 포커스를 제 몸으로 돌린다. 부르는 쪽이 [`close`] 로 닫으면 오지 않는다 */
    onclose?: () => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let caseSensitive = $state(false);
  let count = $state(0);
  /** 지금 일치 — 없으면 -1 */
  let index = $state(-1);
  let bar = $state<ReturnType<typeof FindBar> | null>(null);
  /** 지금 칠해 둔 범위들(문서 순서) — 화면에 나오지 않아 반응형이 아니다 */
  let hits: Range[] = [];
  /** 하이라이트 표에서 이 띠의 몫을 가르는 열쇠(`paintFind`) */
  const owner = {};
  let frame = 0;
  /** 다음 그림 틀의 다시 찾기가 "질의가 바뀜"(보는 자리 뒤 첫 일치로 간다)인가 */
  let jumpNext = false;

  /** 띠가 열려 있나 */
  export function isOpen(): boolean {
    return open;
  }

  /** 띠를 연다(이미 열렸으면 칸으로 포커스 · 질의 고르기) — 찾을 상자가 없으면 `false` */
  export function show(): boolean {
    if (!root) return false;
    open = true;
    // 띠가 막 섰을 수 있다 — 선 뒤에 칸으로
    void tick().then(() => bar?.focus());
    return true;
  }

  /** 띠를 닫고 칠을 걷는다 — 부르는 쪽이 닫을 때(찾을 글이 사라졌다 · 면이 바뀌었다). `onclose` 는 부르지 않는다 */
  export function close(): void {
    if (!open) return;
    open = false;
    watched = null;
    clearFind(owner);
    hits = [];
    count = 0;
    index = -1;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    jumpNext = false;
  }

  function closeByUser(): void {
    close();
    onclose?.();
  }

  function schedule(jump: boolean): void {
    jumpNext ||= jump;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const j = jumpNext;
      jumpNext = false;
      refind(j);
    });
  }

  /**
   * 다시 찾는다. `jump`(질의 · 대소문자가 바뀜)면 지금 보는 자리 뒤 첫 일치를 골라 보이게 민다. 아니면(글이 다시 그려짐) 고른
   * 번호를 지키고 밀지 않는다 — 자동 새로고침 · 따라가기가 읽던 자리를 끌고 가지 않게.
   */
  function refind(jump: boolean): void {
    if (!open) return;
    if (!root) {
      // 상자가 잠깐 없다(다른 파일을 읽는 중 따위) — 칠과 셈을 비워 둔다. 상자가 다시 서면 아래 효과가 다시 찾는다
      hits = [];
      count = 0;
      index = -1;
      paintFind(owner, [], null);
      return;
    }
    hits = findRanges(root, query, caseSensitive);
    count = hits.length;
    if (jump) {
      const box = scroller();
      const base = box ? box.getBoundingClientRect().top : 0;
      index = firstFrom(count, (i) => hits[i].getBoundingClientRect().top - base, 0);
    } else {
      index = count === 0 ? -1 : Math.min(Math.max(index, 0), count - 1);
    }
    paintFind(owner, hits, hits[index] ?? null);
    if (jump) reveal();
  }

  /** 다음 · 이전 일치로 — 끝에서 처음으로 돈다 */
  function step(dir: 1 | -1): void {
    if (count === 0) return;
    index = stepMatch(index, count, dir);
    paintFind(owner, hits, hits[index] ?? null);
    reveal();
  }

  /** 지금 일치가 보이게 — 스크롤 상자만 민다 */
  function reveal(): void {
    const r = hits[index];
    const box = scroller();
    if (!r || !box) return;
    const rr = r.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    box.scrollTo({
      top: revealOffset(box.scrollTop, box.clientHeight, rr.top - br.top + box.scrollTop, rr.height),
      left: revealOffset(box.scrollLeft, box.clientWidth, rr.left - br.left + box.scrollLeft, rr.width),
    });
  }

  // 질의 · 대소문자가 바뀌었다(띠를 막 연 것 포함) — 그림 틀에 한 번
  $effect(() => {
    void query;
    void caseSensitive;
    if (!open) return;
    untrack(() => schedule(true));
  });

  // 상자 안이 다시 그려지면 다시 찾는다 — 띠가 열린 동안만 지켜본다(속성 변화는 보지 않는다). 상자가 바뀌었으면(보기 전환 · 다른
  // 파일) 새 글이라 질의를 바꾼 것처럼 보는 자리 뒤 첫 일치로 한 번
  let watched: HTMLElement | null = null;
  $effect(() => {
    const el = root;
    if (!open) return;
    if (el !== watched) {
      // 막 열었을 때도 지나간다 — 위 질의 효과와 같은 그림 틀로 묶인다(`schedule`)
      watched = el;
      untrack(() => schedule(true));
    }
    if (!el) return;
    const mo = new MutationObserver(() => schedule(false));
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  });

  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame);
    clearFind(owner);
  });
</script>

{#if open}
  <FindBar bind:this={bar} bind:query bind:caseSensitive {count} {index} {label} onstep={step} onclose={closeByUser} />
{/if}

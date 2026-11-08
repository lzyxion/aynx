<script lang="ts">
  /**
   * **터미널 이름 카드** — SSH 타일 머리줄의 이름에 얹으면 뜨는 연결 상태 카드
   * (docs/log/2026-09-28-tile-header-tooltips.md "SSH 이름 카드"). 2026-10-11 부터 **로컬 터미널 타일도 같은 판**이다 —
   * 머리(이름 + 코드)는 그대로, 주소 줄 없이 몸통만 `셸`(또는 `AI`) · `폴더` 두 줄(`localInfoCard`). 2026-10-14 부터 **쿼리 타일**도
   * 같은 판이다 — 머리에 엔진 로고(`icon`) · 주소 줄 `사용자@주소:포트`, 몸통은 `query/info-card`.
   *
   * ```text
   * ● web-01  p3
   *   deploy@web-01.internal:22
   * ───────────────────────────
   * 인증     키 · ~/.ssh/id_ed25519
   * 경유     bastion
   * 접속     12분 전
   * 지연     23ms
   * keepalive 꺼짐
   * ```
   *
   * 예전에는 이름 칸의 `title` 세 줄(`web-01 — deploy@… / 인증: … · 경유: … / 서버: … · 접속 … · 지연 …`)이 전부였다.
   * 같은 사실을 라벨 | 값 격자로 편다 — 줄은 순수 함수 `sessionInfoCard` 가 짓는다(값이 없는 줄은 없다).
   *
   * ## 자리 · 층 — 상태바 사용량 카드(`UsageHoverCard.svelte`)와 같은 판
   *
   * `position: fixed`, 자리는 `placeTooltip`(아래가 기본, 모자라면 위). **타일 상자 밖**(`PaneHost` 의 최상위, ⋯ 메뉴·
   * tmux 팝오버와 같은 자리)에 그린다 — 상자마다 `isolation: isolate` 라 안에서 그리면 포커스되지 않은 타일의 카드가
   * 뒤에 그려지는 이웃 타일에 덮인다. 판 · 자리 계산 · 두 걸음(재고 → 보인다) · 몸짓 · 재질은 공용 틀 `HoverCard.svelte`(2026-10-11).
   *
   * `aria-hidden` — 시각 층이다. 같은 글자는 이름 칸의 `aria-describedby` 가 가리키는 숨은 한 줄이 쥔다.
   * 커서를 먹지 않는다(`pointer-events: none`) — 먹으면 이름에서 `pointerleave` 가 나 카드가 깜빡인다.
   */
  import type { InfoCard } from "$lib/session-info";
  import HoverCard from "$lib/HoverCard.svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import type { TooltipRect } from "$lib/tooltip";

  let {
    name,
    code,
    address,
    color,
    icon = null,
    card,
    anchor,
  }: {
    /** 보이는 이름(`displayName`) — 머리줄 이름 칸과 같은 글자 */
    name: string;
    /** 타일 코드(`p3`) — 이름 뒤에 흐리게 (머리줄 칩은 로컬 ✦ 타일에서만 서므로 여기서 본다 — 원격은 늘 여기, 2026-10-11) */
    code: string;
    /** `user@host:port` (`hostLabel`) — 호스트를 모르면 빈 글자(줄이 없다) */
    address: string;
    /** 호스트 색 — 없으면 점이 없다 */
    color: string | null;
    /** 이름 앞 아이콘(`HostIcon` 값) — 쿼리 타일의 엔진 로고(10-14). 있으면 색 점 대신 선다 */
    icon?: string | null;
    card: InfoCard;
    /** 이름 칸의 상자(뷰포트 좌표) */
    anchor: TooltipRect;
  } = $props();
</script>

<HoverCard
  {anchor}
  watch={[card, name, code, address]}
  minWidth={240}
  maxWidth={440}
  gap="var(--space-2)"
  data-session-info-card=""
>
  <div class="s-head">
    <div class="s-title">
      {#if icon}
        <HostIcon {icon} size={14} />
      {:else if color}
        <span class="s-dot" style:background={color}></span>
      {/if}
      <span class="s-name">{name}</span>
      <span class="s-code">{code}</span>
    </div>
    {#if address}
      <div class="s-addr">{address}</div>
    {/if}
  </div>
  <div class="s-rows">
    {#each card.rows as r (r.key)}
      <span class="s-label">{r.label}</span>
      <span class="s-value" class:warn={r.tone === "warn"} data-row={r.key}>{r.value}</span>
    {/each}
  </div>
  {#each card.warnings as w (w)}
    <div class="s-warn">{w}</div>
  {/each}
</HoverCard>

<style>
  /* 머리 — 이름 줄 + 주소 줄, 아래에 가는 선 하나 */
  .s-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  .s-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  /* 머리줄의 색 점(`.swatch`)과 같은 모양 — 8px 동그라미 */
  .s-dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .s-name {
    min-width: 0;
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .s-code {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    color: var(--fg-3);
    white-space: nowrap;
  }
  .s-addr {
    font-family: var(--font-mono);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 라벨 | 값 — 라벨 칸은 가장 긴 라벨만큼, 값은 나머지. 값이 길면(키 경로·서버 배너) 줄을 바꾼다 */
  .s-rows {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: var(--space-3);
    row-gap: 4px;
  }
  .s-label {
    color: var(--fg-3);
    white-space: nowrap;
  }
  .s-value {
    color: var(--fg-1);
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
  .s-value.warn,
  .s-warn {
    color: var(--warn);
  }
</style>

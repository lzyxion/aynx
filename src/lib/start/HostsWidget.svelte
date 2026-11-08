<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import StartRow from "$lib/start/StartRow.svelte";
  import { hostMeta, type HostEntry } from "$lib/hosts";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import { historyOf } from "$lib/host-history";
  import { relativeTime } from "$lib/history-search";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { LaunchItem, LaunchRowHandlers } from "$lib/start/launch-item";

  /**
   * **최근 호스트 위젯** — 접속 이력(`history.json`)에서 한 번이라도 성공한 곳, 늦은 순(줄은 `StartPage` 가 `recentHosts` 로
   * 위젯 높이만큼 세운다 — 팔레트 "최근" 과 같은 함수). 누르면 호스트 독의 "접속" 과 같은 함수(`hostActions().onconnect`).
   */
  let {
    items,
    handlers,
    now,
  }: {
    items: readonly Extract<LaunchItem, { kind: "host" }>[];
    handlers: LaunchRowHandlers;
    /** 상대 시각의 "지금" — `StartPage` 가 판이 보일 때 갱신한다(주기 시계 없음) */
    now: number;
  } = $props();

  /** 호스트의 앞자리 아이콘 값 — 컬러 로고인지 이모지인지는 `HostIcon` 이 가른다 */
  const iconOf = (host: HostEntry) => hostMeta(host).icon?.trim() || null;
  /** 호스트 색 — 단색(lucide) 아이콘이 입는다 (`HostIcon` 의 `color`) */
  const colorOf = (host: HostEntry) => hostMeta(host).color?.trim() || null;

  /** 마지막 성공 시각 → `2분 전` (팔레트 기록 목록과 같은 계단) */
  function hostWhen(host: HostEntry): string {
    const at = historyOf(hostHistory(), host.name)?.last_ok_at;
    return at == null ? "" : relativeTime(at, now, t);
  }
</script>

{#each items as item, i (item.key)}
  <StartRow {item} index={i} title={item.host.name} {handlers}>
    <span class="ico"><HostIcon icon={iconOf(item.host)} size={14} fallback="server" color={colorOf(item.host)} /></span>
    <span class="name">{item.host.name}</span>
    <span class="meta">{hostWhen(item.host)}</span>
  </StartRow>
{/each}

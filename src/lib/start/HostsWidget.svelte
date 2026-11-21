<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import StartRow from "$lib/start/StartRow.svelte";
  import { hostMeta, type HostEntry } from "$lib/hosts";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import { historyOf } from "$lib/host-history";
  import { relativeTime } from "$lib/history-search";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { LaunchItem, LaunchRowHandlers } from "$lib/start/launch-item";

  let {
    items,
    handlers,
    now,
  }: {
    items: readonly Extract<LaunchItem, { kind: "host" }>[];
    handlers: LaunchRowHandlers;
    /** 판이 보일 때 `StartPage` 가 갱신한다(주기 시계 없음) */
    now: number;
  } = $props();

  const iconOf = (host: HostEntry) => hostMeta(host).icon?.trim() || null;
  const colorOf = (host: HostEntry) => hostMeta(host).color?.trim() || null;

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

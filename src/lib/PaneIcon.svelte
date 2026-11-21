<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import EqBars from "$lib/orchestration/EqBars.svelte";
  import ArtistAvatar from "$lib/orchestration/player/ArtistAvatar.svelte";
  import { pulseOfRun } from "$lib/app/orch-pulse.svelte.js";
  import { iconRef } from "$lib/host-icons";
  import { hostMeta } from "$lib/hosts";
  import type { PaneSpec } from "$lib/session";
  import { lookupHost } from "$lib/app/hosts.svelte.js";
  import { findDbConn } from "$lib/app/db-conns.svelte.js";
  import { DB_ENGINE_ICON } from "$lib/db-conn";
  import { paneAi, paneIdentity } from "$lib/app/titles.svelte.js";

  let {
    pane,
    size = 13,
  }: {
    pane: PaneSpec;
    size?: number;
  } = $props();

  const hostMetaOf = $derived.by(() => {
    const alias = pane.alias?.trim();
    const host = alias ? lookupHost(alias) : undefined;
    return host ? hostMeta(host) : null;
  });
  const hostIcon = $derived(hostMetaOf?.icon ?? null);
  const hostColor = $derived(hostMetaOf?.color?.trim() || null);

  /** 로컬 타일의 이름과 아이콘은 `paneIdentity` 한 답에서 나온다 — 따로 정하면 둘이 어긋난다 */
  const localIdentity = $derived(paneIdentity(pane));
  const localIcon = $derived(iconRef(localIdentity.icon));

  const remoteAi = $derived(pane.kind === "ssh" ? paneAi(pane) : null);

  const queryEngineIcon = $derived.by(() => {
    if (pane.kind !== "query" || !pane.query?.connId) return null;
    const d = findDbConn(pane.query.connId);
    return d ? DB_ENGINE_ICON[d.engine] : null;
  });
</script>

{#if pane.kind === "ssh" && remoteAi}
  <span class="pair" aria-hidden="true">
    <AiGlyph name={remoteAi} {size} />
    <HostIcon icon={hostIcon} {size} fallback="server" color={hostColor} />
  </span>
{:else if pane.kind === "ssh" || pane.kind === "sftp"}
  <HostIcon icon={hostIcon} {size} fallback="server" color={hostColor} />
{:else if pane.kind === "local" && localIdentity.ai}
  <AiGlyph name={localIdentity.ai} {size} />
{:else if pane.kind === "local"}
  <HostIcon icon={localIcon} {size} />
{:else if pane.kind === "localfs"}
  <HostIcon icon={null} {size} fallback="folder" />
{:else if pane.kind === "doc"}
  <UiIcon name="file-text" {size} />
{:else if pane.kind === "image"}
  <UiIcon name="image" {size} />
{:else if pane.kind === "branches"}
  <UiIcon name="git-branch" {size} />
{:else if pane.kind === "diff"}
  <UiIcon name="git-compare" {size} />
{:else if pane.kind === "producer"}
  <ArtistAvatar cli={pane.producer?.cli || null} {size} />
{:else if pane.kind === "run"}
  <EqBars state={pulseOfRun(pane.run?.runId)} size={Math.max(10, size - 1)} />
{:else if pane.kind === "query" && queryEngineIcon}
  <HostIcon icon={queryEngineIcon} {size} />
{:else if pane.kind === "query"}
  <UiIcon name="database" {size} />
{:else}
  <UiIcon name="home" {size} />
{/if}

<style>
  .pair {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 2px;
  }
</style>

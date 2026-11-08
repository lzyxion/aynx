<script lang="ts">
  // **에이전트(CLI) 로고 하나** — 오케스트레이션 설정의 좁은 자리(역할 표 요약 열 · 묶음 카드 역할 줄 · 저장소 목록 묶음 칸)가
  // 에이전트 이름 대신 쓴다. 이름은 `title`(툴팁)과 `aria-label`(스크린 리더)로만 남는다. 로고는 앱의 다른 AI 표시
  // (`AskAiPicker` · `McpSection`)와 같은 길(`aiIconName` → `iconRef` → `HostIcon`)로 그린다. 미정(`null`)이면 대체 글자 "?".
  import HostIcon from "$lib/HostIcon.svelte";
  import { iconRef } from "$lib/host-icons";
  import { aiIconName } from "$lib/pane-icons";
  import { cliShort, type RoleCli } from "$lib/orchestration/config";

  let { cli, size = 14 }: { cli: RoleCli | null; size?: number } = $props();

  const name = $derived(cliShort(cli));
  const logo = $derived(cli ? aiIconName(cli) : null);
</script>

<span class="agent-logo" role="img" title={name} aria-label={name} data-orch-agent={cli ?? ""}>
  {#if logo}<HostIcon icon={iconRef(logo)} {size} />{:else}?{/if}
</span>

<style>
  /* 로고마다 viewBox 가 달라도 같은 정사각 칸 — 줄 글자와 가운데 맞춘다 */
  .agent-logo {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    min-width: 14px;
    height: 14px;
    vertical-align: -2px;
    color: var(--fg-2);
  }
</style>

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

  /**
   * **타일 하나의 앞자리 아이콘** — 이름 왼쪽에 서서 "이게 무엇인가" 를 그림 하나로 말한다.
   *
   * | 타일 | 무엇을 그리나 |
   * | --- | --- |
   * | `ssh` | 그 호스트에 **사용자가 골라 붙인** 아이콘 (`sessions.toml` 의 `icon`). 안 골랐으면 테마 색 서버 랙. AI CLI 가 돌면 **그 로고가 앞**, 호스트 아이콘이 같은 크기로 나란히 뒤에 선다 |
   * | `sftp` | 같은 별칭의 호스트 아이콘 — 파일 타일은 "그 서버의 파일" 이다 |
   * | `local` | 지금 도는 것이 AI CLI 면 그 로고, 아니면 **해석된 셸**의 로고 (PowerShell·Bash·배포판 펭귄…) |
   * | `localfs` | 테마 색 폴더 |
   * | `query` | 그 연결의 **DB 엔진 로고**(독 DB 칸과 같은 `DB_ENGINE_ICON`). 엔진을 아직 모르면(목록을 읽기 전 · 연결이 지워짐) DB 그림 |
   * | `run`(오케스트레이션 플레이어 잎) | 그 앨범의 상태 그림(`EqBars` — 헤드폰 · 움직이는 막대 · ⏸ · 원 ✓ · 2026-10-31). 주소가 없으면 헤드폰 로고 |
   * | `doc` · `branches` · `diff` | **UI 아이콘** (`file-text` · `git-branch` · `git-compare`) |
 * | `start` | 앱 자신의 화면이라 **UI 아이콘** (`home`) — 컬러 로고 세트에 대응물이 없다 |
   *
   * AI 로고 자리(로컬 AI 타일 · 원격 AI 타일의 앞 아이콘)는 `AiGlyph` 를 지난다 — 설정 "AI 아이콘 모양" 이 아바타면 그 CLI 의
   * 아바타를 그린다(docs/log/2026-10-31-avatars.md).
   *
   * 세 자리(타일 헤더 · 탭 스트립 · 상태바 후미단)가 **이 하나**를 쓴다. 규칙이 컴포넌트마다
   * 흩어지면 탭에서는 셸이 보이고 헤더에서는 안 보이는 식으로 어긋난다.
   *
   * ## 이름과 아이콘은 **한 함수**가 함께 정한다
   *
   * 로컬 타일의 갈림(AI 냐 셸이냐, 어느 셸이냐)은 `localPaneIdentity`(`$lib/pane-identity`)
   * 하나에 있고, 이름(`displayName`)도 같은 답에서 `name` 을 꺼낸다. 예전에는 두 파일이
   * 같은 규칙을 각자 적고 있었는데, 갈림이 하나 늘자(손으로 띄운 AI) 곧바로 "아이콘은
   * Claude · 이름은 PowerShell" 이 될 자리가 생겼다. 세션이 열리기 전(해석 전)에는 둘 다
   * `PaneSpec.shell`(사용자가 고른 것)로 떨어지고, 그것도 없으면 일반 터미널 아이콘이다.
   *
   * **장식이다** — 옆의 이름이 읽어 주는 글자이므로 전부 `aria-hidden` (`HostIcon` 은
   * `label` 을 비워 두면 그렇게 그린다).
   */
  let {
    pane,
    size = 13,
  }: {
    pane: PaneSpec;
    size?: number;
  } = $props();

  /**
   * 별칭으로 찾은 호스트의 아이콘 (`ssh`·`sftp` 공용). 목록이 `$state` 라 호스트 아이콘을
   * 바꾸면 헤더·탭이 저절로 따라온다. 목록에 없는 별칭이면 `null` → 서버 랙 폴백.
   */
  const hostMetaOf = $derived.by(() => {
    const alias = pane.alias?.trim();
    const host = alias ? lookupHost(alias) : undefined;
    return host ? hostMeta(host) : null;
  });
  const hostIcon = $derived(hostMetaOf?.icon ?? null);
  /** 호스트 색 — 단색(lucide) 아이콘만 입는다 (`HostIcon` 의 `color`) */
  const hostColor = $derived(hostMetaOf?.color?.trim() || null);

  /**
   * 로컬 타일의 아이콘 — **AI 가 먼저**다. AI 타일은 `kind:"local"` 인 보통 셸에 CLI 를
   * 자동 실행해 만든 것이라(`newAiPane` → `autorun`), 셸 로고를 붙이면 화면에서 AI 타일과
   * 그냥 셸이 구분되지 않는다 — 사람이 그 타일을 찾을 때 쓰는 단서는 "Claude 가 도는 칸" 이다.
   * 그 단서는 **손으로 띄운 경우에도** 서야 한다: PowerShell 타일에서 `claude` 를 직접 치면
   * 도는 동안 로고·이름이 그 CLI 로 바뀌고, 빠져나오면 셸로 돌아온다
   * (docs/log/2026-09-16-ai-tile-identity-from-command.md).
   *
   * `autorun` 은 1회용 값이라 **다른 창으로 이관하면 떨어진다**(`adoptTab`). 그래도 CLI 가
   * 계속 돌고 있으면 이제는 **도는 명령**(OSC 133)이 같은 답을 준다 — 셸 통합이 없는
   * 세션에서만 셸 아이콘으로 돌아온다.
   */
  const localIdentity = $derived(paneIdentity(pane));
  const localIcon = $derived(iconRef(localIdentity.icon));

  /**
   * **원격 AI 타일의 아이콘 둘**(2026-10-08 사용자 결정) — SSH 타일에서 AI CLI 가 돌면(`paneAi` — `agentKindOf` 와
   * 같은 세 갈래) **AI 로고가 앞**, 호스트 아이콘이 **같은 크기로 나란히** 뒤에 선다 — 이름(`Claude Code · dev-01`)과
   * 같은 순서다. "무엇이 도는가" 와 "어느 서버" 를 함께 말한다(로컬 AI 타일은 로고 하나). 겹침·배지는 작은 크기에서
   * 알아보기 어려워 걷었다.
   */
  const remoteAi = $derived(pane.kind === "ssh" ? paneAi(pane) : null);

  /**
   * 쿼리 타일의 엔진 로고(10-14) — 연결 목록 사본(`app/db-conns` · `$state`)에서 id 로 찾는다. 사본은 쿼리 타일이 뜰 때 읽히므로
   * (`queryConnLabel`) 첫 그림은 DB 그림이었다가 읽히면 로고로 바뀐다. 못 찾으면 그대로 DB 그림.
   */
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
  <!-- 문서 보기 — 로컬이든 원격이든 같은 그림이다(어디의 파일인지는 이름의 별칭이 말한다) -->
  <UiIcon name="file-text" {size} />
{:else if pane.kind === "image"}
  <!-- 이미지 타일(2026-11-14) — 로컬 · 원격 같은 그림(어디의 파일인지는 이름의 별칭이 말한다) -->
  <UiIcon name="image" {size} />
{:else if pane.kind === "branches"}
  <!-- 브랜치 그래프 (docs/log/2026-09-29-branch-graph.md) -->
  <UiIcon name="git-branch" {size} />
{:else if pane.kind === "diff"}
  <!-- diff 타일 (docs/log/2026-10-05-diff-tile.md) -->
  <UiIcon name="git-compare" {size} />
{:else if pane.kind === "producer"}
  <!-- 프로듀서 채팅 잎(2단계 단계 3) — 그 CLI 의 캐릭터(아티스트 매핑 하나) -->
  <ArtistAvatar cli={pane.producer?.cli || null} {size} />
{:else if pane.kind === "run"}
  <!-- 오케스트레이션 플레이어 잎 — 로고 A(이퀄라이저 막대 넷) + 그 앨범의 맥박(⑤ · 노트 5-2) -->
  <EqBars state={pulseOfRun(pane.run?.runId)} size={Math.max(10, size - 1)} />
{:else if pane.kind === "query" && queryEngineIcon}
  <!-- 쿼리 타일 — 그 연결의 엔진 로고(독 DB 칸과 같은 그림 · 10-14) -->
  <HostIcon icon={queryEngineIcon} {size} />
{:else if pane.kind === "query"}
  <!-- 엔진을 아직 모를 때 — 호스트 폼 DB 칸과 같은 그림 (2026-10-12) -->
  <UiIcon name="database" {size} />
{:else}
  <UiIcon name="home" {size} />
{/if}

<style>
  /* AI 로고 · 호스트 아이콘 — 같은 크기로 나란히, 사이는 좁게 */
  .pair {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 2px;
  }
</style>

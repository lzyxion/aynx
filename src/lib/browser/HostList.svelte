<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { hostLabel, hostMeta, type HostEntry } from "$lib/hosts";
  import { isCutGroup, isCutHost } from "$lib/hosts-clipboard.svelte";
  import { ROW_ICON_PX } from "$lib/host-icons";
  import { groupPathOf, rowId, type HostTreeRow } from "$lib/host-folders";
  import { delegationGrantsOf } from "$lib/app/delegation.svelte.js";
  import { AI_STAGES, grantSummary, stageOf } from "$lib/delegation";
  import { gaugeIconName, gaugeIndex } from "$lib/ai-gauge";
  import { historyOf, historyTooltipLines } from "$lib/host-history";
  import { relativeTime } from "$lib/history-search";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import type { SelectionController } from "$lib/browser/selection-controller.svelte";
  import type { Box } from "$lib/selection";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { hostCache } from "$lib/app/hosts.svelte.js";
  import { dockAgentPanes } from "$lib/app/dock-dots.svelte.js";
  import { groupDot, hostDots } from "$lib/dock-dots";
  import {
    accordion,
    createSpringLoad,
    nestRows,
    plainClick,
    treeMotion,
    type TreeNode,
  } from "$lib/browser/tree-accordion";
  import "$lib/browser/dock-tree.css";

  /**
   * **호스트 트리** — 펼친 폴더와 호스트를 한 줄기로 늘어놓는다 (docs/log/2026-09-25-hosts-tree.md).
   *
   * 줄은 깊이마다 14px 씩 들여 선다. 폴더 줄 = 아이콘 · 이름 · 개수 · (오른쪽 끝) 펼침 꺾쇠, 호스트 줄 =
   * 아이콘/색 점 · 별칭 + 성질 표식 · 마지막 접속(`2분 전`) · 태그 · (꺾쇠 칸만큼 비움). 펼친 폴더는 아이들과
   * 한 묶음 판으로 선다(2026-10-19 — `tree-accordion.ts` · `dock-tree.css`).
   * 접속 정보(`user@host:port`)는 줄 말풍선의 첫 줄로 갔다.
   * 예전의 아이콘 보기(격자)는 트리와 함께 걷었다 — 들여쓰기가 뜻인 목록에 격자는 맞지 않는다.
   *
   * ssh config 는 같은 별칭이 여러 번 나올 수 있어 키 없이(인덱스) 순회한다.
   */
  let {
    rows,
    selection,
    order,
    /** 지금 드래그가 얹혀 강조 중인 **경로** (`""` 는 최상위라 `null` 과 구분해야 한다) */
    dropTarget,
    draggingIds,
    /** 이 폴더 경로에 사람이 고른 아이콘이 있으면 그 값 (없으면 `null`) */
    iconOf,
    colorOf = () => null,
    loading,
    /** 설정에 호스트가 아예 없는가 — "호스트가 없습니다" 를 가르는 근거의 절반 */
    noHosts,
    searching,
    /**
     * 검색이 아무것도 못 맞췄을 때 대신 내미는 **빠른 접속** 줄 (없으면 `null`).
     * 판정(`parseQuickConnect`)과 실행은 상위가 쥔다 — 여기는 라벨과 콜백만 그린다.
     */
    quickConnect = null,
    /** 첫 경고 한 줄 (호스트가 하나도 없을 때 그 자리에 대신 적는다) */
    warning,
    /** 러버밴드 사각형 (문턱을 못 넘었으면 `null`) */
    marqueeBox,
    /** 볼트에 비밀번호가 담긴 별칭들(소문자) — 줄 끝 표식 하나를 그린다 */
    savedAliases,
    onactivate,
    onexpand,
    onmenu,
    ondragstart,
    ondragend,
    ondragover,
    ondragleave,
    ondrop,
    listEl = $bindable(null),
  }: {
    rows: readonly HostTreeRow[];
    selection: SelectionController;
    order: readonly string[];
    dropTarget: string | null;
    draggingIds: ReadonlySet<string> | null;
    iconOf: (path: string) => string | null;
    /** 폴더의 색 (`[groups."…"].color`) — 단색 아이콘과 기본 폴더가 입는다. 호스트 줄에는 내려가지 않는다 */
    colorOf?: (path: string) => string | null;
    loading: boolean;
    noHosts: boolean;
    searching: boolean;
    quickConnect?: { label: string; run: () => void } | null;
    warning: string | undefined;
    marqueeBox: Box | null;
    savedAliases: ReadonlySet<string>;
    onactivate: (row: HostTreeRow) => void;
    /** 끄는 짐이 접힌 폴더 위에 머물렀다 — 그 폴더를 연다(접힌 폴더 줄만 · 저장되는 보통 펼침) */
    onexpand: (row: Extract<HostTreeRow, { kind: "folder" }>) => void;
    onmenu: (ev: MouseEvent, row: HostTreeRow) => void;
    ondragstart: (ev: DragEvent, row: HostTreeRow) => void;
    ondragend: () => void;
    ondragover: (ev: DragEvent, path: string) => void;
    ondragleave: (path: string) => void;
    ondrop: (ev: DragEvent, path: string) => void;
    listEl?: HTMLUListElement | null;
  } = $props();

  /** 별칭 줄 오른쪽 끝에 실제로 그리는 태그 수. 넘치면 `+N` 칩 하나로 접는다 */
  const MAX_TAGS = 3;

  /**
   * 상대 시각의 "지금" — 목록 하나에 시계 하나, 30초마다 다시 읽는다(런처 `StartPage` 의 `now` 와
   * 같은 박자 · 줄마다 타이머를 두지 않는다). 이력이 바뀌거나(`host-history-changed`) 창이 포커스를
   * 얻으면 사본이 다시 읽혀 줄이 새로 그려지므로, 그 사이의 틈만 이 시계가 메운다.
   */
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  /**
   * 호스트 줄 말풍선 — 첫 줄은 **접속 정보**(`hostLabel` — `root@10.0.0.1:22`, 포트는 적힌 그대로),
   * 그 아래로 **접속 이력**(docs/log/2026-09-23-host-history.md — 마지막 접속·횟수, 마지막 시도가
   * 실패였으면 그 사유). 줄 뒷글자가 주소에서 시각으로 바뀌면서(2026-09-25 덧붙임) 주소는 여기에만
   * 남는다. 둘 다 없으면 `undefined` 라 `title` 자체가 붙지 않는다.
   */
  function rowTip(host: HostEntry): string | undefined {
    const address = hostLabel(host);
    const lines = [
      ...(address ? [address] : []),
      ...historyTooltipLines(historyOf(hostHistory(), host.name), now, t),
    ];
    return lines.length > 0 ? lines.join("\n") : undefined;
  }

  /**
   * 에이전트 점 (docs/log/2026-09-27-dock-agent-dots.md) — 호스트 줄은 그 별칭의 SSH 타일에서 도는 AI 타일들을,
   * **접힌** 폴더 줄은 안(하위 폴더 포함) 호스트들의 타일을 탭 점과 같은 규칙으로 접는다. 로컬 타일은 여기 서지
   * 않는다(프로젝트 독의 몫). 점은 보기만 한다 — 줄의 클릭·더블클릭은 예전 뜻 그대로다.
   * 앞자리 아이콘과 다른 물건이라 줄 **끝**에 `AgentStatusGlyph`(12px)로 선다(프로젝트 독과 같은 자리).
   */
  const agentPanes = $derived(dockAgentPanes());
  const agentDots = $derived(hostDots(agentPanes, t));
  const hostGroups = $derived(hostCache().map((h) => ({ name: h.name, group: groupPathOf(h) })));

  /** 그리는 꼴 — 펼친 폴더 아래 아이들을 둥지로 접는다(판 하나 = 폴더 줄 + 아이들) */
  const tree = $derived(nestRows(rows, (r) => r.depth));

  /**
   * 끌다 머물면 펼침 — 받을 수 있는 접힌 폴더 줄 위에 `SPRING_LOAD_MS` 동안 머물면 연다. 다른 줄로 옮기거나 · 떠나거나 ·
   * 놓거나 · 끌기가 끝나면 거둔다. 연 뒤에 저절로 접지는 않는다.
   */
  const spring = createSpringLoad();
  $effect(() => () => spring.disarm());

  function endDrag() {
    spring.disarm();
    ondragend();
  }

  /** dragleave 가 줄 안의 조각으로 들어간 것뿐인가(그때는 떠난 것이 아니다) */
  function leavesInside(ev: DragEvent): boolean {
    const to = ev.relatedTarget;
    return to instanceof Node && ev.currentTarget instanceof Node && ev.currentTarget.contains(to);
  }

  /** 한 단의 들여쓰기 (px) — 목업의 "판 안 아이 줄은 14px 씩" */
  const INDENT_PX = 14;

  /** 줄의 왼쪽 여백 — 기본 여백에 깊이만큼 더한다 (인라인 스타일 하나라 CSS 가 깊이를 몰라도 된다) */
  function indent(depth: number): string {
    return `calc(var(--row-pad-x) + ${depth * INDENT_PX}px)`;
  }
</script>

<!--
  줄들은 편 꼴(`rows`)로 오고, 그리기는 둥지 꼴(`nestRows`)이다 — 펼친 폴더와 그 아이들이 한 묶음 판(`li.dtree-node.open`)으로
  선다(`dock-tree.css`). 선택 · 키보드 · 끌기는 여전히 편 순서(`order`)를 본다. ssh config 는 같은 별칭이 여러 번 나올 수 있어
  키 없이(인덱스) 순회한다 — 둥지라 접고 펴도 형제 자리는 그대로다.
-->
{#snippet branch(nodes: TreeNode<HostTreeRow>[])}
  {#each nodes as node}
    {@const row = node.row}
    {#if row.kind === "folder"}
      <!-- 사람이 고른 아이콘이 있으면 그것, 없으면 아래에서 테마 색 SVG 폴더를 그린다 -->
      {@const picked = iconOf(row.fullPath)}
      {@const motionKey = `host:${row.fullPath}`}
      <li class="dtree-node" class:open={row.expanded} class:still={!treeMotion.allows(motionKey)}>
        <!--
          폴더 줄 하나가 네 역할을 겸한다: **펼치기** 버튼 · **드롭 대상**(호스트 지정·폴더 중첩) ·
          **드래그 핸들** · 우클릭 컨텍스트 메뉴. 버튼이라 드래그 핸들러를 붙여도 접근성 경고가 없고
          키보드 접근도 유지된다.

          수식 없는 한 번 클릭 = 고르기 + **펼치기/접기**(2026-10-19 — 판 펼침), Ctrl·Shift 클릭 = 고르기만, Enter 도
          펼치기/접기. 더블클릭은 뜻이 없다(앞의 두 클릭이 이미 펼쳤다 접었다). 끄는 짐이 접힌 폴더 위에 머물면 연다
          (`SPRING_LOAD_MS`).
        -->
        <button
          type="button"
          class="item folder"
          aria-expanded={row.expanded}
          class:selected={selection.has(rowId(row))}
          class:focused={selection.focus === rowId(row)}
          class:drop-over={dropTarget === row.fullPath}
          class:dragging={draggingIds?.has(rowId(row))}
          class:cut={isCutGroup(row.fullPath)}
          style:padding-left={indent(row.depth)}
          data-id={rowId(row)}
          data-depth={row.depth}
          title={row.fullPath}
          draggable="true"
          onclick={(ev) => {
            selection.click(ev, rowId(row), order);
            if (plainClick(ev)) onactivate(row);
          }}
          oncontextmenu={(ev) => onmenu(ev, row)}
          ondragstart={(ev) => ondragstart(ev, row)}
          ondragend={endDrag}
          ondragover={(ev) => {
            ondragover(ev, row.fullPath);
            // 받는 자리(preventDefault)이고 접혀 있을 때만 — 머물면 연다
            if (ev.defaultPrevented && !row.expanded) spring.arm(row.fullPath, () => onexpand(row));
            else spring.disarm(row.fullPath);
          }}
          ondragleave={(ev) => {
            if (!leavesInside(ev)) spring.disarm(row.fullPath);
            ondragleave(row.fullPath);
          }}
          ondrop={(ev) => {
            spring.disarm();
            ondrop(ev, row.fullPath);
          }}
        >
          <span class="line">
            <!--
              앞자리는 호스트 줄과 **같은 고정폭 슬롯**이라 폴더와 호스트의 이름이 세로로
              맞는다. 사람이 아이콘을 골라 뒀으면 그것이 곧 이 폴더의 얼굴이고, 아니면
              `HostIcon` 의 `fallback="folder"` 가 테마 색 SVG 폴더(`--folder`)를 준다.
            -->
            <span class="lead">
              <HostIcon icon={picked} size={ROW_ICON_PX} fallback="folder" color={colorOf(row.fullPath)} />
            </span>
            <span class="name">{row.label}</span>
            <!-- 하위 폴더까지 합친 수 (검색 중이면 걸린 수) — 펼치지 않고도 규모가 보인다 -->
            <span class="count">{row.count}</span>
            {#if !row.expanded}
              {@const gdot = groupDot(row.fullPath, hostGroups, agentPanes, t)}
              {#if gdot}
                <AgentStatusGlyph
                  state={gdot.state}
                  data-agent-dot={gdot.state}
                  data-group-dot={row.fullPath}
                  title={gdot.label}
                  aria-label={gdot.label}
                />
              {/if}
            {/if}
            <!-- 펼침 꺾쇠 — 줄 오른쪽 끝, 펼치면 위로 돈다. 그림일 뿐 누름은 줄의 것이다(키보드 길은 →·←·Enter) -->
            <span
              class="dtree-chev"
              data-host-twisty
              aria-hidden="true"
              title={row.expanded ? t("app.hosts.tree.collapse") : t("app.hosts.tree.expand")}
              ><UiIcon name="chevron-down" size={14} /></span
            >
          </span>
        </button>
        {#if node.children.length > 0}
          <ul class="dtree-kids" transition:accordion={{ key: motionKey }}>
            {@render branch(node.children)}
          </ul>
        {/if}
      </li>
    {:else}
      {@const host = row.host}
      {@const meta = hostMeta(host)}
      {@const tags = meta.tags.slice(0, MAX_TAGS)}
      {@const hidden = meta.tags.length - tags.length}
      <!-- AI 위임 — 앱이 든 사본을 **동기로** 읽는다 (`app/delegation.svelte.ts`) -->
      {@const delegation = delegationGrantsOf(host.name)}
      {@const where = groupPathOf(host)}
      <!-- 마지막 **성공** 접속 → `2분 전` (런처 최근 호스트와 같은 값·같은 계단). 붙어 본 적이 없으면 빈 글자 -->
      {@const when = row.lastOkAt === null ? "" : relativeTime(row.lastOkAt, now, t)}
      <li class="dtree-node">
        <!--
          한 줄짜리 항목 — (화살표 칸) → 아이콘 → 별칭 + 성질 표식 → 마지막 접속(`2분 전`, 뒷글자
          12 · 흐림 — 목업의 meta) → (오른쪽 끝) 태그 칩. 태그는 사용자 라벨이라 여기 남긴다.
          접속 정보(`user@host:port`)는 줄 말풍선의 첫 줄이다(`rowTip`).

          한 번 클릭 = 선택, 더블클릭·Enter = 접속, 끌어다 놓기 = 터미널 타일 옆에 분할해서 접속
          (받는 쪽이 방향을 정한다) · 트리 안에 놓으면 **이 호스트가 든 폴더로** 옮기기, 우클릭 =
          호스트 컨텍스트 메뉴.
        -->
        <button
          type="button"
          class="item"
          class:selected={selection.has(rowId(row))}
          class:focused={selection.focus === rowId(row)}
          class:dragging={draggingIds?.has(rowId(row))}
          class:cut={isCutHost(host.name)}
          style:padding-left={indent(row.depth)}
          data-id={rowId(row)}
          data-depth={row.depth}
          title={rowTip(host)}
          draggable="true"
          ondragstart={(ev) => ondragstart(ev, row)}
          ondragend={endDrag}
          onclick={(ev) => selection.click(ev, rowId(row), order)}
          ondblclick={() => onactivate(row)}
          oncontextmenu={(ev) => onmenu(ev, row)}
          ondragover={(ev) => {
            spring.disarm();
            ondragover(ev, where);
          }}
          ondragleave={() => ondragleave(where)}
          ondrop={(ev) => {
            spring.disarm();
            ondrop(ev, where);
          }}
        >
            <span class="line">
              <!--
                앞자리(고정폭) — 고른 아이콘이 있으면 그것, 없으면 **기본 서버 랙**(`HostIcon` 의 `fallback="server"` —
                폴더 기본 그림과 같은 테마 색 `--folder`, 호스트 색이 있으면 그 색 · 2026-09-29). 예전의 색 점·빈칸은
                없어졌다. 폭이 고정이라 별칭이 세로로 정렬된다. 색·아이콘 모두 백엔드가 이미 병합한 최종값이다.
              -->
              <span class="lead">
                <HostIcon icon={meta.icon} size={ROW_ICON_PX} fallback="server" color={meta.color} />
              </span>
              <!--
                별칭과 경유 표식은 **한 칸**이다 — 표식이 이름 바로 뒤에 붙어야 "이 호스트의
                성질" 로 읽힌다. 줄 오른쪽 끝(태그 칩 자리)에 세우면 이름과 떨어져 별개의
                배지가 되고, 이름이 짧은 줄에서는 그 사이가 한 뼘씩 벌어진다.
                늘어나는 쪽이 이 칸이므로 힌트·태그는 예전처럼 오른쪽 끝에 남는다.
              -->
              <span class="name-cell">
                <span class="name">{host.name}</span>
                <!--
                  경유 호스트 표식 — 이 호스트는 **혼자 가지 않는다**(`ProxyJump`).
                  접속이 한 단계 더 있다는 사실은 고르기 전에 알아야 하고(느리다·경유가
                  죽으면 같이 죽는다), 어디를 거치는지는 말풍선에 있다. 값 자체는 백엔드가
                  병합한 최종값이다 (docs/log/2026-09-17-jump-host-ui.md).
                -->
                {#if host.proxy_jump}
                  <span class="jump" title={t("files.host.jump", { jump: host.proxy_jump })}>
                    <UiIcon name="route" size={12} />
                  </span>
                {/if}
                <!--
                  tmux 표식 — 이 호스트는 붙으면 **셸이 아니라 tmux 세션**에 앉는다.
                  경유 표식과 같은 성격이라 같은 자리·같은 톤이다: 고르기 전에 알아야 하는
                  "이 호스트의 성질" 이고(명령 이력·마지막 출력 복사·AI 의 명령 읽기가 꺼진
                  '화면만 있는 세션' 이 된다 — `HostMeta.tmux`), 자세한 말은 말풍선에 있다.

                  판정은 **병합된 최종값**(`meta.tmux === true`)이다 — `list_hosts` 가
                  `hosts.<별칭> > presets.<preset> > [defaults]` 를 이미 합쳐 내려주므로
                  `[defaults]`·프리셋에서 물려받은 호스트도 여기서 표식을 받는다. 접속 경로가
                  보는 값과 같은 값이라 화면과 실제가 어긋나지 않는다
                  (docs/log/2026-09-16-tmux-toggle.md).

                  `=== true` 로 못 박는 이유: `null`/`false` 는 둘 다 꺼짐이고(`HostMeta.tmux`),
                  참 같은 값 판정으로 두면 나중에 이 칸이 3값이 될 때 조용히 뜻이 갈린다.

                  글자는 `tmux`(머리줄 tmux 칩과 같은 손그림) — **창 안에 나뉜 칸과 상태줄**이 tmux 의 생김새
                  그대로다(창·창 안의 여러 pane). 처음 쓰던 `terminal`(`>_`)은 이 목록의 모든
                  줄이 이미 터미널이라 아무것도 가르지 못했다.
                -->
                {#if meta.tmux === true}
                  <span class="tmux" title={t("files.host.tmux")}>
                    <UiIcon name="tmux" size={12} />
                  </span>
                {/if}
                <!--
                  포워딩 표식 — 이 호스트에는 **저장된 포트 포워딩 프리셋**이 있다. 앞의 둘과
                  같은 성격("이 호스트는 어떻게 붙는가")이라 같은 자리·같은 톤이고, 셋째로
                  선다: 경유(가는 길) → tmux(붙은 뒤의 모양) → 포워딩(붙고 나서 열리는 것).

                  글자는 머리줄 포워딩 칩과 **같은** `forward`(`swap-horiz`) —
                  목록에서 본 표식과 타일 머리줄에서 누르는 칩이 같은 것을 가리켜야 한다.

                  `forwards` 는 상속되지 않는다(호스트 제 블록만) — 병합된 최종값이 이미 그
                  규칙을 담고 있어 여기서는 길이만 본다.
                -->
                {#if meta.forwards.length > 0}
                  <span class="forward" title={t("files.host.forwards", { n: meta.forwards.length })}>
                    <UiIcon name="forward" size={12} />
                  </span>
                {/if}
                <!--
                  볼트 표식 — 이 호스트의 **비밀번호가 담겨 있다**
                  (docs/log/2026-09-19-vault.md ③). 앞의 셋과 같은 성격("이 호스트는 어떻게
                  붙는가")이라 같은 자리·같은 톤이고, 넷째로 선다: 경유(가는 길) → tmux(붙은 뒤의
                  모양) → 포워딩(붙고 나서 열리는 것) → 볼트(묻지 않고 붙는다).

                  판정은 목록을 읽을 때 **한 번** 받아 온 집합이다 (`Sidebar.svelte` 의 `load`) —
                  줄마다 백엔드에 묻지 않는다. 키 암호구 쪽은 표식을 두지 않는다: 그것은 호스트의
                  성질이 아니라 **키 파일의 성질**이라, 같은 키를 쓰는 호스트 전부에 같은 표식이
                  붙어 아무것도 가르지 못한다.
                -->
                {#if savedAliases.has(host.name.toLowerCase())}
                  <span class="vault" title={t("files.host.vault")}>
                    <UiIcon name="lock" size={12} />
                  </span>
                {/if}
                <!--
                  AI 권한 표식 — 이 호스트에 **AI 권한 단계**가 적혀 있다 (`~/.aynx/delegation.toml`).
                  앞의 넷과 같은 자리·같은 톤이고 **다섯째로 선다**: 경유(가는 길) → tmux(붙은 뒤의 모양)
                  → 포워딩(붙고 나서 열리는 것) → 볼트(묻지 않고 붙는다) → AI 권한(AI 가 여기서 무엇을 하나).

                  2026-10-07 전에는 문지기가 `connect`(헤드리스 접속) 하나였고 그림은 `ai`(✦)였다 — 그때는
                  이 파일이 헤드리스에만 걸렸다. 지금은 같은 단계가 이 호스트의 **창 타일**에도 걸리므로
                  단계가 끔이 아니면 서고, 그림은 단계의 게이지 글리프(10-23 — 머리줄 칩의 미니 게이지와 같은 꼴)다. 헤드리스 접속 여부는
                  말풍선(`grantSummary`)에 적힌다.
                -->
                {#if delegation && stageOf(delegation) !== "off"}
                  <span
                    class="delegation"
                    data-stage={stageOf(delegation)}
                    title={t("files.host.delegation.tip", { grants: grantSummary(delegation, t) })}
                  >
                    <UiIcon name={gaugeIconName(gaugeIndex(AI_STAGES, stageOf(delegation)))} size={12} />
                  </span>
                {/if}
              </span>
              {#if when}
                <!--
                  마지막 접속 — 별칭 뒤의 뒷글자(12 · 흐림). 한 번도 안 붙은 호스트는 **아무것도 없다**
                  (`—` 를 세우면 목록이 대시로 얼룩진다 — 태그는 제 칸이라 줄이 어긋나지 않는다).
                  실패는 여기서 말하지 않는다 — 말풍선의 몫이다.
                -->
                <span class="meta" data-host-when>{when}</span>
              {/if}
              {#if tags.length > 0}
                <span class="tags">
                  {#each tags as tag}<span class="tag">{tag}</span>{/each}
                  {#if hidden > 0}<span class="tag" title={t("files.host.tags.more", { count: hidden })}>+{hidden}</span>{/if}
                </span>
              {/if}
              {#if agentDots[host.name.toLowerCase()]}
                {@const hdot = agentDots[host.name.toLowerCase()]}
                <AgentStatusGlyph
                  state={hdot.state}
                  data-agent-dot={hdot.state}
                  data-host-dot={host.name}
                  title={hdot.label}
                  aria-label={hdot.label}
                />
              {/if}
              <!-- 폴더 줄의 꺾쇠 칸만큼 비운다 — 오른쪽 끝 글자들이 폴더 줄과 세로로 맞는다 -->
              <span class="dtree-chev-pad" aria-hidden="true"></span>
            </span>
        </button>
      </li>
    {/if}
  {/each}
{/snippet}

<ul class="list" aria-label={t("app.hosts.tree.aria")} bind:this={listEl}>
  {@render branch(tree)}
</ul>

<!--
  빈 화면의 뜻은 둘로 갈린다 — 설정에 호스트가 아예 없는 것, 검색이 못 맞춘 것.
  (옛 탐색기의 "들어와 보니 빈 폴더" 는 트리에서 없다 — 빈 폴더는 펼쳐도 아이가 없을 뿐 줄은 선다.)
-->
{#if loading}
  <p class="empty">{t("files.host.loading")}</p>
{:else if noHosts && rows.length === 0}
  <!--
    "호스트가 아예 없다" 는 **그릴 것이 하나도 없을 때만** 뜻이 있다. 호스트가 없어도
    빈 폴더는 있을 수 있게 됐으므로(폴더 추가), 폴더가 보이는데 "호스트가 없습니다" 가
    같이 떠 있으면 화면과 말이 어긋난다.
  -->
  <p class="empty">{warning ?? t("files.host.empty.nohosts")}</p>
{:else if rows.length === 0 && searching}
  <p class="empty">{t("files.host.empty.nomatch")}</p>
{/if}

<!--
  **빠른 접속** (docs/log/2026-09-16-quick-connect-and-host-keys.md) — 검색이 아무것도 못
  맞췄는데 친 글자가 접속 대상으로 읽히면 그 자리에서 붙을 수 있게 한다.

  위 사슬 **밖에** 둔다: 설정에 호스트가 하나도 없는 사람(첫 실행)은 첫 가지("호스트가
  없습니다")에서 끝나는데, 정작 이 줄이 가장 쓸모 있는 것이 그 상태다. 조건 판정은 상위가
  이미 끝냈으므로(`searching && rows.length === 0 && parseQuickConnect`) 여기 오는 것은
  라벨과 콜백뿐이고, 값이 있으면 그리는 것이 전부다.
-->
{#if quickConnect}
  <p class="quick">
    <button type="button" class="btn btn-secondary quick-btn" onclick={quickConnect.run}>
      {t("files.host.quick.connect")}
      <span class="quick-target">{quickConnect.label}</span>
    </button>
  </p>
{/if}

<!-- 러버밴드 — 내용 좌표계라 목록과 함께 스크롤된다 (좌표 원점은 부모의 `.body` 다) -->
{#if marqueeBox}
  <div
    class="marquee"
    aria-hidden="true"
    style:left="{marqueeBox.left}px"
    style:top="{marqueeBox.top}px"
    style:width="{marqueeBox.right - marqueeBox.left}px"
    style:height="{marqueeBox.bottom - marqueeBox.top}px"
  ></div>
{/if}

<style>
  /*
   * 러버밴드 — 옅은 면에 또렷한 테두리 하나. 포인터 이벤트를 받지 않아야 그 아래 항목의
   * hover 와 커서가 계속 살아 있다 (사각형이 커서를 잡아먹으면 긋는 동안 화면이 죽는다).
   */
  .marquee {
    position: absolute;
    z-index: 2;
    background: var(--accent-soft);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    pointer-events: none;
  }

  .list {
    margin: 0;
    /* 좌우 여백은 파일 브라우저의 목록과 **같은 토큰**이다 — 두 타일을 나란히 놓았을 때
       아이콘이 같은 x 에서 시작해야 한 벌로 읽힌다 */
    padding: var(--row-inset);
    list-style: none;
  }

  .list li {
    position: relative;
  }

  .item {
    display: block;
    width: 100%;
    /* 줄의 치수는 **파일 브라우저와 같은 토큰**이다 (`theme.css` 의 `--row-*`) — 예전에는
       두 컴포넌트가 각자 적어 두는 바람에 세션 줄만 미묘하게 높고 컸다
       (docs/log/2026-09-04-icons-and-rows.md). */
    padding: var(--row-pad-y) var(--row-pad-x);
    text-align: left;
    font-family: var(--font-ui);
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .item:hover {
    background: var(--surface-hover);
  }

  .item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /*
   * 골라진 것은 배경으로 말한다 (docs/log/2026-09-04-hosts-multiselect.md) — 이 화면의 유일한
   * 강조 판이다. 커서(포커스)에는 따로 표시를 두지 않는다 — 예전에는 왼쪽에 세로 띠를 세웠지만
   * 선택 배경과 겹쳐 읽혀 지웠다.
   */
  .item.selected {
    background: var(--accent-soft);
  }

  /* 끌고 가는 동안의 표준 피드백 — 원본은 자리에 남되 "지금 들려 있다" 는 인상만 준다 */
  .item.dragging {
    opacity: 0.45;
  }

  /* 잘라내기로 담긴 것 — "곧 여기서 사라진다" 는 예고. 복사는 원본이 그대로라 표시하지 않는다 */
  .item.cut {
    opacity: 0.5;
  }

  /* 항목 한 줄 — 아이콘 → 별칭 → (오른쪽 끝) 태그 칩 */
  .line {
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    min-width: 0;
  }

  /* 앞자리 고정폭 슬롯 — 아이콘/점/없음 무엇이든 별칭 시작 위치가 같게 한다 */
  .lead {
    flex: 0 0 var(--row-icon);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* 폴더·서버 기본 글리프의 잉크 색(`--folder`)은 `HostIcon` 의 `fallback` 안에 있다 */

  .name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--row-font);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 태그 칩은 별칭 줄 오른쪽 끝에 붙는다 — 별칭이 길면 `.name` 이 먼저 줄어들고 칩은 유지된다 */
  .tags {
    flex: 0 0 auto;
    display: flex;
    gap: var(--space-1);
  }

  /* 태그 칩 — 뒷글자(12 · `--fg-3`)보다 한 단 진한 `--fg-2` 에 회색 판. 사용자가 붙인 라벨이라
     흐림까지 내리지 않는다 (docs/log/2026-09-25-unified-dock.md) */
  .tag {
    padding: 0 var(--space-1);
    font-size: var(--t-xs);
    line-height: 18px;
    color: var(--fg-2);
    background: var(--surface-hover);
    border-radius: var(--radius-sm);
    white-space: nowrap;
    max-width: 56px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /*
   * 별칭 + 경유 표식 한 칸. 늘어나는 쪽을 `.name` 에서 이 칸으로 옮겨(폴더 줄의 `.name` 은
   * 그대로다) 표식이 이름 바로 뒤에 붙게 한다 — 줄이 좁아지면 이름이 먼저 말줄임된다.
   */
  .name-cell {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .name-cell .name {
    flex: 0 1 auto;
  }

  /*
   * 이름 뒤 표식들(경유 · tmux · 포워딩 · 볼트 · 위임) — 이름의 일부처럼 붙되 이름보다 옅다
   * (별칭이 먼저 읽혀야 한다). 다섯은 **한 벌**이라 한 규칙을 나눠 쓴다: 다섯 다 "이 호스트는
   * 어떻게 붙는가" 를 말하고 다섯 다 누를 수 없는 표식이다. 함께 뜨면 `.name-cell` 의 `gap`
   * 만큼 벌어져 경유 → tmux → 포워딩 → 볼트 → 위임 순으로 선다 (마크업 순서 그대로 — 붙는
   * 길이 먼저, 붙은 뒤의 모양이 다음, 붙고 나서 열리는 것, 묻지 않고 붙는다는 사실, 그리고
   * **사람 없이도 붙는다**는 사실이 마지막).
   */
  .jump,
  .tmux,
  .forward,
  .vault,
  .delegation {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    color: var(--fg-3);
  }

  /* 마지막 접속(`2분 전`) — 별칭과 태그 사이, 뒷글자(12 · 흐림). 좁아지면 이쪽이 먼저 줄어든다 */
  .meta {
    flex: 0 1 auto;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── 폴더 줄 ─────────────────────────────────────────────────────────── */

  /*
   * 폴더도 호스트와 **같은 `.item` 골격**을 쓴다 (같은 패딩·같은 앞자리 폭) — 트리 안에서
   * 폴더와 호스트가 한 줄기로 이어지고 ↑↓ 가 둘을 가리지 않으므로, 생김새도 이어져야 한다.
   * 다른 점은 앞에 펼침 화살표를 두고 오른쪽 끝에 개수를 붙이는 것뿐이다.
   */
  .item.folder .name {
    font-weight: 500;
  }

  /* 무언가를 이 폴더 위에 얹은 상태 — "여기 놓으면 이 폴더" 임을 또렷이 보인다(primary 2px 안쪽 테두리 + 옅은 primary 면) */
  .item.drop-over,
  :global(.dock.launcher) .item.drop-over.drop-over {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  /* 하위 폴더까지 합친 호스트 수(검색 중이면 걸린 수) — 펼치지 않고도 규모가 보인다 */
  .count {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .empty {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  /* 빈 결과 바로 아래 — 안내 문구와 같은 여백에 서서 한 덩어리로 읽힌다 */
  .quick {
    margin: 0;
    padding: 0 var(--space-3) var(--space-2);
  }

  /* 모양은 전역 `.btn .btn-secondary` 다 — 여기서는 줄을 채우고 글자를 왼쪽에 붙일 뿐이다
     (옛 강조색 선 두른 판은 걷었다 — 강조 셋 밖이었다) */
  .quick-btn {
    width: 100%;
    justify-content: flex-start;
  }

  /* 대상은 접속 정보라 고정폭으로 — 다른 줄의 `user@host:port` 와 같은 결이다 */
  .quick-target {
    font-family: var(--font-mono);
  }

  /*
   * MD3 목록 줄(2026-10-18 — End-4 식 목업) — **독 안에서만**(`.dock.launcher`): 줄은 알약(`--radius-row` — 2026-10-29 C안, 펼침 판 안에서도 같은 알약) · 호버는 상태 층 · 고른 줄은
   * secondaryContainer(`--accent-soft`) + onSecondaryContainer. 앞자리는 28px 칸이고, 호스트 줄은 원형 아바타
   * (--m3-primary-container). 오른쪽 보조 글자는 outlineVariant 테두리의 보조 칩이다.
   */
  :global(.dock.launcher) .item {
    border-radius: var(--radius-row);
  }

  :global(.dock.launcher) .item:hover {
    background: color-mix(in srgb, var(--fg-1) var(--state-hover), transparent);
  }

  /* 재질 글래스면 고른 줄 = 흰 반투명 칠(`--glass-pick` — theme.css 재질 절, 평면은 없어 그대로) */
  :global(.dock.launcher) .item.selected {
    color: var(--on-accent-soft);
    background: var(--glass-pick, var(--accent-soft));
  }

  :global(.dock.launcher) .lead {
    flex-basis: 28px;
    height: 28px;
  }

  :global(.dock.launcher) .item:not(.folder) > .line > .lead {
    border-radius: 50%;
    color: var(--m3-on-primary-container);
    background: var(--m3-primary-container);
  }

  :global(.dock.launcher) :is(.tag) {
    padding: 1px 8px;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
</style>

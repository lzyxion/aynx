<script lang="ts">
  /**
   * **호스트 추가·수정 모달** — 호스트 목록의 [추가]·[수정] 이 여는 그 폼 한 장이다.
   *
   * 상태는 하나도 여기에 없다 — 폼 값(`hostForm`)·접힘 여부(`formUi`)·열림/저장/닫기가
   * 전부 `app/hosts.svelte.ts` 에 있다. 이 파일이 쥔 것은 **마크업과 그 마크업이 쓰는
   * 스코프 CSS**, 그리고 **지금 보이는 탭** 하나뿐이고, 첫 칸에 포커스를 두는 `$effect` 도
   * `+page.svelte` 에 그대로 남는다 (룬 모듈에는 붙일 컴포넌트 수명이 없다는 그 파일의 규칙).
   *
   * 2026-09-20, **탭 재편에 앞서** `+page.svelte` 에서 통째로 잘라 왔다 — 요소 id·클래스·
   * `aria-*`·`bind:`·i18n 키·주석을 한 글자도 바꾸지 않았다. 헤드리스 검증 스크립트
   * (`scripts/dev/identities-only-harness.mjs`)가 이 id 들을 직접 집는다.
   *
   * ## 그리고 같은 날, 한 줄이던 칸 열여덟을 **세 탭**으로 갈랐다
   * (docs/log/2026-09-20-host-form-tabs.md)
   *
   * 왼쪽 내비 + 오른쪽 패널이고, 내비는 **설정 화면과 같은 컴포넌트**(`settings/SectionNav.svelte`)다.
   * 가르는 선은 **어느 파일에 적히는가**이고(접속 = `~/.ssh/config`, 표시·세션 =
   * `sessions.toml`), 그래서 머리말(`.lead`)은 접속 탭 안으로 들어갔다 — 그 문단이 하는 말이
   * 바로 `~/.ssh/config` 이야기라 세 탭 위에 걸려 있을 문장이 아니다.
   *
   * 섹션은 **언마운트하지 않고 `hidden` 으로만** 숨긴다. [저장]·[취소]와 오류 한 줄은 패널
   * 바깥이라 어느 탭에서도 보인다 — 그리고 그 오류가 가리키는 칸이 다른 탭에 있으면
   * `hostFormErrorField()` → `tabOfField()` 로 **그 탭으로 데려간 뒤** 칸에 포커스를 준다.
   *
   * 스타일은 스코프라 옮긴 마크업이 쓰던 규칙을 여기에 다시 적는다. **이 폼만 쓰던 것**
   * (`.host-modal`·`.section`·`.file-row`·`.tri-row`·`.log-*`·`.vault-*`·`.note-*`·
   * `.fw-preset*`)은 옮겼고(색 견본·글자 칸은 이제 `IconColorFields.svelte` 가 갖는다), **다른 모달과 나눠 쓰는
   * 것**(`.overlay`·`.modal`·`.lead`·`.actions`·`.ghost`·`.primary`·`.fields`·`.browse`·
   * `.error`)은 베꼈다 — 원본은 `+page.svelte` 에 있다가 2026-09-30 `dialogs/*` 로 함께 옮겨 갔다.
   *
   * ## ⓘ 설명은 팝오버다 (2026-09-28, docs/log/2026-09-28-hostform-note-popover.md)
   *
   * 예전에는 ⓘ 가 설명 전문을 요약 밑에 **펼쳤다**(`formUi` 의 불 다섯 · `.note-full`) — 펼칠 때마다
   * 아래 칸들이 밀려 내려갔다. 지금은 설정 화면과 같은 `InfoNote` + `NotePopover` 를 쓴다:
   * 칸은 앱 전체에 하나(다른 ⓘ 를 열면 앞의 것이 닫힌다), 팝오버는 이 모달 뿌리에 한 벌.
   */
  import { tick } from "svelte";
  import Combobox from "$lib/Combobox.svelte";
  import Dropdown from "$lib/Dropdown.svelte";
  import IconColorFields from "$lib/IconColorFields.svelte";
  import TagInput from "$lib/TagInput.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import AiGauge from "$lib/AiGauge.svelte";
  import SectionNav from "$lib/settings/SectionNav.svelte";
  // ⓘ 설명 팝오버 — 설정 화면과 **같은 두 조각**이다 (docs/log/2026-09-28-hostform-note-popover.md)
  import InfoNote from "$lib/settings/InfoNote.svelte";
  import NotePopover from "$lib/settings/NotePopover.svelte";
  import { closeNote } from "$lib/settings/note-popover.svelte.js";
  import { MAX_SCROLLBACK, MIN_SCROLLBACK } from "$lib/session";
  import { tabOfField, type HostFormTab } from "$lib/host-form-tabs";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import {
    addForwardRow,
    browseIdentity,
    clearSavedPassphrase,
    clearSavedPassword,
    closeForm,
    editOriginalName,
    formUi,
    forwardRowInvalid,
    groupSuggestions,
    hostForm,
    hostFormError,
    hostFormErrorField,
    hostFormMode,
    hostFormSaving,
    hostFormVisible,
    hostFormWantTab,
    inheritedHint,
    inheritedIdentitiesOnly,
    configForwardAgent,
    inheritedMeta,
    jumpOptions,
    metaLoading,
    newKeyForForm,
    openSessionLogsFolder,
    removeForwardRow,
    savedPassphrasePath,
    savedPassword,
    sessionLogsFolder,
    submitForm,
  } from "$lib/app/hosts.svelte.js";
  // 볼트가 **아예 없으면** 다섯째 스위치를 켤 수 없다 — 그 사실만 읽는다(값은 여기 오지 않는다).
  import { refreshVault, vaultStatus } from "$lib/app/vault.svelte.js";
  import { forwardKindOptions } from "$lib/forward";
  import {
    AI_STAGES,
    AI_STAGE_DESC,
    AI_STAGE_NAME,
    stageAtLeast,
    stageNeedsConfirm,
    stageOf,
    withStage,
    type AiStage,
  } from "$lib/delegation";
  import { confirmApproveAll } from "$lib/app/approve-all-confirm";
  import { inheritPlaceholder, resetTitle } from "$lib/host-meta-hint";
  import { trapTab } from "$lib/focus-trap";
  import {
    agentArgsTargets,
    agentLaunchPreview,
    type AgentArgsTarget,
    type AgentLaunchPreview,
  } from "$lib/context";
  import { settings } from "$lib/settings.svelte.js";

  // 한 번의 렌더에서 여러 번 읽히는 것만 `$derived` 로 감싼다 — `+page.svelte` 에 있던
  // 그 한 줄을 그대로 데려왔다 (그룹 칸의 자동완성 후보).
  const groups = $derived(groupSuggestions());

  /** 물려받은 색 (없으면 `null`) — 칸이 비었을 때 견본·곁말이 읽는다 */
  const inheritedColor = $derived(inheritedMeta()?.color?.trim() || null);

  /**
   * 폼이 열릴 때 **볼트 상태를 한 번 다시 읽는다** — AI 위임의 다섯째 스위치가 "볼트가
   * 있는가" 하나로 갈리기 때문이다 (없으면 재우고 "먼저 켜세요" 를 적는다). 설정 › 보안을
   * 한 번도 열지 않았으면 그 사본은 기본값(`absent`)이라, 읽지 않으면 있는 볼트를 없다고 한다.
   */
  $effect(() => {
    if (hostFormVisible()) void refreshVault();
  });

  /**
   * 폼이 **닫히면** 떠 있던 ⓘ 팝오버도 닫는다 — 팝오버는 모달 안(`{#if}` 안)에 서므로 폼과 함께
   * 사라지지만, 칸(`note-popover.svelte.ts`)은 모듈 상태라 남아서 떨어져 나간 ⓘ 를 붙든다.
   * **켜짐 → 꺼짐** 으로 바뀔 때만 본다(설정 화면의 `NotePopover` 가 `open` 을 보는 규칙과 같다).
   */
  let wasVisible = false;
  $effect(() => {
    const now = hostFormVisible();
    if (wasVisible && !now) closeNote();
    wasVisible = now;
  });

  /** 볼트가 아직 없다 — 다섯째 스위치를 켤 자리가 없다(문구가 설정 › 보안을 가리킨다) */
  const vaultAbsent = $derived(vaultStatus().state === "absent");

  /**
   * 고르개 두 개의 항목 표 — 예전 `<option>` 들이 있던 자리다
   * (docs/log/2026-09-20-host-form-tabs.md 의 "네이티브 select · datalist → Dropdown · Combobox").
   *
   * **값(`value`)은 한 글자도 바뀌지 않았다** — 저장되는 것이 그 글자이고, 라벨만 사전을
   * 지난다 (docs/conventions.md 의 "id 는 안 바뀐다, 라벨만 바꾼다").
   */
  const jumpItems: { value: string; label: string }[] = $derived([
    { value: "", label: t("app.hostform.field.proxyjump.none") },
    ...jumpOptions().map((alias) => ({ value: alias, label: alias })),
  ]);

  // 타입을 손으로 적는 이유: `Dropdown` 은 값의 타입을 부르는 쪽에서 받는다 —
  // 이 칸이 `string` 으로 넓어지면 세 값 말고 다른 글자가 들어가도 아무도 안 막는다.
  const shellItems: { value: "" | "on" | "off"; label: string }[] = $derived([
    { value: "", label: t("app.hostform.shellint.option.default") },
    { value: "on", label: t("app.hostform.shellint.option.on") },
    { value: "off", label: t("app.hostform.shellint.option.off") },
  ]);

  type HostTab = HostFormTab;

  /**
   * 왼쪽 내비의 다섯 칸. 순서가 곧 화면의 순서이고, **접속이 맨 앞**이다 — 이 폼을 여는 사람이
   * 늘 손대는 칸(별칭·호스트 이름)이 거기 있고, 나머지는 없어도 접속은 된다. **AI 권한** 은 맨 끝이다
   * (2026-10-07) — 파일이 다르고(`delegation.toml`), 이 호스트에 붙는 일이 아니라 AI 에게 무엇을
   * 내주는가를 정하는 칸이다. **에이전트**(2026-10-26)는 그 앞 — 이 호스트에서 뜨는 claude · codex 를
   * 어떻게 띄우는가(`sessions.toml`)다.
   */
  const SECTIONS: readonly { id: string; labelKey: Key }[] = [
    { id: "connect", labelKey: "app.hostform.tab.connect" },
    { id: "display", labelKey: "app.hostform.tab.display" },
    { id: "session", labelKey: "app.hostform.tab.session" },
    { id: "agent", labelKey: "app.hostform.tab.agent" },
    { id: "ai", labelKey: "app.hostform.tab.ai" },
  ];

  /**
   * **에이전트 칸**(2026-10-26 — 에이전트 활성화). 추가 인자 칸은 Rust 의 에이전트 표(`agent_args::TARGETS`)를 돌며
   * 그린다. 판정 · 위험 플래그 · 미리보기 줄은 Rust(`agent_launch_preview`) 한 곳이고, 원격 셸이라 인용은 POSIX(`bash`)다.
   * 칸은 이 호스트의 **자기 값**(`hostForm.agentArgs`)을 쥐고, 비어 있으면 상속값을 곁말(출처 칩 · placeholder)로만 보인다.
   */
  let argsTargets = $state<AgentArgsTarget[]>([]);
  $effect(() => {
    if (hostFormVisible() && argsTargets.length === 0) {
      void agentArgsTargets().then((list) => (argsTargets = list));
    }
  });
  /** 에이전트 id → 지금 값(자기 값 또는 상속값)의 미리보기 */
  let argsPreview = $state<Record<string, AgentLaunchPreview | null>>({});

  /**
   * 위 계층에서 오는 값 — 출처가 적힌 키만이다(병합값에 출처가 없으면 그 값은 이 호스트 자기 것이라 위 계층을 모른다).
   */
  function argsInherited(id: string): string | undefined {
    const m = inheritedMeta();
    return m?.agent_args_from?.[id] ? m.agent_args?.[id] : undefined;
  }
  /** 실제로 붙을 한 줄 — 자기 값이 있으면 그것(`""` = 붙이지 않음), 없으면 상속값 */
  function argsEffective(id: string): string {
    return hostForm.agentArgs[id] ?? argsInherited(id) ?? "";
  }
  /** 출처 칩 — 자기 값 · 붙이지 않음 · 프리셋 · 기본값(없으면 칩 없음) */
  function argsSource(id: string): string | null {
    const own = hostForm.agentArgs[id];
    if (own !== undefined) return own.trim() === "" ? t("app.hostform.agent.src.none") : t("app.hostform.agent.src.own");
    const from = inheritedMeta()?.agent_args_from?.[id];
    if (!from) return null;
    return from.kind === "preset"
      ? t("app.hostform.agent.src.preset", { name: from.name })
      : t("app.hostform.agent.src.defaults");
  }

  // 칸 값 · Codex 스위치가 바뀌면 다시 묻는다. 늦게 온 답은 그새 바뀐 칸을 덮지 않는다. 어긋남은 [저장]이 본다(`formUi.argsError`).
  $effect(() => {
    const noDaemon = settings.codexNoDaemon;
    for (const target of argsTargets) {
      const id = target.id;
      const value = argsEffective(id);
      void agentLaunchPreview(id, value, noDaemon, "bash").then((pv) => {
        if (argsEffective(id) !== value) return;
        argsPreview[id] = pv;
        formUi.argsError[id] = pv?.error ?? null;
      });
    }
  });

  /**
   * AI 칸의 **지금 단계** — 폼 값(`hostForm.delegation`)에서 누적 규칙으로 읽는다(`stageOf`). 단계를
   * 고르면 단계 셋을 갈아 끼우고 헤드리스 묶음은 지키되 의존을 접는다(`withStage` — 단계가 승인 후
   * 실행 아래로 내려가면 헤드리스 접속·볼트 암호구가 함께 꺼진다). 저장은 [저장] 한 번이다.
   */
  const aiStage = $derived(stageOf(hostForm.delegation));
  async function pickAiStage(stage: AiStage): Promise<void> {
    // 모두 승인으로 새로 올리면 확인 상자가 먼저 선다(10-23 — [취소]면 그대로).
    if (stageNeedsConfirm(aiStage, stage) && !(await confirmApproveAll("host", hostForm.name.trim() || "?"))) return;
    hostForm.delegation = withStage(hostForm.delegation, stage);
  }
  /** 헤드리스 접속을 켤 수 있는가 — 단계가 승인 후 실행 이상일 때만 */
  const headlessAllowed = $derived(stageAtLeast(aiStage, "approve"));

  /** 단계가 여는 일 세 줄 — 누적이라 위에서부터 차례로 켜진다 */
  const aiSummary = $derived([
    { on: stageAtLeast(aiStage, "read"), key: "app.hostform.ai.sum.read" as Key },
    { on: stageAtLeast(aiStage, "approve"), key: "app.hostform.ai.sum.propose" as Key },
    { on: stageAtLeast(aiStage, "auto"), key: "app.hostform.ai.sum.auto" as Key },
    { on: aiStage === "all", key: "app.hostform.ai.sum.all" as Key },
  ]);

  /** 지금 보이는 탭 — 이 컴포넌트 안에만 있고 **저장하지 않는다** */
  let tab = $state<HostTab>("connect");

  /**
   * 폼이 열릴 때마다 **여는 쪽이 정한 탭**(없으면 첫 탭)으로 되돌린다.
   *
   * 마지막에 보던 탭을 기억하지 않는 것이 요점이다: 이 상자는 "이 호스트를 고친다" 한 번을
   * 위해 떴다 사라지는 층이고, 열자마자 포커스가 가는 칸(별칭)도 첫 탭에 있다. 지난 탭이
   * 남아 있으면 포커스만 보이지 않는 칸에 들어간다.
   *
   * **예외 하나**가 `hostFormWantTab()` 이다 — 설정 › 보안의 AI 권한 표에서 [호스트 설정…]으로,
   * 또는 원격 타일의 권한 팝오버에서 "호스트 설정 › AI" 로 들어오면 보러 가는 칸이 이미 정해져
   * 있다(AI 칸). 여는 탭을 정하는
   * 자리가 여기 하나뿐이라 그 예외도 같은 줄에 산다.
   *
   * 보는 것은 `hostFormVisible()` **하나**다 — `hostFormMode()` 까지 보면 저장 도중
   * 추가 → 수정으로 넘어가는 한 걸음(`submitForm`)이 탭을 되돌려, 메타 저장이 실패해 폼이
   * 열린 채 남았을 때 방금 데려간 오류 칸을 다시 빼앗는다.
   */
  $effect(() => {
    if (hostFormVisible()) tab = hostFormWantTab() ?? "connect";
  });

  /**
   * 오른쪽 내용 패널 — 폼에서 **스크롤되는 유일한 상자**다 (섹션들은 여기 안에서 `hidden`
   * 으로 갈린다). 탭을 갈아 끼우면 그 섹션의 맨 위부터 보여 준다 — 스크롤 상자가 하나라
   * 긴 섹션을 내려 본 뒤 다른 탭을 고르면 새 섹션이 한가운데부터 보인다 (설정 화면과 같다).
   */
  let panelEl = $state<HTMLElement | null>(null);
  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);
  $effect(() => {
    const section = tab; // 이 효과의 의존성 — 탭이 바뀔 때만 다시 돈다
    if (section && panelEl) panelEl.scrollTop = 0;
  });

  /**
   * **오류가 가리키는 칸으로 데려간다** (`hosts.svelte.ts` 의 `hostFormErrorField`).
   *
   * 오류 한 줄은 패널 바깥이라 어느 탭에서도 보이지만, 그 줄이 말하는 칸(포트·스크롤백·
   * 포워딩 줄)은 다른 탭에 숨어 있을 수 있다 — "고치라는데 고칠 칸이 없는" 화면을 막는다.
   * 칸을 특정할 수 없는 실패는 `null` 로 오고, 그때는 보던 탭을 그대로 둔다.
   */
  $effect(() => {
    const field = hostFormErrorField();
    if (field === null) return;
    const want = tabOfField(field);
    if (want !== null) tab = want;
    // 탭이 방금 바뀌었으면 그 칸은 아직 그려지지 않았다 (`hidden` 이 걷히는 것도 이 flush 다).
    void tick().then(() => focusErrorField(field));
  });

  /** 오류가 가리키는 칸의 탭 — 내비에 점을 찍는다 (칸을 특정할 수 없는 실패면 없다) */
  const errorTab = $derived(tabOfField(hostFormErrorField()));

  /**
   * 그 칸에 포커스를 준다 — 포커스를 받을 수 있는 것일 때만.
   *
   * 포워딩 프리셋은 칸이 여럿이라 id 가 **줄의 이름표**(`f-forwards-label`)다. 틀린 줄에는
   * 이미 `aria-invalid` 가 붙어 있으므로 그 줄의 첫 칸으로, 없으면 목록의 첫 칸으로 간다.
   */
  function focusErrorField(id: string): void {
    if (id === "f-forwards-label") {
      const box = document.querySelector(".fw-presets");
      const bad =
        box?.querySelector<HTMLInputElement>('input[aria-invalid="true"]') ??
        box?.querySelector<HTMLInputElement>("input") ??
        null;
      bad?.focus();
      return;
    }
    const el = document.getElementById(id);
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement ||
      // 고르개의 id 는 이제 `<button role="combobox">` 에 붙는다 (`Dropdown.svelte`) —
      // 지금 이 자리를 가리키는 실패는 없지만, 생기면 조용히 포커스만 빠질 자리다.
      el instanceof HTMLButtonElement
    ) {
      el.focus();
    }
  }
</script>

{#if hostFormVisible()}
  <div class="overlay">
    <div
      class="modal glass-raised host-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="form-title"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={(ev) => modalEl && trapTab(ev, modalEl)}
    >
      <!--
        ⓘ 설명 팝오버 한 벌 — 이 모달이 제 뿌리다(연 ⓘ 가 이 안에 있을 때만 그린다).
        `position: fixed` 라 스크롤 패널(`.host-panel`)·모달의 `overflow: hidden` 에 잘리지 않는다.
        이 폼은 `{#if}` 로 통째로 뜨고 지므로 여기 있는 동안은 늘 보인다 — 닫힘은 위의 `$effect`.
      -->
      <NotePopover active={true} />
      <h2 id="form-title">
        {hostFormMode() === "edit" ? t("app.hostform.title.edit") : t("app.hostform.title.add")}
      </h2>

      <!--
        `novalidate` — **브라우저의 기본 검증을 끈다** (2026-09-20, 탭으로 갈린 뒤의 회귀).

        칸이 한 줄로 늘어서 있을 때는 `required`·`min`·`max` 가 그대로 쓸모가 있었다. 탭이
        생기고 나서는 아니다: 걸린 칸이 지금 `hidden` 인 탭에 있으면 브라우저가 말풍선을
        띄울 곳을 못 찾고(`An invalid form control … is not focusable`) **제출 자체를
        취소한다** — [저장]을 눌러도 아무 일이 없고 콘솔을 열기 전에는 흔적도 없다.

        그래서 길을 하나로 만든다: 검증은 앱이 하고(`validateHostForm`), 걸리면 그 칸의 탭으로
        데려간다. 속성 자체는 **그대로 둔다** — `:invalid` 표시와 접근성에서 여전히 일한다.
      -->
      <form onsubmit={(ev) => void submitForm(ev)} novalidate>
        <!--
          본문 = 좌측 내비 + 우측 패널. 설정 화면과 **같은 컴포넌트**(`SectionNav`)를 쓴다 —
          같은 모양의 두 화면이 각자 다른 탭 줄을 그리면 그것부터가 배울 거리가 된다.

          섹션은 **언마운트하지 않고 `hidden` 으로만 숨긴다** (설정 화면과 같은 규칙). 칸의 값은
          `hostForm` 에 있어 살아남지만, 잘라 내면 별칭 칸의 `bind:this`(포커스 대상)가 탭을
          옮길 때마다 날아가고, 헤드리스 검증 스크립트가 집는 id 도 DOM 에서
          사라진다.

          [저장]·[취소]와 오류 한 줄은 패널 **바깥**이다 — 어느 탭에 있든 늘 보여야 한다.
        -->
        <div class="host-body">
          <!-- 오류가 가리키는 칸의 탭에는 점이 선다(`marked`) — 프로젝트 폼과 같은 표시 -->
          <SectionNav
            tabs={SECTIONS}
            active={tab}
            onselect={(id) => (tab = id as HostTab)}
            marked={errorTab ? [errorTab] : []}
          />

          <div class="host-panel" bind:this={panelEl}>
            <section hidden={tab !== "connect"}>
              <!--
                머리말도 셸 통합·tmux 와 같은 ⓘ 규칙을 따른다 — 폼이 열리자마자 네 줄을 읽히는 대신
                "무엇이 어느 파일에 적히는가" 한 줄만 보이고, 나머지는 ⓘ 팝오버에 있다.
                **ⓘ 는 수정 모드에만** 있다 — 추가 모드의 "덧붙이기만" 은 요약으로 다 말해진다
                (InfoNote 는 `note` 가 없으면 ⓘ 를 그리지 않는다).
              -->
              {#snippet leadNote()}
                {t("app.hostform.lead.full.edit.1")}<code>Host *</code
                >{t("app.hostform.lead.full.edit.2")}
              {/snippet}
              <p class="lead">
                <InfoNote
                  id="hf-lead"
                  label={t("app.hostform.lead.info.aria")}
                  note={hostFormMode() === "edit" ? leadNote : undefined}
                  plain
                >
                  {#snippet summary()}
                    {#if hostFormMode() === "edit"}
                      {t("app.hostform.lead.edit.1")}<code>{editOriginalName()}</code
                      >{t("app.hostform.lead.edit.2")}<code>Host</code
                      >{t("app.hostform.lead.edit.3")}<strong>{t("app.hostform.lead.edit.term")}</strong
                      >{t("app.hostform.lead.edit.4")}
                    {:else}
                      {t("app.hostform.lead.add.1")}<code>~/.ssh/config</code
                      >{t("app.hostform.lead.add.2")}<code>Host</code
                      >{t("app.hostform.lead.add.3")}<strong>{t("app.hostform.lead.add.term")}</strong
                      >{t("app.hostform.lead.add.4")}
                    {/if}
                  {/snippet}
                </InfoNote>
              </p>

              <div class="fields">
                <label for="f-name">{t("app.hostform.field.name")}</label>
                <input
                  id="f-name"
                  bind:this={formUi.firstField}
                  bind:value={hostForm.name}
                  placeholder="dev-web"
                  autocomplete="off"
                  spellcheck="false"
                  required
                />

                <label for="f-hostname">{t("app.hostform.field.hostname")}</label>
                <input
                  id="f-hostname"
                  bind:value={hostForm.hostName}
                  placeholder={t("app.hostform.field.hostname.placeholder")}
                  autocomplete="off"
                  spellcheck="false"
                  required
                />

                <label for="f-user">{t("app.hostform.field.user")}</label>
                <input
                  id="f-user"
                  bind:value={hostForm.user}
                  placeholder={t("app.hostform.field.user.placeholder")}
                  autocomplete="off"
                  spellcheck="false"
                />

                <label for="f-port">{t("app.hostform.field.port")}</label>
                <input
                  id="f-port"
                  type="number"
                  min="1"
                  max="65535"
                  bind:value={hostForm.port}
                  placeholder={t("app.hostform.field.port.placeholder")}
                />

                <label for="f-identity">IdentityFile</label>
                <div class="file-row">
                  <input
                    id="f-identity"
                    bind:value={hostForm.identityFile}
                    placeholder={t("app.hostform.field.identity.placeholder")}
                    autocomplete="off"
                    spellcheck="false"
                  />
                  <button type="button" class="browse btn btn-secondary" onclick={() => void browseIdentity()}>
                    <UiIcon name="folder-open" size={13} />{t("app.hostform.browse")}
                  </button>
                  <!--
                    "찾아보기…" 바로 옆이다 — 이 칸이 비어 있는 사람에게 필요한 것은 둘 중
                    하나니까(있는 키를 **찾거나**, 없는 키를 **만들거나**).
                    docs/log/2026-09-17-keygen.md
                  -->
                  <button
                    type="button"
                    class="browse btn btn-secondary"
                    title={t("app.hostform.keygen.title")}
                    onclick={() => void newKeyForForm()}
                  >
                    <UiIcon name="plus" size={13} />{t("app.hostform.keygen.open")}
                  </button>
                </div>

                <!--
                  이 키만 사용 (`IdentitiesOnly`) — 위 칸 **바로 아래**다. 이 줄이 좁히는 것이
                  그 칸이기 때문이다 (docs/log/2026-09-19-identity-file-auth.md §11).

                  **키 파일이 비면 재운다**: 그때의 `IdentitiesOnly yes` 는 사람이 기대하는 일을
                  하지 않는다 — OpenSSH 는 지정한 키가 없으면 `~/.ssh/id_*` 기본 이름을 그대로 쓰고
                  이 옵션이 빼는 것은 에이전트 키뿐이다. 그 사실을 흐린 한 줄로 말한다.
                -->
                <label for="f-identities-only">{t("app.hostform.field.identities_only")}</label>
                <div class="log-row">
                  <Toggle
                    id="f-identities-only"
                    bind:checked={hostForm.identitiesOnly}
                    disabled={hostForm.identityFile.trim() === ""}
                  />
                  <span class="field-note">
                    <InfoNote id="hf-identities-only" label={t("app.hostform.identities_only.info.aria")} plain>
                      {#snippet summary()}
                        {t("app.hostform.identities_only.summary")}
                        {#if !hostForm.identitiesOnly && inheritedIdentitiesOnly()}
                          <strong>{t("app.hostform.inherited.on")}</strong>
                        {/if}
                      {/snippet}
                      {#snippet note()}
                        {t("app.hostform.identities_only.full")}
                      {/snippet}
                    </InfoNote>
                    {#if hostForm.identityFile.trim() === ""}
                      <span class="note-full">{t("app.hostform.identities_only.needkey")}</span>
                    {/if}
                  </span>
                </div>

                <!--
                  에이전트 포워딩 (`ssh -A`) — 키를 다루는 두 줄 바로 아래다. 스위치는 **접속이 볼 값**
                  (sessions.toml 의 덮어쓰기 › config 의 `ForwardAgent`)으로 서고, 저장은 config 와
                  같으면 덮어쓰기를 지운다. 위험 문구는 접지 않고 늘 보인다 — 켜는 사람이 읽어야 할
                  말이라서다 (docs/log/2026-09-23-agent-forwarding.md).
                -->
                <label for="f-forward-agent">{t("app.hostform.field.forward_agent")}</label>
                <div class="log-row">
                  <Toggle id="f-forward-agent" bind:checked={hostForm.forwardAgent} />
                  <span class="field-note">
                    <span class="note-head">
                      {t("app.hostform.forward_agent.summary")}
                      {#if configForwardAgent()}
                        <strong>{t("app.hostform.forward_agent.config")}</strong>
                      {/if}
                    </span>
                  </span>
                </div>

                <!--
                  경유 호스트 (`ProxyJump`) — 이미 파일에 적으면 동작하던 것에 손잡이만 붙인다
                  (docs/log/2026-09-17-jump-host-ui.md).

                  **자유 입력이 아니라 고르개**인 이유: 값이 될 수 있는 것은 사실상 이미 등록한
                  다른 호스트뿐이고, 손으로 치게 두면 오타가 접속 실패로만 드러난다. 목록에 없는
                  글자(사람이 `user@bastion:2222` 로 적어 둔 것)는 `jumpOptions` 가 항목 하나로
                  들고 있어 저장할 때 조용히 사라지지 않는다.

                  네이티브 `<select>` 가 아니라 `Dropdown` 인 이유는 **열린 목록**이다 —
                  닫힌 칸은 CSS 로 앱의 모양이 되지만 펼쳐진 목록은 Chromium 이 제 색으로
                  그려, 앱의 다른 고르는 목록들과 한 벌로 보이지 않는다.
                -->
                <label for="f-proxy-jump">{t("app.hostform.field.proxyjump")}</label>
                <div class="tri-row">
                  <Dropdown id="f-proxy-jump" bind:value={hostForm.proxyJump} options={jumpItems} />
                  <span class="field-note">
                    <span class="note-head">{t("app.hostform.proxyjump.help")}</span>
                  </span>
                </div>
              </div>

              <!--
                **저장된 자격증명** (docs/log/2026-09-19-vault.md ③) — 수정 모드에서만.

                이 줄은 설정이 아니라 **사실의 보고**다: [저장] 에 실리지 않고, 할 수 있는 일은
                지우는 것뿐이다. 담는 길은 접속 모달의 체크 하나이므로(값을 아는 자리가 거기뿐이다)
                빈 상태의 문구가 그 자리를 가리킨다.

                자리가 **접속 탭의 맨 아래**이고 위 칸들과 **가로줄로 갈리는** 것은, 이 줄이
                `~/.ssh/config` 도 `sessions.toml` 도 아닌 **세 번째 파일**(볼트)을 말하기
                때문이다 — 섞이면 저장 한 번에 함께 쓰이는 값으로 읽힌다. 그래도 접속 탭인 이유는
                이것이 **이 호스트에 어떻게 접속하는가**의 일부라서다 (비밀번호·키 암호구).

                소제목이 곧 `f-vault-label` 이다 — 가로줄 위의 이름과 그룹의 접근성 이름이 같은
                글자라, 칸 이름을 한 번 더 세우면 같은 말이 두 줄이 된다.
              -->
              {#if hostFormMode() === "edit"}
                <p class="section" id="f-vault-label">{t("app.hostform.field.vault")}</p>
                <div class="vault-row" role="group" aria-labelledby="f-vault-label">
                  {#if !savedPassword() && savedPassphrasePath() === null}
                    <span class="field-note">
                      <span class="note-head">{t("app.hostform.vault.none")}</span>
                    </span>
                  {:else}
                    {#if savedPassword()}
                      <span class="vault-line">
                        <UiIcon name="lock" size={13} />
                        <span class="vault-what">{t("app.hostform.vault.password")}</span>
                        <button
                          type="button"
                          class="browse btn btn-secondary btn-sm"
                          aria-label={t("app.hostform.vault.clear.password.aria")}
                          onclick={() => void clearSavedPassword()}
                        >
                          {t("app.hostform.vault.clear")}
                        </button>
                      </span>
                    {/if}
                    {#if savedPassphrasePath() !== null}
                      <span class="vault-line">
                        <UiIcon name="key" size={13} />
                        <!-- 어느 키인지가 중요하므로 경로를 함께 적는다 (전체는 말풍선에) -->
                        <span class="vault-what" title={savedPassphrasePath()}>
                          {t("app.hostform.vault.passphrase.at", {
                            path: hostForm.identityFile || (savedPassphrasePath() ?? ""),
                          })}
                        </span>
                        <button
                          type="button"
                          class="browse btn btn-secondary btn-sm"
                          aria-label={t("app.hostform.vault.clear.passphrase.aria")}
                          onclick={() => void clearSavedPassphrase()}
                        >
                          {t("app.hostform.vault.clear")}
                        </button>
                      </span>
                    {/if}
                  {/if}
                </div>
              {/if}
            </section>

            <section hidden={tab !== "display"}>
              <!--
                여기부터는 **다른 파일**이다 — `~/.ssh/sessions.toml`. ssh·scp·VS Code 는 이 파일을
                모르고 접속에도 쓰이지 않는다. 앱 소유라 GUI 로 자유롭게 고치되, 사람이 손으로 적은
                주석·순서는 그대로 보존된다(백엔드가 toml_edit 로 해당 키만 갈아 끼운다).
                빈 칸은 "값 없음" 이 아니라 **키를 지운다** = `[defaults]`·프리셋 상속으로 되돌린다.

                옛 "표시·동작" 제목은 사라졌다 — 그 글자는 이제 왼쪽 내비에 **눌린 채로** 서 있다.
                남는 것은 어느 파일에 적히는가 한 줄이고, 그것은 두 탭 모두에 필요하다.
              -->
              <p class="section-note"
                >{t("app.hostform.section.note")}<code>~/.ssh/sessions.toml</code></p
              >

              <!--
                순서는 **아이콘 → 색 → 그룹 → 태그** (2026-09-29) — 목록에서 먼저 눈에 드는 것이 아이콘이고,
                색은 단색(기본) 아이콘이 입는 값이라 그 아래에 선다.

                빈 칸의 곁말은 **어디서 온 무엇인가**를 사람 말로 한다 — "프리셋 prod 의 아이콘 · Ubuntu"
                (`host-meta-hint.ts`, docs/log/2026-09-29-hostform-display-tidy.md). 저장 형식(`svg:…`)은
                폼 어디에도 보이지 않는다.
              -->
              <div class="fields">
                <!--
                  아이콘 → 색 두 칸은 **폴더 편집 · 프로젝트 폼과 같은 한 벌**이다 (`IconColorFields.svelte`,
                  docs/log/2026-09-29-folder-project-icons.md). 상속 곁말·말풍선을 주는 것은 호스트 폼뿐이다.
                -->
                <IconColorFields
                  bind:icon={hostForm.icon}
                  bind:color={hostForm.color}
                  iconId="f-icon"
                  colorId="f-color"
                  iconInherited={inheritedMeta()?.icon}
                  colorInherited={inheritedColor}
                  fallback="server"
                  iconPlaceholder={inheritPlaceholder(t, "icon", inheritedMeta()?.icon, inheritedMeta()?.icon_from) ??
                    t("app.iconcolor.icon.placeholder")}
                  colorPlaceholder={inheritPlaceholder(t, "color", inheritedColor, inheritedMeta()?.color_from) ??
                    t("app.iconcolor.color.placeholder")}
                  iconResetTitle={resetTitle(t, inheritedMeta()?.icon, inheritedMeta()?.icon_from)}
                  colorResetTitle={resetTitle(t, inheritedColor, inheritedMeta()?.color_from)}
                />

                <label for="f-group">{t("app.hostform.field.group")}</label>
                <!--
                  이미 쓰이는 그룹 경로를 자동완성으로 보여 준다 (조상 경로 포함). **자유 입력은
                  그대로다** — 아직 없는 새 경로·더 깊은 중첩도 타이핑할 수 있다.

                  `<datalist>` 였던 자리다. 바꾼 이유는 고르개 둘과 같다: 펼쳐지는 목록을
                  브라우저가 제 모양으로 그려 앱의 다른 목록들과 한 벌로 보이지 않는다.
                  `Combobox` 는 그 상자만 앱 것으로 바꾸고 칸은 평범한 `<input>` 으로 남긴다.
                -->
                <Combobox
                  id="f-group"
                  bind:value={hostForm.group}
                  suggestions={groups}
                  placeholder={inheritedHint(inheritedMeta()?.group) ??
                    t("app.hostform.field.group.placeholder")}
                />

                <label for="f-tags">{t("app.hostform.field.tags")}</label>
                <!--
                  태그는 **칩**이다 (docs/log/2026-09-20-host-form-tabs.md 의 "태그 = 칩 입력").
                  예전에는 쉼표로 구분된 한 줄이라, 사람이 친 글자가 실제로 몇 개의 태그가
                  될지는 저장해 봐야 알았다 — 이제 치는 자리에서 칩으로 갈린다. 폼이 쥔 값도
                  그래서 `string[]` 이고, [저장]은 그 배열을 그대로 보낸다.
                -->
                <TagInput
                  id="f-tags"
                  bind:tags={hostForm.tags}
                  placeholder={t("app.hostform.field.tags.placeholder")}
                />
              </div>
            </section>

            <section hidden={tab !== "session"}>
              <!-- 위 칸과 같은 파일이다 (`sessions.toml`) — 탭이 갈렸을 뿐이다 -->
              <p class="section-note"
                >{t("app.hostform.section.note")}<code>~/.ssh/sessions.toml</code></p
              >

              <div class="fields">
                <label for="f-scrollback">{t("app.hostform.field.scrollback")}</label>
                <input
                  id="f-scrollback"
                  type="number"
                  min={MIN_SCROLLBACK}
                  max={MAX_SCROLLBACK}
                  bind:value={hostForm.scrollback}
                  placeholder={inheritedHint(inheritedMeta()?.scrollback) ??
                    t("app.hostform.field.scrollback.placeholder")}
                />

                <label for="f-onconnect">{t("app.hostform.field.onconnect")}</label>
                <div class="tri-row">
                  <input
                    id="f-onconnect"
                    bind:value={hostForm.onConnect}
                    placeholder={inheritedHint(inheritedMeta()?.on_connect) ??
                      t("app.hostform.field.onconnect.placeholder")}
                    autocomplete="off"
                    spellcheck="false"
                  />
                  <!--
                    tmux 를 켜면 첫 입력 한 줄을 tmux 명령이 통째로 쓴다 — 그래서 이 칸은 **실행되지
                    않는다**(v1). 조용히 무시하는 대신 그 자리에서 말한다.
                  -->
                  {#if hostForm.tmux}
                    <span class="field-note">
                      <span class="note-head"><strong>{t("app.hostform.onconnect.tmuxNote")}</strong></span>
                    </span>
                  {/if}
                </div>

                <!--
                  셸 통합 옵트아웃 — "이 서버엔 아무것도 심지 마라".
                  **체크박스가 아니라 3값 고르개인 이유**: 로깅 칸의 "해제 = 키 삭제" 규칙으로는
                  `false` 를 적을 수 없는데, 이 칸의 존재 이유가 바로 상위 계층(`[defaults]`·preset)이
                  켜 놓은 것을 이 호스트에서만 끄는 것이다 (docs/log/2026-09-02-osc133.md).
                  세 값(`""`·`on`·`off`)은 그대로이고, 상자만 `Dropdown` 이다 (경유 호스트와 같은 이유).
                -->
                <label for="f-shellint">{t("app.hostform.field.shellint")}</label>
                <div class="tri-row">
                  <Dropdown
                    id="f-shellint"
                    bind:value={hostForm.shellIntegration}
                    options={shellItems}
                  />
                  <!-- 긴 설명은 ⓘ 팝오버에 둔다 (요약 한 줄 + 실제 상태인 "상속: 끔" 은 늘 보인다) -->
                  <span class="field-note">
                    <InfoNote id="hf-shellint" label={t("app.hostform.shellint.info.aria")} plain>
                      {#snippet summary()}
                        {t("app.hostform.shellint.summary")}
                        {#if hostForm.shellIntegration === "" && inheritedMeta()?.shell_integration === false}
                          <strong>{t("app.hostform.inherited.off")}</strong>
                        {/if}
                      {/snippet}
                      {#snippet note()}
                        {t("app.hostform.shellint.full.before")}<code>rm -rf ~/.aynx</code
                        >{t("app.hostform.shellint.full.after")}
                      {/snippet}
                    </InfoNote>
                  </span>
                </div>

                <!--
                  tmux 로 접속 — 셸 대신 이 호스트의 tmux 세션에 붙는다(없으면 만든다).
                  체크박스 규칙은 **세션 로깅과 같다**: 해제 = `tmux = false` 가 아니라 키 삭제
                  (기본이 꺼짐이라 파일에 `false` 를 남길 이유가 없다).
                  docs/log/2026-09-16-tmux-toggle.md
                -->
                <label for="f-tmux">{t("app.hostform.field.tmux")}</label>
                <div class="log-row">
                  <Toggle id="f-tmux" bind:checked={hostForm.tmux} />
                  <span class="field-note">
                    <InfoNote id="hf-tmux" label={t("app.hostform.tmux.info.aria")} plain>
                      {#snippet summary()}
                        {t("app.hostform.tmux.summary")}
                        {#if !hostForm.tmux && inheritedMeta()?.tmux}
                          <strong>{t("app.hostform.inherited.on")}</strong>
                        {/if}
                      {/snippet}
                      {#snippet note()}
                        {t("app.hostform.tmux.full")}
                      {/snippet}
                    </InfoNote>
                  </span>
                </div>

                <!--
                  세션 로깅 — 원격이 보낸 바이트를 그대로 파일에 남긴다.
                  체크를 풀면 `log = false` 가 아니라 **키를 지운다** (다른 칸의 "비우기" 와 같은
                  규칙). 그래서 `[defaults] log = true` 를 개별 호스트에서만 끄려면 파일을 직접
                  고쳐야 한다 — docs/log/2026-09-02-triggers-webgl-logging.md 의 남은 일.
                -->
                <label for="f-log">{t("app.hostform.field.log")}</label>
                <div class="log-row">
                  <Toggle id="f-log" bind:checked={hostForm.log} />
                  <!--
                    보안 경고는 **요약 한 줄에 다 담는다**(비밀도 남는다 · 암호화 안 됨) — 접을 전문이
                    남지 않아 ⓘ 가 없다(2026-09-28 문구 정리). "상속: 켬" 은 도움말이 아니라 실제 상태다.
                  -->
                  <span class="log-warn">
                    <span class="note-head">
                      {t("app.hostform.log.summary")}
                      {#if !hostForm.log && inheritedMeta()?.log}
                        <strong>{t("app.hostform.inherited.on")}</strong>
                      {/if}
                    </span>
                    <!--
                      **파일이 어디에 생기는가** (docs/log/2026-09-17-scrollback-export-and-logs.md).
                      경고(`--warn`)가 아니라 사실이라 색을 물려받지 않게 따로 세운다. 경로를
                      아직 못 받았으면 줄 자체를 그리지 않는다 — 빈 경로는 아무 말도 못 한다.
                    -->
                    {#if sessionLogsFolder() !== null}
                      <span class="log-where">
                        <code title={sessionLogsFolder()}>{sessionLogsFolder()}</code>
                        <button
                          type="button"
                          class="browse btn btn-secondary"
                          onclick={() => void openSessionLogsFolder()}
                        >
                          <UiIcon name="folder-open" size={13} />{t(
                            "app.hostform.log.open_folder",
                          )}
                        </button>
                      </span>
                    {/if}
                  </span>
                </div>

                <!--
                  포트 포워딩 프리셋 — 접속하면 자동으로 여는 `ssh -L` 줄들
                  (docs/log/2026-09-17-forward-presets.md).

                  **다른 칸과 갈리는 규칙 하나**: 이 칸은 `[defaults]`·프리셋에서 **상속받지
                  않는다** — 로컬 포트는 그 서버 한 대의 것이고, 무리 전체가 나눠 쓰면 둘째
                  접속부터 "포트가 이미 사용 중" 이 된다. 그래서 상속 힌트(placeholder)도 없다.

                  줄 검증은 저장할 때 한 번에 돈다(`parseForwardRows`) — 치는 동안 빨간 테두리가
                  켜졌다 꺼졌다 하면 포트를 두 글자만 쳐도 틀렸다고 말하게 된다. 틀린 줄에는
                  `aria-invalid` 가 붙고 문구는 폼 아래 한 줄로 나간다.
                -->
                <span class="row-label" id="f-forwards-label">{t("app.hostform.field.forwards")}</span>
                <div class="fw-presets" role="group" aria-labelledby="f-forwards-label">
                  <!--
                    줄 하나 = 두 줄: 위는 **종류**(로컬 -L · 원격 -R · 동적 -D)와 지우기, 아래는
                    그 종류의 칸들 (docs/log/2026-09-23-remote-dynamic-forwarding.md). 한 줄에 다
                    넣으면 로컬 줄의 원격 호스트 칸이 몇 글자 폭으로 눌린다.

                    칸의 순서는 **연결이 흘러가는 순서**다 — 로컬: 내 PC 포트 → 호스트:포트,
                    원격: 서버 포트 → 내 PC 포트, 동적: 내 PC 포트 하나. 감춘 칸의 값은 남아
                    있어도 저장되지 않는다(`parseForwardRow` 가 비운다).
                  -->
                  {#each hostForm.forwards as row, i (i)}
                    <div class="fw-preset-row">
                      <div class="fw-kind">
                        <Dropdown
                          bind:value={row.kind}
                          options={forwardKindOptions(t)}
                          ariaLabel={t("app.hostform.forwards.kind.aria", { n: i + 1 })}
                        />
                      </div>
                      <button
                        type="button"
                        class="browse fw-remove btn btn-ghost"
                        title={t("app.hostform.forwards.remove")}
                        aria-label={t("app.hostform.forwards.remove")}
                        onclick={() => removeForwardRow(i)}
                      >
                        <UiIcon name="close" size={13} />
                      </button>
                      <div class="fw-fields">
                        {#if row.kind === "remote"}
                          <input
                            type="number"
                            min="1"
                            max="65535"
                            class="fw-port"
                            bind:value={row.remotePort}
                            placeholder="18080"
                            aria-label={t("app.hostform.forwards.remote.aria", { n: i + 1 })}
                            aria-invalid={forwardRowInvalid(i) ? "true" : undefined}
                          />
                          <span class="fw-arrow" aria-hidden="true">→</span>
                        {/if}
                        <input
                          type="number"
                          min="1"
                          max="65535"
                          class="fw-port"
                          bind:value={row.localPort}
                          placeholder={row.kind === "dynamic"
                            ? "1080"
                            : row.kind === "remote"
                              ? "8080"
                              : "15432"}
                          aria-label={t("app.hostform.forwards.local.aria", { n: i + 1 })}
                          aria-invalid={forwardRowInvalid(i) ? "true" : undefined}
                        />
                        {#if row.kind === "local"}
                          <span class="fw-arrow" aria-hidden="true">→</span>
                          <input
                            bind:value={row.remoteHost}
                            placeholder="localhost"
                            autocomplete="off"
                            spellcheck="false"
                            aria-label={t("app.hostform.forwards.host.aria", { n: i + 1 })}
                            aria-invalid={forwardRowInvalid(i) ? "true" : undefined}
                          />
                          <span class="fw-arrow" aria-hidden="true">:</span>
                          <input
                            type="number"
                            min="1"
                            max="65535"
                            class="fw-port"
                            bind:value={row.remotePort}
                            placeholder="5432"
                            aria-label={t("app.hostform.forwards.remote.aria", { n: i + 1 })}
                            aria-invalid={forwardRowInvalid(i) ? "true" : undefined}
                          />
                        {/if}
                      </div>
                    </div>
                  {/each}
                  <div class="fw-preset-foot">
                    <button type="button" class="browse btn btn-secondary" onclick={addForwardRow}>
                      <UiIcon name="plus" size={13} />{t("app.hostform.forwards.add")}
                    </button>
                  </div>
                  <!-- 종류별 흐름(→)은 줄의 칸 순서가 이미 보여 준다 — 글로 된 설명은 ⓘ 팝오버에 -->
                  <span class="field-note">
                    <InfoNote id="hf-forwards" label={t("app.hostform.forwards.info.aria")} plain>
                      {#snippet summary()}
                        {t("app.hostform.forwards.help")}
                      {/snippet}
                      {#snippet note()}
                        {t("app.hostform.forwards.full")}
                      {/snippet}
                    </InfoNote>
                  </span>
                </div>
              </div>

            </section>

            <!--
              **에이전트** (2026-10-26 — 에이전트 활성화). 옛 AI 칸의 "원격 AI 훅 자동 설치" 가 넓어져 제 칸을 얻었다:
              켜 두면 접속할 때 서버에 훅 · PATH 심 · 타일 파일(추가 인자)을 심어 **손으로 친 claude · codex 도 앱이 띄운
              것과 같게** 한다(Rust `ssh/open.rs` 의 `host_agent` · `auto_remote_agent`). 파일은 `sessions.toml` 의 `agent` ·
              `agent_args`(키별 상속 — 빈 칸 = 상속 · 적고 지운 빈 값 = 붙이지 않음 · ↺ 로 상속에 되돌림).
            -->
            <section hidden={tab !== "agent"}>
              <p class="section-note"
                >{t("app.hostform.section.note")}<code>~/.ssh/sessions.toml</code></p
              >

              <div class="fields">
                <label for="f-agent">{t("app.hostform.field.agent")}</label>
                <div class="log-row">
                  <Toggle id="f-agent" bind:checked={hostForm.agent} />
                  <span class="field-note">
                    <InfoNote id="hf-agent" label={t("app.hostform.agent.info.aria")} plain>
                      {#snippet summary()}
                        {t("app.hostform.agent.summary")}
                      {/snippet}
                      {#snippet note()}
                        {t("app.hostform.agent.plant.lead")}
                        <ul class="agent-plant">
                          <li>
                            {t("app.hostform.agent.plant.hooks")} — <code>~/.claude/settings.json</code> ·
                            <code>~/.codex/hooks.json</code> · <code>~/.config/aynx/hooks/</code>
                          </li>
                          <li>
                            <code>~/.config/aynx/bin/claude</code> · <code>codex</code> — {t("app.hostform.agent.plant.shim")}
                          </li>
                          <li>
                            <code>~/.config/aynx/signal/&lt;stream&gt;.env</code> — {t("app.hostform.agent.plant.tile")}
                          </li>
                        </ul>
                        {t("app.hostform.agent.plant.after")}
                      {/snippet}
                    </InfoNote>
                  </span>
                </div>

                {#each argsTargets as target (target.id)}
                  {@const pv = argsPreview[target.id]}
                  {@const src = argsSource(target.id)}
                  {@const inheritedArgs = argsInherited(target.id)}
                  <label for="f-agent-args-{target.id}">{t("app.hostform.agent.args", { agent: target.display })}</label>
                  <div class="tri-row">
                    <div class="file-row">
                      <input
                        id="f-agent-args-{target.id}"
                        value={hostForm.agentArgs[target.id] ?? ""}
                        oninput={(ev) => (hostForm.agentArgs[target.id] = ev.currentTarget.value)}
                        placeholder={inheritedArgs?.trim() || t("app.hostform.agent.args.placeholder")}
                        autocomplete="off"
                        spellcheck="false"
                        aria-invalid={pv?.error ? "true" : undefined}
                      />
                      {#if hostForm.agentArgs[target.id] !== undefined}
                        <button
                          type="button"
                          class="browse btn btn-ghost"
                          title={t("app.hostform.agent.args.reset")}
                          aria-label={t("app.hostform.agent.args.reset")}
                          onclick={() => delete hostForm.agentArgs[target.id]}
                        >
                          <UiIcon name="reset" size={13} />
                        </button>
                      {/if}
                    </div>
                    {#if src || (pv && pv.dangerous.length > 0)}
                      <span class="agent-chips">
                        {#if src}<span class="agent-chip">{src}</span>{/if}
                        {#each pv?.dangerous ?? [] as flag (flag)}
                          <span class="agent-chip danger" title={t("app.hostform.agent.danger")}>
                            <UiIcon name="warning" size={11} />{flag}
                          </span>
                        {/each}
                      </span>
                    {/if}
                    {#if pv?.error}
                      <span class="field-note agent-error">{pv.error}</span>
                    {/if}
                  </div>
                {/each}

                {#if argsTargets.length > 0}
                  <span class="row-label">{t("app.hostform.agent.preview")}</span>
                  <div class="tri-row">
                    {#if hostForm.agent}
                      <div class="agent-preview">
                        {#each argsTargets as target (target.id)}
                          <code>{argsPreview[target.id]?.line ?? target.id}</code>
                        {/each}
                      </div>
                      <span class="field-note">{t("app.hostform.agent.preview.note")}</span>
                    {:else}
                      <span class="field-note">{t("app.hostform.agent.preview.off")}</span>
                    {/if}
                  </div>
                {/if}
              </div>
            </section>

            <!--
              **AI 권한** (2026-10-07 — docs/user/hosts.md "AI access"). 예전 세션 탭 맨 아래의 "AI 위임
              (헤드리스)" 묶음이 넓어져 제 칸을 얻었다: 원격 세션의 권한이 **호스트 하나의 단계**라 사람이
              연 타일과 헤드리스 세션에 똑같이 걸린다. 파일은 `~/.aynx/delegation.toml` 이다.

              위는 단계(누적 다섯 — 게이지 `AiGauge`, 10-23)와 그 단계가 여는 일 줄(✓ / –),
              아래는 헤드리스 묶음(접속 · 볼트의 키 암호구). 접속은 단계가 승인 후 실행 이상일 때만 켤 수
              있고, 볼트 암호구는 접속 위에서만이다 — 같은 규칙을 저장 직전 `withDependencies` 와 Rust 의
              `set_target` 이 한 번 더 접는다. 원격 타일 머리줄의 권한 팝오버도 같은 값을 바꾼다.
            -->
            <section hidden={tab !== "ai"}>
              <p class="section first" id="f-ai-stage-label">{t("app.hostform.ai.title")}</p>
              <p class="section-note">
                <InfoNote id="hf-ai" label={t("app.hostform.ai.info.aria")} plain>
                  {#snippet summary()}
                    {t("app.hostform.ai.note")}
                  {/snippet}
                  {#snippet note()}
                    {t("app.hostform.ai.full.before")}<code>~/.aynx/delegation.toml</code
                    >{t("app.hostform.ai.full.after")}
                  {/snippet}
                </InfoNote>
              </p>

              <!-- 게이지(10-23 — `AiGauge.svelte`): '끔' 고리 + 칸 넷 · 설명 상자. 고르는 규칙(확인 상자 · 의존 접기)은 `pickAiStage` 그대로 -->
              <div class="ai-gauge">
                <AiGauge
                  levels={AI_STAGES}
                  value={aiStage}
                  nameOf={(s) => t(AI_STAGE_NAME[s])}
                  descOf={(s) => t(AI_STAGE_DESC[s])}
                  labelledby="f-ai-stage-label"
                  onpick={(s) => void pickAiStage(s)}
                />
              </div>

              <ul class="ai-sum">
                {#each aiSummary as row (row.key)}
                  <li class:on={row.on}>
                    <span class="ai-sum-mark" aria-label={row.on ? t("app.hostform.ai.sum.yes") : t("app.hostform.ai.sum.no")}
                      >{#if row.on}<UiIcon name="check" size={12} />{:else}–{/if}</span
                    >{t(row.key)}
                  </li>
                {/each}
              </ul>

              <p class="section">{t("app.hostform.ai.headless.title")}</p>
              <div class="fields">
                <label for="f-delegation-connect">{t("app.ai.headless")}</label>
                <div class="log-row">
                  <!-- 끄면 볼트 암호구도 함께 꺼진다 — 저장 직전 `withDependencies` 가 같은 규칙으로 한 번 더 접는다 -->
                  <Toggle
                    id="f-delegation-connect"
                    checked={hostForm.delegation.connect}
                    disabled={!headlessAllowed}
                    onchange={(on) => {
                      hostForm.delegation.connect = on;
                      if (!on) hostForm.delegation.vault_passphrase = false;
                    }}
                  />
                  <span class="field-note">
                    <span class="note-head">{t("app.ai.headless.desc")}</span>
                  </span>
                </div>

                <!--
                  **볼트의 키 암호구 사용** (2026-09-22) — 이 호스트의 헤드리스 접속에서만 볼트에 담긴 키
                  암호구를 꺼내 `IdentityFile` 을 연다. AI 가 무엇을 하는가가 아니라 **앱이 무엇을 꺼내
                  쓰는가** 라 접속 바로 아래에 둔다(`볼트 암호구 ⊂ 접속`). 볼트가 없으면 켤 자리가 없다.
                -->
                <label for="f-delegation-vault">{t("app.hostform.delegation.vault")}</label>
                <div class="log-row">
                  <Toggle
                    id="f-delegation-vault"
                    checked={hostForm.delegation.vault_passphrase}
                    disabled={!hostForm.delegation.connect || vaultAbsent}
                    onchange={(on) => (hostForm.delegation.vault_passphrase = on)}
                  />
                  <span class="field-note">
                    <span class="note-head">
                      {vaultAbsent
                        ? t("app.hostform.delegation.vault.absent")
                        : t("app.hostform.delegation.vault.note")}
                    </span>
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>

        {#if hostFormError()}
          <p class="error" role="alert">{hostFormError()}</p>
        {/if}

        <div class="actions">
          <button type="button" class="ghost btn btn-secondary" onclick={closeForm}
            >{t("app.actions.cancel")}</button
          >
          <button type="submit" class="primary btn btn-primary" disabled={hostFormSaving() || metaLoading()}>
            {#if hostFormMode() === "edit"}
              {hostFormSaving() ? t("app.hostform.saving") : t("app.actions.save")}
            {:else}
              {hostFormSaving() ? t("app.hostform.adding") : t("app.hostform.add")}
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    /* 모달은 언제나 최상층 — 패널 안 요소들(재연결 배너 z-5 등)이 전역 층위로 새어
       나와 모달을 투명하게 덮으면 "보이는데 클릭·입력이 안 되는" 증상이 된다 (실기 발견).
       패널 쪽은 pane-box 의 isolation 으로 새는 것 자체도 막지만, 모달의 최상층 보장은
       여기서 독립적으로 지킨다. */
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--bg-overlay);
  }

  .modal {
    width: 100%;
    max-width: 420px;
    /* 호스트 폼은 칸이 10개라 작은 창에서 화면을 넘긴다 — 모달 안에서 스크롤한다
       (overlay 의 padding 16px 을 빼 준다) */
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
  }

  /* 호스트 설정 모달만 넓힌다 — 칸(색·아이콘·그룹·태그·로깅·셸 통합…)이 많아 420px 에선
     라벨·입력이 답답하다. `.modal` 을 공유하는 다른 모달(비밀번호·포워딩·SFTP…)은 그대로 둔다.

     **탭이 생기면서 한 번 더 넓혔다** (520 → 680): 왼쪽 내비가 150px 을 가져가므로 그만큼
     보태 주어야 칸의 폭이 탭 이전과 같다. `border-box` 로 바꾼 것도 같은 줄의 일이다 —
     `.modal` 의 content-box 그대로면 높이 상한(`100vh - 32px`)에 안쪽 여백이 더 붙어 작은
     창에서 오버레이 밖으로 삐져나간다.

     **높이를 못 박는다**: 탭마다 칸 수가 달라, 그러지 않으면 탭을 누를 때마다 상자가 늘었다
     줄었다 한다. 스크롤은 안쪽 패널만 맡는다 (`.modal` 의 `overflow-y` 를 되돌린다). */
  .modal.host-modal {
    box-sizing: border-box;
    max-width: 680px;
    height: min(580px, calc(100vh - 32px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* 모달 안은 세로 스택(제목 · 폼)이고 폼 안도 세로 스택(본문 · 오류 · 버튼)이다 —
     늘어나는 것은 본문 하나뿐이라 나머지는 제 높이를 지킨다 (설정 화면과 같은 모양). */
  .host-modal h2 {
    flex: 0 0 auto;
  }

  .host-modal form {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0; /* 자식(패널)이 넘칠 때 스크롤이 생기도록 */
  }

  /* 본문: 좌 내비 | 우 패널 (`SettingsModal` 의 `.settings-body` 와 같은 값이다) */
  .host-body {
    display: flex;
    gap: 12px;
    flex: 1 1 auto;
    min-height: 0;
    margin-bottom: 12px;
  }

  /* 우측 내용 패널 — 활성 탭만 보이고, 넘치면 여기서만 스크롤한다 */
  .host-panel {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    /* 포커스 링(2px + 1px 틈)이 스크롤 자리에 잘리지 않을 만큼 안쪽을 비우고, 바깥 여백으로 되돌려 칸 자리는 그대로 둔다 */
    padding: 3px;
    margin: -3px;
    /* 좁은 패널에서 라벨·입력을 위아래로 쌓는 기준 (아래 `@container`) */
    container-type: inline-size;
  }

  /* 좁은 패널 — 라벨을 입력 위로 올린다. 125~150% 확대 + 작은 창(최소 720×480)이면 CSS 폭이
     480px 까지 줄어 내비 150px 을 뺀 패널이 250px 안팎인데, `auto 1fr` 두 열은 입력의 최소 폭이
     밀어내 가로 스크롤이 생긴다(2026-10-11 디자인 점검). 창이 아니라 **패널 폭**으로 가른다 —
     모달 폭(680px 상한)이 기준이라 창 크기와 1:1 이 아니다.
     선택자에 `.host-panel` 을 붙인 것은 아래 기본 `.fields` 규칙이 소스 순서로 이기지 못하게다. */
  @container (max-width: 380px) {
    .host-panel .fields {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-1) 0;
    }

    .host-panel .fields label,
    .host-panel .fields .row-label {
      white-space: normal;
    }

    /* 라벨이 칸 위에 쌓이면 첫 줄 맞춤(아래 `.fields label`)이 필요 없다 — 줄 높이를 되돌린다 */
    .host-panel .fields label,
    .host-panel .fields .row-label,
    .host-panel .fields :global(.icf-label) {
      line-height: inherit;
    }

    /* 칸 사이 간격 — 라벨이 바로 위 칸의 꼬리처럼 붙어 보이지 않게 */
    .host-panel .fields label:not(:first-child),
    .host-panel .fields .row-label:not(:first-child) {
      margin-top: var(--space-2);
    }

    /* 키 파일 줄 — 입력이 한 줄을 다 쓰고 [찾아보기]·[만들기]는 그 아래로 */
    .host-panel .file-row {
      flex-wrap: wrap;
    }

    .host-panel .file-row input {
      flex-basis: 100%;
    }
  }

  /* 숨긴 섹션이 확실히 이기게 한다 — 안에 `display:grid` 인 `.fields` 가 있어도 눌린다.
     (탭을 갈아도 언마운트하지 않는 것이 요점 — 위 마크업 주석) */
  .host-panel > section[hidden] {
    display: none !important;
  }

  .modal h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  /*
    `display:block` 그대로 둔다 — 다른 `.lead` 들은 <code>·<strong> 이 섞인 평범한 문단이라
    flex 로 바꾸면 그 인라인 요소 하나하나가 flex 아이템이 되어 줄바꿈이 깨진다. 접힌 안내를
    담은 `.lead` 는 안쪽 `.note-head`(flex) 가 블록 상자라 알아서 두 줄로 쌓인다.
  */
  .lead {
    margin: 0 0 var(--space-4);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
  }

  .lead code {
    font-family: var(--font-mono);
  }

  /*
    버튼 — 전역 `.btn` 세 종류 (docs/log/2026-09-25-finish-menus.md · 토큰층 "버튼 세 종류"):
    취소 = 보조(`.btn-secondary`), 확정 = 주(`.btn-primary`, 이 상자의 하나뿐인 강조색).
    옛 `.ghost`/`.primary` 규칙은 지웠다 — 스코프 규칙이 전역 클래스를 이긴다. 두 이름은
    표식으로만 남는다(검증 도구가 `.actions .primary` 로 찾는다).
  */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /* 폼 바닥의 [취소] · [저장] — 설정 모달 바닥과 같은 크기(40px). `.btn` 정의는 그대로 */
  .actions > .btn {
    height: 40px;
    padding: 0 22px;
    font-size: var(--t-sm);
    font-weight: 500;
  }

  /* 호스트 추가 폼 — TOFU 모달의 .fact 와 같은 2열 격자를 쓴다 */
  .fields {
    display: grid;
    /* 입력 열은 `minmax(0, …)` — 1fr 의 최소가 입력의 고유 폭이면 모달 밖으로 밀려난다 */
    grid-template-columns: auto minmax(0, 1fr);
    /* 위 정렬 — 라벨은 항목의 **첫 줄** 이름이다. 가운데 정렬이면 여러 줄 항목에서 어느 줄의 이름인지 흐려진다 */
    align-items: start;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-4);
  }

  .fields label,
  /* 포워딩 프리셋처럼 **칸이 여럿인 줄**의 이름 — `<label for>` 로 잡을 하나가 없으므로
     `role="group" aria-labelledby` 쪽이 접근성 계약이고, 여기서는 모양만 맞춰 준다. */
  .fields .row-label {
    font-size: var(--t-sm);
    /* 첫 줄(칸 높이)의 가운데 — 넓은 패널에서는 `nowrap` 이라 줄 간격이 벌어질 일이 없다 */
    line-height: var(--field-height);
    color: var(--fg-2);
    white-space: nowrap;
  }

  /* 아이콘 · 색 칸(`IconColorFields`)의 라벨은 자식 컴포넌트에 있다 — 같은 첫 줄 맞춤 */
  .fields :global(.icf-label) {
    line-height: var(--field-height);
  }

  /* 아이콘 칸의 맨 위 줄은 26px 고르개(기본 / 로고)다 — 라벨 줄 가운데에 맞춘다 */
  .fields :global(.icon-field) {
    padding-top: calc((var(--field-height) - 26px) / 2);
  }

  /* 포워딩 프리셋 (docs/log/2026-09-17-forward-presets.md) — 줄 목록 + 추가 + 안내 */
  .fw-presets {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  /* 두 줄짜리 격자 — 위: 종류 · 지우기, 아래: 그 종류의 칸들 (마크업 주석) */
  .fw-preset-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 4px 6px;
    min-width: 0;
  }

  /* 고르개는 가장 긴 글자(동적 · SOCKS)가 잘리지 않을 만큼만 — 열린 목록의 폭이 손잡이 폭이다 */
  .fw-kind {
    grid-column: 1;
    grid-row: 1;
    width: 160px;
    max-width: 100%;
  }

  /* 고르개(`Dropdown` — `--field-height`)와 같은 줄이니 같은 높이 */
  .fw-remove {
    grid-column: 2;
    grid-row: 1;
    height: var(--field-height);
  }

  .fw-fields {
    grid-column: 1 / -1;
    grid-row: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  /* 포트 칸은 폭을 고정한다 — 원격 호스트만 남는 폭을 가져가야 긴 이름이 읽힌다 */
  .fields .fw-preset-row input.fw-port {
    flex: 0 0 82px;
    width: 82px;
  }

  .fields .fw-preset-row input {
    min-width: 0;
  }

  /* 틀린 줄 — 문구는 폼 아래 한 줄이고, 여기는 "어느 줄인가" 만 말한다 */
  .fields .fw-preset-row input[aria-invalid="true"] {
    border-color: var(--err);
  }

  .fw-arrow {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .fw-preset-foot {
    display: flex;
  }

  /* 포워딩 줄이 하나도 없으면 28px [추가] 단추가 첫 줄이다 — 라벨 줄 가운데에 맞춘다 */
  .fw-preset-foot:first-child {
    align-items: center;
    min-height: var(--field-height);
  }

  .fields input {
    width: 100%;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    outline: none;
    box-shadow: var(--glass-ctl-edge, none);
  }

  .fields input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  /* 포커스는 중성 — 강조색 선은 "강조는 셋뿐" 밖이다 (docs/log/2026-09-25-finish-menus.md) */
  .fields input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input::placeholder {
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

  /* 폼 안의 구분선 — 지금은 접속 탭 맨 아래의 "저장된 자격증명" 한 자리가 쓴다
     (`~/.ssh/config` 도 `sessions.toml` 도 아닌 **세 번째 파일**이라는 표시). */
  .section {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    padding-top: var(--space-3);
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    border-top: 1px solid var(--line);
  }

  /* 어느 파일에 적히는가 — 표시·세션 탭의 첫 줄. 탭이 생기기 전에는 `.section` 제목
     ("표시·동작") 옆의 곁말이었고, 지금은 그 자리에 혼자 선다(제목은 왼쪽 내비가 대신한다). */
  /* 칸의 첫 제목 — 위에 다른 묶음이 없으니 선을 긋지 않는다 */
  .section.first {
    padding-top: 0;
    border-top: none;
  }

  /* AI 권한 게이지(10-23 — `AiGauge.svelte`) — 아래 "단계가 여는 일" 줄과의 사이만 여기서 잡는다 */
  .ai-gauge {
    margin: 0 0 var(--space-3);
  }

  /* 단계가 여는 일 세 줄 — ✓ 는 본문 글자, – 는 흐리게 */
  .ai-sum {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 var(--space-4);
    padding: 0;
    list-style: none;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .ai-sum li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .ai-sum li.on {
    color: var(--fg-1);
  }

  .ai-sum-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    flex: none;
  }

  .section-note {
    margin: 0 0 var(--space-3);
    font-size: var(--t-xs);
    font-weight: 400;
    color: var(--fg-2);
  }

  .section-note code {
    font-family: var(--font-mono);
  }

  .file-row {
    display: flex;
    gap: 6px;
    min-width: 0;
    align-items: center;
  }

  /* 저장된 자격증명 (docs/log/2026-09-19-vault.md ③) — 사실 한두 줄 + [지우기].
     포워딩 프리셋과 같은 "칸이 여럿인 줄" 이라 세로 스택 하나로 족하다. */
  .vault-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .vault-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  /* 경로가 길어도 줄을 늘리지 않는다 — 말줄임으로 끊고 전체는 말풍선에 남긴다
     (세션 로그 폴더 한 줄과 같은 규칙). */
  .vault-line .vault-what {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 세션 로깅 — 체크박스 하나와 그 옆의 경고 문구 (되돌릴 수 없는 성격이라 --warn 계열) */
  .log-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
    min-height: var(--field-height);
  }

  /* 스위치는 컴포넌트(Toggle.svelte)라 자식이다 — 스코프를 넘겨 위치만 잡아 준다
     (`flex: 0 0 auto` 는 컴포넌트 자신이 갖고 있다). 24px 스위치를 라벨 줄(칸 높이) 가운데에 둔다. */
  .log-row :global(.toggle) {
    margin-top: calc((var(--field-height) - 24px) / 2);
  }

  /* 옆 설명의 첫 줄도 같은 가운데에 — 1.5em 은 아래 `.field-note` · `.log-warn` 의 줄 높이다.
     미리 보기가 꺼진 줄처럼 설명이 항목의 첫 줄인 `.tri-row` 도 같다. */
  .log-row > .field-note,
  .log-row > .log-warn,
  .tri-row > .field-note:first-child {
    padding-top: calc((var(--field-height) - 1.5em) / 2);
  }

  /* 로그가 쌓이는 자리 한 줄 — 경고(`--warn`)를 물려받지 않는다: 이것은 주의가 아니라 사실이다.
     경로가 길면 줄바꿈 없이 말줄임으로 줄이고(전체는 `title` 툴팁) 버튼은 통째로 남긴다. 짧으면 버튼이
     경로 바로 옆에 붙는다. 폭은 `.fields` 입력 열(`minmax(0, 1fr)`) → `.log-row` → `.log-warn`
     (`min-width: 0` 으로 줄어듦) → 세로 flex 의 늘이기로 이미 칸 안에 묶인다. */
  .log-where {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 4px 8px;
    color: var(--fg-2);
  }

  .log-where code {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log-warn {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--warn);
    word-break: keep-all;
  }

  /* 셸 통합·경유 호스트 — 고르개 하나와 그 아래 설명. 설명이 길어 로깅처럼 옆에 두지 않고 쌓는다.
     칸의 치수·색은 `Dropdown.svelte` 안에 있다 (옛 `.tri-row select` 규칙을 그대로 옮겼다) —
     스코프 CSS 는 자식 컴포넌트의 요소에 닿지 않는다. */
  .tri-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .field-note {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
    word-break: keep-all;
  }

  .field-note code {
    font-family: var(--font-mono);
  }

  /* 에이전트 칸(2026-10-26) — ⓘ 안의 "심는 것" 목록 */
  .agent-plant {
    margin: 4px 0;
    padding-left: 1.2em;
  }

  .agent-plant code {
    font-family: var(--font-mono);
  }

  /* 추가 인자 칸 아래의 칩 — 출처(중성)와 위험 플래그(주의색). 막지 않고 알린다 */
  .agent-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }

  .agent-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .agent-chip.danger {
    font-family: var(--font-mono);
    color: var(--warn);
    background: var(--warn-soft);
    border-color: transparent;
  }

  .agent-error {
    color: var(--err);
  }

  /* 실제로 뜨는 명령 — 에이전트마다 한 줄, 고정폭 우물 면 */
  .agent-preview {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .agent-preview code {
    /* 첫 줄이 라벨 줄과 나란하도록 칸 높이를 바닥으로 — 긴 명령이 감기면 그만큼 는다 */
    display: flex;
    align-items: center;
    box-sizing: border-box;
    min-height: var(--field-height);
    padding: 4px 8px;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--field-bg);
    border-radius: var(--radius-sm);
    overflow-wrap: anywhere;
    user-select: text;
  }

  /* 안내 한 줄 — 텍스트 + (있으면) 설정 파일의 실제 상태(`ForwardAgent yes` · "상속: 켬")를 한 줄에
     흐른다. ⓘ 가 달린 줄은 `InfoNote` 가 제 `.note-head` 를 그린다(이 규칙은 거기 닿지 않는다). */
  .note-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 6px;
  }

  /* 요약 아래의 둘째 줄 — 지금은 "이 키만 사용" 의 "IdentityFile 을 먼저 지정하세요" 하나 */
  .note-full {
    color: inherit;
  }

  .file-row input {
    flex: 1;
    min-width: 0;
  }

  /* 아이콘 · 색 칸의 치수(미리보기·입력·격자·견본)는 `IconColorFields.svelte` · `IconPicker.svelte` 안에 있다 —
     폴더 편집 · 프로젝트 폼과 한 벌이다 */

  /*
    칸 옆의 작은 단추들(찾아보기 · 새 키 · 색 되돌리기 · 지우기 · 줄 추가) — 모양은 전역 `.btn`
    (`.btn-secondary`, 금고 줄은 `.btn-sm`, 포워딩 줄 지우기는 `.btn-ghost`). 옛 선 두른 규칙은
    지웠고 `browse` 는 표식으로만 남는다 — 여기서는 줄 안에서 줄지 않게만 한다.
  */
  .browse {
    flex: 0 0 auto;
  }

  /* 입력 칸 줄의 단추(찾아보기 · 새 키 · 추가 인자 되돌리기)는 칸과 같은 높이 */
  .file-row .browse.btn-secondary,
  .file-row .btn-ghost {
    height: var(--field-height);
  }

  /* 저장 실패 한 줄 — 의미색 판(`--err-soft`), 강조색 선이 아니다 */
  .error {
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-1);
    background: var(--err-soft);
    border-radius: var(--radius-sm);
    user-select: text;
  }
</style>

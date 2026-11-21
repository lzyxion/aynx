<script lang="ts">
  /**
   * 호스트 추가 · 수정 모달 — 상태는 `app/hosts.svelte.ts` 에 있고 여기는 마크업 · 스코프 CSS · 지금 보이는 탭뿐이다.
   * 요소 id 는 헤드리스 검증 스크립트가 직접 집는다 — 바꾸지 않는다 (docs/log/2026-09-20-host-form-tabs.md).
   * 섹션은 언마운트하지 않고 `hidden` 으로만 숨긴다.
   * `.overlay` · `.modal` · `.lead` · `.actions` · `.fields` 등 다른 모달과 나눠 쓰는 규칙은 `dialogs/*` 의 것을 베꼈다.
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
  import InfoNote from "$lib/settings/InfoNote.svelte";
  import NotePopover from "$lib/settings/NotePopover.svelte";
  import { closeNote } from "$lib/settings/note-popover.svelte.js";
  import { MAX_SCROLLBACK, MIN_SCROLLBACK } from "$lib/session";
  import { tabOfField, type HostFormTab } from "$lib/host-form-tabs";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";
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
  // 볼트가 있는지만 읽는다 — 볼트 값은 여기 오지 않는다
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

  const groups = $derived(groupSuggestions());

  const inheritedColor = $derived(inheritedMeta()?.color?.trim() || null);

  /** 열 때마다 다시 읽는다 — 설정 › 보안을 한 번도 안 열었으면 사본이 기본값 `absent` 라 있는 볼트를 없다고 한다 */
  $effect(() => {
    if (hostFormVisible()) void refreshVault();
  });

  /** 팝오버 칸(`note-popover.svelte.ts`)은 모듈 상태라 폼이 닫혀도 남는다 — 켜짐 → 꺼짐에서 닫는다 */
  let wasVisible = false;
  $effect(() => {
    const now = hostFormVisible();
    if (wasVisible && !now) closeNote();
    wasVisible = now;
  });

  /** 볼트가 없으면 헤드리스 볼트 암호구 스위치를 켤 수 없다 */
  const vaultAbsent = $derived(vaultStatus().state === "absent");

  /** `value` 는 저장되는 글자라 바꾸지 않는다 — 라벨만 사전을 지난다 */
  const jumpItems: { value: string; label: string }[] = $derived([
    { value: "", label: t("app.hostform.field.proxyjump.none") },
    ...jumpOptions().map((alias) => ({ value: alias, label: alias })),
  ]);

  // 타입을 손으로 적는다 — `string` 으로 넓어지면 세 값 밖의 글자를 아무도 안 막는다
  const shellItems: { value: "" | "on" | "off"; label: string }[] = $derived([
    { value: "", label: t("app.hostform.shellint.option.default") },
    { value: "on", label: t("app.hostform.shellint.option.on") },
    { value: "off", label: t("app.hostform.shellint.option.off") },
  ]);

  type HostTab = HostFormTab;

  const SECTIONS: readonly { id: string; labelKey: Key }[] = [
    { id: "connect", labelKey: "app.hostform.tab.connect" },
    { id: "display", labelKey: "app.hostform.tab.display" },
    { id: "session", labelKey: "app.hostform.tab.session" },
    { id: "agent", labelKey: "app.hostform.tab.agent" },
    { id: "ai", labelKey: "app.hostform.tab.ai" },
  ];

  /** 판정 · 위험 플래그 · 미리보기 줄은 Rust `agent_launch_preview` 한 곳이고, 원격 셸이라 인용은 POSIX(`bash`)다 */
  let argsTargets = $state<AgentArgsTarget[]>([]);
  /** 반응형이 아니다 — 빈 표(실패 포함)도 새 배열이라 효과가 다시 돌아, 이 표시 없이는 IPC 가 끝없이 돈다 */
  let argsTargetsTried = false;
  $effect(() => {
    if (!hostFormVisible()) {
      argsTargetsTried = false;
      return;
    }
    if (argsTargets.length > 0 || argsTargetsTried) return;
    argsTargetsTried = true;
    void agentArgsTargets().then((list) => (argsTargets = list));
  });
  let argsPreview = $state<Record<string, AgentLaunchPreview | null>>({});

  /** 출처가 적힌 키만 — 출처 없는 병합값은 이 호스트 자기 값이다 */
  function argsInherited(id: string): string | undefined {
    const m = inheritedMeta();
    return m?.agent_args_from?.[id] ? m.agent_args?.[id] : undefined;
  }
  function argsEffective(id: string): string {
    return hostForm.agentArgs[id] ?? argsInherited(id) ?? "";
  }
  function argsSource(id: string): string | null {
    const own = hostForm.agentArgs[id];
    if (own !== undefined) return own.trim() === "" ? t("app.hostform.agent.src.none") : t("app.hostform.agent.src.own");
    const from = inheritedMeta()?.agent_args_from?.[id];
    if (!from) return null;
    return from.kind === "preset"
      ? t("app.hostform.agent.src.preset", { name: from.name })
      : t("app.hostform.agent.src.defaults");
  }

  // 늦게 온 답은 그새 바뀐 칸을 덮지 않는다
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

  /** 단계가 승인 후 실행 아래로 내려가면 `withStage` 가 헤드리스 접속 · 볼트 암호구를 함께 끈다 */
  const aiStage = $derived(stageOf(hostForm.delegation));
  async function pickAiStage(stage: AiStage): Promise<void> {
    if (stageNeedsConfirm(aiStage, stage) && !(await confirmApproveAll("host", hostForm.name.trim() || "?"))) return;
    hostForm.delegation = withStage(hostForm.delegation, stage);
  }
  /** 헤드리스 접속은 승인 후 실행 이상에서만 켤 수 있다 */
  const headlessAllowed = $derived(stageAtLeast(aiStage, "approve"));

  const aiSummary = $derived([
    { on: stageAtLeast(aiStage, "read"), key: "app.hostform.ai.sum.read" as Key },
    { on: stageAtLeast(aiStage, "approve"), key: "app.hostform.ai.sum.propose" as Key },
    { on: stageAtLeast(aiStage, "auto"), key: "app.hostform.ai.sum.auto" as Key },
    { on: aiStage === "all", key: "app.hostform.ai.sum.all" as Key },
  ]);

  let tab = $state<HostTab>("connect");

  /**
   * 열 때마다 여는 쪽이 정한 탭(없으면 첫 탭)으로 — 지난 탭이 남으면 포커스가 보이지 않는 별칭 칸에 들어간다.
   * `hostFormMode()` 는 보지 않는다 — 저장 도중 추가 → 수정 한 걸음이 탭을 되돌려 방금 데려간 오류 칸을 빼앗는다.
   */
  $effect(() => {
    if (hostFormVisible()) tab = hostFormWantTab() ?? "connect";
  });

  let panelEl = $state<HTMLElement | null>(null);
  let modalEl = $state<HTMLElement | null>(null);
  $effect(() => {
    const section = tab;
    if (section && panelEl) panelEl.scrollTop = 0;
  });

  /** 칸을 특정할 수 없는 실패(`null`)면 보던 탭을 그대로 둔다 */
  $effect(() => {
    const field = hostFormErrorField();
    if (field === null) return;
    const want = tabOfField(field);
    if (want !== null) tab = want;
    // 탭이 방금 바뀌었으면 그 칸은 아직 `hidden` 이 걷히지 않았다
    void tick().then(() => focusErrorField(field));
  });

  const errorTab = $derived(tabOfField(hostFormErrorField()));

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
      // 고르개의 id 는 `<button role="combobox">` 에 붙는다(`Dropdown.svelte`)
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
      <NotePopover active={true} />
      <h2 id="form-title">
        {hostFormMode() === "edit" ? t("app.hostform.title.edit") : t("app.hostform.title.add")}
      </h2>

      <!-- `novalidate` — 걸린 칸이 `hidden` 탭에 있으면 브라우저가 제출을 조용히 취소한다. 검증은 `validateHostForm` 이 한다 -->
      <form onsubmit={(ev) => void submitForm(ev)} novalidate>
        <!-- 섹션을 잘라 내면 별칭 칸의 `bind:this` 와 하네스가 집는 id 가 사라진다 — `hidden` 으로만 숨긴다 -->
        <div class="host-body">
          <SectionNav
            tabs={SECTIONS}
            active={tab}
            onselect={(id) => (tab = id as HostTab)}
            marked={errorTab ? [errorTab] : []}
          />

          <div class="host-panel" bind:this={panelEl}>
            <section hidden={tab !== "connect"}>
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
                  <!-- [찾아보기…] 는 메인 PC 의 파일 고르기 대화상자라 원격 창에는 없다 -->
                  {#if !isRemote}
                    <button type="button" class="browse btn btn-secondary" onclick={() => void browseIdentity()}>
                      <UiIcon name="folder-open" size={13} />{t("app.hostform.browse")}
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="browse btn btn-secondary"
                    title={t("app.hostform.keygen.title")}
                    onclick={() => void newKeyForForm()}
                  >
                    <UiIcon name="plus" size={13} />{t("app.hostform.keygen.open")}
                  </button>
                </div>

                <!-- 키 파일이 비면 재운다 — 그때 `IdentitiesOnly yes` 는 에이전트 키만 빼고 `~/.ssh/id_*` 는 그대로 쓴다 -->
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

                <!-- 에이전트 포워딩 — 위험 문구는 ⓘ 로 접지 않고 늘 보인다(켜는 사람이 읽어야 한다) (docs/log/2026-09-23-agent-forwarding.md) -->
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

                <!-- 자유 입력이 아니라 고르개 — 손으로 적어 둔 목록 밖의 값은 `jumpOptions` 가 항목으로 들고 있어 저장에서 사라지지 않는다 -->
                <label for="f-proxy-jump">{t("app.hostform.field.proxyjump")}</label>
                <div class="tri-row">
                  <Dropdown id="f-proxy-jump" bind:value={hostForm.proxyJump} options={jumpItems} />
                  <span class="field-note">
                    <span class="note-head">{t("app.hostform.proxyjump.help")}</span>
                  </span>
                </div>
              </div>

              <!-- 저장된 자격증명 — 설정이 아니라 사실의 보고다: [저장] 에 실리지 않고 지우기만 한다. 담는 길은 접속 모달의 체크 하나다 (docs/log/2026-09-19-vault.md) -->
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
              <!-- 여기부터는 `~/.ssh/sessions.toml` — 빈 칸은 "값 없음" 이 아니라 키를 지워 상속으로 되돌린다 -->
              <p class="section-note"
                >{t("app.hostform.section.note")}<code>~/.ssh/sessions.toml</code></p
              >

              <div class="fields">
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
                <Combobox
                  id="f-group"
                  bind:value={hostForm.group}
                  suggestions={groups}
                  placeholder={inheritedHint(inheritedMeta()?.group) ??
                    t("app.hostform.field.group.placeholder")}
                />

                <label for="f-tags">{t("app.hostform.field.tags")}</label>
                <TagInput
                  id="f-tags"
                  bind:tags={hostForm.tags}
                  placeholder={t("app.hostform.field.tags.placeholder")}
                />
              </div>
            </section>

            <section hidden={tab !== "session"}>
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
                  <!-- tmux 를 켜면 첫 입력 한 줄을 tmux 명령이 쓰므로 이 칸은 실행되지 않는다 -->
                  {#if hostForm.tmux}
                    <span class="field-note">
                      <span class="note-head"><strong>{t("app.hostform.onconnect.tmuxNote")}</strong></span>
                    </span>
                  {/if}
                </div>

                <!-- 체크박스가 아니라 3값 — "해제 = 키 삭제" 로는 위 계층이 켠 것을 이 호스트에서만 끌 `false` 를 적을 수 없다 -->
                <label for="f-shellint">{t("app.hostform.field.shellint")}</label>
                <div class="tri-row">
                  <Dropdown
                    id="f-shellint"
                    bind:value={hostForm.shellIntegration}
                    options={shellItems}
                  />
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

                <!-- 체크를 풀면 키를 지운다 — `[defaults] log = true` 를 이 호스트에서만 끄려면 파일을 직접 고친다 -->
                <label for="f-log">{t("app.hostform.field.log")}</label>
                <div class="log-row">
                  <Toggle id="f-log" bind:checked={hostForm.log} />
                  <!-- 보안 경고(비밀도 남는다 · 암호화 안 됨)는 ⓘ 로 접지 않고 요약 한 줄에 다 담는다 -->
                  <span class="log-warn">
                    <span class="note-head">
                      {t("app.hostform.log.summary")}
                      {#if !hostForm.log && inheritedMeta()?.log}
                        <strong>{t("app.hostform.inherited.on")}</strong>
                      {/if}
                    </span>
                    {#if sessionLogsFolder() !== null}
                      <span class="log-where">
                        <code title={sessionLogsFolder()}>{sessionLogsFolder()}</code>
                        <!-- [폴더 열기] 는 메인 PC 의 탐색기라 원격 창에는 없다 -->
                        {#if !isRemote}
                          <button
                            type="button"
                            class="browse btn btn-secondary"
                            onclick={() => void openSessionLogsFolder()}
                          >
                            <UiIcon name="folder-open" size={13} />{t(
                              "app.hostform.log.open_folder",
                            )}
                          </button>
                        {/if}
                      </span>
                    {/if}
                  </span>
                </div>

                <!-- 상속하지 않는 칸이라 상속 placeholder 가 없다. 줄 검증은 치는 동안이 아니라 저장할 때 한 번에 돈다(`parseForwardRows`) -->
                <span class="row-label" id="f-forwards-label">{t("app.hostform.field.forwards")}</span>
                <div class="fw-presets" role="group" aria-labelledby="f-forwards-label">
                  <!-- 칸의 순서는 연결이 흘러가는 순서다. 감춘 칸의 값은 저장되지 않는다(`parseForwardRow` 가 비운다) -->
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

            <!-- 추가 인자: 빈 칸 = 상속 · 적고 지운 빈 값 = 붙이지 않음 · ↺ = 상속으로 되돌림 -->
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
              AI 권한 — 원격 세션의 권한은 호스트 하나의 단계라 사람이 연 타일과 헤드리스 세션에 똑같이 걸린다(→ docs/invariants.md 전문 2).
              헤드리스 접속은 승인 후 실행 이상에서만, 볼트 암호구는 접속 위에서만 — 저장 직전 `withDependencies` 와 Rust `normalize_grants` 가 한 번 더 접는다.
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
                  <!-- 끄면 볼트 암호구도 함께 꺼진다 -->
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

                <!-- 이 호스트의 헤드리스 접속에서만 볼트의 키 암호구로 `IdentityFile` 을 연다(볼트 암호구 ⊂ 접속) · 볼트가 없으면 켤 수 없다 -->
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
    /* 패널 안 요소가 전역 층위로 새어 모달을 덮으면 "보이는데 클릭이 안 되는" 증상이 된다 — 최상층은 여기서 따로 지킨다 */
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
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }

  /*
   * `border-box` — content-box 면 높이 상한에 안쪽 여백이 더 붙어 작은 창에서 오버레이 밖으로 삐져나간다.
   * 높이를 못 박는다 — 탭마다 칸 수가 달라 상자가 늘었다 줄었다 한다. 스크롤은 안쪽 패널만 맡는다.
   */
  .modal.host-modal {
    box-sizing: border-box;
    max-width: 680px;
    height: min(580px, calc(100vh - 32px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .host-modal h2 {
    flex: 0 0 auto;
  }

  .host-modal form {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  .host-body {
    display: flex;
    gap: 12px;
    flex: 1 1 auto;
    min-height: 0;
    margin-bottom: 12px;
  }

  .host-panel {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    /* 포커스 링이 스크롤 자리에 잘리지 않게 — 4px = 큰 쪽인 `.btn` 의 링(2px + 2px 틈). 3px 면 오른쪽 1px 잘린다(`scripts/dev/focus-ring-clip-harness.mjs --outside`) */
    padding: 4px;
    margin: -4px;
    container-type: inline-size;
  }

  /* 좁은 패널은 라벨을 입력 위로 — 확대 + 작은 창에서 두 열이 가로 스크롤을 낸다. `.host-panel` 을 붙여야 아래 기본 `.fields` 규칙을 이긴다 */
  @container (max-width: 380px) {
    .host-panel .fields {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-1) 0;
    }

    .host-panel .fields label,
    .host-panel .fields .row-label {
      white-space: normal;
    }

    .host-panel .fields label,
    .host-panel .fields .row-label,
    .host-panel .fields :global(.icf-label) {
      line-height: inherit;
    }

    .host-panel .fields label:not(:first-child),
    .host-panel .fields .row-label:not(:first-child) {
      margin-top: var(--space-2);
    }

    .host-panel .file-row {
      flex-wrap: wrap;
    }

    .host-panel .file-row input {
      flex-basis: 100%;
    }
  }

  /* 안의 `display:grid` 인 `.fields` 가 `hidden` 을 이기지 못하게 */
  .host-panel > section[hidden] {
    display: none !important;
  }

  .modal h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  /* `display:block` 그대로 — flex 로 바꾸면 섞인 <code> · <strong> 하나하나가 flex 아이템이 되어 줄바꿈이 깨진다 */
  .lead {
    margin: 0 0 var(--space-4);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
  }

  .lead code {
    font-family: var(--font-mono);
  }

  /* `.ghost` · `.primary` 는 규칙 없는 표식이다 — 검증 도구가 `.actions .primary` 로 찾는다. 스코프 규칙을 달면 전역 `.btn` 을 이긴다 */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .actions > .btn {
    height: 40px;
    padding: 0 22px;
    font-size: var(--t-sm);
    font-weight: 500;
  }

  .fields {
    display: grid;
    /* `minmax(0, …)` — 1fr 의 최소가 입력의 고유 폭이면 모달 밖으로 밀려난다 */
    grid-template-columns: auto minmax(0, 1fr);
    /* 라벨은 항목의 첫 줄 이름이다 — 가운데 정렬이면 여러 줄 항목에서 어느 줄의 이름인지 흐려진다 */
    align-items: start;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-4);
  }

  .fields label,
  .fields .row-label {
    font-size: var(--t-sm);
    line-height: var(--field-height);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .fields :global(.icf-label) {
    line-height: var(--field-height);
  }

  /* 아이콘 칸의 맨 위 줄은 26px 고르개다 */
  .fields :global(.icon-field) {
    padding-top: calc((var(--field-height) - 26px) / 2);
  }

  .fw-presets {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  .fw-preset-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 4px 6px;
    min-width: 0;
  }

  /* 열린 목록의 폭이 손잡이 폭이다 — 가장 긴 글자(동적 · SOCKS)가 잘리지 않을 만큼 */
  .fw-kind {
    grid-column: 1;
    grid-row: 1;
    width: 160px;
    max-width: 100%;
  }

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

  .fields .fw-preset-row input.fw-port {
    flex: 0 0 82px;
    width: 82px;
  }

  .fields .fw-preset-row input {
    min-width: 0;
  }

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

  /* 포워딩 줄이 없으면 [추가] 단추가 첫 줄이다 */
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

  /* 포커스는 중성 — 강조색 선은 "강조는 셋뿐" 밖이다 */
  .fields input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input::placeholder {
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

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

  .section.first {
    padding-top: 0;
    border-top: none;
  }

  .ai-gauge {
    margin: 0 0 var(--space-3);
  }

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

  .vault-line .vault-what {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
    min-height: var(--field-height);
  }

  /* 24px 스위치를 라벨 줄 가운데에 */
  .log-row :global(.toggle) {
    margin-top: calc((var(--field-height) - 24px) / 2);
  }

  /* 1.5em 은 아래 `.field-note` · `.log-warn` 의 줄 높이다 */
  .log-row > .field-note,
  .log-row > .log-warn,
  .tri-row > .field-note:first-child {
    padding-top: calc((var(--field-height) - 1.5em) / 2);
  }

  /* 경고(`--warn`)를 물려받지 않는다 — 주의가 아니라 사실이다 */
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

  .agent-plant {
    margin: 4px 0;
    padding-left: 1.2em;
  }

  .agent-plant code {
    font-family: var(--font-mono);
  }

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

  .agent-preview {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .agent-preview code {
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

  /* ⓘ 가 달린 줄은 `InfoNote` 가 제 `.note-head` 를 그린다 — 이 규칙은 거기 닿지 않는다 */
  .note-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 6px;
  }

  .note-full {
    color: inherit;
  }

  .file-row input {
    flex: 1;
    min-width: 0;
  }

  .browse {
    flex: 0 0 auto;
  }

  .file-row .browse.btn-secondary,
  .file-row .btn-ghost {
    height: var(--field-height);
  }

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

<script lang="ts">
  import Dropdown from "$lib/Dropdown.svelte";
  import { onMount, tick, untrack } from "svelte";
  import { agentMcpValidate, type AgentArgsTarget } from "$lib/context";
  import { settings, setAiMcpServers } from "$lib/settings.svelte.js";
  import {
    DEFAULT_AGENTS,
    buildServer,
    cannotSubmitServer,
    putServer,
    sameScopeNames,
    secretDrafts,
    secretRefs,
    secretVaultKey,
    toggleAgentIn,
    type SecretDraft,
  } from "$lib/settings/model/mcp-server-form";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import SettingsSubView from "$lib/settings/SettingsSubView.svelte";
  import TipName from "$lib/settings/TipName.svelte";
  import AgentChip from "./AgentChip.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import * as vault from "$lib/vault";
  import { ensureVaultUnlocked } from "$lib/app/prompts.svelte.js";

  /**
   * 외부 MCP 서버 **추가 · 편집** — 설정 › MCP 의 하위 화면 (docs/log/2026-10-05-mcp-subview.md).
   *
   * 요약(`ExternalMcpServers`)의 [MCP 서버 추가 ›] 또는 줄 누르기가 연다. 틀(`SettingsSubView`)은 트리거 · 스니펫 ·
   * 자동 승인과 공용이고, 움직임 · Escape · 돌아온 뒤 포커스는 요약이 맡는다. 칸 · 검증 · 저장 순서는 옛 모달
   * (`McpServerDialog`)을 그대로 옮겼다:
   *
   * 1. 이름 · 값 검사는 Rust 한 곳(`agentMcpValidate`) — 같은 범위의 이름만 중복으로 본다.
   * 2. 새로 친 비밀 값이 있을 때만 볼트 — 없으면 만들고(마스터 없음), 잠겼으면 해제를 청하고, 그래도 잠겼으면
   *    **아무것도 쓰지 않고** 오류 한 줄(초안은 남는다). 값은 `vault.storeMcpEnv` 로만 나가고 돌려받는 것은 참조뿐.
   * 3. 그다음에야 설정 **초안**(`setAiMcpServers`)에 쓴다 — 실제 파일 · 볼트의 옛 값 정리 · 실행 티켓 회수는 설정
   *    창의 [저장] 이 하던 그대로다(Rust).
   *
   * 칸은 이 화면 안에만 산다 — [취소] · 뒤로 · Escape 는 아무것도 쓰지 않는다. 화면이 닫히면(`closed`) 진행 중인
   * 검사 · 볼트 저장의 뒷단계는 멈춘다. [삭제] 는 옛 모달처럼 확인 없이 초안에서 뺀다(설정 [저장] 전까지 되돌릴 수 있다).
   */
  let {
    index,
    targets,
    projectOptions,
    onback,
    onsaved,
    ondeleted,
  }: {
    /** 고칠 항목의 저장 자리 — `null` 이면 추가 */
    index: number | null;
    targets: AgentArgsTarget[];
    projectOptions: { id: string; name: string }[];
    /** [취소] · 뒤로 · Escape — 아무것도 쓰지 않고 요약으로 */
    onback: () => void;
    /** [추가] · [저장] 뒤 — 넣거나 고친 항목의 저장 자리 */
    onsaved: (index: number) => void;
    ondeleted: () => void;
  } = $props();

  const list = $derived(settings.current.ai.mcp_servers ?? []);

  // 열릴 때만 초안을 만든다. 목록 변경은 검증을 통과한 [추가]/[저장] 에서만 한다.
  const editingIndex = untrack(() => index);
  const initial = untrack(() => (editingIndex === null ? null : (list[editingIndex] ?? null)));
  const adding = initial === null;
  let name = $state(initial?.name ?? "");
  let transport = $state<"stdio" | "http">(initial?.transport ?? "stdio");
  let command = $state(initial?.command ?? "");
  let args = $state<string[]>([...(initial?.args ?? [])]);
  let url = $state(initial?.url ?? "");
  let projectId = $state(initial?.project_id ?? "");
  let env = $state<SecretDraft[]>(secretDrafts(initial?.env));
  let headers = $state<SecretDraft[]>(secretDrafts(initial?.headers));
  const secrets = $derived(transport === "stdio" ? env : headers);
  let storeEnv = $state((initial?.env?.length ?? 0) + (initial?.headers?.length ?? 0) > 0);
  let envContainer = $state<HTMLDivElement>();
  let enabled = $state(initial?.enabled ?? true);
  let agents = $state<string[]>([...(initial?.agents ?? DEFAULT_AGENTS)]);
  let agentsChanged = $state(false);
  /** 대상 › 사이드 채팅 · 사이드 채팅에서 묻지 않기(2026-10-25 — 묻지 않기는 사이드 채팅을 켰을 때만 보이고 저장된다) */
  let sideChat = $state(initial?.side_chat ?? false);
  let sideChatNoAsk = $state(initial?.side_chat_no_ask ?? false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let argsContainer = $state<HTMLDivElement>();
  let cancelButton = $state<HTMLButtonElement>();
  let closed = false;
  const cannotSubmit = $derived(
    cannotSubmitServer({ busy, name, transport, command, url, secretCount: secrets.length, storeSecrets: storeEnv }),
  );

  onMount(() => () => {
    closed = true;
  });

  // 편집 중인 항목이 바깥에서 사라지면(다른 창의 설정 다시 읽기 등) 요약으로 — 없는 자리에 쓰지 않게.
  $effect(() => {
    if (editingIndex !== null && list[editingIndex] === undefined) untrack(onback);
  });

  // 검사 중 입력칸이 disabled 되어도 포커스(→ Escape)가 설정 안에 머물게 한다.
  $effect(() => {
    if (busy) cancelButton?.focus();
  });

  async function addArg() {
    args = [...args, ""];
    await tick();
    argsContainer?.querySelector<HTMLInputElement>(".arg-row:last-of-type input")?.focus();
  }

  async function addEnv() {
    const entry = { name: "", value: "", changed: true };
    if (transport === "stdio") env = [...env, entry];
    else headers = [...headers, entry];
    await tick();
    envContainer?.querySelector<HTMLInputElement>(".env-row:last-child input")?.focus();
  }

  function removeSecret(i: number) {
    if (transport === "stdio") env = env.filter((_, k) => k !== i);
    else headers = headers.filter((_, k) => k !== i);
  }

  function toggleAgent(id: string) {
    agents = toggleAgentIn(agents, id);
    agentsChanged = true;
  }

  async function submit() {
    if (cannotSubmit) return;
    const next = buildServer(
      { name, enabled, agents, projectId, transport, command, args, url, secrets, sideChat, sideChatNoAsk },
      initial,
      agentsChanged,
    );
    busy = true;
    error = null;
    try {
      const result = await agentMcpValidate(next, sameScopeNames(list, editingIndex, projectId));
      if (closed) return;
      error = result;
      if (result !== null) return;
      if (secrets.some((entry) => entry.changed)) {
        const status = await vault.status(true);
        if (closed) return;
        if (status.state === "absent") await vault.create(null);
        else if (status.state === "locked") {
          await ensureVaultUnlocked();
          if ((await vault.status(true)).state !== "unlocked") {
            error = t(transport === "stdio" ? "settings.ai.external.env_locked" : "settings.ai.external.headers_locked");
            return;
          }
        }
        for (const entry of secrets) {
          if (closed) return;
          if (entry.changed) {
            entry.secret_ref = await vault.storeMcpEnv(secretVaultKey(projectId, next.name, transport, entry.name), entry.value);
            entry.value = "";
            entry.changed = false;
          }
        }
        if (transport === "stdio") next.env = secretRefs(secrets);
        else next.headers = secretRefs(secrets);
      }
      if (closed) return;
      const put = putServer(list, editingIndex, next);
      setAiMcpServers(put.list);
      onsaved(put.index);
    } catch (e) {
      if (!closed) error = typeof e === "string" ? e : t("settings.ai.external.validate_failed");
    } finally {
      busy = false;
    }
  }

  function remove() {
    if (editingIndex === null) return;
    setAiMcpServers(list.filter((_, i) => i !== editingIndex));
    ondeleted();
  }
</script>

<SettingsSubView
  title={t(adding ? "settings.ai.external.form_new" : "settings.ai.external.form_edit")}
  back={t("settings.ai.external.back")}
  backAria={t("settings.ai.external.back_aria")}
  {onback}
>
  <form aria-label={t(adding ? "settings.ai.external.form_new" : "settings.ai.external.form_edit")}
    onsubmit={(ev) => { ev.preventDefault(); void submit(); }}>
    <div class="mcp-box">
    <!-- 칸 순서(2026-10-25 목업): 이름 → 연결 방식 → 명령·인자 / URL → 환경변수 / 헤더 → 범위 → 대상 → (사이드 채팅에서 묻지 않기) → 사용.
         늘 보이는 설명 줄은 없다 — 설명은 이름 툴팁(`TipName`)에 산다 -->
    <div class="fields">
      <TipName id="ai-mcp-name-f" for="ai-mcp-name" label={t("settings.ai.external.name")} tip={t("settings.ai.external.name_tip")} />
      <input id="ai-mcp-name" bind:value={name} maxlength={48} disabled={busy}
        autocomplete="off" spellcheck="false" placeholder="playwright" />

      <TipName id="ai-mcp-transport" label={t("settings.ai.external.transport")} tip={t("settings.ai.external.transport_tip")} />
      <div class="field"><div class="opt-chips seg" role="group" aria-labelledby="ai-mcp-transport-label">
        <button type="button" class="opt-chip seg-btn" class:active={transport === "stdio"} aria-pressed={transport === "stdio"}
          disabled={busy} onclick={() => (transport = "stdio")}>{t("settings.ai.external.transport_stdio")}<span class="proto">stdio</span></button>
        <button type="button" class="opt-chip seg-btn" class:active={transport === "http"} aria-pressed={transport === "http"}
          disabled={busy} onclick={() => (transport = "http")}>{t("settings.ai.external.transport_http")}<span class="proto">HTTP</span></button>
      </div></div>

      {#if transport === "stdio"}
        <label class="field-label" for="ai-mcp-command">{t("settings.ai.external.command")}</label>
        <input id="ai-mcp-command" bind:value={command} disabled={busy} autocomplete="off" spellcheck="false" placeholder="npx" />

        <span class="field-label" id="ai-mcp-args-label">{t("settings.ai.external.args")}</span>
        <div class="field" role="group" aria-labelledby="ai-mcp-args-label">
          <div class="arg-list" bind:this={argsContainer}>
            {#each args as arg, i}
              <div class="arg-row">
                <input id={"ai-mcp-arg-" + i} value={arg} oninput={(ev) => (args[i] = ev.currentTarget.value)}
                  aria-label={t("settings.ai.external.arg", { index: i + 1 })} disabled={busy} autocomplete="off" spellcheck="false" />
                <button type="button" class="btn btn-sm btn-ghost arg-remove" disabled={busy}
                  onclick={() => (args = args.filter((_, k) => k !== i))}
                  title={t("settings.ai.external.arg_delete")} aria-label={t("settings.ai.external.arg_delete_aria", { index: i + 1 })}>
                  <UiIcon name="close" size={13} />
                </button>
              </div>
            {/each}
          </div>
          <button type="button" class="btn btn-sm btn-ghost arg-add" disabled={busy} onclick={() => void addArg()}>
            <UiIcon name="plus" size={13} />{t("settings.ai.external.arg_add")}
          </button>
        </div>
      {:else}
        <label class="field-label" for="ai-mcp-url">{t("settings.ai.external.url")}</label>
        <input id="ai-mcp-url" bind:value={url} disabled={busy} autocomplete="off" spellcheck="false" placeholder="https://…" />
      {/if}

      <TipName id={transport === "stdio" ? "ai-mcp-env" : "ai-mcp-headers"}
        label={t(transport === "stdio" ? "settings.ai.external.env" : "settings.ai.external.headers")}
        tip={t(transport === "stdio" ? "settings.ai.external.env_tip" : "settings.ai.external.headers_tip")} />
      <div class="field" role="group" aria-labelledby={transport === "stdio" ? "ai-mcp-env-label" : "ai-mcp-headers-label"}>
        <div class="env-list" bind:this={envContainer}>
          {#each secrets as entry, i}
            <div class="env-row">
              <input value={entry.name} oninput={(ev) => (entry.name = ev.currentTarget.value)}
                id={(transport === "stdio" ? "ai-mcp-env-name-" : "ai-mcp-header-name-") + i} aria-label={t(transport === "stdio" ? "settings.ai.external.env_name" : "settings.ai.external.headers_name")}
                placeholder={transport === "stdio" ? "DATABASE_URI" : "Authorization"} maxlength={128} autocomplete="off" spellcheck="false" disabled={busy} />
              <input type="password" value={entry.value} oninput={(ev) => { entry.value = ev.currentTarget.value; entry.changed = true; }}
                id={(transport === "stdio" ? "ai-mcp-env-value-" : "ai-mcp-header-value-") + i} aria-label={t("settings.ai.external.env_value")}
                placeholder={entry.secret_ref && !entry.changed ? t("settings.ai.external.env_saved") : t("settings.ai.external.env_value")}
                maxlength={4096} autocomplete="new-password" disabled={busy} />
              <button type="button" class="btn btn-sm btn-ghost" disabled={busy} onclick={() => removeSecret(i)}
                aria-label={t(transport === "stdio" ? "settings.ai.external.env_delete" : "settings.ai.external.headers_delete")} title={t(transport === "stdio" ? "settings.ai.external.env_delete" : "settings.ai.external.headers_delete")}><UiIcon name="close" size={13} /></button>
            </div>
          {/each}
        </div>
        <button type="button" class="btn btn-sm btn-ghost env-add" disabled={busy || secrets.length >= (transport === "stdio" ? 128 : 32)} onclick={() => void addEnv()}>
          <UiIcon name="plus" size={13} />{t(transport === "stdio" ? "settings.ai.external.env_add" : "settings.ai.external.headers_add")}
        </button>
        {#if secrets.length > 0}
          <label class="env-consent"><input type="checkbox" bind:checked={storeEnv} disabled={busy} />{t(transport === "stdio" ? "settings.ai.external.env_store" : "settings.ai.external.headers_store")}</label>
        {/if}
      </div>

      <TipName id="ai-mcp-scope-f" for="ai-mcp-form-scope" label={t("settings.ai.external.scope_label")} tip={t("settings.ai.external.scope_tip")} />
      <Dropdown id="ai-mcp-form-scope" bind:value={projectId} disabled={busy}
        options={[{ value: "", label: t("settings.ai.external.scope_global") }, ...projectOptions.map((project) => ({ value: project.id, label: t("settings.ai.external.scope_project_only", { name: project.name }) }))]} />

      <TipName id="ai-mcp-agents" label={t("settings.ai.external.targets")} tip={t("settings.ai.external.targets_tip")} />
      <div class="targets" role="group" aria-labelledby="ai-mcp-agents-label">
        <div class="agent-chips" role="group" aria-label={t("settings.ai.external.targets_tiles")}>
          <span class="group-label" aria-hidden="true">{t("settings.ai.external.targets_tiles")}</span>
          {#each targets as target (target.id)}
            {@const pressed = agents.includes(target.id)}
            <AgentChip agent={target} {pressed} disabled={busy} showLabel
              title={t(pressed ? "settings.ai.external.target_on" : "settings.ai.external.target_off", { agent: target.display })}
              onclick={() => toggleAgent(target.id)} />
          {/each}
        </div>
        <span class="targets-divider" aria-hidden="true"></span>
        <AgentChip agent={{ id: "side-chat", display: t("settings.ai.external.side_chat") }} pressed={sideChat} disabled={busy} showLabel
          title={t(sideChat ? "settings.ai.external.side_chat_on" : "settings.ai.external.side_chat_off")}
          onclick={() => (sideChat = !sideChat)}>
          {#snippet icon()}<UiIcon name="side-panel" size={14} />{/snippet}
        </AgentChip>
      </div>

      {#if sideChat}
        <TipName id="ai-mcp-no-ask-f" for="ai-mcp-no-ask" label={t("settings.ai.external.no_ask")} tip={t("settings.ai.external.no_ask_tip")} />
        <div class="field">
          <Toggle id="ai-mcp-no-ask" bind:checked={sideChatNoAsk} disabled={busy} />
        </div>
      {/if}

      <TipName id="ai-mcp-enabled-f" for="ai-mcp-enabled" label={t("settings.ai.external.enabled_label")} tip={t("settings.ai.external.enabled_note")} />
      <div class="field">
        <Toggle id="ai-mcp-enabled" bind:checked={enabled} disabled={busy} />
      </div>
    </div>
    </div>
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    <div class="form-actions">
      {#if !adding}
        <button type="button" class="btn btn-sm btn-ghost del" disabled={busy} onclick={remove}
          aria-label={t("settings.ai.external.delete_aria", { name: initial?.name ?? "" })}>{t("settings.ai.external.delete")}</button>
      {/if}
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm btn-ghost cancel" bind:this={cancelButton} onclick={onback}>{t("settings.actions.cancel")}</button>
      <button type="submit" id="ai-mcp-submit" class="btn btn-sm btn-primary commit" disabled={cannotSubmit}>
        {t(adding ? "settings.ai.external.submit_add" : "settings.actions.save")}
      </button>
    </div>
  </form>
</SettingsSubView>

<style>
  /* 칸 — 트리거 · 스니펫 편집과 같은 1px 선의 판. 안은 옛 모달의 이름 | 칸 격자 그대로 */
  .mcp-box {
    container-type: inline-size;
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .env-list { display: grid; gap: var(--space-1); }
  .env-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto; align-items: center; gap: var(--space-1); }
  .env-row input { min-width: 0; width: 100%; }
  .fields .env-consent { display: flex; align-items: flex-start; gap: var(--space-2); margin-top: var(--space-2); white-space: normal; }
  .fields .env-consent input { flex: none; width: 14px; height: 14px; padding: 0; margin: 1px 0 0; box-shadow: none; }

  .fields {
    display: grid;
    grid-template-columns: minmax(88px, max-content) minmax(0, 1fr);
    align-items: start;
    gap: var(--space-3);
  }

  .fields label,
  .field-label,
  .fields :global(.name.has-tip) {
    font-size: var(--t-sm);
    color: var(--fg-2);
    white-space: nowrap;
  }

  /* 설명은 이름 툴팁(`TipName` — 위로 뜬다) — 얹을 자리는 글자 폭만큼 */
  .fields :global(.name.has-tip) {
    justify-self: start;
    cursor: help;
  }

  /* 툴팁 글자의 읽기 칸(`aria-describedby`) — 격자의 칸을 차지하지 않는다(`settings.css` 의 `.tip-desc` 와 같은 숨김) */
  .fields :global(.tip-desc) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .field,
  .arg-list {
    min-width: 0;
  }

  .fields :global(.dd) {
    width: 100%;
    min-width: 0;
  }

  .fields input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
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

  .fields input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input::placeholder {
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

  .fields input:disabled,
  .seg-btn:disabled {
    opacity: .45;
  }

  .arg-list {
    display: grid;
    gap: var(--space-2);
  }

  .arg-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .arg-remove {
    flex: none;
    width: var(--space-5);
    padding: 0;
  }

  .arg-add {
    padding: 0;
    margin-top: var(--space-1);
  }

  /* 대상 — [AI 타일 Claude Codex] │ [사이드 채팅] */
  .targets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .agent-chips {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .group-label {
    margin-right: 2px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .targets-divider {
    width: 1px;
    height: 18px;
    background: var(--line);
  }

  /* 연결 방식 옆의 프로토콜 이름 — 흐리게 */
  .proto {
    color: var(--fg-3);
    font-weight: 400;
  }

  .seg-btn.active .proto {
    color: inherit;
    opacity: .7;
  }

  /* 연결 방식 — 공용 이어 붙은 묶음(`.opt-chips` · `.opt-chip`, settings.css — 2026-10-28, 예전 outlined segmented + ✓) */
  .seg-btn {
    font-size: var(--t-xs);
  }

  /* 좁은 설정 칸(작은 창 · 독) — 이름을 칸 위로 올린다(스니펫 · 트리거 편집과 같은 문턱) */
  @container (max-width: 420px) {
    .fields {
      grid-template-columns: minmax(0, 1fr);
      row-gap: var(--space-1);
    }

    .fields > :not(label, .field-label) {
      margin-bottom: var(--space-2);
    }
  }

  .form-error {
    margin: var(--space-3) 0 0;
    font-size: var(--t-xs);
    color: var(--err);
  }

  .form-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .spacer {
    flex: 1 1 auto;
  }

  .del {
    color: var(--fg-2);
  }

  .del:hover {
    color: var(--err);
    background: var(--err-soft);
  }
</style>

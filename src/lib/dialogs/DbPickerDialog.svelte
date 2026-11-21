<script lang="ts">
  // DB 연결 고르기 — 목록 + DB 연결 폼. 연결 테스트 칩은 바닥 줄 안에만 서서 폼의 높이를 바꾸지 않는다.
  import { tick } from "svelte";
  import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
  import Dropdown from "$lib/Dropdown.svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";
  import { trapTab } from "$lib/focus-trap";
  import { DB_DEFAULT_PORT, DB_ENGINE_ICON, DB_ENGINES, DB_TLS_MODES, sameAlias, tlsCaRequired, tlsNeedsCa, tlsUnverified, type DbConn, type DbEngine } from "$lib/db-conn";
  import { connTargetText, directTlsWarning } from "$lib/query/conn-form";
  import AiGauge from "$lib/AiGauge.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import { vaultStatus } from "$lib/app/vault.svelte.js";
  import InfoNote from "$lib/settings/InfoNote.svelte";
  import SectionNav from "$lib/settings/SectionNav.svelte";
  import NotePopover from "$lib/settings/NotePopover.svelte";
  import { closeNote } from "$lib/settings/note-popover.svelte.js";
  import { DB_AI_DESC, DB_AI_LEVELS, DB_AI_NAME, dbAiSendsRows, dbAiSummary, dbHeadlessBox } from "$lib/db-ai";
  import { dbAiServerReady, dbAiWritePlans, dbConnTestReady } from "$lib/app/db-ai.svelte.js";
  import { connTestChip } from "$lib/query/conn-test";
  import {
    closeDbPicker,
    connAiBroken,
    connAiShown,
    connHeadlessShown,
    connTargetChanged,
    setConnHeadless,
    setConnAi,
    dbPicker,
    dbPickerVisible,
    deleteConn,
    leaveConnForm,
    pickDb,
    pickerConns,
    pickerWarnings,
    setConnEngine,
    setConnVia,
    startEditConn,
    startNewConn,
    submitConn,
    cancelConnTest,
    connTestUi,
    noteConnFormChanged,
    startConnTest,
    connPw,
    setConnPassword,
  } from "$lib/app/query.svelte.js";

  let modalEl = $state<HTMLElement | null>(null);

  // 닫히면 ⓘ 팝오버도 닫는다 — 팝오버는 모듈 상태라 떨어져 나간 ⓘ 를 붙든다.
  let wasVisible = false;
  $effect(() => {
    const now = dbPickerVisible();
    if (wasVisible && !now) closeNote();
    wasVisible = now;
  });

  const engineLabel = (e: DbEngine) => t(`app.query.engine.${e}` as Key);
  const engineItems = $derived(DB_ENGINES.map((value) => ({ value, label: engineLabel(value) })));
  const tlsItems = $derived(DB_TLS_MODES.map((value) => ({ value, label: t(`app.query.form.tls.${value}` as Key) })));
  const viaItems = $derived.by(() => {
    const out: { value: string; label: string; icon?: string }[] = [{ value: "", label: t("app.query.form.via.none") }];
    const cur = dbPicker.form.via;
    if (cur && !dbPicker.hosts.some((h) => sameAlias(h.name, cur))) out.push({ value: cur, label: cur });
    for (const h of dbPicker.hosts) out.push({ value: h.name, label: h.name, icon: h.icon ?? undefined });
    return out;
  });
  // 막지 않고 밝힌다(SSH 경유는 SSH 가 감싼다)
  const tlsWarn = $derived(directTlsWarning(dbPicker.form));

  const aiShown = $derived(connAiShown());
  const aiReset = $derived(connTargetChanged() && !dbPicker.aiTouched && dbPicker.ai !== "off");
  const headlessShown = $derived(connHeadlessShown());
  const vaultAbsent = $derived(vaultStatus().state === "absent");
  const headlessBox = $derived(dbHeadlessBox(dbPicker.form.engine, vaultAbsent, headlessShown));

  type FormTab = "connect" | "ai";
  const SECTIONS: readonly { id: FormTab; labelKey: Key }[] = [
    { id: "connect", labelKey: "app.hostform.tab.connect" },
    { id: "ai", labelKey: "app.hostform.tab.ai" },
  ];
  let tab = $state<FormTab>("connect");
  let panelEl = $state<HTMLElement | null>(null);
  const aiSummary = $derived(dbAiSummary(aiShown));
  $effect(() => {
    if (tab && panelEl) panelEl.scrollTop = 0;
  });

  // 폼의 모든 칸을 읽어 따라간다 — 하나라도 바뀌면 테스트 칩을 지운다.
  $effect(() => {
    void JSON.stringify(dbPicker.form);
    noteConnFormChanged();
  });
  let testNow = $state(Date.now());
  const testRunning = $derived(connTestUi.state.phase.kind === "running");
  $effect(() => {
    if (!testRunning) return;
    testNow = Date.now();
    const timer = setInterval(() => (testNow = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const testChip = $derived(connTestChip(connTestUi.state.phase, testNow, (k, p) => t(k as Key, p)));

  const viaGroups = $derived.by(() => {
    const groups: { host: string; icon: string | null; conns: DbConn[] }[] = [];
    for (const d of pickerConns()) {
      const via = d.via;
      if (!via) continue;
      const g = groups.find((x) => sameAlias(x.host, via));
      if (g) g.conns.push(d);
      else groups.push({ host: via, icon: dbPicker.hosts.find((h) => sameAlias(h.name, via))?.icon ?? null, conns: [d] });
    }
    return groups.sort((a, b) => a.host.localeCompare(b.host));
  });
  const directConns = $derived(pickerConns().filter((d) => !d.via));

  $effect(() => {
    if (!dbPickerVisible()) return;
    const view = dbPicker.view;
    if (view === "form") tab = "connect";
    void tick().then(() => {
      if (view === "form") document.getElementById("dbp-name")?.focus();
      else modalEl?.focus();
    });
  });

  async function browse() {
    try {
      const picked = await openFileDialog({
        title: t("app.query.form.path.pick.title"),
        multiple: false,
        directory: false,
        filters: [
          { name: "SQLite", extensions: ["db", "sqlite", "sqlite3", "db3"] },
          { name: "*", extensions: ["*"] },
        ],
      });
      if (typeof picked === "string") {
        dbPicker.form.path = picked;
        if (dbPicker.form.name.trim() === "") dbPicker.form.name = picked.split(/[\\/]/).pop() ?? "";
      }
    } catch {
      // 대화상자를 못 열어도 직접 입력은 된다
    }
  }

  async function browseCa() {
    try {
      const picked = await openFileDialog({ title: t("app.query.form.ca.pick.title"), multiple: false, directory: false });
      if (typeof picked === "string") dbPicker.form.tlsCa = picked;
    } catch {
      // 위와 같다
    }
  }
</script>

{#snippet connRow(d: DbConn)}
  <div class="row" data-db-conn-row={d.id}>
    <button
      type="button"
      class="pick"
      aria-label={t("app.query.picker.open.aria", { name: d.name })}
      data-db-pick={d.id}
      onclick={() => pickDb(d)}
    >
      <HostIcon icon={DB_ENGINE_ICON[d.engine]} size={13} label={engineLabel(d.engine)} />
      <span class="nm">{d.name}</span>
      <span class="sub" title={d.path ?? undefined}>{connTargetText(d)}</span>
    </button>
    <button
      type="button"
      class="mini"
      aria-label={t("app.query.picker.edit.aria", { name: d.name })}
      title={t("app.query.picker.edit")}
      data-db-edit={d.id}
      onclick={() => startEditConn(d.id)}><UiIcon name="edit" size={12} /></button
    >
    <button
      type="button"
      class="mini"
      aria-label={t("app.query.picker.delete.aria", { name: d.name })}
      title={t("app.query.picker.delete")}
      data-db-delete={d.id}
      disabled={dbPicker.busy}
      onclick={() => void deleteConn(d.id)}><UiIcon name="close" size={12} /></button
    >
  </div>
{/snippet}

{#if dbPickerVisible()}
  <div class="overlay">
    <div
      class="modal glass-raised"
      class:form-modal={dbPicker.view === "form"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dbp-title"
      tabindex="-1"
      data-db-picker={dbPicker.view}
      bind:this={modalEl}
      onkeydown={(ev) => modalEl && trapTab(ev, modalEl)}
    >
      <NotePopover active={true} />
      <!-- 스크롤은 이 안쪽 칸이 한다 — 상자 자신이 스크롤하면 흐림 층(`.glass-raised::before`)이 밀려 밑동에 흐림이 빠진다 -->
      <div class="glass-scroll">
      {#if dbPicker.view === "list"}
        <h2 id="dbp-title">{t("app.query.picker.title")}</h2>
        <p class="lead">{t("app.query.picker.lead")}</p>
        {#each pickerWarnings() as w, i (i)}
          <p class="warn">{w}</p>
        {/each}

        <p class="section" id="dbp-hosts">{t("app.query.picker.hosts")}</p>
        <div class="list" role="group" aria-labelledby="dbp-hosts">
          {#if dbPicker.loading && viaGroups.length === 0}
            <p class="empty">{t("app.query.picker.loading")}</p>
          {:else if viaGroups.length === 0}
            <p class="empty">{t("app.query.picker.hosts.empty")}</p>
          {:else}
            {#each viaGroups as g (g.host)}
              <p class="group" data-db-via={g.host}>
                <HostIcon icon={g.icon} size={13} fallback="server" />
                <span class="nm">{g.host}</span>
              </p>
              {#each g.conns as d (d.id)}
                {@render connRow(d)}
              {/each}
            {/each}
          {/if}
        </div>

        <p class="section" id="dbp-local">{t("app.query.picker.local")}</p>
        <div class="list" role="group" aria-labelledby="dbp-local">
          {#if directConns.length === 0}
            <p class="empty">{t("app.query.picker.local.empty")}</p>
          {/if}
          {#each directConns as d (d.id)}
            {@render connRow(d)}
          {/each}
        </div>
        <button type="button" class="add" data-db-new onclick={startNewConn}
          ><UiIcon name="plus" size={13} />{t("app.query.picker.new")}</button
        >

        {#if dbPicker.error}
          <p class="error" role="alert">{dbPicker.error}</p>
        {/if}

        <div class="actions">
          <button type="button" class="ghost btn btn-secondary" onclick={closeDbPicker}>{t("app.actions.close")}</button>
        </div>
      {:else}
        <h2 id="dbp-title">{dbPicker.isNew ? t("app.query.form.title.new") : t("app.query.form.title.edit")}</h2>
        {#snippet leadNote()}{t("app.query.form.lead")}{/snippet}
        <p class="lead">
          <InfoNote id="dbp-lead" label={t("app.query.form.lead.aria")} note={leadNote} plain>
            {#snippet summary()}{t("app.query.form.lead.short")}{/snippet}
          </InfoNote>
        </p>
        <form onsubmit={(ev) => void submitConn(ev)}>
          <div class="form-body">
          <SectionNav tabs={SECTIONS} active={tab} onselect={(id) => (tab = id as FormTab)} />
          <div class="form-panel" bind:this={panelEl}>
          <section hidden={tab !== "connect"} data-db-form-tab="connect">
          <div class="fields">
            <label for="dbp-name">{t("app.query.form.field.name")}</label>
            <input id="dbp-name" bind:value={dbPicker.form.name} autocomplete="off" spellcheck="false" maxlength="64" />

            <label for="dbp-engine">{t("app.query.form.field.engine")}</label>
            <div class="narrow">
              <Dropdown id="dbp-engine" value={dbPicker.form.engine} options={engineItems} onchange={(e) => setConnEngine(e)} />
            </div>

            {#if dbPicker.form.engine === "sqlite"}
              <label for="dbp-path">{t("app.query.form.field.path")}</label>
              <div class="stack">
                <div class="with-btn">
                  <input id="dbp-path" bind:value={dbPicker.form.path} autocomplete="off" spellcheck="false" placeholder="C:\data\app.db" />
                  <!-- [찾아보기…] 는 메인 PC 의 파일 대화상자라 원격 창에는 없다 -->
                  {#if !isRemote}
                    <button type="button" class="btn btn-sm btn-secondary" onclick={() => void browse()}>{t("app.query.form.path.browse")}</button>
                  {/if}
                </div>
                <span class="note">{t("app.query.form.path.help")}</span>
              </div>
            {:else}
              <label for="dbp-via">{t("app.query.form.field.via")}</label>
              <div class="stack" data-db-via-field>
                <div class="narrow">
                  <Dropdown id="dbp-via" value={dbPicker.form.via ?? ""} options={viaItems} onchange={(v) => setConnVia(v || null)} />
                </div>
                <span class="note">{t(dbPicker.form.via ? "app.query.form.via.help.ssh" : "app.query.form.via.help.direct")}</span>
              </div>

              <label for="dbp-host">{t("app.query.form.field.host")}</label>
              <div class="stack">
                <input id="dbp-host" bind:value={dbPicker.form.host} autocomplete="off" spellcheck="false" placeholder="localhost" />
                <span class="note" data-db-host-help={dbPicker.form.via ? "ssh" : "direct"}
                  >{t(dbPicker.form.via ? "app.query.form.host.help.ssh" : "app.query.form.host.help")}</span
                >
              </div>

              <label for="dbp-port">{t("app.query.form.field.port")}</label>
              <input
                id="dbp-port"
                class="port"
                type="number"
                min="1"
                max="65535"
                bind:value={dbPicker.form.port}
                oninput={() => (dbPicker.form.portTouched = true)}
                placeholder={String(DB_DEFAULT_PORT[dbPicker.form.engine])}
              />

              <label for="dbp-db">{t("app.query.form.field.database")}</label>
              <input id="dbp-db" bind:value={dbPicker.form.database} autocomplete="off" spellcheck="false" placeholder={t("app.query.form.field.optional")} />

              <label for="dbp-user">{t("app.query.form.field.user")}</label>
              <input id="dbp-user" bind:value={dbPicker.form.user} autocomplete="off" spellcheck="false" placeholder={t("app.query.form.field.optional")} />

              <!-- 저장된 비밀번호는 받지 않는다 — 있으면 점 8개 자리표시뿐(길이도 드러나지 않음) · 비워 두면 그대로 -->
              <label for="dbp-pw">{t("app.query.form.field.password")}</label>
              <div class="stack">
                <input
                  id="dbp-pw"
                  type="password"
                  value={connPw.text}
                  oninput={(ev) => setConnPassword((ev.currentTarget as HTMLInputElement).value)}
                  autocomplete="new-password"
                  spellcheck="false"
                  placeholder={connPw.stored ? "••••••••" : t("app.query.form.field.optional")}
                  data-db-password
                  data-db-password-stored={connPw.stored ? "" : undefined}
                />
                <div class="pwsave" data-db-password-save>
                  <Toggle id="dbp-pw-save" bind:checked={connPw.save} />
                  <label for="dbp-pw-save">{t("app.query.form.password.save")}</label>
                </div>
              </div>

              <label for="dbp-tls">{t("app.query.form.field.tls")}</label>
              <div class="stack">
                <div class="narrow"><Dropdown id="dbp-tls" bind:value={dbPicker.form.tlsMode} options={tlsItems} /></div>
                {#if tlsWarn}
                  <span class="note tls-warn" role="note" data-db-tls-warn={tlsWarn}>{t(`app.query.form.tls.warn.${tlsWarn}`)}</span>
                {:else if tlsUnverified(dbPicker.form.tlsMode)}<span class="note">{t("app.query.form.tls.unverified")}</span>{/if}
              </div>

              {#if tlsNeedsCa(dbPicker.form.tlsMode)}
                <label for="dbp-ca">{t("app.query.form.field.ca")}</label>
                <div class="stack">
                  <div class="with-btn">
                    <input id="dbp-ca" bind:value={dbPicker.form.tlsCa} autocomplete="off" spellcheck="false" placeholder={t(tlsCaRequired(dbPicker.form.tlsMode) ? "app.query.form.field.required" : "app.query.form.field.optional")} />
                    {#if !isRemote}
                      <button type="button" class="btn btn-sm btn-secondary" onclick={() => void browseCa()}>{t("app.query.form.path.browse")}</button>
                    {/if}
                  </div>
                  {#if tlsCaRequired(dbPicker.form.tlsMode)}
                    <span class="note">{t("app.query.form.ca.help_ca")}</span>
                  {:else}
                    {#snippet caNote()}{t("app.query.form.ca.help")}{/snippet}
                    <span class="note">
                      <InfoNote id="dbp-ca-help" label={t("app.query.form.ca.help.aria")} note={caNote} plain>
                        {#snippet summary()}{t("app.query.form.ca.help.short")}{/snippet}
                      </InfoNote>
                    </span>
                  {/if}
                </div>
              {/if}
            {/if}
          </div>
          </section>

          <section hidden={tab !== "ai"} data-db-form-tab="ai">
          {#snippet aiNote()}
            <p class="pop-p">{t("app.dbai.note")}</p>
            <p class="pop-p">{t("app.dbai.account")}</p>
          {/snippet}
          <p class="section first" id="dbp-ai-label">
            <InfoNote id="dbp-ai" label={t("app.dbai.info.aria")} note={aiNote} plain>
              {#snippet summary()}{t("app.dbai.title")}{/snippet}
            </InfoNote>
          </p>
          <div class="ai-gauge">
            <AiGauge
              levels={DB_AI_LEVELS}
              value={aiShown}
              nameOf={(l) => t(DB_AI_NAME[l])}
              descOf={(l) => t(DB_AI_DESC[l])}
              labelledby="dbp-ai-label"
              itemAttr="level"
              data-db-ai={aiShown}
              onpick={(l) => void setConnAi(l)}
            />
          </div>
          <ul class="ai-sum" data-db-ai-sum>
            {#each aiSummary as row (row.key)}
              <li class:on={row.on}>
                <span class="ai-sum-mark" aria-label={row.on ? t("app.hostform.ai.sum.yes") : t("app.hostform.ai.sum.no")}
                  >{#if row.on}<UiIcon name="check" size={12} />{:else}–{/if}</span
                >{t(row.key)}
              </li>
            {/each}
          </ul>
          {#if aiReset}
            <p class="ai-desc warn" role="note" data-db-ai-reset>{t("app.dbai.target.changed")}</p>
          {:else if connAiBroken() && !dbPicker.aiTouched}
            <p class="ai-desc warn" role="note" data-db-ai-broken>{t("app.dbai.broken")}</p>
          {/if}
          {#if dbAiSendsRows(aiShown)}
            {#snippet rowsNote()}{t("app.dbai.rows.warn")}{/snippet}
            <p class="ai-desc warn" role="note" data-db-ai-rows>
              <InfoNote id="dbp-ai-rows" label={t("app.dbai.rows.aria")} note={rowsNote} tone="warn" plain>
                {#snippet summary()}{t("app.dbai.rows.short")}{/snippet}
              </InfoNote>
            </p>
          {/if}
          {#if aiShown === "approve" || aiShown === "all"}
            {#if aiShown === "approve"}
              {#snippet plansNote()}{t("app.dbai.approve.plans")}{/snippet}
              <p class="ai-desc">
                <InfoNote id="dbp-ai-plans" label={t("app.dbai.approve.aria")} note={plansNote} plain>
                  {#snippet summary()}{t("app.dbai.approve.short")}{/snippet}
                </InfoNote>
              </p>
            {/if}
            {#if dbAiServerReady() && !dbAiWritePlans()}
              <p class="ai-desc warn" role="note" data-db-ai-plans-outdated>{t("app.dbai.approve.restart")}</p>
            {/if}
          {/if}
          {#if aiShown !== "off"}
            <!-- 헤드리스 — 타일 없이 AI 가 볼트의 비밀번호로 이 연결을 여는 위임(SQLite 는 비밀번호 없이도 위임이다) -->
            <p class="section">{t("app.hostform.ai.headless.title")}</p>
            <div class="fields headless" data-db-headless>
              <label for="dbp-headless">{t(headlessBox.label)}</label>
              <div class="log-row">
                <Toggle
                  id="dbp-headless"
                  checked={headlessShown}
                  disabled={headlessBox.blocked}
                  onchange={(on) => setConnHeadless(on)}
                />
                {#snippet headlessNote()}{#each headlessBox.note as k (k)}<p class="pop-p">{t(k)}</p>{/each}{/snippet}
                <span class="field-note">
                  <InfoNote id="dbp-headless-note" label={t("app.dbai.headless.aria")} note={headlessNote} plain>
                    {#snippet summary()}{t(headlessBox.desc)}{/snippet}
                  </InfoNote>
                </span>
              </div>
            </div>
          {/if}
          {#if !dbAiServerReady()}
            <p class="ai-desc warn" role="note" data-db-ai-outdated>{t("app.dbai.server.outdated")}</p>
          {/if}
          </section>
          </div>
          </div>

          {#if dbPicker.formError}
            <p class="error" role="alert" data-db-form-error>{dbPicker.formError}</p>
          {/if}

          <div class="actions">
            {#if dbConnTestReady()}
              {#if testRunning}
                <button type="button" class="ghost btn btn-secondary test-btn" data-db-test-cancel onclick={cancelConnTest}
                  >{t("app.query.form.test.cancel")}</button
                >
              {:else}
                <button
                  type="button"
                  class="ghost btn btn-secondary test-btn"
                  aria-label={t("app.query.form.test.aria")}
                  data-db-test
                  disabled={dbPicker.busy}
                  onclick={() => void startConnTest()}><UiIcon name="sync" size={15} />{t("app.query.form.test")}</button
                >
              {/if}
              {#if testChip}
                <span
                  class="test-status {testChip.mark}"
                  title={testChip.detail}
                  data-tip-place="above"
                  data-db-test-chip={connTestUi.state.phase.kind}
                  role="status"
                >
                  <span class="test-dot" aria-hidden="true">
                    {#if testChip.mark === "spin"}<span class="test-spin"></span>
                    {:else if testChip.mark === "ok"}<UiIcon name="check" size={12} />
                    {:else if testChip.mark === "err"}<UiIcon name="close" size={12} />
                    {:else}–{/if}
                  </span>
                  <span class="test-label">{testChip.label}</span>
                </span>
              {/if}
            {/if}
            <span class="spacer"></span>
            <button
              type="button"
              class="ghost btn btn-secondary"
              disabled={dbPicker.busy}
              onclick={leaveConnForm}>{dbPicker.formOnly ? t("app.actions.cancel") : t("app.query.form.back")}</button
            >
            <button type="submit" class="primary btn btn-primary" disabled={dbPicker.busy} data-db-save>
              {dbPicker.busy ? t("app.query.form.saving") : t("app.query.form.save")}
            </button>
          </div>
        </form>
      {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--bg-overlay);
  }

  .modal {
    box-sizing: border-box;
    width: 100%;
    max-width: calc(480px + 2 * var(--space-4) + 2px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
    outline: none;
  }

  .glass-scroll {
    padding: var(--space-4);
  }

  /* 높이를 못 박는다 — 면마다 칸 수가 달라 면을 누를 때마다 상자가 늘었다 줄었다 하지 않게. 스크롤은 오른쪽 패널만 */
  .modal.form-modal {
    box-sizing: border-box;
    max-width: 680px;
    height: min(580px, calc(100vh - 32px));
  }

  .form-modal .glass-scroll {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    overflow: hidden;
  }

  .form-modal h2,
  .form-modal .lead {
    flex: 0 0 auto;
  }

  .form-modal form {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  .form-body {
    display: flex;
    gap: 12px;
    flex: 1 1 auto;
    min-height: 0;
    margin-bottom: 12px;
  }

  .form-panel {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    /* 포커스 링이 스크롤 자리에 잘리지 않게 안쪽을 비우고 바깥 여백으로 되돌린다. 4px = `.btn` 의 링(2px + 2px 틈) —
       줄이면 끝에 선 [찾아보기…]의 링이 잘린다(`scripts/dev/focus-ring-clip-harness.mjs --outside`) */
    padding: 4px;
    margin: -4px;
    container-type: inline-size;
  }

  .form-panel > section[hidden] {
    display: none !important;
  }

  @container (max-width: 380px) {
    .form-panel .fields {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-1) 0;
    }
  }

  .ai-sum {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: var(--space-2) 0 var(--space-3);
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

  .modal h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .lead {
    margin: 0 0 var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
  }

  .section {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
  }

  .section.first {
    margin-top: 0;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .fields.headless label {
    max-width: 14em;
    white-space: normal;
    line-height: 1.4;
    padding-top: calc((var(--field-height) - 1.4em) / 2);
  }

  .log-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
    min-height: var(--field-height);
  }

  .log-row :global(.toggle) {
    margin-top: calc((var(--field-height) - 24px) / 2);
  }

  .log-row > .field-note {
    padding-top: calc((var(--field-height) - 1.5em) / 2);
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

  .ai-gauge {
    margin-top: var(--space-2);
  }

  .ai-desc {
    margin: var(--space-2) 0 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .ai-desc.warn {
    color: var(--warn);
  }

  .pop-p {
    margin: 0;
  }

  .pop-p + .pop-p {
    margin-top: var(--space-2);
  }

  .empty,
  .warn {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .warn {
    color: var(--warn);
  }

  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: var(--space-1) 0 0;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  .pick {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 var(--space-2);
    font: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .pick:hover,
  .pick:focus-visible {
    background: var(--surface-hover);
    outline: none;
  }

  .nm {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    flex: 1 1 auto;
    min-width: 0;
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .mini {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    color: var(--fg-muted);
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .mini:hover,
  .mini:focus-visible {
    color: var(--fg);
    background: var(--surface-hover);
    outline: none;
  }

  .add {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: var(--space-1);
    padding: 4px var(--space-2);
    font: inherit;
    font-size: var(--t-sm);
    color: var(--fg-2);
    background: transparent;
    border: 1px dashed var(--line);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .add:hover,
  .add:focus-visible {
    color: var(--fg);
    border-color: var(--focus-border);
    outline: none;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  form .actions > .btn {
    height: 40px;
    padding: 0 22px;
    font-size: var(--t-sm);
    font-weight: 500;
  }

  form .actions {
    align-items: center;
    min-width: 0;
  }

  form .actions > .btn.test-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 16px;
  }

  .spacer {
    flex: 1 1 auto;
  }

  .test-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 auto;
    min-width: 0;
    padding: 2px 4px;
    border-radius: var(--radius-sm, 6px);
    font-size: var(--t-sm);
    font-weight: 600;
    white-space: nowrap;
    color: var(--fg-2);
    cursor: help;
  }

  .test-status.ok {
    color: var(--ok);
  }

  .test-status.err {
    color: var(--err);
  }

  .test-dot {
    display: grid;
    place-items: center;
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    font-weight: 700;
    color: var(--fg-2);
  }

  .test-status.ok .test-dot {
    color: var(--ok-soft);
    background: var(--ok);
  }

  .test-status.err .test-dot {
    color: var(--err-soft);
    background: var(--err);
  }

  .test-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .test-spin {
    flex: none;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border: 1.75px solid color-mix(in srgb, var(--accent) 28%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: db-test-spin 1s linear infinite;
  }

  @keyframes db-test-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .test-spin {
      animation: none;
    }
  }

  .fields {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
    gap: var(--space-2) var(--space-3);
  }

  .fields label {
    font-size: var(--t-sm);
    line-height: var(--field-height);
    color: var(--fg-2);
    white-space: nowrap;
  }

  /* 체크박스는 빼야 칸 모양(너비 100% · 높이 · 바탕)을 입지 않는다 */
  .fields input:not([type="checkbox"]) {
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

  .fields input:not([type="checkbox"]):hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .fields input:not([type="checkbox"]):focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .fields input::placeholder {
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

  .fields input.port {
    max-width: 120px;
  }

  .narrow {
    max-width: 220px;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .with-btn {
    display: flex;
    gap: var(--space-2);
    min-width: 0;
    align-items: center;
  }

  .with-btn input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .with-btn .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
  }

  .note {
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--fg-3);
  }

  .pwsave {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: var(--space-2);
    margin-top: 2px;
  }

  .fields .pwsave label {
    line-height: 1.4;
    cursor: pointer;
  }

  .note.tls-warn {
    color: var(--warn);
  }

  .error {
    margin: var(--space-3) 0 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-1);
    background: var(--err-soft);
    border-radius: var(--radius-sm);
    user-select: text;
  }
</style>

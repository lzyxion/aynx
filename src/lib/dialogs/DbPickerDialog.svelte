<script lang="ts">
  // DB 연결 고르기 — 목록(SSH 경유 = 호스트별 · 내 PC/직접) + DB 연결 폼(새로 · 편집 — 경유 칸). 값 · 여닫기 · 저장 · 삭제는
  // `app/query.svelte.ts` 의 `dbPicker`, Escape 사슬 · `anyModalOpen` 은 `app/keys`(폼 → 목록 → 닫기). 연결은 모두
  // `db-connections.json` 하나(10-13 저장 하나로). 독의 DB 칸 · 호스트 우클릭 "DB 연결 추가…" 는 이 모달의 **폼만** 연다
  // (`openConnForm` — `formOnly`: [목록으로] 대신 [취소], 저장 · Escape 가 닫는다). 삭제는 OS 확인 대화(`deleteConn`).
  // 폼 바닥 줄 왼쪽의 [연결 테스트] + 그 옆 칩 하나(목업 "A안 칩" — 규칙은 `query/conn-test`, 배선은 `startConnTest`). 칩은 바닥 줄 안에만
  // 서서 폼의 높이를 바꾸지 않는다 · 칸을 바꾸면 사라진다 · 판 27 세션 서버면 단추를 숨긴다(`dbConnTestReady`).
  import { tick } from "svelte";
  import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
  import Dropdown from "$lib/Dropdown.svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
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
  } from "$lib/app/query.svelte.js";

  let modalEl = $state<HTMLElement | null>(null);

  // 모달이 **닫히면** 떠 있던 ⓘ 팝오버도 닫는다(호스트 폼과 같은 규칙 — 칸은 모듈 상태라 떨어져 나간 ⓘ 를 붙든다).
  let wasVisible = false;
  $effect(() => {
    const now = dbPickerVisible();
    if (wasVisible && !now) closeNote();
    wasVisible = now;
  });

  const engineLabel = (e: DbEngine) => t(`app.query.engine.${e}` as Key);
  const engineItems = $derived(DB_ENGINES.map((value) => ({ value, label: engineLabel(value) })));
  const tlsItems = $derived(DB_TLS_MODES.map((value) => ({ value, label: t(`app.query.form.tls.${value}` as Key) })));
  // 경유 칸 — 없음(직접) + 호스트 목록(아이콘 · 별칭). 목록에 없는 경유(지워진 별칭)도 그 글자로 남겨 보인다.
  const viaItems = $derived.by(() => {
    const out: { value: string; label: string; icon?: string }[] = [{ value: "", label: t("app.query.form.via.none") }];
    const cur = dbPicker.form.via;
    if (cur && !dbPicker.hosts.some((h) => sameAlias(h.name, cur))) out.push({ value: cur, label: cur });
    for (const h of dbPicker.hosts) out.push({ value: h.name, label: h.name, icon: h.icon ?? undefined });
    return out;
  });
  // 직접 + 이 PC 밖 + 인증서를 확인하지 않는 모드 — 막지 않고 밝힌다(SSH 경유는 SSH 가 감싼다)
  const tlsWarn = $derived(directTlsWarning(dbPicker.form));

  // AI 권한 칸(쿼리 타일 3a) — 보이는 단계는 "대상이 바뀌었고 안 만졌으면 끔"(`connAiShown`). 세그먼트 버튼은 호스트 폼과 같은 꼴.
  const aiShown = $derived(connAiShown());
  /** 대상이 바뀌어 끔으로 되돌렸다(만지기 전 · 원래 끔이 아니었을 때) */
  const aiReset = $derived(connTargetChanged() && !dbPicker.aiTouched && dbPicker.ai !== "off");
  // 헤드리스 칸(2026-11-09) — 단계와 같은 "대상이 바뀌면 끔" 규칙(`connHeadlessShown`). 볼트가 없으면 켤 자리가 없다(켜진 것은 끌 수 있다).
  const headlessShown = $derived(connHeadlessShown());
  const vaultAbsent = $derived(vaultStatus().state === "absent");
  // 엔진에 맞춘 문구 · 볼트 조건(SQLite 는 볼트를 쓰지 않는다 — `dbHeadlessBox`).
  const headlessBox = $derived(dbHeadlessBox(dbPicker.form.engine, vaultAbsent, headlessShown));

  /**
   * **폼의 두 면**(2026-11-10 사용자 결정 — 목업 P89y9sHMVHGTt2x3uackJS B안): 호스트 · 프로젝트 폼과 같은 왼쪽 내비(`SectionNav`) +
   * 오른쪽 패널. [접속] = 연결 칸 · [AI 권한] = 게이지 · 할 수 있는 일 · 헤드리스. 헤드리스 줄이 붙으며 폼이 창보다 길어졌던 것을 나눈다.
   * 지난 면은 기억하지 않는다(폼을 열 때마다 [접속] — 포커스가 이름 칸에 간다).
   */
  type FormTab = "connect" | "ai";
  const SECTIONS: readonly { id: FormTab; labelKey: Key }[] = [
    { id: "connect", labelKey: "app.hostform.tab.connect" },
    { id: "ai", labelKey: "app.hostform.tab.ai" },
  ];
  let tab = $state<FormTab>("connect");
  let panelEl = $state<HTMLElement | null>(null);
  const aiSummary = $derived(dbAiSummary(aiShown));
  // 면을 갈면 패널의 맨 위부터(호스트 폼과 같다)
  $effect(() => {
    if (tab && panelEl) panelEl.scrollTop = 0;
  });

  // [연결 테스트] — 칸이 하나라도 바뀌면 칩을 지운다(폼의 모든 칸을 읽어 따라간다 · 비교는 `conn-test` 의 열쇠).
  $effect(() => {
    void JSON.stringify(dbPicker.form);
    noteConnFormChanged();
  });
  // 도는 동안만 1초마다 지난 초를 센다.
  let testNow = $state(Date.now());
  const testRunning = $derived(connTestUi.state.phase.kind === "running");
  $effect(() => {
    if (!testRunning) return;
    testNow = Date.now();
    const timer = setInterval(() => (testNow = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const testChip = $derived(connTestChip(connTestUi.state.phase, testNow, (k, p) => t(k as Key, p)));

  /** 목록 위쪽 — 경유 호스트별 묶음(별칭 순 · 대소문자 무시) */
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

  // 뜰 때 · 화면을 바꿀 때 — 목록이면 모달 뿌리, 폼이면 이름 칸
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
      <!-- ⓘ 설명 팝오버 한 벌(10-30 — 늘 보이는 설명은 한 줄 · 나머지는 ⓘ. 호스트 폼과 같은 `InfoNote` + `NotePopover`) -->
      <NotePopover active={true} />
      <!-- 스크롤은 이 안쪽 칸이 한다 — 글래스 흐림(`.glass-raised::before`)은 상자에 붙은 절대 위치 층이라, 상자 자신이 스크롤하면
           내용과 함께 밀려 올라가 밑동에 흐림이 빠진다(11-10 — 헤드리스 줄로 폼이 창보다 길어지며 드러남). -->
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
          <!-- 본문 = 왼쪽 내비 + 오른쪽 패널(호스트 · 프로젝트 폼과 같은 `SectionNav` · 같은 모양). 면은 `hidden` 으로만 숨긴다 -->
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
                  <button type="button" class="btn btn-sm btn-secondary" onclick={() => void browse()}>{t("app.query.form.path.browse")}</button>
                </div>
                <span class="note">{t("app.query.form.path.help")}</span>
              </div>
            {:else}
              <!-- 경유 — 없음(직접) 또는 호스트(그 호스트로 SSH 터널). SQLite 는 경유가 없어 칸이 숨는다 -->
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
                    <button type="button" class="btn btn-sm btn-secondary" onclick={() => void browseCa()}>{t("app.query.form.path.browse")}</button>
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
          <!--
            **AI 권한**(쿼리 타일 3a — docs/user/query-tile.md "Showing a database to the AI"). 단계 다섯(끔 · 구조만 · 읽기 전용 · 승인 후 실행 ·
            모두 승인(10-23 — 고르면 확인 상자)). 저장은 [저장] 이 연결을 쓴 뒤 `delegation.toml` 에(스냅샷은 Rust 가 계산). 대상이 바뀌면 끔으로 되돌려 보인다.
          -->
          <!-- 머리 한 줄 + ⓘ(무엇에 대한 권한인가 · 계정 권한 권고) — 위험 고지(행이 나감 · YOLO)는 아래에 늘 보인다 -->
          {#snippet aiNote()}
            <p class="pop-p">{t("app.dbai.note")}</p>
            <p class="pop-p">{t("app.dbai.account")}</p>
          {/snippet}
          <p class="section first" id="dbp-ai-label">
            <InfoNote id="dbp-ai" label={t("app.dbai.info.aria")} note={aiNote} plain>
              {#snippet summary()}{t("app.dbai.title")}{/snippet}
            </InfoNote>
          </p>
          <!-- 게이지(10-23 — `AiGauge.svelte`): 호스트 폼과 같은 고르개. 고르는 규칙(모두 승인 확인 상자)은 `setConnAi` 그대로 -->
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
          <!-- 할 수 있는 일(2026-11-10 — 호스트 폼의 `.ai-sum` 과 같은 모양 · 단계 누적) -->
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
            <!-- 위험 고지 — 늘 보이는 한 줄(짧게) · 긴 권고는 ⚠ 팝오버 -->
            {#snippet rowsNote()}{t("app.dbai.rows.warn")}{/snippet}
            <p class="ai-desc warn" role="note" data-db-ai-rows>
              <InfoNote id="dbp-ai-rows" label={t("app.dbai.rows.aria")} note={rowsNote} tone="warn" plain>
                {#snippet summary()}{t("app.dbai.rows.short")}{/snippet}
              </InfoNote>
            </p>
          {/if}
          {#if aiShown === "approve" || aiShown === "all"}
            <!-- "사람이 승인해야 실행 · 자동 승인 없음" 안내는 승인 후 실행만 — 모두 승인의 뜻은 게이지 설명 상자가 말한다 -->
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
            <!--
              **헤드리스**(2026-11-09 — 호스트 폼의 "헤드리스" 상자와 같은 모양): 타일 없이 AI 가 볼트의 비밀번호로 이 연결을 여는 위임.
              단계와 따로인 칸 · 같은 저장(`db_ai_set` 의 `headless`). AI 권한이 끔이면 숨긴다. SQLite 도 있다(2026-11-09 — 비밀번호가
              없어도 타일 없이 AI 가 여는 것은 위임 · 문구는 엔진에 맞춘다). 볼트가 없으면 비밀번호 엔진은 켤 자리가 없다(호스트 폼의
              `vault.absent` 처럼) — SQLite 는 볼트를 쓰지 않아 켤 수 있다.
            -->
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
                <!-- 설명은 한 줄 · 나머지(볼트 잠김 · 꺼져도 타일이 있으면 됨)는 ⓘ 안(2026-11-10 — 설명이 길다는 사용자 판단) -->
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
              <!-- [연결 테스트] — 도는 동안은 [취소](화면에서만 버린다 · [저장] 은 그대로 쓸 수 있다) -->
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
                <!-- 결과 — 면 없는 글자 상태(목업 "D", 2026-11-09): 작은 동그란 표식 + 색 글자 · 상세는 말풍선(호버 · 포커스)뿐 -->
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
    max-width: calc(480px + 2 * var(--space-4) + 2px); /* 옛 content-box 너비 그대로 — 안쪽 여백(스크롤 칸) · 테두리를 더함 */
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
    outline: none;
  }

  /* 스크롤 칸(공용 `.glass-scroll` — theme.css) — 흐림 층은 바깥 상자에 그대로 서 있고 이 안쪽만 움직인다(위 마크업 주석) */
  .glass-scroll {
    padding: var(--space-4);
  }

  /*
    폼 화면 — 호스트 · 프로젝트 폼과 같은 틀(2026-11-10): 왼쪽 내비 150px 을 보태 넓히고 **높이를 못 박는다**(면마다 칸 수가 달라
    면을 누를 때마다 상자가 늘었다 줄었다 하지 않게). 스크롤은 오른쪽 패널만 맡는다 — 바깥 칸(`.glass-scroll`)은 늘어나는 세로 스택.
  */
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

  /* 본문: 좌 내비 | 우 패널 (`HostForm` 의 `.host-body` · `.host-panel` 과 같은 값) */
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
    /* 포커스 링(2px + 1px 틈)이 스크롤 자리에 잘리지 않을 만큼 안쪽을 비우고, 바깥 여백으로 되돌려 칸 자리는 그대로 둔다 */
    padding: 3px;
    margin: -3px;
    container-type: inline-size;
  }

  .form-panel > section[hidden] {
    display: none !important;
  }

  /* 좁은 패널 — 라벨을 입력 위로 올린다(호스트 · 프로젝트 폼의 같은 규칙과 한 벌) */
  @container (max-width: 380px) {
    .form-panel .fields {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-1) 0;
    }
  }

  /* 할 수 있는 일 — 호스트 폼의 `.ai-sum` 과 같은 값 */
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

  /* 면의 첫 머리 — 패널 맨 위에 빈 줄을 두지 않는다 */
  .section.first {
    margin-top: 0;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* 헤드리스 상자 — 호스트 폼의 `.log-row` · `.field-note` 와 같은 꼴(라벨 열 · 스위치 + 옆 설명). 라벨이 길어 줄바꿈을 허용한다 */
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

  /* AI 권한 — 호스트 폼과 같은 게이지(`AiGauge.svelte` — 10-23). 여기서는 둘레 간격만 */
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

  /* ⓘ 팝오버 안 문단(이 모달이 넘긴 스니펫 — 팝오버 상자는 `NotePopover` 가 그린다) */
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

  /* 폼 바닥의 [취소 · 뒤로] · [저장] — 설정 모달 바닥과 같은 크기(40px). 목록 화면의 [닫기]는 `<form>` 밖이라 그대로 */
  form .actions > .btn {
    height: 40px;
    padding: 0 22px;
    font-size: var(--t-sm);
    font-weight: 500;
  }

  /* 바닥 줄 — 왼쪽 [연결 테스트] · 칩, 빈칸, 오른쪽 [뒤로/취소] · [저장]. 칩은 이 줄 안에서만 줄어든다(폼 높이를 바꾸지 않는다) */
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

  /* 결과 — 면 없는 글자 상태(목업 D). 바닥 줄의 덩어리는 단추 셋 그대로, 결과는 정보라 단추처럼 보이지 않게 */
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
    /* 위 정렬 — 라벨은 항목의 **첫 줄** 이름이다 (`HostForm` 과 한 벌) */
    align-items: start;
    gap: var(--space-2) var(--space-3);
  }

  /* 첫 줄(칸 높이)의 가운데 — `nowrap` 이라 줄 간격이 벌어질 일이 없다 */
  .fields label {
    font-size: var(--t-sm);
    line-height: var(--field-height);
    color: var(--fg-2);
    white-space: nowrap;
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

  .fields input:focus-visible {
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

  /* 경로 칸 옆 [찾아보기] — 칸과 같은 높이, 글자 · 여백은 전역 `.btn` 값 */
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

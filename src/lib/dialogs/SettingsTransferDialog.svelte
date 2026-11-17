<script lang="ts">
  // **설정 옮기기 모달** — 내보내기(범주 카드 2열 격자 → 저장 대화상자 → zip 한 장)와 가져오기(미리 보기 표 — 범주 하나 = 한 행
  // "항목 | 무엇이 바뀌나 | 할 일" · 아직 아무것도 안 바꿈 → 백업 뒤 들이기) 두 얼굴(2026-11-17 사용자 목업). 상태 · 명령은
  // `app/settings-transfer.svelte.ts`, 순서 · 개수 · '할 일' 규칙은 순수 `$lib/settings-transfer`. 설정 › 일반의 [내보내기…] · [가져오기…]
  // 단추와 팔레트가 연다 — 메뉴가 없어 menu-runner 통로가 필요 없다.
  // 모양: 글래스 모달 규칙은 `TermThemeDialog` 를 베끼고(스코프 — dialogs/ 규약), 고르기는 설정의 이어 붙은 묶음 `ChoiceChips`
  // (`.opt-chips` 규칙이 `.settings-view` 아래에만 걸려 감싸개를 둔다 — settings.css) · 칩은 `StatusChip` · `WarnChip`.
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import { trapTab } from "$lib/focus-trap";
  import UiIcon from "$lib/UiIcon.svelte";
  import StatusChip from "$lib/settings/StatusChip.svelte";
  import WarnChip from "$lib/settings/WarnChip.svelte";
  import ChoiceChips, { type ChoiceEntry } from "$lib/settings/ChoiceChips.svelte";
  import {
    applySettingsImport,
    closeTransferDialog,
    repickProjectFolder,
    runSettingsExport,
    toggleExportCategory,
    transferDialog as d,
  } from "$lib/app/settings-transfer.svelte.js";
  import {
    NEVER_INCLUDED,
    changeCount,
    defaultExportName,
    exportBytes,
    exportOrder,
    formatBytes,
    importOrder,
    itemDisplay,
    numberDuplicates,
    statusCounts,
    todoKind,
    unchanged,
    unresolvedFolders,
    type Conflict,
    type PreviewCategory,
  } from "$lib/settings-transfer";

  let modalEl = $state<HTMLElement | null>(null);

  const pickedSet = $derived(new Set(d.picked));
  const exportSize = $derived(exportBytes(d.summary, pickedSet));
  const exportCards = $derived(exportOrder(d.summary));
  const rows = $derived(d.preview ? importOrder(d.preview.categories) : []);
  const total = $derived(d.preview ? changeCount(d.preview, d.picks, d.aiMode) : 0);
  const head = $derived(statusCounts(d.preview?.categories.flatMap((c) => c.items) ?? []));
  const fileName = $derived(d.path.split(/[\\/]/).pop() ?? d.path);
  const hasAi = $derived(rows.some((r) => r.id === "ai" && !unchanged(r)));

  const AI_ENTRIES: readonly ChoiceEntry[] = [
    ["asIs", "settings.transfer.ai.asIs"],
    ["off", "settings.transfer.ai.off"],
  ];

  $effect(() => {
    if (!d.mode) return;
    queueMicrotask(() => {
      const first = modalEl?.querySelector<HTMLElement>("[data-autofocus]") ?? modalEl;
      first?.focus();
    });
  });

  /*
   * **변경 항목 팝오버**(2026-11-17 사용자 — 행 안 펼침 + 작은 스크롤이 지저분했다). [변경 항목 보기] 를 누르면 그 링크 아래에
   * 떠서 행 높이를 바꾸지 않는다. 한 번에 하나 · 바깥 누름 · Esc · 표 스크롤이면 닫힌다. 모달은 글래스(`backdrop-filter`)라
   * `fixed` 의 기준 상자가 모달 자신이 되므로 처음부터 **모달 기준 좌표**로 앉힌다(`.modal` 은 `position: relative`).
   * 아래 공간이 모자라면 링크 위로 뒤집는다. 모양은 설정 ⓘ 팝오버(`NotePopover`)의 바탕 · 선 · 그림자 토큰을 따른다.
   */
  const ITEMS_MAX_H = 220;
  let itemsFor = $state<string | null>(null);
  let itemsPos = $state<{ left: number; top: number | null; bottom: number | null; maxH: number }>({
    left: 0,
    top: 0,
    bottom: null,
    maxH: ITEMS_MAX_H,
  });

  function toggleItems(id: string, ev: MouseEvent): void {
    if (itemsFor === id) {
      itemsFor = null;
      return;
    }
    if (!modalEl) return;
    const a = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const m = modalEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.left - m.left, m.width - 320 - 8));
    const below = m.bottom - a.bottom - 12;
    const above = a.top - m.top - 12;
    itemsPos =
      below >= Math.min(ITEMS_MAX_H, 160) || below >= above
        ? { left, top: a.bottom - m.top + 4, bottom: null, maxH: Math.min(ITEMS_MAX_H, below) }
        : { left, top: null, bottom: m.bottom - a.top + 4, maxH: Math.min(ITEMS_MAX_H, above) };
    itemsFor = id;
  }

  function onModalMousedown(ev: MouseEvent): void {
    if (!itemsFor) return;
    const el = ev.target as HTMLElement | null;
    if (el?.closest("[data-items-pop], [data-items-toggle]")) return;
    itemsFor = null;
  }

  // 모달이 닫히거나 미리 보기가 바뀌면 팝오버도 닫는다
  $effect(() => {
    if (!d.mode || !d.preview) itemsFor = null;
  });

  const itemsCat = $derived(itemsFor ? (rows.find((r) => r.id === itemsFor) ?? null) : null);

  /** 팝오버 줄 — 바뀌는 항목만, 보이는 이름(같은 이름은 번호) */
  const itemsShown = $derived.by(() => {
    if (!itemsCat) return [];
    const items = itemsCat.items.filter((i) => i.status !== "same");
    const names = numberDuplicates(
      items.map((item) => {
        const s = itemDisplay(item);
        return [s.key ? t(s.key as Key) : null, s.detail].filter(Boolean).join(" · ");
      }),
    );
    return items.map((item, i) => ({ item, name: names[i]! }));
  });

  function onKeydown(ev: KeyboardEvent): void {
    if (modalEl && trapTab(ev, modalEl)) return;
    ev.stopPropagation();
    if (ev.code === "Escape") {
      ev.preventDefault();
      // 팝오버가 떠 있으면 그것만 닫는다(모달은 다음 Esc)
      if (itemsFor) {
        itemsFor = null;
        return;
      }
      closeTransferDialog();
    }
  }

  const catName = (id: string) => t(`settings.transfer.cat.${id}` as Key);
  const catDesc = (id: string) => t(`settings.transfer.cat.${id}.desc` as Key);

  function conflictEntries(cat: PreviewCategory): ChoiceEntry[] {
    return cat.choices.map((c) => [c, `settings.transfer.conflict.${c}` as Key] as const);
  }

  /** '무엇이 바뀌나' 의 한 줄 사실 */
  function fact(cat: PreviewCategory): string {
    if (cat.id === "hosts") return t("settings.transfer.import.hosts");
    if (cat.id === "appearance") return t("settings.transfer.import.appearance");
    if (cat.id === "projects" && cat.missingFolders.length > 0) {
      return t("settings.transfer.projects.missing", { n: String(unresolvedFolders(cat, d.remap)) });
    }
    return catDesc(cat.id);
  }

  function exportedWhen(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
  }

  function setConflict(id: string, c: string): void {
    const p = d.picks[id];
    if (p) d.picks[id] = { ...p, conflict: c as Conflict };
  }

  function setOn(id: string, on: boolean): void {
    const p = d.picks[id];
    if (p) d.picks[id] = { ...p, on };
  }
</script>

{#if d.mode}
  <div
    class="overlay overlay-fade"
    role="presentation"
    onmousedown={(ev) => {
      if (ev.target === ev.currentTarget) closeTransferDialog();
    }}
  >
    <div
      class="modal glass-raised modal-rise"
      class:wide={d.mode === "import"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-transfer-title"
      tabindex="-1"
      data-settings-transfer={d.mode}
      bind:this={modalEl}
      onkeydown={onKeydown}
      onmousedown={onModalMousedown}
    >
      <div class="glass-scroll" onscroll={() => (itemsFor = null)}>
        {#if d.mode === "export"}
          <h2 id="settings-transfer-title">{t("settings.transfer.export.title")}</h2>
          <ul class="cards" aria-label={t("settings.transfer.export.title")}>
            {#each exportCards as cat (cat.id)}
              <li class="card" class:dim={cat.count === 0}>
                <label class="card-head">
                  <input
                    type="checkbox"
                    checked={pickedSet.has(cat.id)}
                    disabled={cat.count === 0 || d.busy}
                    onchange={(e) => toggleExportCategory(cat.id, e.currentTarget.checked)}
                  />
                  <span class="card-name">{catName(cat.id)}</span>
                  <span class="card-count">{t("settings.transfer.count", { n: String(cat.count) })}</span>
                </label>
                <p class="card-desc">{catDesc(cat.id)}</p>
              </li>
            {/each}
          </ul>
          <div class="never">
            <span class="never-label"><UiIcon name="lock" size={12} />{t("settings.transfer.never.label")}</span>
            {#each NEVER_INCLUDED as id (id)}
              <StatusChip tone="info">{t(`settings.transfer.never.${id}` as Key)}</StatusChip>
            {/each}
          </div>
          {#if d.error}<p class="wrong" role="alert">{d.error}</p>{/if}
          <div class="actions">
            <span class="foot">{defaultExportName()} · {t("settings.transfer.export.size", { size: formatBytes(exportSize) })}</span>
            <button type="button" class="btn btn-secondary" onclick={closeTransferDialog} disabled={d.busy}>
              {t("settings.transfer.cancel")}
            </button>
            <button
              type="button"
              class="btn btn-primary primary"
              data-autofocus
              onclick={() => void runSettingsExport()}
              disabled={d.busy || d.picked.length === 0}
            >
              {t("settings.transfer.export.save")}
            </button>
          </div>
        {:else}
          <div class="head">
            <div class="head-text">
              <h2 id="settings-transfer-title">{t("settings.transfer.import.title")}</h2>
              {#if d.preview}
                <p class="sub" title={exportedWhen(d.preview.exportedAt)}>
                  {fileName} · {t("settings.transfer.import.source", { version: d.preview.appVersion || "?" })}
                </p>
              {/if}
            </div>
            {#if d.preview}
              <div class="head-chips">
                <StatusChip tone="ok">{t("settings.transfer.status.new", { n: String(head.new) })}</StatusChip>
                <StatusChip tone="warn">{t("settings.transfer.status.changed", { n: String(head.changed) })}</StatusChip>
                <StatusChip tone="idle">{t("settings.transfer.status.same", { n: String(head.same) })}</StatusChip>
              </div>
            {/if}
          </div>

          {#if d.preview}
            <div class="table" role="table" aria-label={t("settings.transfer.import.title")}>
              <div class="tr th" role="row">
                <span role="columnheader">{t("settings.transfer.col.item")}</span>
                <span role="columnheader">{t("settings.transfer.col.what")}</span>
                <span role="columnheader">{t("settings.transfer.col.todo")}</span>
              </div>
              {#each rows as cat (cat.id)}
                {@const c = statusCounts(cat.items)}
                {@const pick = d.picks[cat.id]}
                {@const todo = todoKind(cat)}
                {@const off = unchanged(cat)}
                <div class="tr" class:dim={off} role="row" data-transfer-cat={cat.id}>
                  <div class="td item" role="cell">
                    <label class="item-label-wrap">
                      <input
                        type="checkbox"
                        checked={pick?.on ?? false}
                        disabled={d.busy || off}
                        onchange={(e) => setOn(cat.id, e.currentTarget.checked)}
                      />
                      <span class="item-name">{catName(cat.id)}</span>
                    </label>
                  </div>
                  <div class="td what" role="cell">
                    <div class="what-line">
                      {#if c.new}<StatusChip tone="ok">{t("settings.transfer.status.new", { n: String(c.new) })}</StatusChip>{/if}
                      {#if c.changed}<StatusChip tone="warn">{t("settings.transfer.status.changed", { n: String(c.changed) })}</StatusChip>{/if}
                      {#if c.same}<StatusChip tone="idle">{t("settings.transfer.status.same", { n: String(c.same) })}</StatusChip>{/if}
                      {#if cat.items.some((i) => i.note === "command")}
                        <WarnChip label={t("settings.transfer.note.command")} detail={t("settings.transfer.note.command.detail")} />
                      {/if}
                      <span class="fact" class:warn={cat.id === "projects" && unresolvedFolders(cat, d.remap) > 0} title={fact(cat)}>{fact(cat)}</span>
                    </div>
                    {#if cat.id === "projects" && cat.missingFolders.length > 0}
                      <ul class="folders">
                        {#each cat.missingFolders as m (m.id)}
                          <li>
                            <span class="folder-name">{m.name}</span>
                            <span class="folder-path" title={d.remap[m.id] ?? m.path}>{d.remap[m.id] ?? m.path}</span>
                            <!-- 폴더 고르기 — 그림만(이름은 말풍선 · aria-label) -->
                            <button
                              type="button"
                              class="icon-btn"
                              disabled={d.busy}
                              title={t("settings.transfer.projects.repick")}
                              aria-label={t("settings.transfer.projects.repick")}
                              onclick={() => void repickProjectFolder(m.id)}
                            >
                              <UiIcon name="folder-open" size={14} />
                            </button>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                    {#if !off}
                      <button
                        type="button"
                        class="link items-toggle"
                        data-items-toggle
                        aria-expanded={itemsFor === cat.id}
                        aria-controls="transfer-items-pop"
                        onclick={(ev) => toggleItems(cat.id, ev)}
                      >
                        <!-- 위아래 화살표 대신 목록 그림 하나 — 열림은 링크 바탕(알약)으로 보인다 -->
                        <UiIcon name="list" size={13} />
                        {t("settings.transfer.items.show")}
                      </button>
                    {/if}
                  </div>
                  <div class="td todo" role="cell">
                    {#if cat.id === "ai" && !off}
                      <div class="settings-view">
                        <ChoiceChips
                          id="transfer-ai-mode"
                          label={catName("ai")}
                          entries={AI_ENTRIES}
                          value={d.aiMode}
                          disabled={d.busy || !pick?.on}
                          onpick={(v) => (d.aiMode = v === "off" ? "off" : "asIs")}
                        />
                      </div>
                    {/if}
                    {#if todo === "segment"}
                      <!-- AI 행은 위에 모드 묶음이 이미 있어 둘째 묶음의 뜻("값이 다르면")을 앞에 적는다 -->
                      <div class="settings-view" class:with-label={cat.id === "ai"}>
                        {#if cat.id === "ai"}<span class="todo-label">{t("settings.transfer.conflict.label")}</span>{/if}
                        <ChoiceChips
                          id={`transfer-conflict-${cat.id}`}
                          label={t("settings.transfer.conflict.label")}
                          entries={conflictEntries(cat)}
                          value={pick?.conflict ?? "overwrite"}
                          disabled={d.busy || !pick?.on}
                          onpick={(v) => setConflict(cat.id, v)}
                        />
                      </div>
                    {:else if cat.id !== "ai" || off}
                      <span class="todo-text">{t(`settings.transfer.todo.${todo}` as Key)}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
            {#if hasAi}
              <p class="note">{d.aiMode === "asIs" ? t("settings.transfer.ai.asIs.note") : t("settings.transfer.ai.off.note")}</p>
            {/if}
          {:else if d.busy}
            <p class="sub">{t("settings.transfer.import.reading")}</p>
          {/if}
          {#if d.error}<p class="wrong" role="alert">{d.error}</p>{/if}
          <div class="actions">
            {#if d.preview}<span class="foot">{t("settings.transfer.import.backup")}</span>{/if}
            <button type="button" class="btn btn-secondary" onclick={closeTransferDialog} disabled={d.busy}>
              {t("settings.transfer.cancel")}
            </button>
            <button
              type="button"
              class="btn btn-primary primary"
              data-autofocus
              onclick={() => void applySettingsImport()}
              disabled={d.busy || !d.preview || total === 0}
            >
              {t("settings.transfer.import.apply", { n: String(total) })}
            </button>
          </div>
        {/if}
      </div>
      {#if itemsCat}
        <div
          id="transfer-items-pop"
          class="items-pop"
          data-items-pop
          role="group"
          aria-label={catName(itemsCat.id)}
          style:left="{itemsPos.left}px"
          style:top={itemsPos.top === null ? null : `${itemsPos.top}px`}
          style:bottom={itemsPos.bottom === null ? null : `${itemsPos.bottom}px`}
          style:max-height="{itemsPos.maxH}px"
        >
          <ul>
            {#each itemsShown as { item, name } (item.key)}
              <li>
                <span class="item-label" title={item.label}>{name}</span>
                <span class="item-status {item.status}">{t(`settings.transfer.item.${item.status}` as Key)}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* `.overlay`·`.modal`·`.wrong`·`.actions` 는 `TermThemeDialog` 의 규칙을 베껴 둔다(스코프 — dialogs/ 규약) */
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
    position: relative; /* 변경 항목 팝오버(`.items-pop`)의 기준 상자 */
    box-sizing: border-box;
    width: 760px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden; /* 스크롤은 안쪽 `.glass-scroll`(theme.css) — 높이를 넘을 때만 */
    container-type: inline-size;
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }

  .modal.wide {
    width: 880px;
  }

  .glass-scroll {
    padding: var(--space-4);
  }

  .modal h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  /* ── 내보내기 — 범주 카드 2열 격자(좁으면 1열) ── */
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .card {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-field);
    border-radius: var(--radius-surface-inner);
  }

  .card.dim,
  .tr.dim {
    opacity: 0.5;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-sm);
    color: var(--fg-1);
  }

  .card-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--fw-semibold);
  }

  .card-count {
    margin-left: auto;
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-3);
  }

  /* 설명은 짧은 한 줄이라 말줄임 · 말풍선 없이 그대로 보인다(좁으면 줄바꿈) */
  .card-desc {
    margin: 2px 0 0;
    line-height: 1.4;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .never {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-surface-inner);
  }

  .never-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-right: var(--space-1);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* ── 가져오기 — 머리 + 표(범주 하나 = 한 행) ── */
  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .head-text {
    flex: 1 1 auto;
    min-width: 0;
  }

  .head-text h2 {
    margin-bottom: var(--space-1);
  }

  .head-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .sub {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .table {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-surface-inner);
    background: var(--surface-field);
    overflow: hidden;
  }

  .tr {
    display: grid;
    grid-template-columns: 210px minmax(0, 1fr) 220px;
    grid-template-areas: "item what todo";
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--line);
  }

  .tr.th {
    border-top: none;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* '할 일' 머리글은 칸 값(오른쪽 정렬)과 같은 쪽에 선다 */
  .tr.th > :nth-child(3) {
    justify-self: end;
  }

  .td.item {
    grid-area: item;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--t-sm);
    color: var(--fg-1);
  }

  .item-label-wrap {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .item-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--fw-semibold);
  }

  .td.what {
    grid-area: what;
    min-width: 0;
  }

  .td.todo {
    grid-area: todo;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-1);
  }

  .what-line {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }

  .fact {
    min-width: 0;
    margin-left: var(--space-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .fact.warn {
    color: var(--warn);
  }

  .todo-text {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .settings-view.with-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .todo-label {
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: var(--t-xs);
    color: var(--accent);
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  /* 폴더 고르기 — 할 일이 남은 자리라 강조색으로 채운 동그라미(2026-11-17 사용자: 빈 그림은 눈에 띄지 않았다) */
  .icon-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-pill, 999px);
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
  }

  .icon-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 86%, var(--on-accent));
  }

  .icon-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .items-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 2px 0 0 -6px;
    padding: 1px 6px;
    border-radius: var(--radius-pill, 999px);
  }

  /* 열림 — 화살표를 뒤집는 대신 링크에 알약 바탕을 깐다 */
  .items-toggle[aria-expanded="true"] {
    background: var(--accent-soft);
    color: var(--on-accent-soft);
    text-decoration: none;
  }

  /* 변경 항목 팝오버 — 설정 ⓘ 팝오버(`NotePopover`)와 같은 바탕 · 선 · 둥글기 · 그림자 */
  .items-pop {
    position: absolute;
    z-index: 2;
    box-sizing: border-box;
    width: 320px;
    overflow-y: auto;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface-inner, var(--radius-surface));
    box-shadow: var(--shadow-raised);
  }

  .items-pop ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .folders {
    list-style: none;
    margin: var(--space-1) 0 0;
    padding: 0;
    max-height: 120px;
    overflow: auto;
  }

  .items-pop li,
  .folders li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-xs);
  }

  .item-label,
  .folder-path {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
  }

  /* 경로는 제 길이만 — [폴더 고르기…] 가 경로 바로 뒤에 붙는다(칸 끝으로 밀리지 않게) */
  .folder-path {
    flex: 0 1 auto;
    font-family: var(--font-mono);
    color: var(--fg-3);
  }

  .folder-name {
    color: var(--fg-1);
  }

  .item-status.new {
    color: var(--ok);
  }

  .item-status.changed {
    color: var(--warn);
  }

  .note {
    margin: var(--space-3) 0 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
    background: var(--surface-field);
    border-radius: var(--radius-surface-inner);
  }

  .foot {
    margin-right: auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .wrong {
    margin: var(--space-2) 0 0;
    font-size: var(--t-sm);
    color: var(--err);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  /* 좁은 창 — 카드 1열 · 행은 두 줄(항목 + 할 일 / 무엇이 바뀌나) · 머리 행 숨김 */
  @container (max-width: 600px) {
    .cards {
      grid-template-columns: minmax(0, 1fr);
    }

    .tr {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "item todo"
        "what what";
    }

    .tr.th {
      display: none;
    }

    .head {
      flex-direction: column;
    }
  }
</style>

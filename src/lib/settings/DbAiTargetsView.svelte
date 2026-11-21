<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import AiGaugeMini from "$lib/AiGaugeMini.svelte";
  import SettingsSubView from "$lib/settings/SettingsSubView.svelte";
  import CredentialsFilter from "$lib/settings/CredentialsFilter.svelte";
  import InfoNote from "$lib/settings/InfoNote.svelte";
  import { dbAiViews, removeDbAiBlock } from "$lib/app/db-ai.svelte.js";
  import { DB_AI_LEVELS, DB_AI_NAME, type DbAiView } from "$lib/db-ai";
  import { openConnForm } from "$lib/app/query.svelte.js";
  import { dbAiNeedsCleanup, filterDbAiTargets } from "$lib/settings/credentials-view";

  /**
   * AI 권한 DB 연결 — 설정 › 보안의 하위 화면(`delegation.toml` 의 `[[database]]`). 보고 지우기만 한다 — 바꾸는 자리는 DB 연결 폼의 AI 칸이다.
   * 스냅샷 값은 화면에 오지 않는다(맞는지만 — `identityOk`).
   */
  let { onback }: { onback: () => void } = $props();

  let query = $state("");
  let filter = $state<"all" | "cleanup">("all");

  let confirmDbRemove = $state<string | null>(null);
  let dbRemoving = $state<string | null>(null);
  let dbAiError = $state<string | null>(null);

  function dbRowName(v: DbAiView): string {
    return v.name ?? v.id;
  }

  async function removeDbRow(id: string): Promise<void> {
    if (confirmDbRemove !== id) {
      confirmDbRemove = id;
      return;
    }
    confirmDbRemove = null;
    dbRemoving = id;
    dbAiError = null;
    try {
      await removeDbAiBlock(id);
    } catch (e) {
      dbAiError = t("settings.credentials.delegation.remove.failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      dbRemoving = null;
    }
  }

  const all = $derived(dbAiViews());
  const chips = $derived([
    { key: "all", label: t("settings.credentials.filter.all"), n: all.length },
    { key: "cleanup", label: t("settings.credentials.filter.cleanup"), n: all.filter(dbAiNeedsCleanup).length },
  ]);
  const rows = $derived(filterDbAiTargets(all, query, filter === "cleanup"));
</script>

{#snippet dbNote()}{t("settings.credentials.dbai.note")}{/snippet}

<SettingsSubView
  title={t("settings.credentials.dbai.label")}
  back={t("settings.credentials.back")}
  backAria={t("settings.credentials.back.aria")}
  {onback}
>
  <p class="hint cred-note">
    <InfoNote id="db-ai-note" label={t("settings.credentials.dbai.note.aria")} note={dbNote} plain>
      {#snippet summary()}{t("settings.credentials.dbai.note.short")}{/snippet}
    </InfoNote>
  </p>

  {#if all.length === 0}
    <p class="hint">{t("settings.credentials.dbai.empty")}</p>
  {:else}
    <CredentialsFilter
      bind:query
      placeholder={t("settings.credentials.dbai.search.ph")}
      {chips}
      value={filter}
      onpick={(k) => (filter = k as "all" | "cleanup")}
    />
    {#if rows.length === 0}
      <p class="hint">{t("settings.credentials.search.none")}</p>
    {:else}
      <ul class="cred-list grant-list" data-db-ai-table aria-label={t("settings.credentials.dbai.label")}>
        {#each rows as v (v.id)}
          {@const orphan = !v.connKnown}
          {@const broken = v.connKnown && !v.identityOk}
          {@const on = v.headless && !orphan && !broken}
          {@const name = dbRowName(v)}
          <li class:orphan={orphan || broken} data-db-ai-row={v.id}>
            <span class="head">
              <span class="target" title={v.id}>{name}</span>
              {#if orphan}
                <span
                  class="warn"
                  role="note"
                  title={t("settings.credentials.dbai.orphan.title")}
                  data-tip-place="above"
                  aria-label={`${t("settings.credentials.dbai.orphan")}: ${t("settings.credentials.dbai.orphan.title")}`}
                  >{t("settings.credentials.dbai.orphan")}</span
                >
              {:else}
                {#if broken}
                  <span
                    class="warn"
                    role="note"
                    title={t("settings.credentials.dbai.broken.title")}
                    data-tip-place="above"
                    aria-label={`${t("settings.credentials.dbai.broken")}: ${t("settings.credentials.dbai.broken.title")}`}
                    >{t("settings.credentials.dbai.broken")}</span
                  >
                {/if}
                <button
                  type="button"
                  class="btn btn-sm btn-secondary"
                  title={t("settings.credentials.dbai.edit.title", { name })}
                  onclick={() => void openConnForm({ id: v.id })}
                >
                  {t("settings.credentials.dbai.edit")}
                </button>
              {/if}
              <button
                type="button"
                class="btn btn-sm btn-secondary danger"
                disabled={dbRemoving === v.id}
                aria-label={t("settings.credentials.dbai.remove.aria", { name })}
                onclick={() => void removeDbRow(v.id)}
              >
                {confirmDbRemove === v.id
                  ? t("settings.credentials.delegation.remove.confirm")
                  : t("settings.credentials.delegation.remove")}
              </button>
            </span>
            <span class="grants">
              <span
                class="gchip stage"
                class:on={!orphan && !broken}
                data-stage={v.level}
                title={t("settings.credentials.delegation.stage.title", { stage: t(DB_AI_NAME[v.level]) })}
                ><AiGaugeMini at={orphan || broken ? 0 : DB_AI_LEVELS.indexOf(v.level)} />{t(DB_AI_NAME[v.level])}</span
              >
              <!-- 헤드리스 칩은 엔진 무관 · 고아 줄도 세운다 — 파일의 칸이다 -->
              <span
                class="gchip"
                class:on
                data-db-ai-headless={on}
                title={t(on ? "settings.credentials.delegation.grant.on" : "settings.credentials.delegation.grant.off", {
                  grant: t("settings.credentials.delegation.grant.connect"),
                })}>{t("settings.credentials.delegation.grant.connect")}</span
              >
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#if dbAiError}
    <p class="cred-error" role="alert">{dbAiError}</p>
  {/if}
</SettingsSubView>

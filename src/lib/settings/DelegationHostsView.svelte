<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import AiGaugeMini from "$lib/AiGaugeMini.svelte";
  import SettingsSubView from "$lib/settings/SettingsSubView.svelte";
  import CredentialsFilter from "$lib/settings/CredentialsFilter.svelte";
  import { delegationTargetViews, removeDelegation } from "$lib/app/delegation.svelte.js";
  import { openEditByAlias } from "$lib/app/hosts.svelte.js";
  import { AI_STAGES, AI_STAGE_NAME, stageOf, type DelegationTargetView } from "$lib/delegation";
  import { filterDelegationTargets, isOrphanHost } from "$lib/settings/credentials-view";

  /**
   * AI 권한 호스트 — 설정 › 보안의 하위 화면(`~/.aynx/delegation.toml`, docs/log/2026-09-21-fleet-delegation-ui.md).
   * 보고 지우기만 한다 — 바꾸는 자리는 호스트 폼의 AI 칸과 원격 타일 머리줄의 권한 팝오버다(둘 다 `delegation_set_target` 한 길 — 신원 스냅샷은 Rust 가 계산한다).
   * 이 표의 권한은 헤드리스만이 아니라 그 호스트의 창 타일에도 걸린다(`$lib/delegation` 머리말).
   */
  let {
    onback,
    filter = $bindable("all"),
  }: {
    onback: () => void;
    filter?: "all" | "cleanup";
  } = $props();

  let query = $state("");

  let confirmRemove = $state<string | null>(null);
  /** 그 줄의 버튼만 재운다 — 표 전체를 재우면 다른 줄을 못 만진다 */
  let removing = $state<string | null>(null);
  let delegationError = $state<string | null>(null);

  /** 단계 하나 + 헤드리스 둘(접속 · 볼트 암호구) — 헤드리스는 단계와 다른 축이다 */
  const HEADLESS = [
    { key: "connect", label: "settings.credentials.delegation.grant.connect" },
    { key: "vault", label: "settings.credentials.delegation.grant.vault" },
  ] as const;

  /** 화면의 이름(`vault`)과 계약의 이름(`vault_passphrase`)을 편다 */
  function headlessOn(target: DelegationTargetView, key: (typeof HEADLESS)[number]["key"]): boolean {
    return key === "vault" ? target.vault_passphrase : target.connect;
  }

  /** 한 번 더 누르면 지운다 — 다른 줄을 누르면 앞의 확인은 물러난다 */
  async function removeRow(alias: string): Promise<void> {
    if (confirmRemove !== alias) {
      confirmRemove = alias;
      return;
    }
    confirmRemove = null;
    removing = alias;
    delegationError = null;
    try {
      await removeDelegation(alias);
    } catch (e) {
      delegationError = t("settings.credentials.delegation.remove.failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      removing = null;
    }
  }

  /** 목록을 못 읽었으면 조용히 아무 일도 하지 않는다 */
  async function editHost(alias: string): Promise<void> {
    await openEditByAlias(alias, "ai");
  }

  const all = $derived(delegationTargetViews());
  const cleanupN = $derived(all.filter(isOrphanHost).length);
  const chips = $derived([
    { key: "all", label: t("settings.credentials.filter.all"), n: all.length },
    { key: "cleanup", label: t("settings.credentials.filter.cleanup"), n: cleanupN },
  ]);
  const rows = $derived(filterDelegationTargets(all, query, filter === "cleanup"));
</script>

<SettingsSubView
  title={t("settings.credentials.delegation.label")}
  back={t("settings.credentials.back")}
  backAria={t("settings.credentials.back.aria")}
  {onback}
>
  <!-- `delegation-orphans` 는 부팅 고아 알림이 가리키는 anchor 다 -->
  <p class="hint cred-note" id="delegation-orphans">{t("settings.credentials.delegation.note")}</p>

  {#if all.length === 0}
    <p class="hint">{t("settings.credentials.delegation.empty")}</p>
  {:else}
    <CredentialsFilter
      bind:query
      placeholder={t("settings.credentials.delegation.search.ph")}
      {chips}
      value={filter}
      onpick={(k) => (filter = k as "all" | "cleanup")}
    />
    {#if rows.length === 0}
      <p class="hint">{t("settings.credentials.search.none")}</p>
    {:else}
      <ul class="cred-list grant-list" aria-label={t("settings.credentials.delegation.label")}>
        {#each rows as target (target.alias)}
          {@const orphan = isOrphanHost(target)}
          {@const stage = stageOf(target)}
          <li class:orphan>
            <span class="head">
              <span class="target" title={target.alias}>{target.alias}</span>
              {#if orphan}
                <span
                  class="warn"
                  role="note"
                  title={t("settings.credentials.delegation.orphan.title")}
                  data-tip-place="above"
                  aria-label={`${t("settings.credentials.delegation.orphan")}: ${t("settings.credentials.delegation.orphan.title")}`}
                  >{t("settings.credentials.delegation.orphan")}</span
                >
              {:else}
                <button
                  type="button"
                  class="btn btn-sm btn-secondary"
                  title={t("settings.credentials.delegation.edit.title", { alias: target.alias })}
                  onclick={() => void editHost(target.alias)}
                >
                  {t("settings.credentials.delegation.edit")}
                </button>
              {/if}
              <button
                type="button"
                class="btn btn-sm btn-secondary danger"
                disabled={removing === target.alias}
                aria-label={t("settings.credentials.delegation.remove.aria", { alias: target.alias })}
                onclick={() => void removeRow(target.alias)}
              >
                {confirmRemove === target.alias
                  ? t("settings.credentials.delegation.remove.confirm")
                  : t("settings.credentials.delegation.remove")}
              </button>
            </span>
            <!-- 꺼진 칩도 그린다 — 자리가 고정이라야 줄끼리 눈으로 비교된다 -->
            <span class="grants">
              <span
                class="gchip stage"
                class:on={stage !== "off"}
                data-stage={stage}
                title={t("settings.credentials.delegation.stage.title", { stage: t(AI_STAGE_NAME[stage]) })}
                ><AiGaugeMini at={AI_STAGES.indexOf(stage)} />{t(AI_STAGE_NAME[stage])}</span
              >
              {#each HEADLESS as g (g.key)}
                {@const on = headlessOn(target, g.key)}
                <span
                  class="gchip"
                  class:on
                  title={t(
                    on
                      ? "settings.credentials.delegation.grant.on"
                      : "settings.credentials.delegation.grant.off",
                    { grant: t(g.label) },
                  )}>{t(g.label)}</span
                >
              {/each}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#if delegationError}
    <p class="cred-error" role="alert">{delegationError}</p>
  {/if}
</SettingsSubView>

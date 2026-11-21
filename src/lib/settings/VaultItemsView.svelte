<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";
  import UiIcon from "$lib/UiIcon.svelte";
  import SettingsSubView from "$lib/settings/SettingsSubView.svelte";
  import CredentialsFilter from "$lib/settings/CredentialsFilter.svelte";
  import {
    deleteAllVaultItems,
    deleteVaultItem,
    vaultBusy,
    vaultConfirmAll,
    vaultError,
    vaultItems,
  } from "$lib/app/vault.svelte.js";
  import type { VaultItem } from "$lib/vault";
  import { dbVaultLabels } from "$lib/db-conn";
  import { dbConns } from "$lib/app/db-conns.svelte.js";
  import {
    filterVaultItems,
    groupVaultItems,
    vaultKindCounts,
    VAULT_KIND_LABEL,
    type VaultKind,
  } from "$lib/settings/credentials-view";

  /**
   * 볼트 값은 여기 오지 않는다 — 목록이 아는 것은 종류와 대상뿐(`vault_list`)이고 할 수 있는 일은 지우는 것뿐이다(담는 길은 접속 모달의 체크 하나).
   * 잠긴 볼트는 섹션의 들어가기 관문이 막으므로 여기에는 잠김 갈래가 없다.
   */
  let { onback }: { onback: () => void } = $props();

  let query = $state("");
  let kind = $state<VaultKind | "all">("all");

  /** 볼트에는 DB 연결 id 만 있다(이름 · 경유를 바꿔도 같은 열쇠) — 이름은 `db-connections.json` 사본에서 찾는다 */
  const dbLabels = $derived(dbVaultLabels(dbConns(), t("settings.credentials.db.direct")));

  function kindLabel(k: VaultKind): string {
    return t(VAULT_KIND_LABEL[k]);
  }

  /** 암호구의 대상은 키 경로 — `.ssh` 부터 잘라 `~` 로 접는다(전체는 말풍선에) */
  function targetText(item: VaultItem): string {
    if (item.kind === "db_password") return dbLabels.get(item.target) ?? item.target;
    if (item.kind !== "key_passphrase") return item.target;
    const m = /[\\/]\.ssh[\\/].*$/.exec(item.target);
    return m ? `~${m[0].replaceAll("\\", "/")}` : item.target;
  }

  const counts = $derived(vaultKindCounts(vaultItems()));
  const chips = $derived([
    { key: "all", label: t("settings.credentials.filter.all"), n: vaultItems().length },
    ...counts.map((c) => ({ key: c.kind, label: kindLabel(c.kind), n: c.n })),
  ]);
  // 고른 종류가 지워져 칩이 사라지면 전체로 — 빈 목록에 칩만 눌린 채 남지 않게
  const pick = $derived(kind !== "all" && !counts.some((c) => c.kind === kind) ? "all" : kind);
  const groups = $derived(groupVaultItems(filterVaultItems(vaultItems(), query, pick, targetText)));
</script>

<SettingsSubView
  title={t("settings.credentials.items.label")}
  back={t("settings.credentials.back")}
  backAria={t("settings.credentials.back.aria")}
  {onback}
>
  {#if vaultItems().length === 0}
    <p class="hint">{t("settings.credentials.items.empty")}</p>
  {:else}
    <CredentialsFilter
      bind:query
      placeholder={t("settings.credentials.items.search.ph")}
      {chips}
      value={pick}
      onpick={(k) => (kind = k as VaultKind | "all")}
    />
    {#if groups.length === 0}
      <p class="hint">{t("settings.credentials.search.none")}</p>
    {/if}
    {#each groups as g (g.kind)}
      <h5 class="cred-group-head" id="vault-group-{g.kind}">{kindLabel(g.kind)} {g.items.length}</h5>
      <ul class="cred-list" aria-labelledby="vault-group-{g.kind}">
        {#each g.items as item (item.kind + "\u0000" + item.target)}
          <li>
            <span class="mark" title={kindLabel(item.kind)}>
              <UiIcon
                name={item.kind === "host_password" || item.kind === "db_password" ? "lock" : "key"}
                size={13}
              />
            </span>
            <span class="target" title={item.target}>{targetText(item)}</span>
            <button
              type="button"
              class="btn btn-sm btn-secondary danger"
              disabled={vaultBusy()}
              aria-label={t("settings.credentials.items.delete.aria", {
                kind: kindLabel(item.kind),
                target: item.target,
              })}
              onclick={() => void deleteVaultItem(item)}
            >
              {t("settings.credentials.items.delete")}
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}

  {#if vaultItems().length > 0}
    <div class="cred-actions">
      <!-- 확인은 버튼 라벨이 그 자리에서 바뀌는 것이다 -->
      <button
        type="button"
        class="btn btn-sm btn-secondary danger"
        disabled={vaultBusy() || isRemote}
        title={isRemote ? t("settings.remote.homeOnly") : undefined}
        onclick={() => void deleteAllVaultItems()}
      >
        {vaultConfirmAll()
          ? t("settings.credentials.items.deleteAll.confirm")
          : t("settings.credentials.items.deleteAll")}
      </button>
    </div>
  {/if}

  {#if vaultError()}
    <p class="cred-error" role="alert">{vaultError()}</p>
  {/if}
</SettingsSubView>

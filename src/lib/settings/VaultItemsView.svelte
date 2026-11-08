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
   * **저장된 항목** — 설정 › 보안의 하위 화면(2026-10-21 — 요약의 [관리 ›] 이 연다. 움직임 · Escape · 돌아온 뒤 포커스는
   * `CredentialsSection` 이 맡는다).
   *
   * **값은 여기 오지 않는다**. 목록이 아는 것은 종류와 대상뿐이고(`vault_list`), 할 수 있는 일은 지우는 것뿐이다
   * (담는 길은 접속 모달의 체크 하나). 위에서부터: 찾기 칸 + 종류 칩(전체 · 있는 종류, 개수) → 종류별 묶음(머리 = 이름 +
   * 개수, 줄 = 그림 · 대상 · [삭제]) → [모두 삭제] · 실패 한 줄. 줄의 [삭제] 는 옛 판 그대로 확인 없이 지운다. 잠긴 볼트는 섹션의
   * 들어가기 관문이 막으므로 여기에는 잠김 갈래가 없다.
   * 상태와 목록은 섹션이 볼 때마다 다시 읽는다(`CredentialsSection` 의 `$effect`) — 여기는 그 사본을 그릴 뿐이다.
   */
  let { onback }: { onback: () => void } = $props();

  let query = $state("");
  let kind = $state<VaultKind | "all">("all");

  /**
   * DB 비밀번호 대상(연결 id) → **"경유 호스트 · 연결 이름"**(직접이면 "직접 · 이름"). 볼트에는 id 만 있어(이름 · 경유를 바꿔도 같은
   * 열쇠) 이름은 `db-connections.json` 사본에서 찾는다 — 섹션이 볼 때마다 한 번 다시 읽는다(볼트 목록과 같은 박자). 못 찾으면 id 그대로다.
   */
  const dbLabels = $derived(dbVaultLabels(dbConns(), t("settings.credentials.db.direct")));

  function kindLabel(k: VaultKind): string {
    return t(VAULT_KIND_LABEL[k]);
  }

  /**
   * 대상 표기 — 비밀번호는 별칭 그대로, 암호구는 **경로**다.
   *
   * 경로는 기기마다 길어서 홈 접두사를 `~` 로 접는다. 홈 경로를 따로 묻지 않고 `.ssh` 부터
   * 잘라 내는 이유는, 이 자리에서 필요한 것이 "어느 키인가" 뿐이고 그 답은 언제나 뒤쪽
   * 두어 조각에 있기 때문이다 (전체는 말풍선에 그대로 있다).
   */
  function targetText(item: VaultItem): string {
    // DB 비밀번호의 대상은 연결 id — 경유 호스트(또는 직접) · 연결 이름으로 보인다(못 찾으면 id 그대로).
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
  <!-- 잠긴 볼트는 여기 오지 않는다 — 섹션의 들어가기 관문이 막고, 보는 중에 잠기면 관문으로 돌아간다 -->
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
            <!-- 자물쇠(서버의 비밀번호) ↔ 열쇠(내 디스크의 키 파일) — 그림이 종류를 가른다 -->
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
      <!-- 확인은 **버튼 라벨이 그 자리에서 바뀌는 것**이다 ("복원 정보 지우기" 와 같은 규칙) -->
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

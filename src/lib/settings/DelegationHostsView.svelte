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
   * **AI 권한 호스트** — 설정 › 보안의 하위 화면(2026-10-21 — 요약의 [관리 ›] 이 연다. 부팅의 고아 알림 [설정 열기] 도
   * 여기로 곧장 오고 그때는 [정리 필요] 칩이 눌려 있다 — `filter`). `~/.aynx/delegation.toml` 에 적힌 대상 목록
   * (docs/log/2026-09-21-fleet-delegation-ui.md).
   *
   * 앞선 판에서는 이 목록이 **관제판의 위임 탭**이었다. 관제판이 답하는 질문은 "지금 무엇이
   * 돌고 있나" 인데 위임은 **설정**이라, 아직 안 붙은 줄이 세션 목록의 바닥을 늘 차지했다.
   * 볼트와 같은 층이라 보안으로 왔다 — 둘 다 "앱이 사람 없이 쓰는 권한" 이다.
   *
   * 이 표가 할 수 있는 일은 **보는 것과 지우는 것**뿐이다. 바꾸는 자리는 호스트 폼의
   * AI 칸과 원격 타일 머리줄의 권한 팝오버이고(둘 다 `delegation_set_target` 한 길 — 신원 스냅샷을
   * Rust 가 그 길에서 계산한다), 여기 [호스트 설정…]은 그 AI 칸으로 가는 문이다. 2026-10-07 부터
   * 이 표의 권한은 헤드리스만이 아니라 그 호스트의 **창 타일**에도 걸린다(`$lib/delegation` 머리말).
   * 표는 섹션이 볼 때마다 다시 읽는다(`CredentialsSection` 의 `$effect`).
   */
  let {
    onback,
    filter = $bindable("all"),
  }: {
    onback: () => void;
    /** 고른 칩 — 섹션이 쥔다([관리 ›] 은 전체로, 고아 알림은 정리 필요로 연다) */
    filter?: "all" | "cleanup";
  } = $props();

  let query = $state("");

  /** 지금 [제거]를 한 번 눌러 확인을 기다리는 별칭 (`null` = 없음) — 볼트의 "모두 삭제" 와 같은 문법 */
  let confirmRemove = $state<string | null>(null);
  /** 지우는 중인 별칭 — 그 줄의 버튼만 재운다(표 전체를 재우면 다른 줄을 못 만진다) */
  let removing = $state<string | null>(null);
  let delegationError = $state<string | null>(null);

  /**
   * 줄의 칩 — **단계 하나 + 헤드리스 묶음 둘** (2026-10-07). 단계는 누적 넷(끔 · 읽기 전용 · 승인 후
   * 실행 · 자동 승인 실행)이라 칩 하나로 아이콘+이름을 말하고(`stageOf`), 헤드리스 둘(접속 · 볼트
   * 암호구)은 단계와 다른 축이라 따로 선다. 옛 판의 다섯 칩(읽기·접속·볼트·작업안·무인 실행)이 했던
   * 일이 이 셋이다.
   */
  const HEADLESS = [
    { key: "connect", label: "settings.credentials.delegation.grant.connect" },
    { key: "vault", label: "settings.credentials.delegation.grant.vault" },
  ] as const;

  /** 헤드리스 칩이 켜져 있는가 — 화면의 이름(`vault`)과 계약의 이름(`vault_passphrase`)을 편다 */
  function headlessOn(target: DelegationTargetView, key: (typeof HEADLESS)[number]["key"]): boolean {
    return key === "vault" ? target.vault_passphrase : target.connect;
  }

  /**
   * [제거] — **한 번 더 누르면** 지운다 (볼트의 "모두 삭제" 와 같은 확인 문법: 대화상자를
   * 띄우지 않고 그 자리에서 버튼 글자가 바뀐다). 다른 줄을 누르면 앞의 확인은 물러난다.
   */
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

  /**
   * [호스트 설정…] — 그 호스트의 폼을 **AI 칸**으로 연다(권한 단계와 헤드리스 묶음이 거기 있다).
   *
   * 별칭만으로는 폼을 못 채운다(`openEdit` 은 병합된 `HostEntry` 를 받는다) — 목록을 그
   * 자리에서 읽어 찾는다. 고아 줄에는 이 단추가 없으므로 못 찾는 일은 사실상 없지만,
   * 목록을 못 읽었으면 조용히 아무 일도 하지 않는다(설정 화면은 그대로 남는다).
   */
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
  <!--
    이름 밑 설명(옛 판의 이름 툴팁 글자) — 하위 화면에서는 제목이 이름이라 설명을 한 줄로 편다.
    `delegation-orphans` 는 부팅 고아 알림이 가리키는 anchor 다(`CredentialsSection.expandForAnchor` 가 이 화면을 [정리 필요]로 연다).
  -->
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
          <!-- 줄 하나가 **두 단**이다: 위는 별칭과 손잡이(고아면 그 자리에 경고 한 마디), 아래는 권한 칩 셋(단계 · 헤드리스 둘) -->
          <li class:orphan>
            <span class="head">
              <span class="target" title={target.alias}>{target.alias}</span>
              {#if orphan}
                <!-- 영영 붙지 않는 줄 — 경고 톤으로 한 마디, 자세한 말은 말풍선에 -->
                <span class="warn" title={t("settings.credentials.delegation.orphan.title")}
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
            <!--
              단계 칩 하나 + 헤드리스 칩 둘 — 켜진 것은 판, 꺼진 것은 저채도. **꺼진 칩도 그린다**: 자리가
              고정이라야 줄끼리 눈으로 비교된다(빈 자리는 "여긴 뭐였더라" 가 된다).
            -->
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

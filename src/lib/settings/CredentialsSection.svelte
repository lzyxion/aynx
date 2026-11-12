<script lang="ts">
  import { tick } from "svelte";
  import { settings, setIdleLockMin } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";
  import UiIcon from "$lib/UiIcon.svelte";
  import TipName, { tipOf } from "$lib/settings/TipName.svelte";
  import StateRow from "$lib/settings/StateRow.svelte";
  import SettingRow from "$lib/settings/SettingRow.svelte";
  import ValueSlider from "$lib/settings/ValueSlider.svelte";
  import { comboText } from "$lib/settings/combo";
  import SubViewStack from "$lib/settings/SubViewStack.svelte";
  import VaultItemsView from "$lib/settings/VaultItemsView.svelte";
  import DelegationHostsView from "$lib/settings/DelegationHostsView.svelte";
  import DbAiTargetsView from "$lib/settings/DbAiTargetsView.svelte";
  import "$lib/settings/credentials.css";
  import {
    cancelDeleteAll,
    openMasterPrompt,
    refreshVault,
    unlockVault,
    vaultBusy,
    vaultItems,
    vaultStatus,
    verifyMasterPrompt,
  } from "$lib/app/vault.svelte.js";
  import { delegationTargetViews, refreshDelegationTargets } from "$lib/app/delegation.svelte.js";
  import { reloadDbConns } from "$lib/app/db-conns.svelte.js";
  import { dbAiViews, refreshDbAi } from "$lib/app/db-ai.svelte.js";
  import {
    dbAiNeedsCleanup,
    isOrphanHost,
    vaultStateView,
    vaultKindCounts,
    DELEGATION_ORPHANS_ANCHOR,
    VAULT_KIND_LABEL,
  } from "$lib/settings/credentials-view";

  /**
   * **보안** 섹션 — 볼트 한 묶음: 상태 · 마스터 암호 · 저장된 자격증명 · AI 권한 표 둘
   * (화면의 이름만 보안이다 — 섹션 id · 키 앞가지 · 파일 이름은 `credentials` 로 둔다)
   * (docs/log/2026-09-19-vault.md ③, 2026-09-19 밤에 **일반에서 떨어져 나왔다**).
   *
   * ③에서는 이 묶음이 일반의 마지막 소제목이었다. 그때는 줄이 넷이라 소제목 하나로 족했는데,
   * 자동 잠금 칸이 프라이버시 줄로 접히면서(저녁) 남은 셋이 전부 **비밀을 다루는 일**이 됐다 —
   * 언어·시작 동작과 층이 다르고, 접속 모달의 곁말이 "설정 › …에서 마스터 암호를 둘 수
   * 있습니다" 로 가리키는 곳도 여기다. 내비 한 칸이면 그 가리킴이 글자 그대로 길이 된다.
   *
   * **자리는 내비 맨 아래, 혼자 한 묶음**이다 (2026-09-30 — `settings-index.ts` 의 `SETTINGS_SECTIONS`,
   * docs/log/2026-09-30-settings-nav-order.md): 비밀을 다루는 일은 한 번 정해 두면 드물게 연다.
   *
   * ## 요약과 하위 화면 (2026-10-21)
   *
   * 저장된 항목 · AI 권한 호스트 · AI 권한 DB 연결이 한 화면에 펼쳐져 있어 항목이 늘면 끝없이 길어졌다. 이제 본문은
   * **요약**이다 — 머리말 · 상태 줄 · 마스터 암호 줄은 그대로 서고, 목록 셋은 줄 하나씩(이름 + 짧은 요약 + [관리 ›])으로 접힌다.
   * [관리 ›] 이 그 목록의 하위 화면(`VaultItemsView` · `DelegationHostsView` · `DbAiTargetsView` — 찾기 칸 · 거르기 칩 ·
   * 옛 판의 줄 그대로)을 연다. 문법은 자동 승인(`AutomationSection`)과 같다: `SubViewStack` 이 미끄러지고 Escape 는
   * 요약으로만 가며, 돌아오면 그 화면을 연 [관리 ›] 에 포커스가 선다. 섹션이 안 보이게 되면(다른 섹션 · 모달 닫힘)
   * 확인 상태를 거두고 요약으로 돌아간다. 설정 색인의 목록 줄 셋은 요약의 [관리 ›] 을 가리킨다.
   *
   * ## 들어가기 관문 (2026-10-21 — 사용자 결정)
   *
   * 보안은 **들어갈 때마다** 잠금 해제를 거친다: 섹션이 보이게 될 때마다 요약 · 하위 화면 대신 관문 카드가 선다. 통과 조건은
   * 볼트 상태에 따라 셋이다 — 잠김이면 잠금 해제 모달(`unlockVault` — 접속 관문과 같은 모달), 열림 + 마스터면 마스터 **확인**
   * (`verifyMasterPrompt` — 서버 op `vault_verify_master`, 상태를 바꾸지 않는다 · 원격 관문 재확인과 같은 op), 마스터가 없거나
   * 볼트가 없으면 단추 한 번(지킬 비밀이 없음을 카드가 그대로 말한다). 통과는 **화면 상태뿐**이라 저장하지 않고, 섹션이 안 보이게
   * 되거나(다른 섹션 · 모달 닫힘) 통과 중 볼트가 잠기면(가림막 · 창 0개) 다시 관문이다. 딥링크(설정 색인 · 고아 알림)는
   * 관문 뒤로 미뤘다가 통과하면 그 자리로 간다. 이것은 **자리를 비운 사이 남이 앉은 경우**를 위한 확인이지 같은 계정의 프로세스를
   * 막는 경계가 아니다(볼트 위협 모델 그대로).
   *
   * ## 여기 있는 손잡이는 [저장]·[취소] 바깥이다 (끝의 무입력 자동 잠금 한 칸만 빼고)
   *
   * 설정 화면의 다른 값은 미리보기 계약을 탄다(고르면 화면에 걸리고 파일에는 [저장]이 쓴다).
   * 이 섹션은 그 예외다 — 무입력 자동 잠금(`settings.toml` 의 값이라 계약을 그대로 탄다)을 빼면, 마스터 걸기·항목 지우기는 누르는 즉시 디스크를 바꾸고
   * 되돌릴 [취소]가 없다(일반의 "복원 정보 지우기" 와 같은 부류). 상태 줄의 툴팁이 그 사실을
   * 말하고, 배선은 전부 `app/vault.svelte.ts` 에 있다.
   *
   * ## 잠금 = 가림막 하나 (2026-10-21 — 사용자 결정)
   *
   * 볼트는 프라이버시 가림막과 같은 시점에 잠기고, 가림막을 걷는 것이 곧 볼트를 여는 것이다(docs/log/2026-09-19-vault.md 의
   * "가림막과 함께 잠긴다"). 그래서 사용자에게 잠금은 **가림막 하나**다 — 예전 상태 줄의 [잠그기] · [잠금 해제…](화면은 열어
   * 둔 채 볼트만 잠그는 길)는 걷었다. 무인 접속만 막고 싶으면 그 손잡이는 볼트가 아니라 호스트 AI 권한과 '볼트의 키 암호구
   * 사용'(호스트 폼의 AI 칸)이다. 잠그는 시점을 정하는 칸은 **무입력 자동 잠금** 하나뿐이고, 2026-11-12 부터 이 섹션의 끝에
   * 선다(옛 자리 = 일반 › 프라이버시 · 줄 id `lock-idle` 그대로 — 가림막이 곧 볼트 잠금이라 docs/invariants.md 2절). 머리말이
   * 가림막 단축키(`toggle-veil` 의 지금 조합)와 함께 그 줄로 내려가는 길을 준다. 상태 줄은 단추 없이 **글자 안내**로 남는다 —
   * 볼트의 등급(마스터 없음 = 이 PC 의 내 계정)은 화면이 늘 밝혀야 하는 사실이다.
   */

  /**
   * 이 설정 화면이 지금 **보이는 활성 화면**인가 — 볼트 상태를 언제 읽을지 · 요약으로 돌아갈지를 가른다
   * (`McpSection` 과 같은 규칙). 다른 섹션을 보는 동안 디스크를 묻지 않는다.
   */
  let { active = false }: { active?: boolean } = $props();

  // ── 요약 ↔ 하위 화면(저장된 항목 · AI 권한 호스트 · AI 권한 DB 연결) — 화면 상태, 저장하지 않는다 ──
  type Sub = "items" | "hosts" | "db";
  let view = $state<"summary" | Sub>("summary");
  /** 들어오는 화면이 어느 쪽에서 미끄러져 오나 — 처음 그릴 때는 움직이지 않는다 */
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  /** 하위 화면을 연 [관리 ›] 단추 — 돌아오면 여기에 포커스가 선다 */
  const btns = $state<Record<Sub, HTMLButtonElement | null>>({ items: null, hosts: null, db: null });
  /** AI 권한 호스트 하위 화면의 고른 칩 — [관리 ›] 은 전체로, 고아 알림은 정리 필요로 연다 */
  let hostsFilter = $state<"all" | "cleanup">("all");

  // ── 들어가기 관문 — 화면 상태, 저장하지 않는다 ──
  /** 이번에 보는 동안 관문을 지났는가 — 섹션이 안 보이게 되거나 볼트가 잠기면 거둔다 */
  let passed = $state(false);
  /** 관문 단추가 일하는 중 — 두 번 눌러 모달 둘을 세우지 않게 */
  let gateBusy = $state(false);
  /** 관문 앞에서 받은 딥링크 — 통과하면 그 자리로 간다(설정 색인 · 고아 알림) */
  let pendingAnchor: string | null = null;

  /** 관문 카드의 상황 한 줄 — 위협 모델 문구와 같은 톤 */
  const GATE_NOTE = {
    locked: "settings.credentials.gate.locked",
    master: "settings.credentials.gate.master",
    nomaster: "settings.credentials.gate.nomaster",
    absent: "settings.credentials.gate.absent",
  } as const;

  /** 관문이 무엇을 물을지 — 볼트 상태 셋 + 마스터 유무 */
  const gateKind = $derived.by((): "locked" | "master" | "nomaster" | "absent" => {
    const s = vaultStatus();
    if (s.state === "locked") return "locked";
    if (s.state === "absent") return "absent";
    return s.hasMaster ? "master" : "nomaster";
  });

  /**
   * 관문 단추 — 볼트를 새로 읽고 그때의 상태로 묻는다(보이는 글자가 늦었어도 판정은 지금 상태). 잠금 해제 · 확인 모달을
   * 사람이 닫으면 관문에 그대로 남는다. 그 사이 섹션이 안 보이게 됐으면 통과시키지 않는다.
   */
  async function pass(): Promise<void> {
    if (gateBusy) return;
    gateBusy = true;
    try {
      await refreshVault();
      const s = vaultStatus();
      let ok: boolean;
      if (s.state === "locked") {
        await unlockVault();
        ok = vaultStatus().state === "unlocked";
      } else if (s.state === "unlocked" && s.hasMaster) {
        ok = await verifyMasterPrompt();
      } else {
        ok = true;
      }
      if (!ok || !active) return;
      passed = true;
      await tick();
      revealAfterPass();
    } finally {
      gateBusy = false;
    }
  }

  /** 통과 직후 — 미뤄 둔 딥링크 자리로(없으면 상태 줄 이름에 포커스 — 관문 단추가 사라져 포커스가 길을 잃지 않게) */
  function revealAfterPass(): void {
    const anchor = pendingAnchor;
    pendingAnchor = null;
    const p = panel();
    if (!p) return;
    const el = p.querySelector<HTMLElement>(`#${CSS.escape(anchor ?? "vault-state-label")}`);
    if (!el) return;
    if (anchor) el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }

  function panel(): HTMLElement | null {
    return rootEl?.closest<HTMLElement>(".settings-panel") ?? null;
  }

  function openSub(v: Sub): void {
    if (v === "hosts") hostsFilter = "all";
    dir = "fwd";
    view = v;
    const p = panel();
    if (p) p.scrollTop = 0;
  }

  async function closeSub(returnFocus = true): Promise<void> {
    if (view === "summary") return;
    const from = view;
    // [모두 삭제] 의 확인은 저장된 항목 화면의 것이다 — 떠나면 거둔다(줄 [제거] 의 확인은 하위 화면과 함께 사라진다)
    cancelDeleteAll();
    dir = returnFocus ? "back" : null;
    view = "summary";
    if (!returnFocus) return;
    await tick();
    const btn = btns[from];
    btn?.scrollIntoView({ block: "nearest" });
    btn?.focus({ preventScroll: true });
  }

  /**
   * 설정 색인 · 바깥 딥링크가 이 섹션의 줄로 올 때(`SettingsModal.revealPendingAnchor` 가 스크롤 전에 부른다) —
   * 부팅 고아 알림의 anchor 면 AI 권한 호스트 하위 화면을 [정리 필요]로 **움직임 없이** 열고, 나머지(상태 · 마스터 ·
   * [관리 ›])는 전부 요약에 있으니 요약으로 돌아간다.
   */
  export function expandForAnchor(anchor: string): void {
    // 관문 앞이면 자리만 기억한다(화면 상태는 아래처럼 미리 맞춰 두고, 통과한 뒤 그 줄로 간다)
    if (!passed) pendingAnchor = anchor;
    if (anchor === DELEGATION_ORPHANS_ANCHOR) {
      hostsFilter = "cleanup";
      dir = null;
      view = "hosts";
      return;
    }
    void closeSub(false);
  }

  // Escape(하위 화면 → 요약)는 `SubViewStack` 이 창에 캡처로 받는다 — 요약에서는 모달 몫이라 넘기지 않는다.
  const onescape = $derived(!passed || view === "summary" ? null : () => void closeSub(true));

  // 통과 중 볼트가 잠기면(가림막 · 창 0개) 곧바로 관문으로 — 다시 지나면 요약부터다.
  $effect(() => {
    if (passed && vaultStatus().state === "locked") {
      passed = false;
      void closeSub(false);
    }
  });

  /**
   * 이 칸을 **볼 때마다** 상태와 목록을 다시 읽는다 — 요약의 개수도 하위 화면의 줄도 같은 사본을 본다.
   *
   * 한 번만 읽으면 안 되는 이유가 둘이다: 접속 모달에서 값을 담으면 그 사이에 개수가 늘고,
   * 유휴 자동 잠금은 이 화면을 보지 않는 동안에도 상태를 바꾼다. 읽는 값은 상태 넷과
   * 목록(종류·대상)뿐이라 싸다. 안 보이게 되면 확인 상태를 거두고 요약으로 돌아간다(다음에 열면 요약부터다).
   */
  $effect(() => {
    if (!active) {
      cancelDeleteAll();
      void closeSub(false);
      // 관문은 들어갈 때마다 — 섹션이 안 보이게 되면 통과를 거둔다
      passed = false;
      return;
    }
    void refreshVault();
    // DB 비밀번호 대상의 이름(경유 · 연결 이름)은 `db-connections.json` 사본에서 — 볼트 목록과 같은 박자로 다시 읽는다.
    void reloadDbConns();
    // 위임 표도 **볼 때마다** 다시 읽는다 (볼트와 같은 이유): 호스트 폼에서 스위치를 바꾸고
    // 여기로 오면 그 사이에 파일이 달라져 있다. 파일 하나 읽기라 볼트 조회와 같은 무게다.
    void refreshDelegationTargets();
    // DB 연결의 AI 권한(쿼리 타일 3a — 같은 파일의 `[[database]]`)도 같은 까닭으로.
    void refreshDbAi();
  });

  /**
   * 머리말의 **무입력 자동 잠금으로 가는 길** — 같은 섹션 끝의 그 줄로 내려가 포커스를 준다(예전에는 일반 › 프라이버시로
   * 섹션을 건너뛰는 링크였다 — 2026-11-12 그 칸이 이 섹션으로 왔다). 머리말은 관문 뒤에만 그려지니 줄은 늘 있다.
   */
  function goIdleLock(): void {
    const el = panel()?.querySelector<HTMLElement>("#lock-idle");
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }

  /**
   * 무입력 자동 잠금 슬라이더의 후보 — **분**. `0` 은 끄기(자동 잠금 안 함), 나머지는 흔한 자리비움
   * 시간. 간격이 고르지 않아 슬라이더는 이 목록의 인덱스를 움직인다(`ValueSlider` 의 `steps`).
   * 파일에 손으로 적은 다른 값(1~240)은 손잡이가 가장 가까운 후보에 서고 글자는 그 값 그대로다.
   */
  const IDLE_MINUTES: number[] = [0, 1, 3, 5, 10, 15, 30];

  /** 항목의 표시 이름 — `0` 만 다른 말이고 나머지는 숫자를 끼운 한 문장이다 */
  function idleLabel(min: number): string {
    return min === 0 ? t("settings.general.idle.off") : t("settings.general.idle.minutes", { min });
  }

  /**
   * **상태 줄**(2026-10-21 — 목업 안 A): 상태 타일 + 제목 · 한 마디 + 사실 칩. 판정(톤 · 그림 · 문구 · 칩)은 순수 함수
   * `vaultStateView` 하나다. 위협 모델은 그대로 밝힌다 — 마스터가 없는 볼트는 "이 PC 의 내 계정" 등급이고(`vault.rs` 4절 ·
   * 접속 모달의 `app.save.note.*` 와 **같은 문장**), 그 줄은 경고 톤 + 그 문장 + "마스터 암호 없음" 칩이다. 무입력 자동 잠금이
   * 꺼져 있으면 자동 잠금 칩이 그 사실을 말한다 — 그때 잠그는 길은 가림막 단축키뿐이라 "잠깁니다" 만 적으면 오지 않는 잠금을
   * 약속하는 줄이 된다. 색만으로 가르지 않는다(그림 · 문구가 함께 다르다).
   */
  const stateView = $derived(vaultStateView(vaultStatus(), settings.idleLockMin));

  // ── 요약 줄의 숫자 — 하위 화면과 같은 판정(`credentials-view.ts`)으로 센다 ──
  const kindCounts = $derived(vaultKindCounts(vaultItems()));
  const hostCount = $derived(delegationTargetViews().length);
  const hostCleanup = $derived(delegationTargetViews().filter(isOrphanHost).length);
  const dbCount = $derived(dbAiViews().length);
  const dbCleanup = $derived(dbAiViews().filter(dbAiNeedsCleanup).length);
</script>

<!--
  머리말은 **잠그는 시점 한 줄**뿐이다 — "무엇이고 [저장]을 기다리지 않는다" 는 상태 줄의 이름 툴팁(`TipName`)으로 갔다.
  잠그는 시점 줄은 무입력 자동 잠금 설정·볼트 상태와 무관하게 **늘 보인다**(사용자 결정, 2026-10-03 — 예전 동작).
  가운데 버튼은 키를 셋으로 쪼개 세운다(문구에 HTML 을 넣지 않는다 — docs/conventions.md).
  **상태와 위협 모델도 늘 보인다**(상태 줄의 한 마디 · 칩): 볼트의 등급(마스터 없음 = 이 PC 의 내 계정)과 잠그는
  시점은 지금 상태에 따라 바뀌는 사실이고, 감추면 잘못된 안심을 산다.
  `vault-state` 는 색인 anchor 다 — 상태 줄 자체에 단다.
-->
{#if !passed}
  <!--
    들어가기 관문 — 섹션 전체를 덮는 카드 하나(자물쇠 타일 · 제목 · 상황 한 줄 · 주 단추). 상태 · 마스터 · 목록 줄은 통과 전엔
    그리지 않는다(색인 anchor 도 없으니 딥링크는 미뤄진다 — `expandForAnchor`). 위협 모델 문구는 상태 줄 밑 안내와 같은 톤이다.
  -->
  <div class="gate" bind:this={rootEl} data-cred-gate={gateKind}>
    <div class="gate-card" role="group" aria-labelledby="cred-gate-title" aria-describedby="cred-gate-note">
      <span class="gate-icon" aria-hidden="true"><UiIcon name="lock" size={22} /></span>
      <h4 class="gate-title" id="cred-gate-title">{t("settings.credentials.gate.title")}</h4>
      <p class="gate-note" id="cred-gate-note">{t(GATE_NOTE[gateKind])}</p>
      <button type="button" class="btn btn-primary" disabled={gateBusy || vaultBusy()} onclick={() => void pass()}>
        {gateKind === "locked" || gateKind === "master"
          ? t("settings.credentials.gate.unlock")
          : t("settings.credentials.gate.open")}
      </button>
    </div>
  </div>
{:else}
<SubViewStack {view} {dir} {onescape} bind:root={rootEl}>
{#if view === "items"}
  <VaultItemsView onback={() => void closeSub(true)} />
{:else if view === "hosts"}
  <DelegationHostsView bind:filter={hostsFilter} onback={() => void closeSub(true)} />
{:else if view === "db"}
  <DbAiTargetsView onback={() => void closeSub(true)} />
{:else}
<p class="lead">
  {t("settings.credentials.lead.veil.before", { combo: comboText("toggle-veil", settings.keybindings) })}<button type="button" class="link" onclick={goIdleLock}
    >{t("settings.credentials.lead.veil.link")}</button
  >{t("settings.credentials.lead.veil.after")}
</p>

<!--
  상태 줄(목업 안 A) — 왼쪽 상태 타일(그림만 · aria-hidden) + 오른쪽 두 단(위: 제목 · 한 마디, 아래: 사실 칩 줄). 제목이 이름 툴팁
  (`TipName` — "무엇이고 [저장]을 기다리지 않는다")을 지고, 글자 전부가 `role="status"` 로 읽힌다. 톤은 `data-tone`
  (`ok` 성공 · `warn` 경고 · `neutral`) — 줄 판의 옅은 틴트는 `::before` 가 깐다(묶음 카드 규칙이 `background` 를 쥐고 있어서).
  **단추가 없다**(2026-10-21 — 잠금 = 가림막 하나): 예전의 [잠그기] · [잠금 해제…]는 화면을 열어 둔 채 볼트만 잠그는 길이었는데,
  사용자 개념에서 잠금은 가림막 하나라 걷었다(잠그는 길은 머리말의 가림막 단축키 · 무입력 자동 잠금). 볼트를 만드는 길은 아래
  [설정…](마스터를 걸면서)과 접속 모달의 체크다. 이 줄이 색인 anchor(`vault-state`)다.
-->
<StateRow id="vault-state" tone={stateView.tone} icon={stateView.icon} note={t(stateView.note)} bodyClass="vault-state-note">
  {#snippet title()}
    <TipName
      id="vault-state"
      label={t(stateView.title)}
      tip={tipOf(t("settings.credentials.lead"), t("settings.credentials.state.note"))}
    />
  {/snippet}
  {#snippet chips()}
    {#if stateView.chips.length > 0}
      <ul class="vstate-chips">
        {#each stateView.chips as c (c.id)}
          <li class="vchip" data-look={c.look} data-chip={c.id} title={c.title ? t(c.title) : undefined}>
            <UiIcon name={c.icon} size={13} />
            <span>{t(c.label, c.params)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
</StateRow>

<!-- 마스터가 걸렸는지는 단추(변경·해제 ↔ 설정)가 말하고, 없을 때의 위협 모델은 위 상태 줄 밑 안내가 말한다 -->
<div class="srow">
  <TipName
    id="vault-master"
    for="vault-master"
    label={t("settings.credentials.master.label")}
    tip={t("settings.credentials.master.note")}
  />
  <span class="vault-actions">
    {#if vaultStatus().hasMaster}
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        disabled={vaultBusy() || isRemote}
        title={isRemote ? t("settings.remote.homeOnly") : undefined}
        onclick={() => openMasterPrompt("change")}
      >
        {t("settings.credentials.master.change")}
      </button>
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        disabled={vaultBusy() || isRemote}
        title={isRemote ? t("settings.remote.homeOnly") : undefined}
        onclick={() => openMasterPrompt("remove")}
      >
        {t("settings.credentials.master.remove")}
      </button>
    {:else}
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        disabled={vaultBusy() || isRemote}
        title={isRemote ? t("settings.remote.homeOnly") : undefined}
        onclick={() => openMasterPrompt("set")}
      >
        {t("settings.credentials.master.set")}
      </button>
    {/if}
  </span>
</div>

<!--
  목록 셋 — 줄마다 이름 + 짧은 요약 + [관리 ›](자동 승인의 [편집 ›] 줄과 같은 모양). [관리 ›] 이 설정 색인
  (`vault-items` · `delegation-targets` · `db-ai-targets`)의 목적지다(이름 라벨이 그 단추를 가리킨다).
  저장된 항목 — **값은 여기 오지 않는다**: 요약은 종류별 개수뿐이고 잠겼으면 "잠김" 한 마디다.
-->
<div class="srow">
  <TipName
    id="vault-items-row"
    for="vault-items"
    label={t("settings.credentials.items.label")}
    tip={t("settings.credentials.items.note")}
  />
  <div class="size-row cred-summary">
    {#if vaultStatus().state === "locked"}
      <span class="hint">{t("settings.credentials.state.locked")}</span>
    {:else if kindCounts.length === 0}
      <span class="hint">{t("settings.credentials.items.empty")}</span>
    {:else}
      <span class="sum-chips">
        {#each kindCounts as c (c.kind)}
          <span class="sum-chip">{t(VAULT_KIND_LABEL[c.kind])} {c.n}</span>
        {/each}
      </span>
    {/if}
    <button
      type="button"
      id="vault-items"
      class="btn btn-sm btn-secondary adjust"
      bind:this={btns.items}
      onclick={() => openSub("items")}
    >
      {t("settings.credentials.manage")}
      <UiIcon name="chevron" size={12} />
    </button>
  </div>
</div>

<!--
  AI 권한 호스트 — 볼트 아래, **같은 층**이다(둘 다 "앱이 사람 없이 쓰는 권한"). 여기서 할 수 있는 일은 보는 것과
  지우는 것뿐이고(하위 화면), 켜고 끄는 자리는 호스트 폼의 AI 칸이다(docs/log/2026-09-21-fleet-delegation-ui.md).
  요약은 개수와, 고아(설정에 없음)가 있으면 경고색 "정리 필요 N" 칩.
-->
<div class="srow">
  <TipName
    id="delegation-targets-row"
    for="delegation-targets"
    label={t("settings.credentials.delegation.label")}
    tip={t("settings.credentials.delegation.note")}
  />
  <div class="size-row cred-summary">
    <span class="sum-chips">
      <span class="hint">{t("settings.credentials.count", { n: hostCount })}</span>
      {#if hostCleanup > 0}
        <span class="sum-chip warn">{t("settings.credentials.cleanup.count", { n: hostCleanup })}</span>
      {/if}
    </span>
    <button
      type="button"
      id="delegation-targets"
      class="btn btn-sm btn-secondary adjust"
      bind:this={btns.hosts}
      onclick={() => openSub("hosts")}
    >
      {t("settings.credentials.manage")}
      <UiIcon name="chevron" size={12} />
    </button>
  </div>
</div>

<!-- AI 권한 DB 연결(쿼리 타일 3a) — 위 호스트 줄과 같은 꼴 · 같은 층(`delegation.toml` 한 파일). 정리 거리 = 고아 · 대상 바뀜 -->
<div class="srow">
  <TipName
    id="db-ai-targets-row"
    for="db-ai-targets"
    label={t("settings.credentials.dbai.label")}
    tip={t("settings.credentials.dbai.note")}
  />
  <div class="size-row cred-summary">
    <span class="sum-chips">
      <span class="hint">{t("settings.credentials.count", { n: dbCount })}</span>
      {#if dbCleanup > 0}
        <span class="sum-chip warn">{t("settings.credentials.cleanup.count", { n: dbCleanup })}</span>
      {/if}
    </span>
    <button
      type="button"
      id="db-ai-targets"
      class="btn btn-sm btn-secondary adjust"
      bind:this={btns.db}
      onclick={() => openSub("db")}
    >
      {t("settings.credentials.manage")}
      <UiIcon name="chevron" size={12} />
    </button>
  </div>
</div>

<!--
  무입력 자동 잠금 (옛 일반 › 프라이버시 · 그 앞은 **잠금** 섹션 — 2026-11-12 이 섹션 끝으로 왔다). 손잡이는 "무입력 몇 분 뒤에
  가림막을 내릴 것인가" 하나이고, 가림막이 곧 볼트 잠금이다(docs/invariants.md 2절). 값은 다른 섹션처럼 미리보기 계약을 탄다
  (고르면 걸리고 파일에는 [저장]이 쓴다) — 이 섹션의 "[저장] 바깥" 손잡이들과 다르다. 수동으로 내리는 길(`toggle-veil`)은 툴팁 안.
  줄 id `lock-idle` 은 옛 자리 그대로(설정 색인 anchor).
-->
<SettingRow
  id="lock-idle"
  label={t("settings.general.idle.label")}
  tip={tipOf(
    t("settings.general.idle.summary") + t("settings.general.idle.summary.term"),
    t("settings.general.idle.note") + comboText("toggle-veil", settings.keybindings),
  )}
>
  {#snippet control()}
    <ValueSlider
      id="lock-idle"
      steps={IDLE_MINUTES}
      value={settings.idleLockMin}
      format={idleLabel}
      onchange={setIdleLockMin}
    />
  {/snippet}
</SettingRow>
{/if}
</SubViewStack>
{/if}

<style>
  /* 머리말 안의 링크 — **문장 안에 흐른다**(여백 없음). 강조색이 아니라 본문 글자 + 밑줄:
     강조색은 [저장] 의 몫이고, 이 링크는 섹션 하나를 옮길 뿐이다. */
  .link {
    padding: 0;
    font: inherit;
    color: var(--fg-1);
    background: transparent;
    border: 0;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
    border-radius: 3px;
  }

  /* 손잡이 두어 개가 한 줄에 선다 (상태·마스터 줄) */
  .vault-actions {
    display: flex;
    flex: 0 0 auto;
    gap: var(--space-2);
  }

  /* 목록 요약 줄 — 요약(글자 · 칩) + [관리 ›]. 칩이 많으면 단추 앞에서 줄바꿈한다 */
  .cred-summary {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .sum-chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }

  /* 요약 안의 `.hint` 는 줄 밑 안내가 아니라 글자 하나다 — 위 여백을 걷는다 */
  .sum-chips .hint,
  .cred-summary > .hint {
    margin-top: 0;
  }

  /* 종류별 개수 · 정리 필요 칩 — 위임 표의 켜진 권한 칩과 같은 판(강조색 없음), 정리 필요만 경고색 글자 */
  .sum-chip {
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 20px;
    white-space: nowrap;
    border-radius: var(--radius-sm);
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .sum-chip.warn {
    color: var(--warn);
    background: transparent;
    box-shadow: inset 0 0 0 1px currentColor;
  }

  /* 상태 줄의 사실 칩 — 줄 자체는 공용 `StateRow` */
  .vchip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 22px;
    white-space: nowrap;
    border-radius: var(--radius-sm);
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .vchip[data-look="accent"] {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  .vchip[data-look="warn"] {
    color: var(--warn);
    background: transparent;
    border: 1px dashed currentColor;
    line-height: 20px;
  }

  /* ── 들어가기 관문 — 가운데 카드 한 장(묶음 카드와 같은 판 · 24px 둥글게) ── */
  .gate {
    display: flex;
    justify-content: center;
    padding: var(--space-5) 0;
  }

  .gate-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: 360px;
    padding: var(--space-5) var(--space-4);
    text-align: center;
    background: var(--glass-card, var(--m3-surface-container));
    border-radius: var(--radius-surface-inner);
  }

  /* 자물쇠 타일 — 고른 칩과 같은 secondaryContainer 짝(강조색 채움은 주 단추의 몫이다) */
  .gate-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: calc(var(--radius-surface-inner) - 2px);
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  .gate-title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-md);
    font-weight: 600;
    color: var(--fg-1);
  }

  .gate-note {
    margin: 0;
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
    word-break: keep-all;
  }

  .adjust {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
</style>

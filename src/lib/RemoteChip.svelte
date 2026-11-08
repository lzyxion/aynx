<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote, remoteDeviceName } from "$lib/ipc";
  import { runAfterClose } from "$lib/browser/menu-runner";
  import { placeNotifyPanel, relativeTime } from "$lib/notifications";
  import { logKindKey } from "$lib/remote-access";
  import { disconnectAllRemote, lockThisRemote, remoteActive, remoteLog } from "$lib/app/remote-access.svelte.js";
  import { openSettingsAt } from "$lib/app/overlays.svelte.js";
  import { toast } from "$lib/toast.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";
  import { mobileLayout } from "$lib/app/mobile.svelte.js";
  import type { StatusBarPosition } from "$lib/settings.svelte.js";

  /**
   * **상태바의 원격 칩**(R1a-5 — 설계 docs/log/2026-10-15-remote-web-client-design.md 9-⑤ · 13절). 두 얼굴이다:
   *
   * - **집 PC 창**: 지금 원격으로 쓰는 기기(열렸고 원격 창이 붙은 기기 — `remoteActive`)가 하나라도 있으면 "원격 접속 중 (N)" 이
   *   선다. **끌 수 없다**(설정 칸이 없다 — 늘 보여야 하는 사실이다). 누르면 작은 상자: 지금 쓰는 기기(창 수) · [모두 끊기] ·
   *   최근 기록 · [원격 접속 설정…]. 원격이 열릴 때의 OS 알림은 Rust 가 따로 낸다(`gate::notify_home`).
   * - **원격 창**(브라우저): 늘 "원격 — <이 기기 이름>" 이 서고, 누르면 이 원격 창을 **잠근다**(`POST /remote/lock` — 잠금 해제 쪽으로
   *   돌아간다 · 집 PC 는 그대로).
   *
   * 상자 몸짓은 옛 알림 상자(`NotificationCenter` — 2026-10-18 독 알림 칸으로 들어가 걷혔다)와 같다 — 칩 옆에 붙고(`placeNotifyPanel`) · 바깥 누르기·Escape 로 닫히고 · 칩 자신은
   * 바깥 누르기 감지가 비켜 간다(`data-remote-chip`). 상자를 닫고 다른 화면을 여는 항목은 메뉴 통로(`runAfterClose`)를 지난다.
   */
  let { position, vertical = false }: { position: StatusBarPosition; vertical?: boolean } = $props();

  const ICON_SIZE = 17;

  const active = $derived(isRemote ? [] : remoteActive());
  const names = $derived(active.map((d) => d.name).join(", "));
  const selfName = remoteDeviceName();

  let chip = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLElement | null>(null);
  let open = $state(false);
  let pos = $state<{ left: number; top: number } | null>(null);
  let busy = $state(false);

  // 쓰는 기기가 사라지면(모두 끊김) · 가림막이 내려오면(상자가 가림막보다 위다 — 알림 상자와 같은 규칙) 닫는다
  $effect(() => {
    if (active.length === 0 || veilVisible()) open = false;
  });

  $effect(() => {
    const node = panel;
    const anchor = chip;
    if (!open || !node || !anchor) return;
    const place = () => {
      pos = placeNotifyPanel(
        anchor.getBoundingClientRect(),
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        position,
      );
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(node);
    window.addEventListener("resize", place);
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-remote-panel], [data-remote-chip]")) return;
      open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      open = false;
      anchor.focus();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  });

  async function disconnectAll(): Promise<void> {
    busy = true;
    try {
      const n = await disconnectAllRemote();
      toast.success(t("app.statusbar.remote.disconnected", { n }));
    } catch (e) {
      toast.error(String(e));
    } finally {
      busy = false;
    }
  }

  const now = $derived(open ? Date.now() : 0);
  function whenOf(stamp: string): string {
    const at = Date.parse(stamp);
    return Number.isFinite(at) ? relativeTime(at, now, t) : "";
  }
</script>

{#if isRemote}
  {@const label = t("app.statusbar.remote.self", { name: selfName || "?" })}
  {@const compact = mobileLayout()}
  <button
    type="button"
    class="rchip self"
    class:vertical
    class:compact
    data-remote-self
    data-compact={compact || undefined}
    title={`${label}\n${t("app.statusbar.remote.self.tip")}`}
    aria-label={`${label}, ${t("app.statusbar.remote.lock")}`}
    onclick={() => void lockThisRemote()}
  >
    <!-- 모바일 배치 — 원격 아이콘 하나(보이는 폭은 작게 · 누르는 자리는 ::after 로 44px) · 기기 이름 · "잠그기" 는 title/aria-label 로만.
         자물쇠 그림을 쓰지 않는 까닭: 바로 옆 볼트 자물쇠(가림막 + 볼트 잠금 — 메인 PC 까지)와 같은 그림이 둘 서면 무엇을 잠그는지 못 가른다. -->
    <UiIcon name="remote" size={ICON_SIZE} />
    {#if !vertical && !compact}<span class="text">{label}</span><span class="sep" aria-hidden="true"></span><UiIcon
        name="lock"
        size={14}
      /><span class="text">{t("app.statusbar.remote.lock")}</span>{/if}
  </button>
{:else if active.length > 0}
  {@const label = t("app.statusbar.remote.active", { n: active.length })}
  <button
    type="button"
    class="rchip"
    class:vertical
    class:active={open}
    data-remote-chip
    data-remote-active={active.length}
    bind:this={chip}
    title={t("app.statusbar.remote.tip", { names })}
    aria-label={`${label}: ${names}`}
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="live" aria-hidden="true"></span>
    <UiIcon name="remote" size={ICON_SIZE} />
    {#if vertical}<span class="badge" aria-hidden="true">{active.length}</span>{:else}<span class="text">{label}</span>{/if}
  </button>
{/if}

{#if open && !isRemote}
  <div
    class="rpanel glass-raised"
    role="dialog"
    aria-label={t("app.statusbar.remote.panel.title")}
    data-remote-panel
    bind:this={panel}
    style:left="{pos?.left ?? -9999}px"
    style:top="{pos?.top ?? -9999}px"
  >
    <div class="ptitle">{t("app.statusbar.remote.panel.title")}</div>
    <ul class="pdevices">
      {#each active as d (d.id)}
        <li>
          <UiIcon name="remote" size={13} />
          <span class="pname" title={d.name}>{d.name}</span>
          <span class="pmeta">{t("app.statusbar.remote.panel.windows", { n: d.connected })}</span>
        </li>
      {/each}
    </ul>
    <div class="pactions">
      <button type="button" class="btn btn-sm btn-secondary danger" disabled={busy} data-remote-disconnect-all onclick={() => void disconnectAll()}>
        {t("app.statusbar.remote.panel.disconnectAll")}
      </button>
      <button
        type="button"
        class="btn btn-sm btn-ghost"
        data-remote-open-settings
        onclick={() => runAfterClose(() => (open = false), () => openSettingsAt("remote"))}
      >
        {t("app.statusbar.remote.panel.settings")}
      </button>
    </div>
    {#if remoteLog().length > 0}
      <div class="psub">{t("app.statusbar.remote.panel.log")}</div>
      <ul class="plog">
        {#each remoteLog().slice(0, 6) as e, i (i + e.at + e.kind)}
          {@const key = logKindKey(e.kind)}
          {#if key}
            <li>
              <span class="when">{whenOf(e.at)}</span>
              <span class="what" class:bad={e.kind === "unlockFailed"}>{t(key)}{#if e.what}<span class="detail">{e.what}</span>{/if}</span>
              <span class="who">{e.deviceName || t("settings.remote.log.all")}</span>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  /* 칩 — 상태바 글리프(`.glyph`)와 같은 높이 · 고스트 관용구. 가로 띠는 글자까지, 세로 기둥은 아이콘 + 숫자 배지 */
  .rchip {
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: var(--sb-cell-h);
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1;
    white-space: nowrap;
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .rchip.vertical {
    width: var(--sb-cell-w);
    padding: 0;
    justify-content: center;
  }

  .rchip:hover,
  .rchip.active {
    background: var(--surface-hover);
  }

  .rchip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 지금 누가 들어와 있다 — 경고색 점 하나(깜빡이지 않는다 · 늘 보이는 띠에서 움직임은 시선을 빼앗는다) */
  .live {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--warn);
  }

  .rchip.vertical .live {
    position: absolute;
    top: 3px;
    left: 3px;
  }

  .badge {
    position: absolute;
    top: 0;
    right: 0;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    box-sizing: border-box;
    font-size: 11px;
    line-height: 14px;
    text-align: center;
    color: var(--fg-1);
    background: var(--line-strong);
    border-radius: 999px;
  }

  .rchip.self {
    color: var(--fg-2);
  }

  .rchip.self:hover {
    color: var(--fg-1);
  }

  /* 모바일 배치 — 원격 아이콘 하나만 보이는 작은 단추. 누르는 자리는 보이지 않는 44px 정사각형(손가락 크기) */
  .rchip.compact {
    padding: 0 6px;
    gap: 0;
  }

  .rchip.compact::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 44px;
    height: 44px;
    transform: translate(-50%, -50%);
  }

  .plog .detail {
    margin-left: 0.5em;
    color: var(--fg-2);
  }

  .sep {
    width: 1px;
    height: 12px;
    margin: 0 2px;
    background: var(--line);
  }

  /* 상자 — 알림 상자와 같은 뜬 면 */
  .rpanel {
    position: fixed;
    z-index: 121;
    box-sizing: border-box;
    width: min(320px, calc(100vw - 16px));
    padding: var(--space-2) var(--space-3) var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }

  .ptitle {
    padding: var(--space-1) 0 var(--space-2);
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }

  .psub {
    margin-top: var(--space-3);
    padding-bottom: var(--space-1);
    color: var(--fg-2);
  }

  .pdevices,
  .plog {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .pdevices li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    color: var(--fg-1);
  }

  .pname {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pmeta {
    color: var(--fg-2);
  }

  .pactions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .plog li {
    display: grid;
    grid-template-columns: 5em 6.5em 1fr;
    gap: var(--space-2);
    padding: 2px 0;
    color: var(--fg-2);
  }

  .plog .what {
    color: var(--fg-1);
  }

  .plog .what.bad {
    color: var(--err);
  }

  .plog .who {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

// 고르기는 전부 menu-runner 통로(스냅샷 → 닫기 → 실행)를 지난다 — 타일 체크 줄 · 모델 메뉴 · 허용 목록 × 는 닫기 자리가 빈 같은 통로다(이어서 고르게).
// 권한 모드를 바꾸는 길은 세션 서버 op(`side_chat_set_perm_mode` · `side_chat_forget_allow`)뿐이다 — 메인 PC 독 · 원격 웹 독 · 폰이 같다.
import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
import type { ToolbarMenuRow } from "$lib/browser/toolbar-tools";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { openSettingsAt } from "$lib/app/overlays.svelte.js";
import {
  currentSideChat,
  loadCodexModels,
  setSideChatEffortPick,
  setSideChatPick,
  sideChats,
  type CodexModels,
} from "$lib/app/side-chats.svelte.js";
import {
  addSideChatLink,
  forgetSideChatAllow,
  removeSideChatLink,
  setSideChatLinks,
  setSideChatEffort,
  setSideChatModel,
  setSideChatPermMode,
  sideChatLiveOf,
  switchSideChatCli,
} from "$lib/app/side-chat-live.svelte.js";
import { linkTilesHere } from "$lib/app/side-chat-ask.svelte.js";
import { sideChatCliOk, sideChatEffortChoices, sideChatModelChoices, sideChatModelOk, type SideChat } from "$lib/side-chat";
import { SIDE_CHAT_LINK_MAX, linkTileName, type LinkChip, type LinkTile } from "$lib/side-chat-link";
import { EFFORTS, MODEL_SUGGESTIONS, type RoleCli } from "$lib/orchestration/config";
import { effortLabel, modelLabel, orderModels } from "$lib/model-order";
import { targetOf } from "$lib/chat/chat-presentation";
import type { AiCli } from "$lib/session";
import type { PermMode } from "$lib/side-chat-api";
import { t } from "$lib/i18n/i18n.svelte.js";

export type PlusView = "root" | "link" | "mcp";

/** `value` 의 `""` = CLI 기본 */
export interface ModelChoice {
  value: string;
  label: string;
  checked: boolean;
}

interface Opts {
  chat: () => SideChat | null;
  offered: () => readonly Pick<AiCli, "id" | "name">[] | null;
  chipLinks: () => readonly LinkChip[];
  focusHome: () => void;
  /** 메뉴 줄의 누름 안에서 곧바로 불러야 브라우저가 파일 상자를 연다 */
  pickFiles: () => void;
}

export function keywordModelLabel(model: string): string {
  return model ? modelLabel(model) : t("app.chatDock.cliDefault");
}

export function effortName(effort: string): string {
  return effort ? effortLabel(effort) : t("app.chatDock.effort.default");
}

export class SideChatControls {
  readonly #o: Opts;

  constructor(o: Opts) {
    this.#o = o;
  }

  // ── 열림 ───────────────────────────────────────────────────────────────────

  plusOpen = $state(false);
  plusView = $state<PlusView>("root");
  plusBtn = $state<HTMLElement | null>(null);
  modelOpen = $state(false);
  modelBtn = $state<HTMLElement | null>(null);
  customOpen = $state(false);
  customText = $state("");
  codexModels = $state<CodexModels | null>(null);
  permOpen = $state(false);
  permBtn = $state<HTMLElement | null>(null);

  readonly chat = $derived.by(() => this.#o.chat());
  readonly offered = $derived.by(() => this.#o.offered() ?? []);
  readonly #live = $derived.by(() => (this.chat ? sideChatLiveOf(this.chat.id) : null));

  readonly untested = $derived(this.#live?.state.untested ?? null);

  readonly customOk = $derived(sideChatModelOk(this.customText.trim()));

  readonly permMode = $derived<PermMode>(this.#live?.state.perm.mode ?? "manual");
  readonly permAllow = $derived<readonly string[]>(this.#live?.state.perm.allow ?? []);

  // ── 모델 ───────────────────────────────────────────────────────────────────

  readonly models = $derived.by<ModelChoice[]>(() => {
    const c = this.chat;
    if (!c) return [];
    const isCodex = c.cli === "codex";
    const ready = this.#live?.state.ready ?? null;
    const codex = this.codexModels;
    const suggestions =
      ready && ready.models.length > 0
        ? ready.models
        : [...(MODEL_SUGGESTIONS[c.cli as RoleCli] ?? []), ...(isCodex ? (codex?.models ?? []) : [])];
    const list = orderModels(sideChatModelChoices(c.model, isCodex ? codex?.configured : null, suggestions));
    return [
      { value: "", label: t("app.chatDock.cliDefault"), checked: c.model === "" },
      ...list.map((m) => ({ value: m, label: modelLabel(m), checked: c.model === m })),
    ];
  });

  // ── 강도 ───────────────────────────────────────────────────────────────────

  readonly #effortChoices = $derived.by<string[]>(() => {
    const c = this.chat;
    if (!c) return [];
    const ready = this.#live?.state.ready ?? null;
    return sideChatEffortChoices(ready?.efforts ?? null, c.model, EFFORTS[c.cli as RoleCli] ?? []);
  });

  readonly efforts = $derived.by<string[]>(() => {
    const c = this.chat;
    if (!c) return [];
    const list = this.#effortChoices;
    return c.effort === "" || list.includes(c.effort) ? list : [c.effort, ...list];
  });

  readonly effortShown = $derived(!!this.chat && this.efforts.length > 0);

  // ── 연결 · MCP ─────────────────────────────────────────────────────────────

  readonly linkTiles = $derived.by<LinkTile[]>(() => (this.chat ? linkTilesHere() : []));
  readonly chipLinks = $derived.by(() => this.#o.chipLinks());
  readonly mcp = $derived<string[]>(this.#live?.state.mcp ?? []);

  readonly #linkRows = $derived.by<ToolbarMenuRow[]>(() => {
    const c = this.chat;
    if (!c) return [];
    const full = c.tiles.length >= SIDE_CHAT_LINK_MAX;
    const out: ToolbarMenuRow[] = this.linkTiles.map((x) => {
      const checked = c.tiles.some((l) => l.stream === x.stream);
      const blocked = full && !checked;
      return {
        key: `tile:${x.paneId}`,
        icon: x.kind === "ssh" ? "server" : "terminal",
        pane: x.pane,
        label: linkTileName(x),
        code: x.code,
        hint: x.readable ? (x.focused ? t("app.chatDock.link.focused") : "") : t("app.chatDock.link.readOff"),
        title: blocked ? t("app.chatDock.link.full", { max: SIDE_CHAT_LINK_MAX }) : x.readable ? undefined : t("app.chatDock.link.readOff.title"),
        checked,
        disabled: blocked,
      };
    });
    if (out.length === 0) out.push({ key: "none", icon: "", label: t("app.chatDock.link.noTiles"), disabled: true });
    out.push({ key: "unlink", icon: "close", label: t("app.chatDock.link.unlinkAll"), disabled: c.tiles.length === 0, sep: true });
    return out;
  });

  readonly plusRows = $derived.by<ToolbarMenuRow[]>(() => {
    const view = this.plusView;
    if (view === "link") {
      return [
        { key: "back", icon: "chevron-left", label: t("app.chatDock.plus.link") },
        ...this.#linkRows.map((r, i) => (i === 0 ? { ...r, sep: true } : r)),
      ];
    }
    if (view === "mcp") {
      return [
        { key: "back", icon: "chevron-left", label: t("app.chatDock.plus.mcp") },
        ...this.mcp.map((name, i) => ({ key: `server:${name}`, icon: "mcp", label: name, sep: i === 0 })),
        { key: "settings", icon: "settings", label: t("app.chatDock.mcp.settings"), sep: true },
      ];
    }
    const links = this.chipLinks;
    const linkMore = links.length === 1 ? links[0].name : links.length > 1 ? String(links.length) : "";
    const rows: ToolbarMenuRow[] = [
      // 이름 · 그림은 AI 타일 대화 면 `[+]`(`pane/AiFlip` 의 `attachPlus`)와 같은 문구 키 · 그림이다
      { key: "attach", icon: "attach-file", label: t("pane.flip.composer.attach") },
      { key: "link", icon: "link", label: t("app.chatDock.plus.link"), more: linkMore },
    ];
    if (this.mcp.length > 0) {
      rows.push({ key: "mcp", icon: "mcp", label: t("app.chatDock.plus.mcp"), more: String(this.mcp.length), sep: true });
    }
    return rows;
  });

  // ── [+] 메뉴 ───────────────────────────────────────────────────────────────

  togglePlus(el: HTMLElement): void {
    this.plusBtn = el;
    this.modelOpen = false;
    this.permOpen = false;
    this.plusView = "root";
    this.plusOpen = !this.plusOpen;
  }

  closePlus(back: boolean): void {
    this.plusOpen = false;
    this.plusView = "root";
    if (back) this.plusBtn?.focus({ preventScroll: true });
  }

  plusBack(): void {
    if (this.plusView !== "root") this.plusView = "root";
  }

  pickPlus(key: string): void {
    if (key === "link" || key === "mcp") {
      this.plusView = key;
      return;
    }
    if (key === "back") {
      this.plusView = "root";
      return;
    }
    if (key === "attach") {
      runAfterClose(
        () => this.closePlus(false),
        () => this.#o.pickFiles(),
      );
      return;
    }
    if (key === "settings" || key.startsWith("server:")) {
      runAfterClose(
        () => this.closePlus(false),
        () => openSettingsAt("mcp", "ai-mcp-servers"),
      );
      return;
    }
    if (key === "unlink") {
      runOnMenu(
        () => this.chat?.id ?? null,
        () => this.closePlus(false),
        (chat) => {
          void setSideChatLinks(chat, []).then(() => {
            if (currentSideChat()?.id === chat) this.#o.focusHome();
          });
        },
      );
      return;
    }
    // 타일 체크 줄 — 닫지 않는다(이어서 고르게)
    runOnMenu(
      () => {
        const c = this.chat;
        const tile = c && key.startsWith("tile:") ? this.linkTiles.find((x) => x.paneId === key.slice(5)) : undefined;
        if (!c || !tile) return null;
        const on = c.tiles.some((l) => l.stream === tile.stream);
        return { chat: c.id, on, tile: { stream: tile.stream, name: linkTileName(tile) } };
      },
      () => {},
      ({ chat, on, tile }) => {
        void (on ? removeSideChatLink(chat, tile.stream) : addSideChatLink(chat, tile));
      },
    );
  }

  /** 입력 칸 위 연결 칩의 × — 그 타일만 끊는다 */
  unlink(stream: string): void {
    const c = this.chat;
    if (!c) return;
    void removeSideChatLink(c.id, stream).then(() => this.#o.focusHome());
  }

  // ── 모델 메뉴 ──────────────────────────────────────────────────────────────

  toggleModel(el: HTMLElement): void {
    this.modelBtn = el;
    this.plusOpen = false;
    this.permOpen = false;
    this.customOpen = false;
    this.modelOpen = !this.modelOpen;
    if (this.modelOpen && this.chat?.cli === "codex") this.#loadCodex();
  }

  closeModel(back: boolean): void {
    this.modelOpen = false;
    this.customOpen = false;
    if (back) this.modelBtn?.focus({ preventScroll: true });
  }

  #loadCodex(): void {
    void loadCodexModels().then((v) => (this.codexModels = v));
  }

  #pick<T>(target: () => T | null, fn: (x: T) => void): void {
    runOnMenu(target, () => {}, fn);
  }

  pickCli(cli: string): void {
    this.#pick(
      () => (this.chat && cli !== this.chat.cli ? this.chat : null),
      (chat) => {
        if (cli === "codex") this.#loadCodex();
        void this.#applyChange(chat, cli, "");
      },
    );
  }

  pickModel(model: string): void {
    this.#pick(
      () => (this.chat && model !== this.chat.model ? this.chat : null),
      (chat) => void this.#applyChange(chat, chat.cli, model),
    );
  }

  startCustom(): void {
    this.customText = this.chat?.model ?? "";
    this.customOpen = true;
  }

  cancelCustom(): void {
    this.customOpen = false;
  }

  commitCustom(): void {
    if (!this.customOk) return;
    const model = this.customText.trim();
    this.customOpen = false;
    this.pickModel(model);
  }

  pickEffort(effort: string): void {
    this.#pick(
      () => (this.chat && effort !== this.chat.effort ? this.chat : null),
      (chat) => void this.#applyEffort(chat, effort),
    );
  }

  // ── 권한 모드 메뉴 ─────────────────────────────────────────────────────────

  togglePerm(el: HTMLElement): void {
    this.permBtn = el;
    this.plusOpen = false;
    this.modelOpen = false;
    this.customOpen = false;
    this.permOpen = !this.permOpen;
  }

  closePerm(back: boolean): void {
    this.permOpen = false;
    if (back) this.permBtn?.focus({ preventScroll: true });
  }

  pickPermMode(mode: PermMode): void {
    runOnMenu(
      () => (this.chat && mode !== this.permMode ? this.chat.id : null),
      () => this.closePerm(true),
      (chat) => void setSideChatPermMode(chat, mode),
    );
  }

  forgetAllow(kind: string): void {
    runOnMenu(
      () => (this.chat && this.permAllow.includes(kind) ? this.chat.id : null),
      () => {},
      (chat) => void forgetSideChatAllow(chat, kind),
    );
  }

  closeAll(): void {
    this.permOpen = false;
    this.plusOpen = false;
    this.plusView = "root";
    this.modelOpen = false;
    this.customOpen = false;
  }

  /** CLI 바꾸기와 "CLI 기본" 은 프로세스를 닫으므로 답하는 중이면 한 번 묻는다(지금 턴이 끊긴다) — 모델 값은 산 프로세스에 곧바로 */
  async #applyChange(chat: SideChat, cli: string, model: string): Promise<void> {
    if (!sideChatCliOk(cli)) return;
    // `chat` 은 목록의 그 채팅 자체다 — 적기 전에 갈래를 정한다(적은 뒤엔 `chat.cli` 가 이미 새 값)
    const switching = cli !== chat.cli;
    const closes = switching || model === "";
    if (closes && sideChatLiveOf(chat.id)?.state.status === "running") {
      const ok = await askConfirm(t("app.chatDock.switch.busy"), { kind: "warning", okLabel: t("app.chatDock.switch.now") });
      if (!ok) return;
    }
    setSideChatPick(chat.id, cli, model);
    const c = sideChats().find((x) => x.id === chat.id);
    if (!c) return;
    if (switching) await switchSideChatCli(targetOf(c));
    else await setSideChatModel(targetOf(c));
  }

  async #applyEffort(chat: SideChat, effort: string): Promise<void> {
    setSideChatEffortPick(chat.id, effort);
    const c = sideChats().find((x) => x.id === chat.id);
    if (!c) return;
    await setSideChatEffort(targetOf(c));
  }
}

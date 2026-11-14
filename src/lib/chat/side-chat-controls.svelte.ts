// ---------------------------------------------------------------------------
// **사이드 채팅 입력 칸의 손잡이 상태**(2026-11-13 — 목업 D안) — 입력 칸 한 줄 안의 `[+]`(파일 업로드 · 타일 연결 · MCP)와 오른쪽 모델
// 키워드(CLI 로고 · 모델 · Effort 게이지 · ⌄ → CLI 스위치 · 모델 · Effort 한 메뉴)가 쥐는 것. 대화 면(`SideChatFace`)이 채팅마다 하나 세운다
// — 집 PC 독 · 원격 웹 독 · 폰 덮개가 같은 몸이다(옛 입력 칸 아래 칩 줄 `ChatModelControls` · `ChatLinkControl` 과 머리줄 MCP 칩을 대신한다).
//
// - **모델** = 산 프로세스에 곧바로(다시 띄우지 않음 · 턴 중이면 다음 턴부터). **CLI** = 지금 프로세스를 닫고 그 CLI 의 대화로 다시 연다(각
//   CLI 가 제 대화 id 를 쥔다 — 모델 · 강도는 그 CLI 의 마지막 선택). **"CLI 기본"** 모델도 닫고 다시 연다. 닫는 길은 답하는 중이면 한 번 묻는다.
// - **강도** = 두 CLI 모두 산 프로세스에 곧바로. 고를 강도는 지어낸 값 없이(`sideChatEffortChoices`) — 빈 목록이면 게이지를 숨긴다(이미
//   고른 강도가 있으면 "기본" 으로 되돌릴 수 있게 남긴다).
// - **연결** = 이 채팅이 MCP 로 읽을 타일 하나(새 채팅은 아무것도 보지 않는다) · **MCP** = 지금 프로세스에 실린 외부 MCP 서버 이름(없으면 줄 없음).
//
// 메뉴 통로: `[+]` 는 `ToolbarMenu`(갈래 셋 — 뿌리 · 연결 · MCP, 갈래를 바꾸면 메뉴를 다시 세운다)이고 고르기는 `runOnMenu`(스냅샷 → 닫기 →
// 실행). 모델 메뉴(`ChatModelPopover`)는 **고른 뒤에도 열려 있다**(모델과 Effort 를 한 번에) — 그래도 고르기는 같은 통로를 지난다(닫기 자리가
// 비어 있을 뿐 · 스냅샷이 먼저다). 바깥 누르기 · Esc 로 닫는다.
// ---------------------------------------------------------------------------
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
  linkSideChat,
  setSideChatEffort,
  setSideChatModel,
  sideChatLiveOf,
  switchSideChatCli,
} from "$lib/app/side-chat-live.svelte.js";
import { linkTilesHere } from "$lib/app/side-chat-ask.svelte.js";
import { sideChatCliOk, sideChatEffortChoices, sideChatModelChoices, sideChatModelOk, type SideChat } from "$lib/side-chat";
import { linkTileName, linkTilePickLabel, type LinkChip, type LinkTile } from "$lib/side-chat-link";
import { EFFORTS, MODEL_SUGGESTIONS, type RoleCli } from "$lib/orchestration/config";
import { modelLabel, orderModels } from "$lib/model-order";
import { targetOf } from "$lib/chat/chat-presentation";
import type { AiCli } from "$lib/session";
import { t } from "$lib/i18n/i18n.svelte.js";

/** `[+]` 메뉴의 갈래 — 뿌리 · 타일 연결(고르기 · 끊기) · MCP(실린 서버 이름 · 설정) */
export type PlusView = "root" | "link" | "mcp";

/** 모델 메뉴의 줄 하나 — 값(`""` = CLI 기본) · 보이는 글자 · 고른 것 */
export interface ModelChoice {
  value: string;
  label: string;
  checked: boolean;
}

interface Opts {
  /** 이 대화 면의 채팅(목록의 그 객체 — 반응형) */
  chat: () => SideChat | null;
  /** 고를 수 있는 CLI(설치 · 켬 · 서버가 아는 것) — 감지 전엔 `null` */
  offered: () => readonly Pick<AiCli, "id" | "name">[] | null;
  /** 연결 칩 상태(부르는 쪽의 `linkChipState`) */
  chipLink: () => LinkChip;
  /** 바꾼 뒤 키보드를 입력 칸으로 */
  focusHome: () => void;
  /** 사진 · 파일 고르기(숨은 `<input type=file>`) — 메뉴 줄의 누름 안에서 곧바로 불러야 브라우저가 연다 */
  pickFiles: () => void;
}

/** 모델 키워드의 이름 — 값이 없으면 "Default", 있으면 목록 줄과 같은 글자(첫 글자 대문자 · GPT 머리글자 — `model-order`) */
export function keywordModelLabel(model: string): string {
  return model ? modelLabel(model) : t("app.chatDock.cliDefault");
}

/** 강도 이름의 보이는 글자 — 첫 글자만 대문자(값은 그대로 넘긴다). 빈 값 = "Default" */
export function effortName(effort: string): string {
  return effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : t("app.chatDock.effort.default");
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
  /** [직접 입력…] 칸이 열렸다(모델 메뉴 안 — 목록의 그 줄이 칸이 된다) */
  customOpen = $state(false);
  customText = $state("");
  /** Codex 의 모델 목록 — 모델 메뉴를 열 때 · Codex 로 바꿀 때 새로 읽는다(파일 둘 · 프로세스 없음) */
  codexModels = $state<CodexModels | null>(null);

  readonly chat = $derived.by(() => this.#o.chat());
  readonly offered = $derived.by(() => this.#o.offered() ?? []);
  readonly #live = $derived.by(() => (this.chat ? sideChatLiveOf(this.chat.id) : null));

  /** 확인하지 않은 CLI 버전(있으면 키워드에 경고 그림 · 메뉴 맨 위 한 줄) */
  readonly untested = $derived(this.#live?.state.untested ?? null);

  readonly customOk = $derived(sideChatModelOk(this.customText.trim()));

  // ── 모델 ───────────────────────────────────────────────────────────────────

  /**
   * 모델 줄 — "CLI 기본" 맨 앞, 그 뒤 고정 순서 별칭 → 버전 → 등급(`orderModels` — 고른 줄은 ✓ 로만) · 줄 글자만 첫 글자 대문자. 출처는 지어낸 이름 없이
   * (`sideChatModelChoices`): 지금 프로세스의 악수가 알린 목록(`ready.models`)이 있으면 그것, 없으면 Claude 별칭 · Codex 자신의 모델 캐시 +
   * `config.toml` 의 `model`. 목록 밖은 [직접 입력…].
   */
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

  /** 게이지의 칸(낮은 것부터) — 지금 고른 강도가 목록 밖이면 맨 앞에 둔다(되돌릴 수 있게) */
  readonly efforts = $derived.by<string[]>(() => {
    const c = this.chat;
    if (!c) return [];
    const list = this.#effortChoices;
    return c.effort === "" || list.includes(c.effort) ? list : [c.effort, ...list];
  });

  /** 강도를 받는 모델인가(빈 목록이면 게이지를 숨긴다 — 이미 고른 강도가 있으면 남긴다) */
  readonly effortShown = $derived(!!this.chat && this.efforts.length > 0);

  // ── 연결 · MCP ─────────────────────────────────────────────────────────────

  /** 이 창의 연결할 수 있는 타일(포커스된 것이 위) */
  readonly linkTiles = $derived.by<LinkTile[]>(() => (this.chat ? linkTilesHere() : []));
  readonly chipLink = $derived.by(() => this.#o.chipLink());
  /** 지금 프로세스에 실린 외부 MCP 서버 이름 */
  readonly mcp = $derived<string[]>(this.#live?.state.mcp ?? []);

  readonly #linkRows = $derived.by<ToolbarMenuRow[]>(() => {
    const c = this.chat;
    if (!c) return [];
    const out: ToolbarMenuRow[] = this.linkTiles.map((x) => ({
      key: `tile:${x.paneId}`,
      icon: x.kind === "ssh" ? "server" : "terminal",
      label: linkTilePickLabel(x),
      hint: x.readable ? (x.focused ? t("app.chatDock.link.focused") : "") : t("app.chatDock.link.readOff"),
      title: x.readable ? undefined : t("app.chatDock.link.readOff.title"),
      checked: c.tile?.stream === x.stream,
      radio: true,
    }));
    if (out.length === 0) out.push({ key: "none", icon: "", label: t("app.chatDock.link.noTiles"), disabled: true });
    out.push({ key: "unlink", icon: "close", label: t("app.chatDock.link.unlink"), disabled: !c.tile, sep: true });
    return out;
  });

  /** `[+]` 메뉴의 줄 — 갈래마다(하위 갈래의 맨 위는 `‹` 돌아가기 머리) */
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
        // 서버 이름 줄 — 앞에 MCP 그림(뿌리의 MCP 줄과 같은 `mcp` — 11-13 실기: 이름만이면 허전하다) · 누르면 설정 › MCP 의 서버 목록
        ...this.mcp.map((name, i) => ({ key: `server:${name}`, icon: "mcp", label: name, sep: i === 0 })),
        { key: "settings", icon: "settings", label: t("app.chatDock.mcp.settings"), sep: true },
      ];
    }
    const link = this.chipLink;
    const rows: ToolbarMenuRow[] = [
      // 이름 · 그림은 AI 타일 대화 면 `[+]`(`pane/AiFlip` 의 `attachPlus` — 같은 문구 키)와 같다 · 그림은 클립 `attach-file`(2026-11-14 사용자 결정)
      { key: "attach", icon: "attach-file", label: t("pane.flip.composer.attach") },
      { key: "link", icon: "link", label: t("app.chatDock.plus.link"), more: link.kind === "linked" ? link.name : "" },
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
    this.plusView = "root";
    this.plusOpen = !this.plusOpen;
  }

  closePlus(back: boolean): void {
    this.plusOpen = false;
    this.plusView = "root";
    if (back) this.plusBtn?.focus({ preventScroll: true });
  }

  /** `[+]` 의 ← (하위 갈래 → 뿌리) */
  plusBack(): void {
    if (this.plusView !== "root") this.plusView = "root";
  }

  /** `[+]` 메뉴의 줄 하나 — 하위 갈래로 들어가기는 닫지 않는다 · 나머지는 메뉴 통로로 */
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
      // 사진 · 파일 고르기 — 닫고 곧바로(같은 누름 안 — 브라우저가 파일 상자를 연다)
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
    // 연결 갈래의 줄 — 스냅샷(그 채팅 · 그 타일) → 닫기 → 연결 바꾸기
    runOnMenu(
      () => {
        const c = this.chat;
        if (!c) return null;
        if (key === "unlink") return { chat: c.id, tile: null };
        const tile = key.startsWith("tile:") ? this.linkTiles.find((x) => x.paneId === key.slice(5)) : undefined;
        return tile ? { chat: c.id, tile: { stream: tile.stream, name: linkTileName(tile) } } : null;
      },
      () => this.closePlus(false),
      ({ chat, tile }) => {
        void linkSideChat(chat, tile).then(() => {
          if (currentSideChat()?.id === chat) this.#o.focusHome();
        });
      },
    );
  }

  /** 입력 칸 위 연결 칩의 × */
  unlink(): void {
    const c = this.chat;
    if (!c) return;
    void linkSideChat(c.id, null).then(() => this.#o.focusHome());
  }

  // ── 모델 메뉴 ──────────────────────────────────────────────────────────────

  toggleModel(el: HTMLElement): void {
    this.modelBtn = el;
    this.plusOpen = false;
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

  /**
   * 고르기 — 메뉴 통로를 지난다(스냅샷 → 닫기 → 실행). 이 메뉴는 고른 뒤에도 열려 있어 닫기 자리가 비었다(모델과 Effort 를 한 번에 —
   * 사용자 D안). 대상(그 채팅)은 고른 순간에 뜬다.
   */
  #pick<T>(target: () => T | null, fn: (x: T) => void): void {
    runOnMenu(target, () => {}, fn);
  }

  pickCli(cli: string): void {
    this.#pick(
      () => (this.chat && cli !== this.chat.cli ? this.chat : null),
      (chat) => {
        // CLI 를 바꾸면 모델 · 강도는 그 CLI 의 마지막 선택으로(모델 이름 · 강도 낱말은 CLI 마다 다르다 — `setSideChatPick`)
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

  /** [직접 입력…] — 목록의 그 줄이 모델 이름 칸이 된다(Enter = 바꾸기 · Esc = 그만두기 · 메뉴는 그대로) */
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

  /** 모두 닫는다(독이 닫힐 때 · 채팅이 바뀔 때) */
  closeAll(): void {
    this.plusOpen = false;
    this.plusView = "root";
    this.modelOpen = false;
    this.customOpen = false;
  }

  /**
   * 바꿨다. 모델(값 있음)은 산 프로세스에 곧바로 — 턴 중이면 다음 턴부터라 묻지 않는다. CLI 바꾸기와 "CLI 기본"(대화 중에는 바꿀 수
   * 없어 프로세스를 닫고 다시 연다)은 프로세스를 닫으므로 **답하는 중이면 한 번 묻는다**(지금 턴이 끊긴다).
   */
  async #applyChange(chat: SideChat, cli: string, model: string): Promise<void> {
    if (!sideChatCliOk(cli)) return;
    // `chat` 은 목록의 그 채팅 자체(반응형 사본이 아니다) — 적기 전에 갈래를 정한다(적은 뒤엔 `chat.cli` 가 이미 새 값)
    const switching = cli !== chat.cli;
    const closes = switching || model === "";
    if (closes && sideChatLiveOf(chat.id)?.state.status === "running") {
      const ok = await askConfirm(t("app.chatDock.switch.busy"), { kind: "warning", okLabel: t("app.chatDock.switch.now") });
      if (!ok) return;
    }
    // CLI 를 바꾸면 그 CLI 의 기억된 모델 · 강도로 채운다(`setSideChatPick`) — 다시 열기가 그 강도도 싣는다
    setSideChatPick(chat.id, cli, model);
    const c = sideChats().find((x) => x.id === chat.id);
    if (!c) return;
    if (switching) await switchSideChatCli(targetOf(c));
    else await setSideChatModel(targetOf(c));
  }

  /** 강도를 적고(저장) 산 프로세스에 보낸다 — 없으면 서버가 다음 띄우기에 쓴다 */
  async #applyEffort(chat: SideChat, effort: string): Promise<void> {
    setSideChatEffortPick(chat.id, effort);
    const c = sideChats().find((x) => x.id === chat.id);
    if (!c) return;
    await setSideChatEffort(targetOf(c));
  }
}

/**
 * 타일 ⋯ 메뉴 · 터미널 우클릭 메뉴의 항목 목록 — 순수 함수라 종류별 목록이 테스트로 고정된다.
 * 분할 · 분리는 모든 타일에서 "분할 · 분리 ▸" 한 줄이다. SFTP 타일 · 원격 문서 타일은 옆 터미널의 세션을 빌려 쓰므로
 * 그 안에서 분리가 빠지고 라벨이 "분할" 이 된다(`startPaneTear` 와 같은 판정).
 * 지금 못 쓰는 줄은 숨기지 않고 흐리게 둔다 — 기능이 있다는 사실과 어디서 켜는지가 툴팁에서 읽혀야 한다.
 */

import { hasSession, type PaneKind, type Tr } from "$lib/session";
import { snippetSaveLabel } from "$lib/snippets";
import { AI_STAGE_NAME, type AiStage } from "$lib/delegation";
import { DB_AI_NAME, type DbAiLevel } from "$lib/db-ai";

/** 누른 결과를 상위 콜백으로 잇는 열쇠다(`PaneHost` 의 `runTileMenu`) */
export type PaneMenuAction =
  // ── 터미널 우클릭 메뉴에만 ──
  | "open-link"
  | "copy-link"
  | "copy"
  | "paste"
  | "select-all"
  /** xterm `clear()` — 셸에 `clear` 를 보내는 것이 아니다 */
  | "clear-screen"
  | "save-snippet"
  | "ask-ai"
  /** 고른 글자(없으면 그 블록)를 사이드 채팅 입력 칸에 채운다 — 보내지 않는다 */
  | "ask-side-chat"
  // ── 헤더 ⋯ 와 공통 ──
  | "split-row"
  | "split-col"
  | "folder-conversations"
  | "continue-side-chat"
  | "continue-orchestration"
  | "forward"
  | "edit-remote"
  | "sftp"
  | "tmux-sessions"
  | "copy-output"
  | "save-scrollback"
  | "session-log"
  | "ai-permission"
  | "toggle-ai-read"
  | "copy-path"
  | "new-doc"
  | "toggle-sync"
  | "detach"
  | "close"
  // ── 폰의 위 띠 ⋯ 메뉴에만 — 머리줄에만 있던 단추의 자리 ──
  | "flip"
  | "files"
  | "branches"
  // ── 타일이 머리줄 ⋯ 에 얹은 도구 줄 ──
  | `tool:${string}`;

export interface PaneMenuItem {
  action: PaneMenuAction;
  label: string;
  /** `ui-icons.generated.ts` 의 키 — 오타는 빈 칸으로 조용히 사라지므로 테스트가 생성 목록에 있는지 본다 */
  icon: string | null;
  checkbox?: boolean;
  checked?: boolean;
  disabled?: boolean;
  title?: string;
  /** 이 항목 앞에 구분선 */
  separator?: boolean;
  hint?: string;
}

/** `data-flyout` 속성으로 그대로 나간다 — 헤드리스 스크립트가 겨누는 이름 */
export type PaneFlyoutId =
  | "split"
  | "convo"
  | "block"
  | "server"
  | "output"
  | "format"
  | "paragraph"
  | "insert"
  | "copy-as"
  | "filter"
  | "refs";

/** 옆목록(`▸`)을 여는 줄 — 한 켜만 판다(목록 안의 `▸` 는 만들지 않는다) */
export interface PaneMenuGroup {
  flyout: PaneFlyoutId;
  label: string;
  icon: string | null;
  children: PaneMenuItem[];
  disabled?: boolean;
  title?: string;
  separator?: boolean;
}

export type PaneMenuRow = PaneMenuItem | PaneMenuGroup;

export function isGroup(row: PaneMenuRow): row is PaneMenuGroup {
  return "flyout" in row;
}

/** 액션 id 와 옆목록 id 는 겹치지 않는다 */
export function rowId(row: PaneMenuRow): PaneMenuAction | PaneFlyoutId {
  return isGroup(row) ? row.flyout : row.action;
}

/** 자식이 전부 흐리면 부모도 흐리고, 말풍선은 첫 자식의 사유를 그대로 쓴다 */
function flyoutRow(
  flyout: PaneFlyoutId,
  label: string,
  icon: string,
  title: string,
  children: PaneMenuItem[],
): PaneMenuGroup {
  const allOff = children.every((c) => c.disabled === true);
  return {
    flyout,
    label,
    icon,
    children,
    separator: true,
    disabled: allOff || undefined,
    title: allOff ? (children[0]?.title ?? title) : title,
  };
}

export interface PaneMenuCtx {
  /** 로컬 타일의 "AI 읽기 허용"(원격은 [`aiStage`]) */
  shared: boolean;
  /** 호스트 하나의 단계 — 호스트 목록에 없는 원격 타일(빠른 접속)은 `null` 이고 "AI 권한…" 줄이 흐려진다 */
  aiStage?: AiStage | null;
  /** 연결이 목록에 없으면 `null` */
  dbAi?: { level: DbAiLevel; broken: boolean } | null;
  syncOn: boolean;
  included: boolean;
  hasOutput: boolean;
  /** tmux 타일(간이 모드) — `hasOutput` 과 같은 흐림이지만 "기다려도 안 생긴다" 라 툴팁이 다르다 */
  screenOnly: boolean;
  hasScrollback: boolean;
  logging: boolean;
  /** 원격 창이면 메인 PC 의 저장 대화상자 · 기본 앱 · 편집기 · 창을 여는 줄을 그리지 않는다(폴리필 · 명령의 문이 거절한다) */
  remoteWindow?: boolean;
  folderConvoHint?: string;
  sideChatFork?: boolean;
  /** 종류만으로 갈리지 않는 빌림(원격 문서 타일) — 참이면 분리를 그리지 않는다 */
  borrowed?: boolean;
  /** 위 띠 ⋯(`MobileBar`)로 연 메뉴에만 넘긴다. `flip` = AI 타일의 지금 면(넘길 수 없으면 `null`) */
  phone?: { flip: "term" | "convo" | null };
  /** 폰 배치 — "분할 · 분리 ▸" 를 그리지 않는다 */
  solo?: boolean;
  /** 오케스트레이션 탭은 앱이 배치를 쥐므로 "분할 · 분리 ▸" 를 그리지 않는다 */
  orchTab?: boolean;
  orchContinue?: boolean;
  /** 머리줄 ⋯ · 머리줄 우클릭에만 넘긴다 — 메뉴 맨 위에 얹힌다 */
  tools?: readonly PaneMenuItem[];
  /** 머리줄 ⋯ · 머리줄 우클릭에만 넘긴다 — [경로 복사] 바로 위 */
  fileTools?: readonly PaneMenuItem[];
  /** 복사되는 것은 별칭 없는 `path` */
  docPath?: { path: string; alias: string } | null;
  /** `false` 면 흐리게, `null` · 없음이면 줄이 없다 */
  docNew?: boolean | null;
}

export function newDocItem(enabled: boolean, tr: Tr): PaneMenuItem {
  return {
    action: "new-doc",
    label: tr("files.doc.new"),
    icon: "plus",
    separator: true,
    ...(enabled ? {} : { disabled: true, title: tr("files.doc.edit.block.offline") }),
  };
}

export function docPathShown(p: { path: string; alias: string }): string {
  return p.alias ? `${p.alias}:${p.path}` : p.path;
}

/** 우클릭한 그 순간의 스냅샷 — 메뉴가 떠 있는 동안 화면은 계속 흐른다 */
export interface TermMenuCtx extends PaneMenuCtx {
  link: string | null;
  hasSelection: boolean;
  snippet: SnippetSource | null;
  askBlock?: { fromRow: boolean } | null;
  askHint?: string;
  sideChat?: boolean;
  /** 손가락으로 고른 선택의 띠(`term/TouchSelection.svelte`)에서 ⋯ 로 열었다 — 띠에 있는 복사 · 붙여넣기 · 모두 선택을 뺀다 */
  barEdits?: boolean;
  /** AI 타일의 대화 면에서 열었다 — 같은 메뉴에서 붙여넣기 · 화면 지우기만 뺀다 */
  convo?: boolean;
}

export interface SnippetSource {
  command: string;
  /** `false` = 커서 밑에 블록이 없어 마지막 끝난 명령으로 물러섰다 — 라벨이 다르다 */
  fromRow: boolean;
}

function phoneRows(kind: PaneKind, ctx: PaneMenuCtx, tr: Tr): PaneMenuItem[] {
  const phone = ctx.phone;
  if (phone === undefined) return [];
  const rows: PaneMenuItem[] = [];
  if (phone.flip !== null) {
    const toConvo = phone.flip === "term";
    rows.push({
      action: "flip",
      label: tr(toConvo ? "pane.flip.toConvo" : "pane.flip.toTerm"),
      icon: toConvo ? "conversations" : "terminal",
    });
  }
  if (kind === "local") rows.push({ action: "files", label: tr("pane.header.folder.unknown"), icon: "folder" });
  if (kind === "local" || kind === "ssh") rows.push({ action: "branches", label: tr("pane.menu.branches"), icon: "git-branch" });
  return rows;
}

export function menuItemsFor(kind: PaneKind, ctx: PaneMenuCtx, tr: Tr): PaneMenuRow[] {
  const items: PaneMenuRow[] = [];
  // 원격 창의 새 창은 메인 PC 의 창이라 `open_tear_window` 를 `remote/deny.rs` 가 거절한다
  const detachable =
    kind !== "sftp" &&
    kind !== "start" &&
    ctx.borrowed !== true &&
    ctx.solo !== true &&
    ctx.orchTab !== true &&
    ctx.remoteWindow !== true;
  // 어느 메뉴에서나 맨 첫 줄 — 도구 줄보다도 위다(폰 줄은 `solo` 라 함께 서지 않는다)
  if (ctx.solo !== true && ctx.orchTab !== true) {
    const split: PaneMenuItem[] = [
      { action: "split-row", label: tr("pane.menu.split_row"), icon: "split-h" },
      { action: "split-col", label: tr("pane.menu.split_col"), icon: "split-v" },
    ];
    if (detachable) split.push({ action: "detach", label: tr("pane.menu.detach"), icon: "window" });
    items.push(
      detachable
        ? flyoutRow("split", tr("pane.menu.splitDetach"), "layout", tr("pane.menu.splitDetach.title"), split)
        : flyoutRow("split", tr("pane.menu.split"), "layout", tr("pane.menu.split.title"), split),
    );
  }
  const lead = [...phoneRows(kind, ctx, tr), ...(ctx.tools ?? [])];
  const leadHead = lead[0];
  if (leadHead !== undefined) lead[0] = { ...leadHead, separator: true };
  items.push(...lead);

  const convo: PaneMenuItem[] = [];
  if (hasSession(kind)) {
    convo.push({
      action: "folder-conversations",
      label: tr("pane.menu.folder_conversations"),
      icon: "conversations",
      hint: ctx.folderConvoHint || undefined,
    });
  }
  if (kind === "local" && ctx.sideChatFork === true) {
    convo.push({
      action: "continue-side-chat",
      label: tr("pane.menu.continueSideChat"),
      icon: "side-panel",
      title: tr("pane.menu.continueSideChat.title"),
    });
  }
  if (kind === "local" && ctx.orchContinue === true) {
    convo.push({
      action: "continue-orchestration",
      label: tr("pane.menu.continueOrch"),
      icon: "orchestra",
      title: tr("pane.menu.continueOrch.title"),
    });
  }
  // 하나뿐이어도 묶는다 — 대화를 알게 되는 순간 지난 대화 줄이 묶음에 들어갔다 나왔다 하면 손이 자리를 잃는다
  if (convo.length > 0) {
    items.push(flyoutRow("convo", tr("pane.menu.convo"), "conversations", tr("pane.menu.convo.title"), convo));
  }

  if (kind === "ssh") {
    const server: PaneMenuItem[] = [
      { action: "forward", label: tr("pane.menu.forward"), icon: "forward" },
      { action: "sftp", label: tr("pane.menu.sftp"), icon: "folder" },
      ...(ctx.remoteWindow ? [] : [{ action: "edit-remote" as const, label: tr("pane.menu.edit_remote"), icon: "edit" }]),
    ];
    // 머리줄의 tmux 칩이 주 입구지만 지우지 않는다 — `[app] tile_header` 로 머리줄을 끄면 여기가 유일한 길이다
    if (ctx.screenOnly) {
      server.push({
        action: "tmux-sessions",
        label: tr("pane.menu.tmux"),
        icon: "list",
        title: tr("pane.menu.tmux.title"),
      });
    }
    items.push(
      flyoutRow("server", tr("pane.menu.server"), "server", tr("pane.menu.server.title"), server),
    );
  }

  if (hasSession(kind)) {
    items.push(
      flyoutRow("output", tr("pane.menu.output"), "terminal", tr("pane.menu.output.title"), [
        {
          action: "copy-output",
          label: tr("pane.menu.copy_output"),
          icon: "copy",
          disabled: ctx.screenOnly || !ctx.hasOutput,
          title: ctx.screenOnly
            ? tr("pane.menu.copy_output.title.screen_only")
            : ctx.hasOutput
              ? tr("pane.menu.copy_output.title.ready")
              : tr("pane.menu.copy_output.title.empty"),
        },
        ...(ctx.remoteWindow
          ? []
          : [
              // tmux 타일에서도 스크롤백 저장은 살아 있다 — 버퍼는 간이 모드에도 있다
              {
                action: "save-scrollback" as const,
                label: tr("pane.menu.save_scrollback"),
                icon: "file-down",
                disabled: !ctx.hasScrollback,
                title: ctx.hasScrollback
                  ? tr("pane.menu.save_scrollback.title.ready")
                  : tr("pane.menu.save_scrollback.title.empty"),
              },
              {
                action: "session-log" as const,
                label: tr("pane.menu.session_log"),
                icon: "file-text",
                disabled: !ctx.logging,
                title: ctx.logging
                  ? tr("pane.menu.session_log.title.on")
                  : tr("pane.menu.session_log.title.off"),
              },
            ]),
      ]),
    );
    const aiRow: PaneMenuItem =
      kind === "ssh"
        ? // 원격 — 권한은 호스트 하나의 단계라 체크 하나로 말할 수 없다
          {
            action: "ai-permission",
            separator: true,
            label: tr("pane.menu.aiperm"),
            // 단계는 머리줄 칩의 게이지가 말한다 — 메뉴 줄은 단계와 무관한 고정 그림
            icon: "shield-check",
            disabled: ctx.aiStage == null,
            title:
              ctx.aiStage == null
                ? tr("app.ai.adhoc")
                : tr("pane.menu.aiperm.title", { stage: tr(AI_STAGE_NAME[ctx.aiStage]) }),
          }
        : // 로컬 — 단계가 Off · Read 둘뿐이라 체크 하나로 말한다
          {
            action: "toggle-ai-read",
            separator: true,
            label: tr("pane.menu.aiRead"),
            // 머리줄 눈 칩과 같은 그림 — 켜짐 ✓ 는 `PaneMenu` 가 줄 끝에 그린다
            icon: "ai-read",
            checkbox: true,
            checked: ctx.shared,
            title: tr("pane.menu.aiRead.title"),
          };
    items.push(
      aiRow,
      {
        action: "toggle-sync",
        label: tr("pane.menu.sync"),
        icon: "keyboard",
        checkbox: true,
        checked: ctx.included,
        disabled: !ctx.syncOn,
        title: ctx.syncOn ? tr("pane.menu.sync.title.on") : tr("pane.menu.sync.title.off"),
      },
    );
  }

  if (kind === "query") {
    const db = ctx.dbAi ?? null;
    items.push({
      action: "ai-permission",
      separator: true,
      label: tr("pane.menu.aiperm"),
      icon: "shield-check",
      disabled: db === null,
      title:
        db === null
          ? tr("pane.menu.dbaiperm.missing")
          : db.broken
            ? tr("app.dbai.broken")
            : tr("pane.menu.dbaiperm.title", { stage: tr(DB_AI_NAME[db.level]) }),
    });
  }

  if (kind === "doc" || kind === "image") {
    const file: PaneMenuItem[] = (ctx.fileTools ?? []).map((x) => ({ ...x, separator: undefined }));
    if (ctx.docPath != null && ctx.docPath.path !== "") {
      file.push({
        action: "copy-path",
        label: tr("files.menu.copypath"),
        icon: "copy",
        title: docPathShown(ctx.docPath),
      });
    }
    const head = file[0];
    if (head !== undefined) file[0] = { ...head, separator: true };
    items.push(...file);
  }
  if (kind === "doc" && ctx.docNew != null) items.push(newDocItem(ctx.docNew, tr));

  items.push({
    action: "close",
    label: tr("pane.menu.close"),
    icon: "close",
    separator: true,
  });
  const first = items[0];
  if (first !== undefined && first.separator === true) items[0] = { ...first, separator: undefined };
  return items;
}

/**
 * 헤더 ⋯ 메뉴와 한 정의다 — 머리줄을 끈 사람에게 타일 조작으로 가는 유일한 마우스 길이라 새 항목이 저절로 따라와야 한다.
 * 맨 위는 ⋯ 와 같은 "분할 · 분리 ▸", 그 아래 링크 · 편집 묶음 · 우클릭한 자리에 하는 일(고른 글자의 사이드 채팅 · "이 블록 ▸" ·
 * 끌어올린 "출력 ▸")이 오고, 그 뒤가 ⋯ 의 나머지다.
 * "서버 ▸" 는 ⋯ 전용이다(우클릭은 화면 위 몸짓 — 팔레트 · `Ctrl+Shift+O` 가 같은 곳으로 간다).
 */
export function terminalMenuItems(kind: PaneKind, ctx: TermMenuCtx, tr: Tr): PaneMenuRow[] {
  const items: PaneMenuRow[] = [];
  const rest = menuItemsFor(kind, ctx, tr);
  const split = rest.find((row) => rowId(row) === "split");
  if (split) items.push({ ...split, separator: undefined });

  if (ctx.link !== null) {
    items.push(
      {
        action: "open-link",
        label: tr("pane.menu.open_link"),
        icon: "external",
        title: ctx.link,
        ...(items.length > 0 ? { separator: true } : {}),
      },
      { action: "copy-link", label: tr("pane.menu.copy_link"), icon: "copy", title: ctx.link },
    );
  }

  // 편집 묶음 — 띠가 이미 낸 줄(`barEdits`)과 대화 면에 없는 것(붙여넣을 자리 · 지울 화면)을 뺀다
  const edit: PaneMenuItem[] = [];
  if (!ctx.barEdits) {
    if (ctx.hasSelection) edit.push({ action: "copy", label: tr("pane.menu.copy"), icon: "copy" });
    if (!ctx.convo) edit.push({ action: "paste", label: tr("pane.menu.paste"), icon: "paste" });
    edit.push({ action: "select-all", label: tr("pane.menu.select_all"), icon: "select-all" });
  }
  if (!ctx.convo) {
    edit.push({ action: "clear-screen", label: tr("pane.menu.clear"), icon: "erase", title: tr("pane.menu.clear.title") });
  }
  if (edit.length > 0 && items.length > 0) edit[0] = { ...edit[0], separator: true };
  items.push(...edit);

  const sideChat = ctx.sideChat === true && (kind === "local" || kind === "ssh");
  const at = items.length;

  // 고른 글자에 하는 일이라 "이 블록 ▸" 에 넣지 않는다
  if (sideChat && ctx.hasSelection) {
    items.push({
      action: "ask-side-chat",
      label: tr("pane.menu.askSideChat"),
      icon: "side-panel",
      title: tr("pane.menu.askSideChat.selection"),
    });
  }

  // 블록이 없으면(셸 통합 없음 · tmux 간이 모드) 넘길 것이 영영 없어 흐리게가 아니라 아예 없다.
  // `askBlock` · `snippet` 은 `block-target.ts` 의 같은 판정에서 나와 함께 있고 `fromRow` 도 같다
  const block: { item: PaneMenuItem; short: string }[] = [];
  if (!ctx.screenOnly && ctx.askBlock) {
    block.push({
      item: {
        action: "ask-ai",
        label: ctx.askBlock.fromRow ? tr("pane.menu.askai.row") : tr("pane.menu.askai.last"),
        icon: "ai",
        title: tr("pane.menu.askai.title"),
        hint: ctx.askHint || undefined,
      },
      short: tr("pane.menu.askai.short"),
    });
    if (sideChat && !ctx.hasSelection) {
      const label = tr("pane.menu.askSideChat");
      block.push({
        item: { action: "ask-side-chat", label, icon: "side-panel", title: tr("pane.menu.askSideChat.block") },
        short: label,
      });
    }
  }
  if (!ctx.screenOnly && ctx.snippet !== null) {
    block.push({
      item: {
        action: "save-snippet",
        label: ctx.snippet.fromRow
          ? tr("pane.menu.snippet.row", { name: snippetSaveLabel(ctx.snippet.command) })
          : tr("pane.menu.snippet.last"),
        icon: "bookmark",
        title: ctx.snippet.fromRow
          ? tr("pane.menu.snippet.row.title")
          : tr("pane.menu.snippet.last.title"),
      },
      short: tr("pane.menu.snippet.short"),
    });
  }
  if (block.length >= 2) {
    const fromRow = (ctx.askBlock ?? ctx.snippet)?.fromRow !== false;
    items.push({
      ...flyoutRow(
        "block",
        tr(fromRow ? "pane.menu.block.row" : "pane.menu.block.last"),
        "command",
        tr("pane.menu.block.title"),
        block.map((b) => ({ ...b.item, label: b.short })),
      ),
      separator: undefined,
    });
  } else if (block[0] !== undefined) {
    items.push(block[0].item);
  }

  const output = rest.find((row) => rowId(row) === "output");
  if (output) items.push({ ...output, separator: undefined });
  // 이 묶음의 선은 첫 줄 하나만 인다
  const head = items[at];
  if (head !== undefined) items[at] = { ...head, separator: at > 0 || undefined };

  const tail = dropRows(rest, ["split", "output", "server"]);
  for (const [i, item] of tail.entries()) {
    items.push(i === 0 ? { ...item, separator: items.length > 0 } : item);
  }
  return items;
}

/** 빼는 줄이 들고 있던 구분선은 다음 줄에 넘긴다 — 구분선은 묶음의 경계다 */
function dropRows(
  rows: readonly PaneMenuRow[],
  ids: readonly (PaneMenuAction | PaneFlyoutId)[],
): PaneMenuRow[] {
  const out: PaneMenuRow[] = [];
  let carried = false;
  for (const row of rows) {
    if (ids.includes(rowId(row))) {
      carried ||= row.separator === true;
      continue;
    }
    out.push(carried && row.separator !== true ? { ...row, separator: true } : row);
    carried = false;
  }
  return out;
}

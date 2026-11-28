// 채팅 모양 AI 타일 명세(`PaneSpec.chat`)의 순수 층 — 배치 파일 · 창 이관 · 원격 거울로 나가므로 토큰 칸은 없다.

import type { ChatTileSpec, PaneSpec } from "$lib/session/spec";
import type { TierView } from "$lib/side-chat-api";
import type { ChatTileTiers } from "./chat-tile-api";
import { permModeOk } from "./chat-tile-mode";

const ID_RE = /^ct-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** `orch-tab` 의 `WORD_RE` 와 같은 꼴(서버 `word_ok` 근사) */
const WORD_RE = /^[A-Za-z0-9._:[\]-]{0,64}$/;
const CONV_RE = /^[A-Za-z0-9-]{8,80}$/;
const CWD_MAX = 4096;

export function newChatTileId(): string {
  return `ct-${crypto.randomUUID().toLowerCase()}`;
}

export function chatTileIdOk(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

/** id · cli 가 틀리면 `null` — 복원은 그 잎을 시작 타일로 세운다 */
export function parseChatTileSpec(raw: unknown): ChatTileSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!chatTileIdOk(r.chatId)) return null;
  if (r.cli !== "claude" && r.cli !== "codex") return null;
  const word = (v: unknown) => (typeof v === "string" && WORD_RE.test(v) ? v : "");
  const out: ChatTileSpec = {
    chatId: r.chatId,
    cli: r.cli,
    model: word(r.model),
    effort: word(r.effort),
    cwd: typeof r.cwd === "string" && r.cwd.length <= CWD_MAX ? r.cwd : "",
  };
  if (typeof r.conv === "string" && CONV_RE.test(r.conv)) out.conv = r.conv;
  // 틀린 모드는 칸만 버린다 — 잎은 사용자 CLI 설정으로 산다
  if (permModeOk(r.cli, r.permMode)) out.permMode = r.permMode;
  if (r.cli === "codex" && tierWordOk(r.tier)) out.tier = r.tier;
  return out;
}

/** 속도 등급 id 의 꼴(서버 `word_ok` · 32 바이트) — 이 모델이 고를 수 있는지는 `tierOffered` */
export function tierWordOk(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= 32 && WORD_RE.test(v);
}

const TIER_NAME_MAX = 40;
const TIER_DESC_MAX = 120;

/** 스냅숏 · 사건의 등급 표를 칸째 다시 짓는다 — 꼴이 틀린 줄은 버린다 */
export function tiersOf(raw: unknown): ChatTileTiers | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const byModel: Record<string, TierView[]> = {};
  const src = r.byModel && typeof r.byModel === "object" && !Array.isArray(r.byModel) ? (r.byModel as Record<string, unknown>) : {};
  for (const [model, list] of Object.entries(src)) {
    if (!Array.isArray(list)) continue;
    byModel[model] = list.flatMap((x): TierView[] => {
      if (!x || typeof x !== "object") return [];
      const t = x as Record<string, unknown>;
      if (!tierWordOk(t.id)) return [];
      const name = typeof t.name === "string" && t.name.trim() !== "" ? t.name.slice(0, TIER_NAME_MAX) : t.id;
      const description = typeof t.description === "string" ? t.description.slice(0, TIER_DESC_MAX) : "";
      return [{ id: t.id, name, description }];
    });
  }
  return { byModel, thread: tierWordOk(r.thread) ? r.thread : null };
}

/** 그 모델이 알린 등급 — 모르면(목록 전 · 그 모델 칸 없음) 빈 목록 */
export function tierOptions(tiers: ChatTileTiers | null, model: string): TierView[] {
  const list = tiers?.byModel?.[model];
  return Array.isArray(list) ? list.filter((x) => !!x && tierWordOk(x.id)) : [];
}

/** 사람이 고른 등급이 그 모델의 목록에 있다 — 목록을 모르면 거짓(보내지 않는다) */
export function tierOffered(tiers: ChatTileTiers | null, model: string, tier: string): boolean {
  return tierOptions(tiers, model).some((x) => x.id === tier);
}

/** 키 순서가 늘 같아야 한다(자동 저장의 문자열 비교) */
export function saveChatTileSpec(p: ChatTileSpec): ChatTileSpec {
  const out: ChatTileSpec = { chatId: p.chatId, cli: p.cli, model: p.model, effort: p.effort, cwd: p.cwd };
  if (p.conv) out.conv = p.conv;
  if (p.permMode) out.permMode = p.permMode;
  if (p.tier) out.tier = p.tier;
  return out;
}

/** 대화 장부의 스트림 이름 — 채팅 잎은 셸이 없어 `chatId` 가 그 자리다 */
export function paneStreamOf(pane: Pick<PaneSpec, "id" | "kind" | "chat" | "historyStreamId">): string | undefined {
  return pane.kind === "chat" ? pane.chat?.chatId : (pane.historyStreamId ?? pane.id);
}

/**
 * 연결이 선 대화를 명세의 `conv` 로 — 고칠 것이 없으면 `null`. 연결을 풀어도(`null`) 지우지 않는다(`conv` 는 다시 세울 때의 resume 열쇠).
 * 원격 창은 메인 PC 의 명세를 고치지 않는다.
 */
export function chatSpecWithConv(chat: ChatTileSpec | undefined, conv: string | null, remote: boolean): ChatTileSpec | null {
  if (!chat || conv === null || remote || chat.conv === conv) return null;
  return { ...chat, conv };
}

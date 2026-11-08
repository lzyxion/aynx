/**
 * **앨범마다 마지막으로 본 프로듀서**(이 브라우저의 편의 — `localStorage` · 없어도 앱은 돈다).
 *
 * - CLI · 모델 · 강도 — [새 프로듀서로 이어받기] 칩의 기본값(`app/orch-start`).
 * - 채팅 id · 대화 id(10-31) — 끝난 앨범의 [프로듀서 대화 기록] · 마무리 카드가 그 대화의 기록을 읽는다. 서버는 채팅이 닫히면 대화 id 를
 *   들고 있지 않다(프로듀서 레지스트리는 메모리 · Run 파일에는 채팅 id 만). 그래서 채팅이 앨범에 묶여 보일 때마다 여기 적어 둔다.
 *   대화 id 는 이미 잎 주소(`ProducerSpec.conv` — 저장되는 탭 상태)에 있는 값과 같은 것이다(토큰 · 본문 아님).
 *
 * 기록이 없으면(다른 브라우저 · 지운 저장소 · 이 기능 전에 끝난 앨범) 카드와 단추가 서지 않는다.
 */

/** 앨범의 직전 프로듀서 값 */
export interface ProducerPick {
  cli: string;
  model: string;
  effort: string;
  /** 그 채팅 id(`pc-…`) */
  chat?: string;
  /** 그 채팅 자신의 대화 id(첫 턴이 선 뒤 — 갈라 온 원본 대화가 아니다) */
  conv?: string;
}

const LAST_KEY = "aynx:orch-last-producer";
/** 기억하는 앨범 수(오래된 것부터 버린다) */
const LAST_MAX = 40;
const CHAT_RE = /^pc-[A-Za-z0-9-]{1,77}$/;
const CONV_RE = /^[A-Za-z0-9-]{8,80}$/;

function readLast(): Record<string, ProducerPick & { at: number }> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, ProducerPick & { at: number }>) : {};
  } catch {
    return {};
  }
}

/** 그 앨범의 직전 프로듀서 값(없으면 `null`) — 채팅 · 대화 id 는 꼴이 맞을 때만 */
export function lastProducerOf(runId: string): ProducerPick | null {
  const v = readLast()[runId];
  if (!v || (v.cli !== "claude" && v.cli !== "codex")) return null;
  const out: ProducerPick = { cli: v.cli, model: typeof v.model === "string" ? v.model : "", effort: typeof v.effort === "string" ? v.effort : "" };
  if (typeof v.chat === "string" && CHAT_RE.test(v.chat)) {
    out.chat = v.chat;
    if (typeof v.conv === "string" && CONV_RE.test(v.conv)) out.conv = v.conv;
  }
  return out;
}

/**
 * 그 앨범의 프로듀서 값을 적는다(채팅이 앨범에 묶여 보일 때 — 같으면 쓰지 않는다). 채팅 id 를 주지 않으면 알던 채팅 · 대화는 둔다,
 * 다른 채팅이면 옛 대화 id 를 버린다(이어받은 새 프로듀서의 기록이 옛 프로듀서 대화로 읽히지 않게).
 */
export function rememberProducer(runId: string, p: ProducerPick): void {
  const all = readLast();
  const old = all[runId];
  const chat = p.chat ?? old?.chat;
  const conv = p.conv ?? (chat === old?.chat ? old?.conv : undefined);
  if (old && old.cli === p.cli && old.model === p.model && old.effort === p.effort && old.chat === chat && old.conv === conv) return;
  all[runId] = { cli: p.cli, model: p.model, effort: p.effort, ...(chat ? { chat } : {}), ...(chat && conv ? { conv } : {}), at: Date.now() };
  const keep = Object.entries(all)
    .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
    .slice(0, LAST_MAX);
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* 저장소를 못 쓰면 기억하지 않는다(편의일 뿐) */
  }
}

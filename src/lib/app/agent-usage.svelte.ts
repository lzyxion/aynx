import { agentUsageLimits, agentUsageScan, agentUsageSummary } from "$lib/context";
import { usageMap, type AgentLimits, type ConversationUsage } from "$lib/agent-usage";
import { DEFAULT_PERIOD, parseUsageFilter, type UsageFilter, type UsageSummary } from "$lib/usage-board";
import { withoutDisabled } from "$lib/agent-enabled";
import { settings } from "$lib/settings.svelte.js";

/**
 * **사용량의 저장소** — 대화마다 토큰(Rust `agent_usage_scan`)과 에이전트마다 한도 %(`agent_usage_limits`)
 * (docs/log/2026-09-26-agent-usage.md). 글자로 바꾸는 규칙은 순수 층 `$lib/agent-usage`.
 *
 * ## 읽는 때
 *
 * - **토큰**: 지난 대화 목록을 읽은 **뒤에** 한 번(`app/agent-sessions` 가 부른다) — 목록은 앞·꼬리만 읽어 빠르고,
 *   토큰은 첫 호출에 파일 전체를 읽으므로(수백 ms) 목록을 막지 않게 둘째 호출로 둔다. 그다음부터는 늘어난 몫만.
 * - **한도**: 앱이 뜰 때 한 번(상태바 경고) · 사용량 화면이 보이는 동안 1분마다 · 에이전트 턴이 끝났을
 *   때(`stop` 신호 — 모아서). 싸다(파일 하나 + 롤아웃 꼬리 몇 개).
 *
 * 실패는 조용하다 — 숫자가 비면 화면은 안내 한 줄이다(지어낸 값을 세우지 않는다).
 */

let usage = $state.raw<Map<string, ConversationUsage>>(new Map());
let usageLoaded = $state(false);
let usageSeq = 0;

let limits = $state.raw<AgentLimits[]>([]);
let limitsLoaded = $state(false);
let limitsSeq = 0;
let limitsTimer: ReturnType<typeof setTimeout> | null = null;

/** 분 시계 — 상태바 경고가 초기화 시각을 지나면 스스로 걷히게(값을 다시 읽지 않아도) */
let clock = $state(Date.now());
let clockStarted = false;

/** `stop` 뒤 한도를 다시 읽기까지 모으는 시간 */
const LIMITS_DEBOUNCE_MS = 3000;

/** 대화마다 토큰 — 반응형 */
export function conversationUsage(): ReadonlyMap<string, ConversationUsage> {
  return usage;
}

/** 토큰을 한 번이라도 읽었나 — 반응형 */
export function usageReady(): boolean {
  return usageLoaded;
}

/** 에이전트마다 한도 — 반응형 */
export function agentLimits(): readonly AgentLimits[] {
  return limits;
}

/**
 * 화면에 세울 한도 — 설정에서 끈 에이전트(`[ai] disabled_agents`)를 뺀다. 상태바 고리 · 팔레트 사용량 줄 · 대시보드 한도
 * 카드가 읽는다(사용량 칩은 "고르는 자리" 쪽이다). 토큰 기록(사용량 화면의 표)은 지난 대화처럼 그대로 둔다. 반응형.
 */
export function enabledAgentLimits(): readonly AgentLimits[] {
  return withoutDisabled(limits, (l) => l.agent, settings.disabledAgents);
}

/** 한도를 한 번이라도 읽었나 — 반응형 */
export function limitsReady(): boolean {
  return limitsLoaded;
}

/** 분 시계 — 반응형 */
export function usageClock(): number {
  return clock;
}

/** 토큰을 (다시) 읽는다 — 목록 읽기가 끝난 뒤. 옛 값은 새 답이 올 때까지 둔다 */
export async function loadUsage(): Promise<void> {
  const mine = ++usageSeq;
  try {
    const r = await agentUsageScan();
    if (mine === usageSeq) {
      usage = usageMap(r);
      usageLoaded = true;
    }
  } catch (e) {
    console.warn("[aynx] 사용량 읽기 실패:", e);
  }
}

/** 한도를 (다시) 읽는다 */
export async function loadLimits(): Promise<void> {
  const mine = ++limitsSeq;
  if (!clockStarted) {
    clockStarted = true;
    setInterval(() => (clock = Date.now()), 60_000);
  }
  try {
    const r = await agentUsageLimits();
    if (mine === limitsSeq) {
      limits = r;
      limitsLoaded = true;
      clock = Date.now();
    }
  } catch (e) {
    console.warn("[aynx] 사용 한도 읽기 실패:", e);
  }
}

/** 에이전트 턴이 끝났다 — 잠시 모아 한도를 다시 읽는다(상태바 경고가 낡지 않게) */
export function scheduleLimitsRefresh(): void {
  if (limitsTimer !== null) clearTimeout(limitsTimer);
  limitsTimer = setTimeout(() => {
    limitsTimer = null;
    void loadLimits();
  }, LIMITS_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// 대시보드 "사용량" 칸 — 기간 요약 · 거르개 · 고른 날
// ---------------------------------------------------------------------------

/** 거르개의 저장 이름 — 창·세션을 건너 남는 **보는 사람의 편의**라 `localStorage` 다(프로젝트 펼침과 같은 규칙) */
const FILTER_STORE_KEY = "aynx.usage.filter";

let filter = $state<UsageFilter>({ agent: null, period: DEFAULT_PERIOD });
let filterLoaded = false;
let summary = $state.raw<UsageSummary | null>(null);
let summaryLoading = $state(false);
let summaryError = $state<string | null>(null);
let summarySeq = 0;
/** 잔디에서 고른 날 — `null` 이면 오늘 */
let pickedDay = $state<string | null>(null);
/**
 * 요약의 **출처**(docs/log/2026-09-27-remote-conversations.md "2단계") — 이 PC 를 넣나 · 원격 별칭들. 사용량 칸이 대시보드의
 * "어디서" 칩에서 정해 넘긴다(`setUsageSource`). 기본은 이 PC 만 — 예전 그대로.
 */
let source: { local: boolean; hosts: string[] } = { local: true, hosts: [] };
let sourceKey = "local|";

function ensureFilter(): void {
  if (filterLoaded) return;
  filterLoaded = true;
  try {
    if (typeof localStorage !== "undefined") filter = parseUsageFilter(localStorage.getItem(FILTER_STORE_KEY));
  } catch {
    // 저장소가 막혀 있으면 기본값 그대로(언제든 던질 수 있다)
  }
}

/** 지금 거르개 — 반응형 */
export function usageFilter(): UsageFilter {
  ensureFilter();
  return filter;
}

/** 거르개를 바꾸고 기억한 뒤 다시 읽는다 */
export function setUsageFilter(next: Partial<UsageFilter>): void {
  ensureFilter();
  filter = { ...filter, ...next };
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(FILTER_STORE_KEY, JSON.stringify(filter));
  } catch {
    // 기억하지 못해도 이 창에서는 그대로 쓴다
  }
  void loadUsageSummary();
}

/** 기간 요약 — 반응형 */
export function usageSummary(): UsageSummary | null {
  return summary;
}

export function usageSummaryLoading(): boolean {
  return summaryLoading;
}

export function usageSummaryError(): string | null {
  return summaryError;
}

/** 고른 날(없으면 `null` = 오늘) — 반응형 */
export function pickedUsageDay(): string | null {
  return pickedDay;
}

export function pickUsageDay(date: string | null): void {
  pickedDay = date;
}

/**
 * 요약의 출처를 바꾼다 — 바뀌었으면(또는 `force`) 다시 읽는다. 원격 몫은 Rust 의 원격 캐시에서만 온다(여기서 서버에 묻지
 * 않는다 — 원격 목록 · 전체 사용량 읽기가 캐시를 채운 뒤 다시 부르면 새 값이 든다).
 */
export function setUsageSource(next: { local: boolean; hosts: string[] }, force = false): void {
  const key = `${next.local ? "local" : ""}|${next.hosts.join(",")}`;
  if (key === sourceKey && !force) return;
  sourceKey = key;
  source = { local: next.local, hosts: [...next.hosts] };
  void loadUsageSummary();
}

/** 기간 요약을 (다시) 읽는다 — 칸이 보일 때 · 거르개가 바뀔 때. 옛 값은 새 답이 올 때까지 둔다 */
export async function loadUsageSummary(): Promise<void> {
  ensureFilter();
  const mine = ++summarySeq;
  summaryLoading = true;
  try {
    const r = await agentUsageSummary(filter.period, filter.agent, source);
    if (mine === summarySeq) {
      summary = r;
      summaryError = null;
      // 고른 날이 기간 밖으로 밀려났으면 오늘로
      if (pickedDay !== null && !r.daily.some((d) => d.date === pickedDay)) pickedDay = null;
    }
  } catch (e) {
    if (mine === summarySeq) summaryError = String(e);
  } finally {
    if (mine === summarySeq) summaryLoading = false;
  }
}

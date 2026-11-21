import { agentUsageLimits, agentUsageScan, agentUsageSummary } from "$lib/context";
import { usageMap, type AgentLimits, type ConversationUsage } from "$lib/agent-usage";
import { DEFAULT_PERIOD, parseUsageFilter, type UsageFilter, type UsageSummary } from "$lib/usage-board";
import { withoutDisabled } from "$lib/agent-enabled";
import { settings } from "$lib/settings.svelte.js";

/** 사용량의 저장소 — 실패는 조용하다(숫자가 비면 화면은 안내 한 줄 · 지어낸 값을 세우지 않는다) */

let usage = $state.raw<Map<string, ConversationUsage>>(new Map());
let usageLoaded = $state(false);
let usageSeq = 0;

let limits = $state.raw<AgentLimits[]>([]);
let limitsLoaded = $state(false);
let limitsSeq = 0;
let limitsTimer: ReturnType<typeof setTimeout> | null = null;

/** 상태바 경고가 초기화 시각을 지나면 값을 다시 읽지 않아도 걷히게 */
let clock = $state(Date.now());
let clockStarted = false;

const LIMITS_DEBOUNCE_MS = 3000;

export function conversationUsage(): ReadonlyMap<string, ConversationUsage> {
  return usage;
}

export function usageReady(): boolean {
  return usageLoaded;
}

export function agentLimits(): readonly AgentLimits[] {
  return limits;
}

/** 끈 에이전트를 뺀다 — 토큰 기록(사용량 화면의 표)은 지난 대화처럼 그대로 둔다 */
export function enabledAgentLimits(): readonly AgentLimits[] {
  return withoutDisabled(limits, (l) => l.agent, settings.disabledAgents);
}

export function limitsReady(): boolean {
  return limitsLoaded;
}

export function usageClock(): number {
  return clock;
}

/** 목록 읽기가 끝난 뒤에 부른다 — 첫 호출은 파일 전체를 읽어 목록을 막는다 */
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

export function scheduleLimitsRefresh(): void {
  if (limitsTimer !== null) clearTimeout(limitsTimer);
  limitsTimer = setTimeout(() => {
    limitsTimer = null;
    void loadLimits();
  }, LIMITS_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// 대시보드 "사용량" 칸
// ---------------------------------------------------------------------------

/** 보는 사람의 편의라 `localStorage` 다 — 키를 바꾸면 기억한 거르개를 잃는다 */
const FILTER_STORE_KEY = "aynx.usage.filter";

let filter = $state<UsageFilter>({ agent: null, period: DEFAULT_PERIOD });
let filterLoaded = false;
let summary = $state.raw<UsageSummary | null>(null);
let summaryLoading = $state(false);
let summaryError = $state<string | null>(null);
let summarySeq = 0;
/** `null` 이면 오늘 */
let pickedDay = $state<string | null>(null);
let source: { local: boolean; hosts: string[] } = { local: true, hosts: [] };
let sourceKey = "local|";

function ensureFilter(): void {
  if (filterLoaded) return;
  filterLoaded = true;
  try {
    if (typeof localStorage !== "undefined") filter = parseUsageFilter(localStorage.getItem(FILTER_STORE_KEY));
  } catch {
    // 저장소 접근은 언제든 던질 수 있다
  }
}

export function usageFilter(): UsageFilter {
  ensureFilter();
  return filter;
}

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

export function usageSummary(): UsageSummary | null {
  return summary;
}

export function usageSummaryLoading(): boolean {
  return summaryLoading;
}

export function usageSummaryError(): string | null {
  return summaryError;
}

export function pickedUsageDay(): string | null {
  return pickedDay;
}

export function pickUsageDay(date: string | null): void {
  pickedDay = date;
}

/** 원격 몫은 Rust 의 원격 캐시에서만 온다 — 여기서 서버에 묻지 않는다(캐시를 채운 뒤 `force` 로 다시 부른다) */
export function setUsageSource(next: { local: boolean; hosts: string[] }, force = false): void {
  const key = `${next.local ? "local" : ""}|${next.hosts.join(",")}`;
  if (key === sourceKey && !force) return;
  sourceKey = key;
  source = { local: next.local, hosts: [...next.hosts] };
  void loadUsageSummary();
}

export async function loadUsageSummary(): Promise<void> {
  ensureFilter();
  const mine = ++summarySeq;
  summaryLoading = true;
  try {
    const r = await agentUsageSummary(filter.period, filter.agent, source);
    if (mine === summarySeq) {
      summary = r;
      summaryError = null;
      if (pickedDay !== null && !r.daily.some((d) => d.date === pickedDay)) pickedDay = null;
    }
  } catch (e) {
    if (mine === summarySeq) summaryError = String(e);
  } finally {
    if (mine === summarySeq) summaryLoading = false;
  }
}

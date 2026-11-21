/**
 * 세션을 호스트로 묶기 — 소비자는 세션 카드(`./session-cards.ts`)다(목록 모드 · 거르개 칩은 그 카드 면으로 합쳐지며 걷혔다).
 * 4상태 합성 · 명령 자르기는 `console-rows.ts` 것을 쓴다 — 창 줄과 헤드리스 줄이 갈라지지 않게.
 */

import {
  shortenCommand,
  synthState,
  type ConsoleRow,
  type ConsoleState,
  type RawStatus,
} from "./console-rows";
import type { ConsoleSession } from "./delegation-rows";
// 타입만 빌린다 — 둘 다 `invoke` 를 값으로 들이는 모듈이라 node 에서 못 읽는다.
import type { HostMeta } from "$lib/hosts";
import type { DelegationGrants } from "$lib/delegation";

/** 별칭 이름공간과 겹치지 않게 `:` 를 쓴다(ssh 별칭에는 못 들어간다) */
export const LOCAL_GROUP_KEY = "local:";

/** `ai` = 위임으로 사람 없이 연 헤드리스 세션. 공유(`shared`)와는 다른 축이다 — 내가 연 타일도 AI 에게 보일 수 있다 */
export type RowActor = "human" | "ai";

export type RowKind = "ssh" | "local" | "headless";

/** 줄 정렬과 묶음 정렬이 같은 표를 쓴다 */
const STATE_RANK: Record<ConsoleState, number> = {
  fail: 0,
  working: 1,
  idle: 2,
  disconnected: 3,
};

const ACTOR_RANK: Record<RowActor, number> = { human: 0, ai: 1 };

export interface GroupRow {
  id: string;
  actor: RowActor;
  kind: RowKind;
  account: string;
  label: string;
  state: ConsoleState;
  /** 마지막 활동, 없으면 붙은 시각 */
  since: number | null;
  connectedAt: number | null;
  running: boolean;
  command: string;
  commandShort: string;
  exit: number | null;
  shared: boolean;
  /** 다른 창의 타일 — 이 줄에는 점프가 없다(그 창을 이 창에서 띄울 길이 없다) */
  otherWindow: boolean;
  tabId: string | null;
  paneId: string | null;
  attention: RawStatus;
  code: string;
}

export interface HostGroup {
  /** SSH 는 소문자 별칭, 로컬은 [`LOCAL_GROUP_KEY`] */
  key: string;
  name: string;
  local: boolean;
  meta: HostMeta | null;
  delegated: boolean;
  grants: DelegationGrants | null;
  state: ConsoleState;
  rows: GroupRow[];
}

export interface GroupInput {
  rows: readonly ConsoleRow[];
  sessions: readonly ConsoleSession[];
  /** 키는 소문자 별칭 */
  delegations: ReadonlyMap<string, DelegationGrants>;
  runningTargets: ReadonlySet<string>;
  commandByTarget: ReadonlyMap<string, string>;
  /** 키는 소문자 별칭 */
  metas: ReadonlyMap<string, HostMeta>;
  /** 소문자 별칭 → `~/.ssh/config` 의 `User` */
  users: ReadonlyMap<string, string>;
  windowLabel: string;
  localName: string;
}

export function worstState(states: readonly ConsoleState[]): ConsoleState | null {
  let worst: ConsoleState | null = null;
  for (const s of states) {
    if (worst === null || STATE_RANK[s] < STATE_RANK[worst]) worst = s;
  }
  return worst;
}

/** 음수(시계가 뒤로 갔다)는 `0s` — 미래 시각을 보여 주지 않는다 */
export function elapsedLabel(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

/** ssh config 의 규칙(대소문자 무시)과 같게 */
function aliasKey(alias: string): string {
  return alias.trim().toLowerCase();
}

/** Rust `delegated_stream_id` 의 접두사와 같은 값 */
const DELEGATED_PREFIX = "delegated:";

function isHeadless(id: string): boolean {
  return id.startsWith(DELEGATED_PREFIX);
}

/** 헤드리스는 `code` 가 곧 별칭이고, 창 세션은 `label` 이 별칭(또는 빠른 접속 이름)이다 */
function groupOfSession(s: ConsoleSession, localName: string): { key: string; name: string } {
  if (s.kind === "local") return { key: LOCAL_GROUP_KEY, name: localName };
  const name = (isHeadless(s.id) ? s.code : s.label).trim();
  return { key: aliasKey(name), name };
}

export function groupOfRow(row: ConsoleRow, localName: string): { key: string; name: string } {
  if ((row.kind ?? "local") === "local") return { key: LOCAL_GROUP_KEY, name: localName };
  const name = (row.alias ?? row.adhoc ?? row.label).trim();
  return { key: aliasKey(name), name };
}

interface Bucket {
  key: string;
  name: string;
  local: boolean;
  rows: GroupRow[];
}

/**
 * 중복 제거는 이 창이 이긴다 — 공유가 켜진 타일은 전역 목록에도 같은 `streamId` 로 있고, 점프(탭 · 타일 id)와 sticky 는 이 창 줄에만 있다.
 * 아직 안 붙은 위임은 버린다 — 위임은 설정(설정 › 보안의 위임 표)이 맡는다.
 */
export function groupSessions(input: GroupInput): HostGroup[] {
  const {
    rows,
    sessions,
    delegations,
    runningTargets,
    commandByTarget,
    metas,
    users,
    windowLabel,
    localName,
  } = input;

  const buckets = new Map<string, Bucket>();
  const bucketOf = (key: string, name: string, local: boolean): Bucket => {
    const found = buckets.get(key);
    if (found) return found;
    const made: Bucket = { key, name, local, rows: [] };
    buckets.set(key, made);
    return made;
  };

  // ── 이 창의 타일 ──
  const mine = new Set<string>();
  const sharedIds = new Set(sessions.map((s) => s.id));

  for (const row of rows) {
    mine.add(row.streamId);
    const kind = row.kind ?? "local";
    const { key, name } = groupOfRow(row, localName);
    const bucket = bucketOf(key, name, kind === "local");
    let account = row.label;
    if (kind === "ssh") account = (row.alias ? users.get(key) : adhocUser(name)) ?? "";
    bucket.rows.push({
      id: row.streamId,
      actor: "human",
      kind,
      account,
      label: row.label,
      state: row.state,
      since: row.lastActivityAt ?? row.connectedAt ?? null,
      connectedAt: row.connectedAt ?? null,
      running: row.status === "running",
      command: row.lastCommand ?? "",
      commandShort: row.commandShort,
      exit: row.exit,
      // 전역 목록에 실렸는가가 결과라 OR 로 받는다(토글 직후 한 박자의 어긋남을 화면이 감추지 않는다)
      shared: (row.shared ?? false) || sharedIds.has(row.streamId),
      otherWindow: false,
      tabId: row.tabId,
      paneId: row.paneId,
      attention: row.attention,
      code: row.code,
    });
  }

  // ── 앱 전역 세션 뷰 ──
  for (const s of sessions) {
    if (mine.has(s.id)) continue;
    const headless = isHeadless(s.id);
    const { key, name } = groupOfSession(s, localName);
    const local = s.kind === "local";

    // `dropped` 는 버리지 않는다 — 한 번 붙었던 세션이라 `끊김` 줄로 남는다
    if (!s.connected && !s.dropped) continue;

    const bucket = bucketOf(key, name, local);
    const state: ConsoleState = s.dropped
      ? "disconnected"
      : runningTargets.has(s.id)
        ? "working"
        : synthState(normalizeStatus(s.status), s.connected);
    // 헤드리스 세션은 셸이 없어 스스로 보고하지 못한다 — 도는 작업안의 명령이 우선
    const command =
      (state === "working" ? commandByTarget.get(s.id) : undefined) ?? s.lastCommand ?? "";
    bucket.rows.push({
      id: s.id,
      actor: headless ? "ai" : "human",
      kind: headless ? "headless" : local ? "local" : "ssh",
      account: local ? s.label : s.user ?? users.get(key) ?? "",
      label: s.label,
      state,
      since: s.lastActivityAt ?? s.connectedAt ?? null,
      connectedAt: s.connectedAt ?? null,
      running: state === "working",
      command,
      commandShort: shortenCommand(command),
      exit: s.lastExit,
      // 전역 목록에 실렸다는 것 자체가 곧 "AI 가 본다" 다 (Rust `ai_readable` 게이트)
      shared: true,
      otherWindow: !headless && s.windowLabel !== windowLabel,
      tabId: null,
      paneId: null,
      attention: null,
      code: s.code,
    });
  }

  // ── 머리줄 · 정렬 ──
  const groups: HostGroup[] = [];
  for (const bucket of buckets.values()) {
    bucket.rows.sort(
      (a, b) =>
        STATE_RANK[a.state] - STATE_RANK[b.state] ||
        ACTOR_RANK[a.actor] - ACTOR_RANK[b.actor] ||
        a.code.localeCompare(b.code) ||
        a.id.localeCompare(b.id),
    );
    const grants = bucket.local ? null : (delegations.get(bucket.key) ?? null);
    groups.push({
      key: bucket.key,
      name: bucket.name,
      local: bucket.local,
      meta: bucket.local ? null : (metas.get(bucket.key) ?? null),
      // 문지기는 `connect` 하나다 — 목록 표식(`HostList.svelte`)과 같은 규칙
      delegated: grants?.connect === true,
      grants,
      state: worstState(bucket.rows.map((r) => r.state)) ?? "disconnected",
      rows: bucket.rows,
    });
  }
  groups.sort(
    (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.name.localeCompare(b.name),
  );
  return groups;
}

/** Rust `adhoc_user` 와 같은 규칙이다 — 두 쪽이 같은 이름에서 같은 글자를 읽어야 한다 */
function adhocUser(label: string): string {
  const at = label.indexOf("@");
  if (at <= 0 || at === label.length - 1) return "";
  const user = label.slice(0, at);
  return /[\s:]/.test(user) ? "" : user;
}

function normalizeStatus(status: string | null | undefined): RawStatus {
  return status === "running" || status === "ok" || status === "fail" ? status : null;
}

/**
 * 관제판 **목록 모드 — 호스트로 묶은 한 벌** (docs/log/2026-09-21-console-host-groups.md).
 *
 * 2026-09-28 부터 이 묶음의 소비자는 대시보드 **세션 칸의 카드**다(`./session-cards.ts` — 목록 모드와
 * 거르개 칩은 그 카드 면으로 합쳐지며 사라졌다 · docs/log/2026-09-28-dashboard-session-cards.md).
 * 묶는 축 · 중복 제거 · 안 붙은 위임을 버리는 규칙은 그대로 여기 하나다.
 *
 * 앞선 판의 목록은 평평한 두 덩어리였다: 위는 **이 창의 타일**, 아래는 **앱 전역**(AI 에게
 * 보이는 창 세션 + 헤드리스 위임). 같은 서버에 붙은 줄이 두 덩어리에 흩어져 있었고, 그
 * 사이에 "이 줄과 저 줄이 같은 호스트다" 를 말해 주는 것이 하나도 없었다. 이제 **묶는 축은
 * 호스트 하나**이고, 창이냐 헤드리스냐는 줄 안의 **성질**로 내려간다.
 *
 * `console-rows.ts`·`delegation-rows.ts` 와 같은 규칙의 **순수 모듈**이다 — 룬도 DOM 도 `invoke`
 * 도 없다(그래서 node vitest 로 바로 테스트한다). 4상태 합성([`synthState`])과 명령 자르기
 * ([`shortenCommand`])는 `console-rows.ts` 것을 **재사용**한다: 규칙이 한 곳에 모여 있어야
 * 창 줄과 헤드리스 줄이 갈라지지 않는다.
 */

import {
  shortenCommand,
  synthState,
  type ConsoleRow,
  type ConsoleState,
  type RawStatus,
} from "./console-rows";
import type { ConsoleSession } from "./delegation-rows";
// **타입만** 빌린다 — 둘 다 `invoke` 를 값으로 들이는 모듈이라 node 에서 못 읽는다.
import type { HostMeta } from "$lib/hosts";
import type { DelegationGrants } from "$lib/delegation";

/** 로컬 셸 묶음의 키 — 별칭 이름공간과 겹치지 않게 `:` 를 쓴다(ssh 별칭에는 못 들어간다) */
export const LOCAL_GROUP_KEY = "local:";

/**
 * 한 줄의 **주체** — 이 세션을 누가 열었는가.
 *
 * - `human` — 사람이 타일에서 연 세션(이 창이든 다른 창이든).
 * - `ai` — 앱이 위임을 받아 **사람 없이** 연 헤드리스 세션.
 *
 * 화면에서 가장 먼저 답해야 하는 질문이라 첫 칸이다("지금 이 서버에서 움직이는 것이
 * 나인가 AI 인가"). 공유(`shared`)와는 다른 축이다 — 내가 연 타일도 AI 에게 보일 수 있다.
 */
export type RowActor = "human" | "ai";

/** 한 줄의 **종류** — `SSH` · `로컬` · `헤드리스`(타일 없는 위임 실행 세션) */
export type RowKind = "ssh" | "local" | "headless";

/**
 * 주의-우선 순위 — 낮을수록 위로. 줄 정렬과 묶음 정렬이 **같은 표**를 쓴다.
 * 물어볼 것이 있는 실패·작업중이 늘 위로 온다.
 */
const STATE_RANK: Record<ConsoleState, number> = {
  fail: 0,
  working: 1,
  idle: 2,
  disconnected: 3,
};

/** 주체 순위 — 한 호스트 안에서 **사람이 먼저**다 (줄 정렬의 둘째 열쇠) */
const ACTOR_RANK: Record<RowActor, number> = { human: 0, ai: 1 };

/** 묶음 안의 한 줄 = 세션 하나 */
export interface GroupRow {
  /** 행 키 = streamId (위치가 바뀌어도 줄이 안 튄다) */
  id: string;
  actor: RowActor;
  kind: RowKind;
  /**
   * 계정 — SSH 는 `~/.ssh/config` 의 `User`(빠른 접속은 이름에 적힌 것), 로컬은 셸 이름.
   * 모르면 빈 문자열이고 화면은 그 칸을 비운다.
   */
  account: string;
  /**
   * 사람이 읽는 이름 — 이 창의 타일은 `paneName`(셸 이름 · 별칭), 전역 항목은 백엔드의 `label`.
   * 세션 칸의 카드 제목이 계정을 모를 때 이 값으로 선다.
   */
  label: string;
  state: ConsoleState;
  /**
   * **경과의 기준 시각**(epoch ms) — 마지막 활동(마지막 블록의 끝), 없으면 붙은 시각.
   * 둘 다 없으면 `null` 이고 화면은 경과를 그리지 않는다.
   */
  since: number | null;
  /** 붙은 시각(epoch ms) — 경과 말풍선이 읽는다. 모르면 `null` */
  connectedAt: number | null;
  /** 지금 명령이 도는가 — 유휴면 아래 명령은 **마지막** 명령이라 흐리게 그린다 */
  running: boolean;
  /** 현재 작업(도는 명령) 또는 마지막 명령. 없으면 빈 문자열 */
  command: string;
  /** 표 한 칸에 맞게 자른 것 (말풍선은 [`command`] 원문) */
  commandShort: string;
  /** 마지막 완료 명령의 종료 코드 (없거나 도는 중이면 `null`) */
  exit: number | null;
  /** 이 세션이 **AI 에게 보이는가** — 창 타일의 공유 토글, 헤드리스의 `read` 위임 */
  shared: boolean;
  /** **다른 창**의 타일인가 — 이 줄에는 점프가 없다(그 창을 이 창에서 띄울 길이 없다) */
  otherWindow: boolean;
  /** 이 창의 타일이면 점프 대상 (아니면 `null`) */
  tabId: string | null;
  paneId: string | null;
  /** 안 본 결과(sticky) — 이 창의 타일만 가진다 */
  attention: RawStatus;
  /** 짧은 신원 코드 (`p2`·`t7·p2`, 헤드리스는 별칭) */
  code: string;
}

/** 호스트 하나 = 머리줄 + 그 호스트의 줄들 */
export interface HostGroup {
  /** 묶음 키 — SSH 는 **소문자 별칭**, 로컬은 [`LOCAL_GROUP_KEY`] */
  key: string;
  /** 화면에 보이는 이름 (별칭 원래 대소문자 · 빠른 접속 이름 · 로컬 이름) */
  name: string;
  /** 이 묶음이 로컬 셸인가 — 아이콘·위임 표식이 없다 */
  local: boolean;
  /** `sessions.toml` 메타(아이콘·색) — 없으면 `null` */
  meta: HostMeta | null;
  /** 이 호스트에 **접속 위임**(`delegation.toml` 의 `connect`)이 적혀 있는가 */
  delegated: boolean;
  /** 위임 말풍선이 읽는 권한 넷 (없으면 `null`) */
  grants: DelegationGrants | null;
  /** 머리줄 상태 — 줄들의 **최악** (묶음은 줄이 하나 이상일 때만 만들어진다) */
  state: ConsoleState;
  rows: GroupRow[];
}

/** [`groupSessions`] 의 재료 한 벌 — 컴포넌트가 레지스트리·폴링 결과에서 꺼내 채운다 */
export interface GroupInput {
  /** 이 창의 세션 타일 (`console-rows.ts` 의 `buildRows` 결과) */
  rows: readonly ConsoleRow[];
  /** 앱 전역 세션 뷰 (`list_console_sessions`) — 공유된 창 세션 + 헤드리스 + 위임 발견 항목 */
  sessions: readonly ConsoleSession[];
  /** 위임 표 — **소문자 별칭** → 권한 넷 (`app/delegation.svelte.ts` 의 `delegations()`) */
  delegations: ReadonlyMap<string, DelegationGrants>;
  /** 지금 실행 중(running·approved) 작업안의 대상 id 집합 */
  runningTargets: ReadonlySet<string>;
  /** 그 대상 → 도는 작업안의 명령문 */
  commandByTarget: ReadonlyMap<string, string>;
  /** 호스트 메타 — **소문자 별칭** → `sessions.toml` 병합값 */
  metas: ReadonlyMap<string, HostMeta>;
  /** 계정 색인 — **소문자 별칭** → `~/.ssh/config` 의 `User` */
  users: ReadonlyMap<string, string>;
  /** 이 창의 라벨 — 전역 목록에서 "다른 창" 을 가른다 */
  windowLabel: string;
  /** 로컬 셸 묶음의 이름(`로컬`) — 사전은 컴포넌트에 있으므로 주입받는다 */
  localName: string;
}

/** 상태 목록의 **최악** — `실패 > 작업중 > 유휴 > 끊김`. 비었으면 `null` */
export function worstState(states: readonly ConsoleState[]): ConsoleState | null {
  let worst: ConsoleState | null = null;
  for (const s of states) {
    if (worst === null || STATE_RANK[s] < STATE_RANK[worst]) worst = s;
  }
  return worst;
}

/**
 * 경과를 사람이 읽는 한 토막으로 — `12s` · `4m` · `1h 12m` · `3d`. **순수 함수**.
 *
 * 단위를 둘까지만 쓴다(`1h 12m`), 하루를 넘으면 날만 센다(`3d`) — 관제판의 이 칸이 답해야
 * 하는 질문은 "방금인가 한참 전인가" 이고, 초 단위 정확도가 필요한 자리가 아니다.
 * 음수(시계가 뒤로 갔다)는 `0s` 로 떨어뜨린다 — 미래 시각을 보여 주지 않는다.
 */
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

/** 별칭 비교 키 — ssh config 의 규칙(대소문자 무시)과 같게 소문자로 맞춘다 */
function aliasKey(alias: string): string {
  return alias.trim().toLowerCase();
}

/** 헤드리스 세션의 streamId 접두사 (Rust `delegated_stream_id`) */
const DELEGATED_PREFIX = "delegated:";

/** 이 전역 항목이 헤드리스(위임 실행) 세션인가 — 아니면 어느 창의 타일이다 */
function isHeadless(id: string): boolean {
  return id.startsWith(DELEGATED_PREFIX);
}

/**
 * 전역 항목의 **묶음 키와 이름**. 헤드리스는 `code` 가 곧 별칭이고, 창 세션은 `label` 이
 * 별칭(또는 빠른 접속 이름)이다. 로컬 셸은 한 묶음으로 모인다.
 */
function groupOfSession(s: ConsoleSession, localName: string): { key: string; name: string } {
  if (s.kind === "local") return { key: LOCAL_GROUP_KEY, name: localName };
  const name = (isHeadless(s.id) ? s.code : s.label).trim();
  return { key: aliasKey(name), name };
}

/**
 * 이 창 타일의 묶음 키와 이름 — 별칭 > 빠른 접속 이름 > 로컬.
 *
 * **밖으로 열어 둔다** — 예전엔 상태바의 호스트 칩이 같은 재료(`ConsoleRow`)를 같은 열쇠로 묶었다(칩은
 * 2026-10-07 에 하단 독이 워크스페이스 전환으로 바뀌며 걷었다). 한 열쇠를 두 화면이 나눠 쓰는 자리는 여기 하나다 —
 * 갈리면 두 화면이 같은 서버를 다르게 센다.
 */
export function groupOfRow(row: ConsoleRow, localName: string): { key: string; name: string } {
  if ((row.kind ?? "local") === "local") return { key: LOCAL_GROUP_KEY, name: localName };
  const name = (row.alias ?? row.adhoc ?? row.label).trim();
  return { key: aliasKey(name), name };
}

/** 묶음을 만들어 두는 가변 상자 (정렬 전) */
interface Bucket {
  key: string;
  name: string;
  local: boolean;
  rows: GroupRow[];
}

/**
 * 재료 한 벌 → **호스트로 묶은 목록**. 순수 함수.
 *
 * ## 묶는 축
 * SSH 는 **별칭**(빠른 접속은 그 타일의 `user@host:port` 이름), 로컬 셸은 전부 한 묶음,
 * 헤드리스는 그 위임의 별칭이다. 키는 소문자로 맞춘다 — `~/.ssh/config` 의 비교가 그렇다.
 *
 * ## 중복 제거 — **이 창이 이긴다**
 * 이 창의 타일 중 공유가 켜진 것은 전역 목록(`list_console_sessions`)에도 같은 `streamId`
 * 로 들어 있다. 전부 `streamId` 로 열쇠를 잡고 **이 창 줄을 남긴다**: 그쪽에만 탭·타일 id
 * (점프)와 sticky(안 본 결과)가 있기 때문이다. 전역 쪽에서 가져오는 것은 "AI 에게 보인다"
 * 한 칸뿐이다.
 *
 * ## 아직 안 붙은 위임은 **여기 오지 않는다**
 * `list_console_sessions` 는 아직 접속하지 않은 위임 대상도 실어 온다(`connected:false`).
 * 관제판은 그것을 **버린다** — 이 화면이 답하는 질문은 "지금 무엇이 돌고 있나" 하나이고,
 * 위임은 설정이다(설정 › 보안의 `AI 위임 호스트` 표가 그 목록을 맡는다 —
 * docs/log/2026-09-21-fleet-delegation-ui.md). 붙은 뒤에는 보통 세션과 똑같이 줄이 된다.
 *
 * ## 정렬
 * 묶음은 **머리줄 상태** → 이름, 줄은 **상태** → `code` → `id`. 둘 다 [`STATE_RANK`] 한
 * 표를 쓰고 `Array.sort` 는 안정 정렬이라 동순위는 입력 순서를 지킨다.
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

  // ── ① 이 창의 타일 ────────────────────────────────────────────────────────
  // 전역 목록에도 같은 streamId 가 있을 수 있으므로(공유 켜짐) 열쇠를 먼저 모아 둔다.
  const mine = new Set<string>();
  const sharedIds = new Set(sessions.map((s) => s.id));

  for (const row of rows) {
    mine.add(row.streamId);
    const kind = row.kind ?? "local";
    const { key, name } = groupOfRow(row, localName);
    const bucket = bucketOf(key, name, kind === "local");
    // 계정 — SSH 는 설정의 `User`(빠른 접속은 이름에 적힌 것), 로컬은 셸 이름이 곧 계정 칸이다.
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
      // 공유는 두 곳에서 온다 — 타일이 스스로 아는 값과, 전역 목록에 실제로 실렸는가.
      // 후자가 **결과**라 OR 로 받는다(토글 직후 한 박자의 어긋남을 화면이 감추지 않는다).
      shared: (row.shared ?? false) || sharedIds.has(row.streamId),
      otherWindow: false,
      tabId: row.tabId,
      paneId: row.paneId,
      attention: row.attention,
      code: row.code,
    });
  }

  // ── ② 앱 전역 세션 뷰 ─────────────────────────────────────────────────────
  for (const s of sessions) {
    if (mine.has(s.id)) continue; // 이 창이 이긴다(위 머리말)
    const headless = isHeadless(s.id);
    const { key, name } = groupOfSession(s, localName);
    const local = s.kind === "local";

    // **아직 안 붙은 위임은 버린다** (위 머리말) — 관제판은 돌고 있는 것만 보인다.
    // `dropped` 는 여기 들지 않는다: 살아 있다 떨어진 세션이라 `끊김` 줄로 남는다
    // (한 번 붙었던 세션에는 보여 줄 이력이 있다).
    if (!s.connected && !s.dropped) continue;

    const bucket = bucketOf(key, name, local);
    const state: ConsoleState = s.dropped
      ? "disconnected"
      : runningTargets.has(s.id)
        ? "working"
        : synthState(normalizeStatus(s.status), s.connected);
    // 작업중이면 지금 도는 작업안의 명령이 우선(헤드리스 세션은 셸이 없어 스스로 보고하지 못한다).
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
      // 전역 목록에 실렸다는 것 자체가 곧 "AI 가 본다" 다 (Rust `ai_readable` 게이트).
      shared: true,
      otherWindow: !headless && s.windowLabel !== windowLabel,
      tabId: null,
      paneId: null,
      attention: null,
      code: s.code,
    });
  }

  // ── ③ 머리줄 채우기 · 정렬 ────────────────────────────────────────────────
  const groups: HostGroup[] = [];
  for (const bucket of buckets.values()) {
    // 상태 → **주체**(사람 먼저) → 코드 → id. 주체가 둘째인 것은 한 호스트의 줄을 읽는
    // 순서가 "내 것 먼저, 그다음 AI 가 하는 것" 이기 때문이다 — 상태(급한 것)만 그보다 위다.
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
      // 문지기는 `connect` 하나다 — 목록 표식(`HostList.svelte`)과 같은 규칙이다.
      delegated: grants?.connect === true,
      grants,
      // 빈 묶음은 애초에 만들어지지 않는다 — 줄을 담는 자리에서만 상자가 생긴다.
      state: worstState(bucket.rows.map((r) => r.state)) ?? "disconnected",
      rows: bucket.rows,
    });
  }
  groups.sort(
    (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.name.localeCompare(b.name),
  );
  return groups;
}

/**
 * `user@host[:port]`(빠른 접속 타일의 이름)에서 계정 자리만 — 아니면 빈 문자열.
 * Rust `adhoc_user` 와 **같은 규칙**이다(두 쪽이 같은 이름에서 같은 글자를 읽어야 한다).
 */
function adhocUser(label: string): string {
  const at = label.indexOf("@");
  if (at <= 0 || at === label.length - 1) return "";
  const user = label.slice(0, at);
  return /[\s:]/.test(user) ? "" : user;
}

/**
 * Rust 가 낼 수 있는 임의 문자열을 [`synthState`] 가 아는 넷으로 좁힌다 — 모르는 값은
 * `null`(유휴). `delegation-rows.ts` 의 같은 함수와 같은 이유다(헤드리스는 애초에 `null`).
 */
function normalizeStatus(status: string | null | undefined): RawStatus {
  return status === "running" || status === "ok" || status === "fail" ? status : null;
}

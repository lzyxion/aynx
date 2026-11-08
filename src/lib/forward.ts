import { invoke } from "./ipc";
import type { Tr } from "$lib/session";

// 문구는 **인자로** 들어온다 (`i18n/ko/pane.ts` 머리말) — 이 파일은 vitest 가 그대로
// 돌리는 순수 모듈이라 룬 모듈을 값으로 들일 수 없고, 기본값도 두지 않는다: 기본값이
// 있으면 인자를 빠뜨린 화면이 조용히 한국어로 남는다.

/**
 * 포트 포워딩 — 로컬(`ssh -L`) · 원격(`ssh -R`) · 동적(`ssh -D`, SOCKS5).
 * Rust `port_forward` 모듈의 얇은 래퍼.
 *
 * 포워드는 **세션에 매달려 있다**: 세션이 닫히면(사용자가 탭을 닫거나 연결이 끊겨
 * `close_ssh` 가 돌면) 그 세션의 포워드는 백엔드가 전부 정리한다. 재연결은 새 세션 id 를
 * 만들므로 **옛 포워드는 복원되지 않는다** (docs/log/2026-09-01-port-forward.md).
 *
 * 종류마다 쓰는 칸 (docs/log/2026-09-23-remote-dynamic-forwarding.md):
 *
 * | 종류 | `local_port` | `remote_host` | `remote_port` |
 * | --- | --- | --- | --- |
 * | `local` | 내 PC 에서 듣는 포트 | 서버에서 본 목적지 | 목적지 포트 |
 * | `remote` | 서버의 연결을 **이어 줄** 내 PC 포트 | (빈 값) | 서버가 127.0.0.1 에서 듣는 포트 |
 * | `dynamic` | 내 PC 의 SOCKS5 포트 | (빈 값) | (0) |
 */

/** 포워드의 종류 — Rust `ForwardKind` 와 같은 글자 (소문자) */
export type ForwardKind = "local" | "remote" | "dynamic";

/** 고르개의 순서 — 모달과 호스트 폼이 같은 순서로 보여 준다 */
export const FORWARD_KINDS: readonly ForwardKind[] = ["local", "remote", "dynamic"];

/** 종류 고르개(`Dropdown`)의 항목 — 모달과 호스트 폼이 같은 글자를 쓴다 */
export function forwardKindOptions(tr: Tr): { value: ForwardKind; label: string }[] {
  const labels: Record<ForwardKind, string> = {
    local: tr("pane.forward.kind.local"),
    remote: tr("pane.forward.kind.remote"),
    dynamic: tr("pane.forward.kind.dynamic"),
  };
  return FORWARD_KINDS.map((value) => ({ value, label: labels[value] }));
}

/** 살아 있는 포워드 하나 (Rust `ForwardInfo` 와 1:1, snake_case 유지) */
export interface ForwardInfo {
  id: number;
  session_id: number;
  kind: ForwardKind;
  local_port: number;
  remote_host: string;
  remote_port: number;
  /** 지금까지 이 포워드를 통해 중계된 연결 수 (누적, 진단용) */
  conns: number;
  /** **지금 열려 있는** 중계 연결 수 — 0 이면 리스너만 서 있고 아무도 안 쓰는 상태 */
  active_conns: number;
  /**
   * **앱이 건 포워드**면 그 까닭 — 지금은 원격 AI 타일의 훅 신호 하나(`agent-signal` ·
   * docs/log/2026-09-24-remote-agent-signals.md). 사람이 건 것에는 칸이 없다.
   */
  purpose?: "agent-signal";
}

/**
 * 앱이 건 포워드인가 — 화면에 보이지 않고([`userForwards`]), 프리셋 맞추기가 건드리지 않는다(사람이
 * 멈출 수도 없다 — 백엔드가 거절한다). 그 호스트의 에이전트 타일을 모두 닫으면 앱이 거둔다.
 */
export function isAppForward(f: { purpose?: string }): boolean {
  return f.purpose !== undefined;
}

/**
 * **화면에 보일 포워드만** — 앱이 건 포워드([`isAppForward`])를 뺀 목록(순서 유지).
 *
 * 사용자 결정 2026-10-27: 원격 AI 타일의 에이전트 신호 포워드(`agent-signal` — 원격 `-R` → 세션 서버
 * `/agent-signal`)는 사람이 멈출 수 없는 앱 포워드라 머리줄 칩 · 호버 카드 · 목록 메뉴 어디에도 보이지 않는다
 * (칩 개수 · 칩이 뜨는 조건 · 연결 점 · 칩 폴링 타이머까지). 칩 표(`app/forwards` 의 `paneForwards`)에 적는
 * 자리가 모두 이것을 거친다. 신호가 안 올 때는 세션 서버 로그 · `list_forwards`(이 거름 없는 원본)로 본다.
 * 프리셋 맞추기처럼 **지금 선 것 전부**가 필요한 동작 로직은 원본(`listForwards`)을 그대로 쓴다.
 */
export function userForwards<T extends { purpose?: string }>(list: readonly T[]): T[] {
  return list.filter((f) => !isAppForward(f));
}

/**
 * **호스트별 포워딩 프리셋 한 줄** — Rust `sessions_meta::ForwardPreset` 와 1:1 (snake_case).
 *
 * `sessions.toml` 의 `[hosts.<별칭>]` 에 적히고, 그 호스트에 붙는 순간 자동으로 열린다
 * (docs/log/2026-09-17-forward-presets.md). **상속이 없는 유일한 칸**이라 `[defaults]`·
 * 프리셋에 적어도 무시된다 — 로컬 포트는 그 서버 한 대의 것이고, 나눠 쓰면 곧 충돌이다.
 */
export interface ForwardPreset {
  /**
   * 없으면 로컬이다 — 이 칸이 생기기 전에 적힌 줄은 전부 로컬이었고, 백엔드도 파일에
   * 로컬이면 적지 않는다 (`sessions_meta::forward_value`). 읽을 때는 [`forwardKindOf`] 로.
   */
  kind?: ForwardKind;
  local_port: number;
  remote_host: string;
  remote_port: number;
}

/** 그 줄의 종류 — 적혀 있지 않으면 로컬 */
export function forwardKindOf(f: { kind?: ForwardKind }): ForwardKind {
  return f.kind ?? "local";
}

/** 호스트 폼의 한 줄 — 아직 사람이 치고 있는 중이라 포트가 비어 있을 수 있다 */
export interface ForwardRow {
  kind: ForwardKind;
  localPort: number | null;
  remoteHost: string;
  remotePort: number | null;
}

/** 새 줄의 기본값 — DB 포워딩의 전형이라 원격 호스트만 미리 채운다 (모달 폼과 같은 선택) */
export function emptyForwardRow(): ForwardRow {
  return { kind: "local", localPort: null, remoteHost: "localhost", remotePort: null };
}

/**
 * 프리셋을 폼 줄로 (편집 폼 프리필). 원격·동적 줄의 빈 호스트는 `localhost` 로 채워 둔다 —
 * 그 칸은 그 종류에서 감춰져 있고, 사람이 종류를 로컬로 바꾸는 순간 보이는 기본값이 된다.
 */
export function forwardRowOf(p: ForwardPreset): ForwardRow {
  const kind = forwardKindOf(p);
  return {
    kind,
    localPort: p.local_port,
    remoteHost: kind === "local" ? p.remote_host : p.remote_host || "localhost",
    remotePort: kind === "dynamic" ? null : p.remote_port,
  };
}

/**
 * 폼 줄 하나를 프리셋으로 — **Rust `port_forward::validate` 와 같은 규칙**이다
 * (포트 1–65535 · 원격 호스트 필수 · 가운데 공백 금지 · 앞뒤 공백은 다듬는다).
 *
 * 종류마다 보는 칸이 다르고, **보지 않는 칸은 비워서** 내보낸다 — 원격은 호스트를 `""`,
 * 동적은 거기에 원격 포트까지 `0`. 화면이 감춘 칸에 남은 옛 값이 파일에 적히지 않게 한다
 * (백엔드도 같은 자리에서 같은 일을 한다).
 *
 * 왜 두 벌인가 — 백엔드가 단일 진실이지만, 폼을 보내고 IPC 를 왕복한 뒤에야 "포트가
 * 이상합니다" 가 뜨면 **어느 줄인지**가 흐려진다. 규칙이 갈리지 않도록 문구까지 같은
 * 뜻으로 맞추고, 양쪽에 유닛 테스트를 둔다.
 */
export function parseForwardRow(
  row: ForwardRow,
  tr: Tr,
): { ok: true; preset: ForwardPreset } | { ok: false; error: string } {
  if (invalidPort(row.localPort)) {
    return { ok: false, error: tr("pane.forward.preset.localport") };
  }
  const localPort = row.localPort as number;
  if (row.kind === "dynamic") {
    return {
      ok: true,
      preset: { kind: "dynamic", local_port: localPort, remote_host: "", remote_port: 0 },
    };
  }
  if (invalidPort(row.remotePort)) {
    return { ok: false, error: tr("pane.forward.preset.remoteport") };
  }
  const remotePort = row.remotePort as number;
  if (row.kind === "remote") {
    return {
      ok: true,
      preset: { kind: "remote", local_port: localPort, remote_host: "", remote_port: remotePort },
    };
  }
  const host = row.remoteHost.trim();
  if (host === "") return { ok: false, error: tr("pane.forward.preset.remotehost") };
  if (/\s/.test(host)) return { ok: false, error: tr("pane.forward.preset.whitespace") };
  return {
    ok: true,
    preset: { kind: "local", local_port: localPort, remote_host: host, remote_port: remotePort },
  };
}

/**
 * 이 줄이 **잡는 자리** — 로컬·동적은 내 PC 의 리스너(`L:로컬 포트`), 원격은 **서버의**
 * 포트(`R:원격 포트`). 두 줄의 자리가 같으면 둘째는 "이미 사용 중" 으로 실패한다.
 *
 * 로컬 15432 와 원격(서버 15432)은 부딪히지 않고, 로컬 1080 과 동적 1080 은 부딪힌다.
 * Rust `sessions_meta::bind_slot` 과 같은 판정이다. 살아 있는 포워드([`ForwardInfo`])에도
 * 같은 질문을 한다 — 프리셋을 열 때 "이미 선 자리" 를 건너뛰는 데 쓴다.
 */
export function forwardBindKey(f: { kind?: ForwardKind; local_port: number; remote_port: number }): string {
  return forwardKindOf(f) === "remote" ? `R:${f.remote_port}` : `L:${f.local_port}`;
}

/**
 * 자리([`forwardBindKey`])가 **앞줄과 겹치는 첫 줄의 번호** (없으면 `-1`).
 *
 * 겹친 채로 저장하면 접속마다 뒷줄이 "포트가 이미 사용 중" 으로 실패하는데, 그 실패는
 * 서버 사정이 아니라 우리가 적어 둔 파일 때문이라 원인을 찾을 자리가 없다. 백엔드도 같은
 * 검사를 한다 (`sessions_meta::validate_forwards`).
 *
 * **포트가 아니라 줄 번호**를 돌려주는 이유: 폼이 그 줄에 `aria-invalid` 를 다는 데 쓰고,
 * 포트 값은 그 줄에서 다시 읽으면 된다 (반대로는 못 한다 — 같은 포트가 두 줄이다).
 */
export function duplicateBindIndex(list: ForwardPreset[]): number {
  const seen = new Set<string>();
  for (const [index, p] of list.entries()) {
    const key = forwardBindKey(p);
    if (seen.has(key)) return index;
    seen.add(key);
  }
  return -1;
}

/**
 * 폼 줄 목록을 통째로 프리셋 목록으로 — 첫 실패 하나만 돌려준다 (폼이 한 줄로 띄운다).
 * 줄 번호를 함께 주는 이유는 `1번 줄:` 처럼 **어느 줄인지**가 문구에 실려야 하기 때문이다.
 */
export function parseForwardRows(
  rows: ForwardRow[],
  tr: Tr,
): { ok: true; presets: ForwardPreset[] } | { ok: false; error: string; index: number } {
  const presets: ForwardPreset[] = [];
  for (const [index, row] of rows.entries()) {
    const parsed = parseForwardRow(row, tr);
    if (!parsed.ok) return { ok: false, error: parsed.error, index };
    presets.push(parsed.preset);
  }
  const dup = duplicateBindIndex(presets);
  if (dup >= 0) {
    const p = presets[dup];
    const error =
      forwardKindOf(p) === "remote"
        ? tr("pane.forward.preset.duplicate_remote", { port: p.remote_port })
        : tr("pane.forward.preset.duplicate", { port: p.local_port });
    return { ok: false, error, index: dup };
  }
  return { ok: true, presets };
}

/**
 * 두 줄이 **같은 터널**을 뜻하는가 — 종류가 같고, 그 종류가 쓰는 칸이 전부 같다
 * (로컬: 셋 다 · 원격: 두 포트 · 동적: 로컬 포트). 종류가 다르면 포트가 같아도 다른 터널이다.
 *
 * 인자를 `ForwardPreset` 이 아니라 **세 칸의 구조**로 받는 이유는 살아 있는 포워드
 * ([`ForwardInfo`])에도 같은 질문을 하기 때문이다 (저장해 둔 줄 하나가 지금 서 있는 어느
 * 리스너인가). 판정이 두 벌이 되면 "지웠는데 안 닫히는 줄" 이 생긴다.
 *
 * **원격 호스트만 대소문자를 무시한다** — 호스트 이름은 DNS 규칙상 대소문자를 타지 않고
 * (`DB01` 과 `db01` 은 같은 서버다), 별칭 비교의 기준도 저장소 전체에서 그렇다.
 * 앞뒤 공백은 `parseForwardRow` 가 이미 다듬지만 손으로 적은 파일에서도 올 수 있어 한 번 더 뗀다.
 */
export function sameForwardTarget(
  a: { kind?: ForwardKind; local_port: number; remote_host: string; remote_port: number },
  b: { kind?: ForwardKind; local_port: number; remote_host: string; remote_port: number },
): boolean {
  const kind = forwardKindOf(a);
  if (kind !== forwardKindOf(b) || a.local_port !== b.local_port) return false;
  if (kind === "dynamic") return true;
  if (a.remote_port !== b.remote_port) return false;
  if (kind === "remote") return true;
  return a.remote_host.trim().toLowerCase() === b.remote_host.trim().toLowerCase();
}

/**
 * 프리셋 목록 **두 판 사이의 차이** — 호스트 폼을 저장한 뒤 살아 있는 세션을 맞추는 데 쓴다
 * (docs/log/2026-09-17-forward-presets.md 의 "저장 시 열린 세션에 반영").
 *
 * 규칙은 한 줄이다: **같은 터널([`sameForwardTarget`])이 맞은편에 없으면 바뀐 것이다.**
 * 그래서 포트만 고친 줄은 `removed` 하나 + `added` 하나로 갈라지고, 결과적으로 옛 리스너가
 * 내려가고 새 리스너가 선다 — 사람이 폼에서 한 일이 그것이다.
 *
 * 줄 순서만 바꾼 저장은 **차이가 없다**(양쪽에 다 있으므로). 멀쩡히 서 있는 터널을 끊었다
 * 다시 세우지 않는다는 뜻이고, 그 사이 그 포트를 쓰던 연결이 죽지 않는다.
 */
export function diffForwardPresets(
  before: ForwardPreset[],
  after: ForwardPreset[],
): { removed: ForwardPreset[]; added: ForwardPreset[] } {
  return {
    removed: before.filter((p) => !after.some((q) => sameForwardTarget(p, q))),
    added: after.filter((p) => !before.some((q) => sameForwardTarget(p, q))),
  };
}

/**
 * 표시용 한 줄 — 모달 목록 · 머리줄 칩의 툴팁이 같은 글자를 쓴다.
 *
 * - 로컬: `127.0.0.1:15432 → localhost:5432` (언어를 타지 않는다 — 예전 그대로)
 * - 원격: `원격 127.0.0.1:18080 → 내 PC 127.0.0.1:8080`
 * - 동적: `SOCKS 127.0.0.1:1080`
 *
 * 원격은 화살표의 방향이 **서버 → 내 PC** 다. 로컬과 모양을 맞추면서 방향만 뒤집으면 한눈에
 * 어느 쪽이 듣는지 헷갈리므로, 양쪽에 "원격"·"내 PC" 를 붙여 말한다.
 */
export function forwardLabel(f: ForwardInfo, tr: Tr): string {
  switch (f.kind) {
    case "remote":
      return tr("pane.forward.label.remote", { r: f.remote_port, l: f.local_port });
    case "dynamic":
      return tr("pane.forward.label.dynamic", { l: f.local_port });
    default:
      return `127.0.0.1:${f.local_port} → ${f.remote_host}:${f.remote_port}`;
  }
}

/**
 * 이 포워드를 **시스템 기본 브라우저로 열 주소** — 로컬(`-L`)만, 나머지는 `null`
 * (docs/log/2026-09-27-forward-open-browser.md).
 *
 * - 원격(`-R`)은 **서버 쪽**이 듣는다 — 내 PC 의 브라우저로 열 자리가 없다.
 * - 동적(`-D`)은 SOCKS 프록시다 — 주소로 여는 것이 아니라 프록시로 거는 것이다.
 * - 호스트는 늘 `127.0.0.1` 이다. 포워드는 루프백에만 선다(보안 불변) — `localhost` 는
 *   IPv6 `::1` 로 먼저 풀려 리스너를 못 찾는 경우가 있어 숫자로 적는다.
 * - 스킴은 **목적지 포트로 어림한다**: 443 · 8443 이면 `https`, 그 밖은 `http`. 틀리면
 *   브라우저가 그 자리에서 말해 주고 사람이 주소창에서 고친다 — 설정 칸을 따로 두지 않는다.
 */
export function forwardBrowserUrl(f: ForwardInfo): string | null {
  if (forwardKindOf(f) !== "local") return null;
  const scheme = f.remote_port === 443 || f.remote_port === 8443 ? "https" : "http";
  return `${scheme}://127.0.0.1:${f.local_port}/`;
}

/**
 * 지금 이 포워드로 오가는 연결이 있는가 — 초록 점의 판단 기준.
 *
 * 누적 `conns` 는 "한 번이라도 붙었다" 만 말해 준다. 실기에서 "연결이 됐는지 모르겠다"
 * 는 말이 나온 지점이라, 표시는 언제나 이 값을 본다.
 */
export function isForwardActive(f: ForwardInfo): boolean {
  return f.active_conns > 0;
}

/**
 * 종류의 **짧은 표** — `-L` · `-R` · `-D` (`ssh` 의 그 글자). 머리줄 포워딩 칩의 호버 카드와 목록 메뉴가
 * 줄 맨 앞에 찍는다 — 화살표의 방향만으로는 어느 쪽이 듣는지 한눈에 안 갈린다(원격·동적은 `forwardLabel` 도
 * 말로 밝히지만 로컬은 말이 없다). 언어를 타지 않는 글자라 사전을 거치지 않는다.
 */
export function forwardKindFlag(f: { kind?: ForwardKind }): "-L" | "-R" | "-D" {
  switch (forwardKindOf(f)) {
    case "remote":
      return "-R";
    case "dynamic":
      return "-D";
    default:
      return "-L";
  }
}

/** 지금 이 포워드들을 **오가는 연결 수의 합** — 칩의 트래픽 점 · 카드 머리의 "연결 n개 중계 중" */
export function relayingConns(list: readonly { active_conns: number }[]): number {
  return list.reduce((sum, f) => sum + f.active_conns, 0);
}

/** 목록 항목의 상태 문구 — `활성 2` 또는 `대기 중` (리스너는 살아 있다) */
export function forwardStateLabel(f: ForwardInfo, tr: Tr): string {
  return isForwardActive(f)
    ? tr("pane.forward.active", { n: f.active_conns })
    : tr("pane.forward.idle");
}

/**
 * 포트 한 칸이 **잘못됐는가** — 1–65535 의 정수가 아니면 참 (빈 칸 `null` 도 참).
 *
 * 백엔드도 같은 규칙을 다시 검사한다. 여기 있는 것은 **즉시 피드백**용이다 — 폼을 보내고
 * IPC 왕복을 기다린 뒤에야 "포트가 이상합니다" 가 뜨면 어느 칸인지도 흐려진다.
 */
export function invalidPort(value: number | null): boolean {
  return value === null || !Number.isInteger(value) || value < 1 || value > 65535;
}

/**
 * 한 세션의 포워드 목록. **실패하면 빈 배열** 이다 (throw 하지 않는다) —
 * 목록 조회가 깨져서 모달 전체가 못 뜨는 것보다 "아직 없음" 으로 보이는 편이 낫다.
 */
export async function listForwards(sessionId: number): Promise<ForwardInfo[]> {
  try {
    const list = await invoke<ForwardInfo[]>("list_forwards", { sessionId });
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * 포워드를 건다. 실패(포트 사용 중·세션 없음·검증 오류·서버 거절)는 한 줄을 담은 `Error` 다 —
 * 폼이 그 자리에 그대로 보여 준다. 인자는 프리셋 한 줄의 모양 그대로다(모달도 같은 모양을 만든다).
 */
export async function addForward(sessionId: number, p: ForwardPreset, tr: Tr): Promise<ForwardInfo> {
  try {
    return await invoke<ForwardInfo>("add_forward", {
      sessionId,
      kind: forwardKindOf(p),
      localPort: p.local_port,
      remoteHost: p.remote_host,
      remotePort: p.remote_port,
    });
  } catch (e) {
    throw new Error(
      typeof e === "string" ? e : e instanceof Error ? e.message : tr("pane.forward.add_failed"),
    );
  }
}

/** 포워드를 중지한다. 이미 사라진 id 도 성공이다 (백엔드가 멱등) */
export async function removeForward(id: number, tr: Tr): Promise<void> {
  try {
    await invoke("remove_forward", { id });
  } catch (e) {
    throw new Error(
      typeof e === "string"
        ? e
        : e instanceof Error
          ? e.message
          : tr("pane.forward.remove_failed"),
    );
  }
}

import { invoke, isRemote } from "./ipc";
import type { Tr } from "$lib/session";

// 문구는 인자로 들어온다 — 기본값을 두지 않는다: 있으면 인자를 빠뜨린 화면이 조용히 한국어로 남는다.

/**
 * 포트 포워딩 — 로컬(`-L`) · 원격(`-R`) · 동적(`-D`, SOCKS5). Rust `port_forward` 의 얇은 래퍼.
 * 포워드는 세션에 매달린다 — 재연결은 새 세션 id 라 옛 포워드는 복원되지 않는다.
 * 원격 줄의 `local_port` = 서버의 연결을 이어 줄 내 PC 포트, `remote_port` = 서버가 127.0.0.1 에서 듣는 포트.
 */

/** Rust `ForwardKind` 와 같은 글자 */
export type ForwardKind = "local" | "remote" | "dynamic";

export const FORWARD_KINDS: readonly ForwardKind[] = ["local", "remote", "dynamic"];

export function forwardKindOptions(tr: Tr): { value: ForwardKind; label: string }[] {
  const labels: Record<ForwardKind, string> = {
    local: tr("pane.forward.kind.local"),
    remote: tr("pane.forward.kind.remote"),
    dynamic: tr("pane.forward.kind.dynamic"),
  };
  return FORWARD_KINDS.map((value) => ({ value, label: labels[value] }));
}

/** Rust `ForwardInfo` 와 1:1 (snake_case) */
export interface ForwardInfo {
  id: number;
  session_id: number;
  kind: ForwardKind;
  local_port: number;
  remote_host: string;
  remote_port: number;
  /** 누적(진단용) */
  conns: number;
  active_conns: number;
  /** 앱이 건 포워드면 그 까닭 — 사람이 건 것에는 칸이 없다 */
  purpose?: "agent-signal";
}

/** 앱이 건 포워드 — 화면에 안 보이고 프리셋 맞추기가 건드리지 않는다(사람이 멈출 수도 없다 — 백엔드가 거절한다) */
export function isAppForward(f: { purpose?: string }): boolean {
  return f.purpose !== undefined;
}

/** 칩 · 카드 · 목록에 적는 자리는 모두 이것을 거친다. 지금 선 것 전부가 필요한 동작은 원본(`listForwards`)을 쓴다 */
export function userForwards<T extends { purpose?: string }>(list: readonly T[]): T[] {
  return list.filter((f) => !isAppForward(f));
}

/**
 * Rust `sessions_meta::ForwardPreset` 와 1:1 (snake_case). `sessions.toml` 의 `[hosts.<별칭>]` 에 적힌다.
 * 상속이 없는 유일한 칸이다 — `[defaults]` · 프리셋에 적어도 무시된다(로컬 포트를 나눠 쓰면 곧 충돌이다).
 */
export interface ForwardPreset {
  /** 없으면 로컬 — 백엔드도 로컬이면 파일에 적지 않는다(`sessions_meta::forward_value`) */
  kind?: ForwardKind;
  local_port: number;
  remote_host: string;
  remote_port: number;
}

export function forwardKindOf(f: { kind?: ForwardKind }): ForwardKind {
  return f.kind ?? "local";
}

/** 호스트 폼의 한 줄 — 치는 중이라 포트가 비어 있을 수 있다 */
export interface ForwardRow {
  kind: ForwardKind;
  localPort: number | null;
  remoteHost: string;
  remotePort: number | null;
}

export function emptyForwardRow(): ForwardRow {
  return { kind: "local", localPort: null, remoteHost: "localhost", remotePort: null };
}

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
 * Rust `port_forward::validate` 와 같은 규칙이다(양쪽에 유닛 테스트).
 * 종류가 보지 않는 칸은 비워서 내보낸다 — 감춘 칸에 남은 옛 값이 파일에 적히지 않게.
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

/** 이 줄이 잡는 자리 — 원격은 서버의 포트. Rust `sessions_meta::bind_slot` 과 같은 판정이다 */
export function forwardBindKey(f: { kind?: ForwardKind; local_port: number; remote_port: number }): string {
  return forwardKindOf(f) === "remote" ? `R:${f.remote_port}` : `L:${f.local_port}`;
}

/** 앞줄과 자리가 겹치는 첫 줄의 번호(없으면 `-1`). 백엔드도 같은 검사를 한다(`sessions_meta::validate_forwards`) */
export function duplicateBindIndex(list: ForwardPreset[]): number {
  const seen = new Set<string>();
  for (const [index, p] of list.entries()) {
    const key = forwardBindKey(p);
    if (seen.has(key)) return index;
    seen.add(key);
  }
  return -1;
}

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
 * 살아 있는 포워드에도 같은 질문을 한다 — 판정이 두 벌이 되면 "지웠는데 안 닫히는 줄" 이 생긴다.
 * 원격 호스트만 대소문자를 무시한다.
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

/** 줄 순서만 바꾼 저장은 차이가 없다 — 서 있는 터널을 끊었다 다시 세우지 않는다 */
export function diffForwardPresets(
  before: ForwardPreset[],
  after: ForwardPreset[],
): { removed: ForwardPreset[]; added: ForwardPreset[] } {
  return {
    removed: before.filter((p) => !after.some((q) => sameForwardTarget(p, q))),
    added: after.filter((p) => !before.some((q) => sameForwardTarget(p, q))),
  };
}

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
 * 로컬(`-L`)만. 호스트는 늘 `127.0.0.1` — 포워드는 루프백에만 서고(보안 불변), `localhost` 는 `::1` 로 먼저 풀릴 수 있다.
 * 원격 창에서는 늘 `null` — 그 기기 자신의 `127.0.0.1` 이 열린다.
 */
export function forwardBrowserUrl(f: ForwardInfo, remoteWindow: boolean = isRemote): string | null {
  if (remoteWindow || forwardKindOf(f) !== "local") return null;
  const scheme = f.remote_port === 443 || f.remote_port === 8443 ? "https" : "http";
  return `${scheme}://127.0.0.1:${f.local_port}/`;
}

export function isForwardActive(f: ForwardInfo): boolean {
  return f.active_conns > 0;
}

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

export function relayingConns(list: readonly { active_conns: number }[]): number {
  return list.reduce((sum, f) => sum + f.active_conns, 0);
}

export function forwardStateLabel(f: ForwardInfo, tr: Tr): string {
  return isForwardActive(f)
    ? tr("pane.forward.active", { n: f.active_conns })
    : tr("pane.forward.idle");
}

/** 빈 칸 `null` 도 참 */
export function invalidPort(value: number | null): boolean {
  return value === null || !Number.isInteger(value) || value < 1 || value > 65535;
}

/** 실패하면 빈 배열이다(throw 하지 않는다) */
export async function listForwards(sessionId: number): Promise<ForwardInfo[]> {
  try {
    const list = await invoke<ForwardInfo[]>("list_forwards", { sessionId });
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

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

/** 이미 사라진 id 도 성공이다 (백엔드가 멱등) */
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

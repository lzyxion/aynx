/** Rust `remote.rs`(`remote_status` · `remote_devices_list` · `remote_log`)의 모양과 1:1 이다 */
import type { Key } from "$lib/i18n/keys";

/** Rust `RemoteStatus` */
export interface RemoteStatus {
  enabled: boolean;
  listening: boolean;
  port: number;
  host: string;
  funnel: "off" | "on" | "unknown";
  tailscaleCli: boolean;
  error?: string;
}

/** Rust `ServeStatus` — 지금 443 판정 */
export interface RemoteServeStatus {
  state: "none" | "ours" | "other" | "funnel" | "unknown";
  target?: string;
}

/** Rust `ServeOutcome` — [연결] 의 답(그 밖의 실패는 던진다) */
export type ServeConnectOutcome =
  | { kind: "connected"; host: string; url: string }
  | { kind: "confirm"; target: string }
  | { kind: "admin"; message: string; url?: string };

export type ConnectFlow =
  | { phase: "idle" }
  | { phase: "busy"; step: "serve" | "off" }
  | { phase: "confirm"; target: string }
  | { phase: "admin"; message: string; url?: string }
  | { phase: "failed"; message: string; retry: "connect" | "off" };

export type ConnectRow =
  | { state: "checking" }
  | { state: "ready" }
  | { state: "busy"; step: "serve" | "off" }
  | { state: "connected"; url: string }
  | { state: "other"; target: string }
  | { state: "admin"; message: string; url?: string }
  | { state: "failed"; message: string; retry: "connect" | "off" }
  | { state: "nocli" };

export interface ConnectRowInput {
  flow: ConnectFlow;
  status: RemoteStatus | null;
  serve: RemoteServeStatus | null;
  savedEnabled: boolean;
  savedHost: string | undefined;
}

/**
 * 연결됨 = serve 가 이 포트를 가리키고 **저장된** 켬 · 이름이 있을 때. 443 을 남이 쓰는 것은 [연결] 을 눌러 답이 왔을 때만 말한다.
 */
export function connectRowState(i: ConnectRowInput): ConnectRow {
  const { flow } = i;
  switch (flow.phase) {
    case "busy":
      return { state: "busy", step: flow.step };
    case "confirm":
      return { state: "other", target: flow.target };
    case "admin":
      return { state: "admin", message: flow.message, url: flow.url };
    case "failed":
      return { state: "failed", message: flow.message, retry: flow.retry };
  }
  if (i.status && !i.status.tailscaleCli) return { state: "nocli" };
  if (!i.status || !i.serve) return { state: "checking" };
  const url = i.savedEnabled ? remoteUrl(i.savedHost ?? "") : null;
  if (i.serve.state === "ours" && url) return { state: "connected", url };
  return { state: "ready" };
}

/** 한 번에 한 장만 열린다 */
export type RemoteCard = "access" | "devices" | "log" | "guide";

export interface RemoteStateChip {
  id: "stopped" | "failed" | "funnel" | "cli";
  tone: "bad" | "idle" | "off";
  label: Key;
  tip?: string;
  tipKey?: Key;
}

export interface RemoteStateView {
  phase: "checking" | "before" | "connected";
  tone: "ok" | "warn" | "bad" | "neutral";
  icon: "remote" | "warning";
  title: Key;
  note: Key | null;
  chips: RemoteStateChip[];
}

export interface RemoteStateInput {
  /** 원격 창 — serve 판정이 없다 */
  remote: boolean;
  /** **이번 방문에 새로 읽은** 값 — 지난 값이면 초록이나 경고가 깜빡인다 */
  status: RemoteStatus | null;
  serve: RemoteServeStatus | null;
  /** 저장된 켬(저장 전 편집 아님) */
  savedEnabled: boolean;
  hasMaster: boolean;
  deviceCount: number;
}

const funnelChip = (f: RemoteStatus["funnel"]): RemoteStateChip => ({
  id: "funnel",
  tone: f === "on" ? "bad" : "idle",
  label: `settings.remote.status.funnel.${f}`,
  tipKey: `settings.remote.status.funnel.${f}.tip`,
});
const NO_CLI_CHIP: RemoteStateChip = { id: "cli", tone: "off", label: "settings.remote.status.cli.missing", tipKey: "settings.remote.status.cli.missing.tip" };
const funnelIfOdd = (f: RemoteStatus["funnel"]): RemoteStateChip[] => (f === "off" ? [] : [funnelChip(f)]);

/**
 * 연결됨은 serve 가 우리 것이고 듣는 중일 때만이다(토글만 켰거나 [serve 끄기] 뒤에 초록을 그리면 거짓이다). 우선순위는 코드 순서 그대로다.
 * Rust 의 사실(`remote/gateway.rs` · `remote/serve.rs`): `funnel: "on"` · `listening: false` · `error` 가 함께 와야 "관문 닫힘" 이다.
 * `serve: "funnel"` 은 저장 꺼짐이어도 올 수 있고 관문은 아직 열려 있을 수 있다(문지기는 60초마다). 켠 직후 첫 Funnel 확인 전에는
 * `listening: false` 인데 오류가 없다 — 실패가 아니라 확인 중이다.
 */
export function remoteStateView(i: RemoteStateInput): RemoteStateView {
  const checking: RemoteStateView = { phase: "checking", tone: "neutral", icon: "remote", title: "settings.remote.connect.checking", note: null, chips: [] };
  const before = (tone: RemoteStateView["tone"], title: Key, note: Key, chips: RemoteStateChip[]): RemoteStateView => ({
    phase: "before",
    tone,
    icon: tone === "bad" ? "warning" : "remote",
    title,
    note,
    chips,
  });
  const s = i.status;
  if (!s) return checking;
  if (s.enabled && s.funnel === "on") {
    return before("bad", "settings.remote.state.funnel.title", "settings.remote.state.funnel.note", [
      { id: "stopped", tone: "off", label: "settings.remote.state.stopped", tip: s.error },
      funnelChip("on"),
    ]);
  }
  if (i.serve?.state === "funnel") {
    return before("bad", "settings.remote.state.funnel443.title", "settings.remote.state.funnel443.note", [funnelChip("on")]);
  }
  if (s.enabled && !s.listening && s.error) {
    return before("bad", "settings.remote.state.failed.title", "settings.remote.state.failed.note", [
      { id: "failed", tone: "bad", label: "settings.remote.status.notListening", tip: s.error },
      ...funnelIfOdd(s.funnel),
    ]);
  }
  if (!i.savedEnabled) {
    const cli = i.remote || s.tailscaleCli;
    const note: Key = i.remote ? "settings.remote.state.off.note.remote" : cli ? "settings.remote.state.off.note" : "settings.remote.state.nocli.note";
    return before("neutral", "settings.remote.state.off.title", note, cli ? [] : [NO_CLI_CHIP]);
  }
  if (!i.remote) {
    if (!s.tailscaleCli) return before("warn", "settings.remote.state.nocli.title", "settings.remote.state.nocli.note", [NO_CLI_CHIP]);
  }
  if (!s.listening) return checking;
  if (!i.remote) {
    if (!i.serve) return checking;
    const odd = funnelIfOdd(s.funnel);
    if (i.serve.state === "none") return before("warn", "settings.remote.state.noserve.title", "settings.remote.state.noserve.note", odd);
    if (i.serve.state === "other") return before("warn", "settings.remote.state.other.title", "settings.remote.state.other.note", odd);
    if (i.serve.state !== "ours") return before("warn", "settings.remote.state.unknown.title", "settings.remote.state.unknown.note", odd);
  }
  const pairing = i.deviceCount === 0;
  return {
    phase: "connected",
    tone: i.hasMaster ? "ok" : "warn",
    icon: "remote",
    title: pairing ? "settings.remote.state.pairing.title" : "settings.remote.state.inUse.title",
    note: !i.hasMaster ? "settings.remote.state.noMaster.note" : pairing ? "settings.remote.state.pairing.note" : "settings.remote.state.inUse.note",
    chips: funnelIfOdd(s.funnel),
  };
}

export function firstOpenCard(phase: RemoteStateView["phase"]): RemoteCard | null | undefined {
  if (phase === "checking") return undefined;
  return phase === "before" ? "access" : null;
}

export function remoteAnchorCard(anchor: string): RemoteCard | null {
  switch (anchor) {
    case "remote-host":
    case "remote-port":
      return "access";
    case "remote-devices-label":
      return "devices";
    case "remote-checklist":
      return "guide";
    default:
      return null;
  }
}

/** Rust `DeviceInfo` — 해시 없음 */
export interface RemoteDevice {
  id: string;
  name: string;
  /** RFC 3339 */
  created: string;
  lastSeen: string;
  unlocked: boolean;
  connected: number;
}

/** Rust `activity::Entry` — 비밀 없음 */
export interface RemoteLogEntry {
  at: string;
  kind: RemoteLogKind;
  deviceId: string;
  deviceName: string;
  what?: string;
}

export type RemoteLogKind =
  | "paired"
  | "unlocked"
  | "unlockFailed"
  | "locked"
  | "connected"
  | "disconnected"
  | "revoked"
  | "disconnectedAll"
  | "reauthorized";

export function logKindKey(kind: string): Key | null {
  switch (kind) {
    case "paired":
      return "settings.remote.log.paired";
    case "unlocked":
      return "settings.remote.log.unlocked";
    case "unlockFailed":
      return "settings.remote.log.unlockFailed";
    case "locked":
      return "settings.remote.log.locked";
    case "connected":
      return "settings.remote.log.connected";
    case "disconnected":
      return "settings.remote.log.disconnected";
    case "revoked":
      return "settings.remote.log.revoked";
    case "disconnectedAll":
      return "settings.remote.log.disconnectedAll";
    case "reauthorized":
      return "settings.remote.log.reauthorized";
    default:
      return null;
  }
}

export function activeDevices(devices: readonly RemoteDevice[]): RemoteDevice[] {
  return devices.filter((d) => d.unlocked && d.connected > 0);
}

export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";

/**
 * 직접 설정용 안내 — [연결] 은 Rust `remote/serve.rs` 가 같은 인자를 고정으로 실행한다. Tailscale 1.52 부터의 새 `serve` 문법이다
 * (옛 `serve https / http://…` 문법은 쓰지 않는다).
 */
export function serveCommand(port: number): string {
  return `tailscale serve --bg --https=443 http://127.0.0.1:${port}`;
}

/** 443 자리 하나만 걷는다(다른 serve 설정은 그대로). */
export const SERVE_OFF_COMMAND = "tailscale serve --https=443 off";

export const SERVE_STATUS_COMMAND = "tailscale serve status";

export const DNS_NAME_COMMAND = "(tailscale status --json | ConvertFrom-Json).Self.DNSName";

/**
 * 원격 접속 포트(443)는 내 기기만. 기본 정책의 "모두 허용" 규칙이 남아 있으면 이 줄은 아무것도 좁히지 않는다(그래서 첫 주석이 그것을
 * 말한다). 태그 단 서버(`tag:server`)는 사용자 소유가 아니라서 `autogroup:self` 에 들지 않는다.
 */
export function aclExample(comments: { default: string; self: string; server: string }): readonly string[] {
  return [
    "{",
    `  // ${comments.default}`,
    "  \"tagOwners\": { \"tag:server\": [\"autogroup:admin\"] },",
    "  \"grants\": [",
    `    // ${comments.self}`,
    "    { \"src\": [\"autogroup:member\"], \"dst\": [\"autogroup:self\"], \"ip\": [\"tcp:443\"] },",
    `    // ${comments.server}`,
    "    { \"src\": [\"autogroup:member\"], \"dst\": [\"tag:server\"], \"ip\": [\"tcp:22\"] },",
    "  ],",
    "}",
  ];
}

export function remoteUrl(host: string): string | null {
  const h = host.trim();
  return h ? `https://${h}/` : null;
}

/** Rust `valid_ts_host` 와 같은 규칙(화면의 즉시 안내용 · 최종 판정은 Rust). */
export function validTsHost(host: string): boolean {
  const labels = host.split(".");
  return (
    host.length <= 253 &&
    host.endsWith(".ts.net") &&
    labels.length >= 4 &&
    labels.every((l) => l.length > 0 && l.length <= 63 && !l.startsWith("-") && !l.endsWith("-") && /^[a-z0-9-]+$/.test(l))
  );
}

export type HostNote =
  | { kind: "found"; host: string }
  | { kind: "same" }
  | { kind: "applied"; url: string }
  /** 켜짐인데 이름이 비었다(릴리스는 관문을 열지 않는다) */
  | { kind: "missing" }
  /** 개발 빌드 — 이름 없이 127.0.0.1 로만 연다 */
  | { kind: "devLoopback" };

export interface HostNoteInput {
  host: string | undefined;
  savedHost: string | undefined;
  enabled: boolean;
  status: RemoteStatus | null;
  detected: { host: string; changed: boolean } | null;
  dev: boolean;
  remote: boolean;
}

const norm = (h: string | undefined): string => (h ?? "").trim().toLowerCase();

/** 관문 에러(`status.error`)는 상태 줄이 이미 말하니 여기서는 그리지 않는다 */
export function hostNote(i: HostNoteInput): HostNote | null {
  const host = norm(i.host);
  const saved = norm(i.savedHost);
  if (!i.remote && i.detected && norm(i.detected.host) === host && host) {
    if (!i.detected.changed) return { kind: "same" };
    if (host !== saved) return { kind: "found", host };
  }
  const s = i.status;
  if (host && host === saved && s && s.enabled && s.listening && !s.error && norm(s.host) === saved) {
    return { kind: "applied", url: `https://${saved}/` };
  }
  if (i.enabled && !host) {
    if (i.dev) return { kind: "devLoopback" };
    return i.remote ? null : { kind: "missing" };
  }
  return null;
}

/** `dot` 은 아이콘 세트가 아니라 CSS 점이다. */
export interface HostNoteIcon {
  icon: "check" | "dot" | "warning" | "info";
  tone: "ok" | "accent" | "muted" | "warn";
}

/** 문장은 아이콘의 툴팁 · 읽기 이름으로만 나간다 — 칸 아래 줄은 두지 않는다(줄이 생기면 화면이 늘어난다) */
export function hostNoteIcon(note: HostNote | null): HostNoteIcon | null {
  switch (note?.kind) {
    case "applied":
      return { icon: "check", tone: "ok" };
    case "found":
      return { icon: "dot", tone: "accent" };
    case "same":
      return { icon: "check", tone: "muted" };
    case "missing":
      return { icon: "warning", tone: "warn" };
    case "devLoopback":
      return { icon: "info", tone: "muted" };
    default:
      return null;
  }
}

/**
 * **원격 접속(원격 웹 클라이언트)의 순수 조각** — 설정 › 원격 접속 화면과 상태바 원격 칩이 함께 쓴다(R1a-5 —
 * 설계 docs/log/2026-10-15-remote-web-client-design.md 13·14절). Rust `remote.rs`(`remote_status` · `remote_devices_list` ·
 * `remote_log`)의 모양과 1:1 이고, 사용자가 칠 명령·정책 조각을 여기서 만든다. 잎 모듈이다 — 앱 모듈을 부르지 않는다.
 */
import type { Key } from "$lib/i18n/keys";

/** Rust `RemoteStatus` */
export interface RemoteStatus {
  enabled: boolean;
  listening: boolean;
  port: number;
  host: string;
  /** Funnel 이 이 포트를 공개 인터넷에 내보내는가 */
  funnel: "off" | "on" | "unknown";
  /** `tailscale` CLI 를 찾았는가 */
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

/** [연결] · [serve 끄기] 가 지금 어디까지 왔나 */
export type ConnectFlow =
  | { phase: "idle" }
  | { phase: "busy"; step: "serve" | "off" }
  | { phase: "confirm"; target: string }
  | { phase: "admin"; message: string; url?: string }
  | { phase: "failed"; message: string; retry: "connect" | "off" };

/** "Tailscale 연결" 줄이 그릴 것 — [`connectRowState`] 의 결과 */
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
  /** 저장된 `[remote]` */
  savedEnabled: boolean;
  savedHost: string | undefined;
}

/**
 * **"Tailscale 연결" 줄의 상태 하나** — 우선순위: 하는 중 → 방금 동작의 답(확인 · 관리 화면 · 실패) → CLI 없음 → 확인 전 → 연결됨 → 처음.
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

/** 설정 › 원격 접속의 펼침 카드 넷 — 한 번에 한 장만 열린다 */
export type RemoteCard = "access" | "devices" | "log" | "guide";

/** 상태 줄의 사실 칩 하나 — 이상이 있을 때만 선다. `tone` 은 `StatusChip` 의 톤. `tip` 은 그대로 보일 글(오류), `tipKey` 는 문구 키 */
export interface RemoteStateChip {
  id: "stopped" | "failed" | "funnel" | "cli";
  tone: "bad" | "idle" | "off";
  label: Key;
  tip?: string;
  tipKey?: Key;
}

/** 상태 줄 — [`remoteStateView`] 의 결과. `phase` 는 처음 펼칠 카드의 재료다 */
export interface RemoteStateView {
  phase: "checking" | "before" | "connected";
  tone: "ok" | "warn" | "bad" | "neutral";
  icon: "remote" | "warning";
  title: Key;
  /** 없으면 제목만 */
  note: Key | null;
  chips: RemoteStateChip[];
}

export interface RemoteStateInput {
  /** 원격 창 — serve 판정이 없다 */
  remote: boolean;
  /** **이번 방문에 새로 읽은** 값(읽기 전이면 `null`) — 지난 값이면 초록이나 경고가 깜빡인다 */
  status: RemoteStatus | null;
  serve: RemoteServeStatus | null;
  /** 저장된 켬(저장 전 편집 아님) */
  savedEnabled: boolean;
  /** 볼트에 마스터 암호가 있다 */
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
/** Funnel 칩은 이상일 때만 — 꺼짐은 말하지 않는다 */
const funnelIfOdd = (f: RemoteStatus["funnel"]): RemoteStateChip[] => (f === "off" ? [] : [funnelChip(f)]);

/**
 * **원격 접속 상태 줄** — 단계는 제목이 말하고, 칩은 이상이 있을 때만 선다. **연결됨은 serve 가 우리 것이고 듣는 중일 때만이다**(토글만 켰거나 [serve 끄기] 뒤에 초록을 그리면 거짓이다).
 * 원격 창은 serve 판정이 없어 저장된 켬 + 수신 중으로 보고 [연결] 을 말하지 않는다. 우선순위는 코드 순서 그대로다.
 *
 * Rust 의 사실(`remote/gateway.rs` · `remote/serve.rs`): Funnel 이 보여 관문을 닫으면 `funnel: "on"` · `listening: false` · `error` 가 함께 온다 — 이것만 "관문 닫힘" 이다.
 * `serve: "funnel"` 은 443 **또는** 이 포트가 Funnel 로 나간다는 뜻이라 저장 꺼짐이어도 올 수 있고 관문은 아직 열려 있을 수 있어(문지기는 60초마다) 따로 말한다. 켠 직후 첫 Funnel 확인이
 * 끝나기 전에는 `listening: false` 인데 오류가 없다 — 실패가 아니라 확인 중이다. `serve: "unknown"` 은 CLI 가 답하지 않았을 때다. 마스터 암호 경고 칩은 화면 몫이라 여기 없다.
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

/**
 * **섹션에 들어와 처음 펼칠 카드** — 연결 전이면 원격 접속, 연결됐으면 모두 접힘. 확인 중이면 `undefined`(아직 정하지 않는다).
 */
export function firstOpenCard(phase: RemoteStateView["phase"]): RemoteCard | null | undefined {
  if (phase === "checking") return undefined;
  return phase === "before" ? "access" : null;
}

/** 설정 색인 · 앵커가 가리키는 칸이 든 카드 — 머리에 늘 보이는 칸(`remote-enabled`)과 모르는 앵커는 `null`(펼치지 않는다). */
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
  /** 지금 원격 가림막을 걷은 세션이 있다 */
  unlocked: boolean;
  /** 지금 붙은 원격 창 수 */
  connected: number;
}

/** Rust `activity::Entry` — 비밀 없음 */
export interface RemoteLogEntry {
  at: string;
  kind: RemoteLogKind;
  deviceId: string;
  deviceName: string;
  /** 무엇을 했나(R4 — 재확인 줄의 일 이름 · Rust 가 이미 사람 말로) — 다른 줄에는 없다 */
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

/** 기록 줄 종류 → 문구 키(모르는 종류는 `null` — 줄을 그리지 않는다) */
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

/**
 * **지금 원격으로 쓰는 기기** — 열렸고(세션) 원격 창이 하나 이상 붙은 기기. 상태바 "원격 접속 중 (N)" 의 N 이다
 * (열기만 하고 페이지가 아직 안 붙었거나, 끊긴 뒤 세션만 남은 기기는 세지 않는다).
 */
export function activeDevices(devices: readonly RemoteDevice[]): RemoteDevice[] {
  return devices.filter((d) => d.unlocked && d.connected > 0);
}

/** CLI 가 없을 때 [Tailscale 설치 ↗] 가 여는 곳 */
export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";

/**
 * **`tailscale serve` 켜는 명령**(직접 설정용 안내 — [연결] 은 Rust `remote/serve.rs` 가 같은 인자를 고정으로 실행한다) — tailnet 안에만 `https://<이 PC 의 MagicDNS 이름>/`(443) 를 열고 그 요청을 이 앱의 관문
 * `http://127.0.0.1:<포트>` 로 넘긴다. 인증서·TLS 는 Tailscale 이 맡는다. `--bg` = 백그라운드로 남는다(재부팅 뒤에도 —
 * 끌 때까지). Tailscale 1.52 부터의 새 `serve` 문법이다(옛 `serve https / http://…` 문법은 쓰지 않는다).
 */
export function serveCommand(port: number): string {
  return `tailscale serve --bg --https=443 http://127.0.0.1:${port}`;
}

/** 끄는 명령 — 443 자리 하나만 걷는다(다른 serve 설정은 그대로). */
export const SERVE_OFF_COMMAND = "tailscale serve --https=443 off";

/** 지금 serve 설정 보기(Funnel 이 섞였는지도 여기서 보인다). */
export const SERVE_STATUS_COMMAND = "tailscale serve status";

/** 이 PC 의 MagicDNS 이름 찾기 — `Self.DNSName`(끝의 `.` 는 뺀다). PowerShell 한 줄. */
export const DNS_NAME_COMMAND = "(tailscale status --json | ConvertFrom-Json).Self.DNSName";

/**
 * **tailnet 정책 예시**(HuJSON — Tailscale 관리 화면 › Access controls) — 원격 접속 포트(443)는 **내 기기만**. 기본 정책의
 * "모두 허용" 규칙이 남아 있으면 이 줄은 아무것도 좁히지 않는다(그래서 첫 주석이 그것을 말한다).
 * `autogroup:self` = 같은 사용자의 기기 · 태그 단 서버(`tag:server`)는 사용자 소유가 아니라서 여기 들지 않는다.
 * 주석 글자만 사전에서 받는다(`settings.remote.check.acl.comment.*`) — 규칙 줄은 언어와 무관하다.
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

/** 브라우저에서 열 주소 — 이름이 없으면 `null`. */
export function remoteUrl(host: string): string | null {
  const h = host.trim();
  return h ? `https://${h}/` : null;
}

/** `*.ts.net` MagicDNS 이름 모양인가 — Rust `valid_ts_host` 와 같은 규칙(화면의 즉시 안내용 · 최종 판정은 Rust). */
export function validTsHost(host: string): boolean {
  const labels = host.split(".");
  return (
    host.length <= 253 &&
    host.endsWith(".ts.net") &&
    labels.length >= 4 &&
    labels.every((l) => l.length > 0 && l.length <= 63 && !l.startsWith("-") && !l.endsWith("-") && /^[a-z0-9-]+$/.test(l))
  );
}

/** 이름 칸 상태 — [`hostNote`] 의 결과(화면은 [`hostNoteIcon`] 아이콘 + 툴팁). */
export type HostNote =
  /** [찾기] 가 새 이름을 채웠다 — 아직 저장 전 */
  | { kind: "found"; host: string }
  /** [찾기] 결과가 이미 칸의 이름과 같다 */
  | { kind: "same" }
  /** 저장된 이름으로 관문이 듣는 중 */
  | { kind: "applied"; url: string }
  /** 켜짐인데 이름이 비었다(릴리스는 관문을 열지 않는다) */
  | { kind: "missing" }
  /** 개발 빌드 — 이름 없이 127.0.0.1 로만 연다 */
  | { kind: "devLoopback" };

export interface HostNoteInput {
  /** 칸의 지금 값(저장 전 포함) */
  host: string | undefined;
  /** 저장된 값 */
  savedHost: string | undefined;
  /** 칸의 켜기 값(저장 전 포함) */
  enabled: boolean;
  status: RemoteStatus | null;
  /** 마지막 [찾기] 결과 — `changed` = 그때 칸의 값과 달랐나 */
  detected: { host: string; changed: boolean } | null;
  dev: boolean;
  /** 원격 창(찾기 없음) */
  remote: boolean;
}

const norm = (h: string | undefined): string => (h ?? "").trim().toLowerCase();

/**
 * **이름 칸 상태** — [찾기] 가 무엇을 했는지와 저장된 이름이 실제로 걸렸는지를 사람 말로. 우선순위:
 * [찾기] 결과(칸이 그 값 그대로일 때만) → 적용됨 → 이름 없음. 관문 에러(`status.error`)는 상태 줄이 이미 말하니 여기서는
 * "이름 없음" 말고는 따로 그리지 않는다(`null`). 찾기 실패 · 형식 오류는 화면이 따로 그린다.
 */
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

/** 이름 칸 왼쪽 상태 아이콘 하나 — [`hostNoteIcon`] 의 결과. `dot` 은 아이콘 세트가 아니라 CSS 점이다. */
export interface HostNoteIcon {
  icon: "check" | "dot" | "warning" | "info";
  tone: "ok" | "accent" | "muted" | "warn";
}

/**
 * **상태 → 칸 왼쪽 아이콘** — 문장은 아이콘의 툴팁·읽기 이름으로만 나가고 칸 아래 줄은 없다(줄이 생기면 화면이 늘어난다).
 * 적용됨 = 초록 체크 · 찾음(저장 전) = 강조색 점 · 이미 같은 이름 = 흐린 체크 · 이름 없음 = 경고 · 개발 루프백 = 흐린 정보.
 */
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

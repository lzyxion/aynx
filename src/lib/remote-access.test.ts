import { describe, expect, it } from "vitest";
import {
  aclExample,
  connectRowState,
  type ConnectRowInput,
  firstOpenCard,
  hostNote,
  hostNoteIcon,
  activeDevices,
  logKindKey,
  remoteAnchorCard,
  remoteStateView,
  type RemoteStateInput,
  remoteUrl,
  serveCommand,
  validTsHost,
  type HostNoteInput,
  type RemoteDevice,
  type RemoteStatus,
} from "$lib/remote-access";

const dev = (id: string, unlocked: boolean, connected: number): RemoteDevice => ({
  id,
  name: id,
  created: "",
  lastSeen: "",
  unlocked,
  connected,
});

describe("Tailscale 연결 줄 상태", () => {
  const status: RemoteStatus = { enabled: false, listening: false, port: 47821, host: "", funnel: "off", tailscaleCli: true };
  const input = (over: Partial<ConnectRowInput> = {}): ConnectRowInput => ({
    flow: { phase: "idle" },
    status,
    serve: { state: "none" },
    savedEnabled: false,
    savedHost: undefined,
    ...over,
  });
  const HOST = "mypc.tail1234.ts.net";

  it("확인 전 · 처음", () => {
    expect(connectRowState(input({ status: null }))).toEqual({ state: "checking" });
    expect(connectRowState(input({ serve: null }))).toEqual({ state: "checking" });
    expect(connectRowState(input())).toEqual({ state: "ready" });
    // 못 읽음 · 남의 443 도 누르기 전에는 처음 화면 — 답은 [연결] 이 받는다
    expect(connectRowState(input({ serve: { state: "unknown" } }))).toEqual({ state: "ready" });
    expect(connectRowState(input({ serve: { state: "other", target: "x" } }))).toEqual({ state: "ready" });
    expect(connectRowState(input({ serve: { state: "funnel" } }))).toEqual({ state: "ready" });
  });

  it("연결됨은 serve 가 우리 것이고 저장된 켬 · 이름이 있을 때만", () => {
    const ours = { state: "ours" } as const;
    expect(connectRowState(input({ serve: ours, savedEnabled: true, savedHost: HOST }))).toEqual({
      state: "connected",
      url: `https://${HOST}/`,
    });
    expect(connectRowState(input({ serve: ours, savedEnabled: false, savedHost: HOST }))).toEqual({ state: "ready" });
    expect(connectRowState(input({ serve: ours, savedEnabled: true }))).toEqual({ state: "ready" });
    expect(connectRowState(input({ serve: { state: "none" }, savedEnabled: true, savedHost: HOST }))).toEqual({ state: "ready" });
  });

  it("CLI 없음은 판정과 상관없이 · 하는 중과 방금의 답이 앞선다", () => {
    const noCli = { ...status, tailscaleCli: false };
    expect(connectRowState(input({ status: noCli, serve: null }))).toEqual({ state: "nocli" });
    expect(connectRowState(input({ status: noCli, flow: { phase: "busy", step: "serve" } }))).toEqual({ state: "busy", step: "serve" });
    expect(connectRowState(input({ flow: { phase: "confirm", target: "t" } }))).toEqual({ state: "other", target: "t" });
    expect(connectRowState(input({ flow: { phase: "admin", message: "m", url: "u" } }))).toEqual({ state: "admin", message: "m", url: "u" });
    expect(connectRowState(input({ flow: { phase: "failed", message: "m", retry: "off" } }))).toEqual({
      state: "failed",
      message: "m",
      retry: "off",
    });
    const connected = input({ serve: { state: "ours" }, savedEnabled: true, savedHost: HOST, flow: { phase: "busy", step: "off" } });
    expect(connectRowState(connected)).toEqual({ state: "busy", step: "off" });
  });
});

describe("처음 펼칠 카드(firstOpenCard)", () => {
  it("연결 전만 원격 접속 · 연결됨은 모두 접힘 · 확인 중은 아직 정하지 않는다", () => {
    expect(firstOpenCard("before")).toBe("access");
    expect(firstOpenCard("connected")).toBeNull();
    expect(firstOpenCard("checking")).toBeUndefined();
  });
});

describe("상태 줄(remoteStateView)", () => {
  const off: RemoteStatus = { enabled: false, listening: false, port: 47821, host: "", funnel: "unknown", tailscaleCli: true };
  const on: RemoteStatus = { enabled: true, listening: true, port: 47821, host: "a.b.ts.net", funnel: "off", tailscaleCli: true };
  const input = (over: Partial<RemoteStateInput> = {}): RemoteStateInput => ({
    remote: false,
    status: on,
    serve: { state: "ours" },
    savedEnabled: true,
    hasMaster: true,
    deviceCount: 0,
    ...over,
  });
  const ids = (v: ReturnType<typeof remoteStateView>) => v.chips.map((c) => c.id).join();
  const P = "settings.remote.state.";
  const CHECKING = { phase: "checking", tone: "neutral", title: "settings.remote.connect.checking", note: null, chips: [] };

  it("연결됨은 serve 가 우리 것이고 듣는 중일 때만 · 정상이면 칩이 없다", () => {
    const pairing = remoteStateView(input());
    expect(pairing).toMatchObject({ phase: "connected", tone: "ok", title: `${P}pairing.title`, note: `${P}pairing.note`, chips: [] });
    const inUse = remoteStateView(input({ deviceCount: 2 }));
    expect(inUse).toMatchObject({ phase: "connected", tone: "ok", title: `${P}inUse.title`, note: `${P}inUse.note`, chips: [] });
  });

  it("마스터 없으면 연결된 두 상태만 경고로", () => {
    expect(remoteStateView(input({ hasMaster: false }))).toMatchObject({ tone: "warn", title: `${P}pairing.title`, note: `${P}noMaster.note` });
    expect(remoteStateView(input({ hasMaster: false, deviceCount: 1 }))).toMatchObject({ tone: "warn", title: `${P}inUse.title`, note: `${P}noMaster.note` });
    expect(remoteStateView(input({ hasMaster: false, serve: { state: "none" } })).note).toBe(`${P}noserve.note`);
  });

  it("Funnel 로 관문이 닫히면 무엇보다 앞선다", () => {
    const status: RemoteStatus = { ...on, listening: false, funnel: "on", error: "closed" };
    const v = remoteStateView(input({ status, deviceCount: 2, hasMaster: false }));
    expect(v).toMatchObject({ phase: "before", tone: "bad", icon: "warning", title: `${P}funnel.title`, note: `${P}funnel.note` });
    expect(ids(v)).toBe("stopped,funnel");
    expect(v.chips[1].tone).toBe("bad");
    expect(remoteStateView(input({ status: { ...status, enabled: false }, savedEnabled: false })).title).toBe(`${P}off.title`);
  });

  it("serve 판정의 Funnel — 관문이 아직 열려 있거나 꺼져 있어도 위험을 말한다", () => {
    for (const over of [{}, { savedEnabled: false, status: off }]) {
      const v = remoteStateView(input({ ...over, serve: { state: "funnel" } }));
      expect(v).toMatchObject({ phase: "before", tone: "bad", title: `${P}funnel443.title`, note: `${P}funnel443.note` });
      expect(ids(v)).toBe("funnel");
      expect(v.chips[0].label).toBe("settings.remote.status.funnel.on");
    }
  });

  it("켰는데 수신 실패 — 오류가 있을 때만 · 켠 직후 오류 없음은 확인 중", () => {
    const failed = remoteStateView(input({ status: { ...on, listening: false, error: "no host" } }));
    expect(failed).toMatchObject({ phase: "before", tone: "bad", title: `${P}failed.title`, note: `${P}failed.note` });
    expect(ids(failed)).toBe("failed");
    expect(failed.chips[0].tip).toBe("no host");
    expect(ids(remoteStateView(input({ status: { ...on, listening: false, funnel: "unknown", error: "x" } })))).toBe("failed,funnel");
    expect(remoteStateView(input({ status: { ...on, listening: false, funnel: "unknown" } }))).toMatchObject(CHECKING);
  });

  it("저장 꺼짐 — 중립 · 칩 없음 · CLI 가 없으면 [연결] 을 말하지 않는다", () => {
    const v = remoteStateView(input({ savedEnabled: false, status: off, serve: { state: "none" } }));
    expect(v).toMatchObject({ phase: "before", tone: "neutral", title: `${P}off.title`, note: `${P}off.note`, chips: [] });
    const noCli = remoteStateView(input({ savedEnabled: false, status: { ...off, tailscaleCli: false } }));
    expect(noCli).toMatchObject({ tone: "neutral", title: `${P}off.title`, note: `${P}nocli.note` });
    expect(ids(noCli)).toBe("cli");
    // 저장 전 편집이 아니라 저장된 값 — 관문이 아직 듣고 있어도(저장 직후) 꺼짐이다
    expect(remoteStateView(input({ savedEnabled: false })).title).toBe(`${P}off.title`);
  });

  it("CLI 없음 — 토글이 켜져 있고 듣는 중이어도 연결됨이 아니다", () => {
    const v = remoteStateView(input({ status: { ...on, tailscaleCli: false, funnel: "unknown" }, serve: { state: "unknown" }, deviceCount: 3 }));
    expect(v).toMatchObject({ phase: "before", tone: "warn", title: `${P}nocli.title`, note: `${P}nocli.note` });
    expect(ids(v)).toBe("cli");
  });

  it("serve 확인 전 · 상태 읽기 전은 확인 중 — 초록도 경고도 아니다", () => {
    expect(remoteStateView(input({ serve: null, hasMaster: false, deviceCount: 1 }))).toMatchObject(CHECKING);
    expect(remoteStateView(input({ status: null }))).toMatchObject(CHECKING);
  });

  it("serve 없음 · 남의 443 · 못 읽음은 경고 + 연결 전", () => {
    expect(remoteStateView(input({ serve: { state: "none" } }))).toMatchObject({ phase: "before", tone: "warn", title: `${P}noserve.title`, note: `${P}noserve.note`, chips: [] });
    expect(remoteStateView(input({ serve: { state: "other", target: "t" } }))).toMatchObject({ phase: "before", tone: "warn", title: `${P}other.title`, note: `${P}other.note`, chips: [] });
    expect(remoteStateView(input({ serve: { state: "unknown" } }))).toMatchObject({ phase: "before", tone: "warn", title: `${P}unknown.title` });
  });

  it("Funnel 을 확인 못 하면 연결됨이어도 칩이 남는다 — 닫힘은 아니다", () => {
    const v = remoteStateView(input({ status: { ...on, funnel: "unknown" } }));
    expect(v).toMatchObject({ phase: "connected", tone: "ok" });
    expect(v.chips).toEqual([expect.objectContaining({ id: "funnel", tone: "idle", label: "settings.remote.status.funnel.unknown" })]);
  });

  it("원격 창 — serve 를 꾸미지 않고 저장 켬 + 수신 중으로 · [연결] 을 말하지 않는다", () => {
    const remote = { remote: true, serve: null };
    expect(remoteStateView(input({ ...remote }))).toMatchObject({ phase: "connected", title: `${P}pairing.title`, chips: [] });
    expect(remoteStateView(input({ ...remote, deviceCount: 1 }))).toMatchObject({ phase: "connected", title: `${P}inUse.title` });
    // 집 PC CLI 판정은 원격 창에서 말하지 않는다 — 이 창이 떠 있는 것이 곧 연결이다
    expect(remoteStateView(input({ ...remote, status: { ...on, tailscaleCli: false } })).phase).toBe("connected");
    expect(remoteStateView(input({ ...remote, savedEnabled: false, status: off }))).toMatchObject({ phase: "before", title: `${P}off.title`, note: `${P}off.note.remote`, chips: [] });
    expect(remoteStateView(input({ ...remote, status: { ...on, listening: false } }))).toMatchObject(CHECKING);
    for (const v of [input({ ...remote }), input({ ...remote, savedEnabled: false, status: off })]) {
      expect(remoteStateView(v).note).not.toBe(`${P}off.note`);
      expect(remoteStateView(v).note).not.toBe(`${P}noserve.note`);
    }
  });
});

describe("앵커가 가리키는 카드(remoteAnchorCard)", () => {
  it("몸통 안 칸은 그 카드 · 머리에 늘 보이는 칸과 모르는 앵커는 없음", () => {
    expect(remoteAnchorCard("remote-host")).toBe("access");
    expect(remoteAnchorCard("remote-port")).toBe("access");
    expect(remoteAnchorCard("remote-devices-label")).toBe("devices");
    expect(remoteAnchorCard("remote-checklist")).toBe("guide");
    expect(remoteAnchorCard("remote-enabled")).toBeNull();
    expect(remoteAnchorCard("nope")).toBeNull();
  });
});

describe("원격 접속 순수 조각", () => {
  it("상태바의 N 은 열렸고 원격 창이 붙은 기기만 센다", () => {
    const list = [dev("a", true, 1), dev("b", true, 0), dev("c", false, 2), dev("d", true, 3)];
    expect(activeDevices(list).map((d) => d.id)).toEqual(["a", "d"]);
    expect(activeDevices([])).toEqual([]);
  });

  it("serve 명령은 443 → 127.0.0.1:<포트> (Funnel 아님)", () => {
    expect(serveCommand(47821)).toBe("tailscale serve --bg --https=443 http://127.0.0.1:47821");
    expect(serveCommand(47821)).not.toMatch(/funnel/);
  });

  it("정책 예시는 Funnel 없이 내 기기만 443 을 연다", () => {
    const text = aclExample({ default: "A", self: "B", server: "C" }).join("\n");
    expect(text).toContain('"dst": ["autogroup:self"], "ip": ["tcp:443"]');
    expect(text.toLowerCase()).not.toContain("funnel");
    // 주석 글자는 부르는 쪽(사전)에서만 온다 — 코드에 박힌 한 언어가 없다
    expect(text).not.toMatch(/[가-힣]/);
    for (const c of ["// A", "// B", "// C"]) expect(text).toContain(c);
  });

  it("기록 종류마다 문구 키가 있고 모르는 것은 null", () => {
    for (const k of ["paired", "unlocked", "unlockFailed", "locked", "connected", "disconnected", "revoked", "disconnectedAll", "reauthorized"]) {
      expect(logKindKey(k)).toBe(`settings.remote.log.${k}`);
    }
    expect(logKindKey("nope")).toBeNull();
  });

  it("MagicDNS 이름 모양은 Rust 와 같은 규칙", () => {
    expect(validTsHost("mypc.tail1234.ts.net")).toBe(true);
    expect(validTsHost("MyPC.tail1234.ts.net")).toBe(false);
    expect(validTsHost("mypc.ts.net")).toBe(false);
    expect(validTsHost("mypc.example.com")).toBe(false);
    expect(validTsHost("-a.tail.ts.net")).toBe(false);
    expect(remoteUrl(" mypc.tail1234.ts.net ")).toBe("https://mypc.tail1234.ts.net/");
    expect(remoteUrl("")).toBeNull();
  });
});

describe("이름 칸 상태 한 줄(hostNote)", () => {
  const H = "mypc.tail1234.ts.net";
  const st = (over: Partial<RemoteStatus> = {}): RemoteStatus => ({
    enabled: true,
    listening: true,
    port: 47821,
    host: H,
    funnel: "off",
    tailscaleCli: true,
    ...over,
  });
  const base: HostNoteInput = {
    host: H,
    savedHost: H,
    enabled: true,
    status: st(),
    detected: null,
    dev: false,
    remote: false,
  };

  it("찾기로 새 이름 — 저장 전이면 found", () => {
    expect(hostNote({ ...base, savedHost: undefined, status: st({ host: "", listening: false }), detected: { host: H, changed: true } })).toEqual({
      kind: "found",
      host: H,
    });
  });

  it("찾기 결과가 이미 같은 이름이면 same", () => {
    expect(hostNote({ ...base, detected: { host: H, changed: false } })).toEqual({ kind: "same" });
  });

  it("찾은 뒤 저장해 관문이 그 이름으로 듣으면 applied", () => {
    expect(hostNote({ ...base, detected: { host: H, changed: true } })).toEqual({ kind: "applied", url: `https://${H}/` });
    expect(hostNote(base)).toEqual({ kind: "applied", url: `https://${H}/` });
  });

  it("찾은 뒤 칸을 손으로 고치면 찾기 문구는 사라진다", () => {
    expect(hostNote({ ...base, host: "other.tail1234.ts.net", detected: { host: H, changed: true } })).toBeNull();
  });

  it("관문이 다른 이름·안 들음·에러면 applied 아님", () => {
    expect(hostNote({ ...base, status: st({ host: "old.tail1234.ts.net" }) })).toBeNull();
    expect(hostNote({ ...base, status: st({ listening: false }) })).toBeNull();
    expect(hostNote({ ...base, status: st({ error: "x" }) })).toBeNull();
    expect(hostNote({ ...base, status: null })).toBeNull();
  });

  it("켜짐 + 이름 없음 — 릴리스는 missing, 개발은 루프백 안내, 꺼짐은 없음", () => {
    const empty = { ...base, host: undefined, savedHost: undefined, status: st({ host: "", listening: false, error: "no host" }) };
    expect(hostNote(empty)).toEqual({ kind: "missing" });
    expect(hostNote({ ...empty, dev: true })).toEqual({ kind: "devLoopback" });
    expect(hostNote({ ...empty, enabled: false })).toBeNull();
  });

  it("원격 창은 찾기 결과를 보지 않고 applied 만(이름 없음은 개발만)", () => {
    expect(hostNote({ ...base, remote: true, detected: { host: H, changed: false } })).toEqual({ kind: "applied", url: `https://${H}/` });
    const empty = { ...base, remote: true, host: undefined, savedHost: undefined, status: st({ host: "" }) };
    expect(hostNote(empty)).toBeNull();
    expect(hostNote({ ...empty, dev: true })).toEqual({ kind: "devLoopback" });
  });
});

describe("이름 칸 왼쪽 아이콘(hostNoteIcon)", () => {
  it("상태마다 아이콘 하나 · 상태 없음은 비움", () => {
    expect(hostNoteIcon({ kind: "applied", url: "https://x/" })).toEqual({ icon: "check", tone: "ok" });
    expect(hostNoteIcon({ kind: "found", host: "x" })).toEqual({ icon: "dot", tone: "accent" });
    expect(hostNoteIcon({ kind: "same" })).toEqual({ icon: "check", tone: "muted" });
    expect(hostNoteIcon({ kind: "missing" })).toEqual({ icon: "warning", tone: "warn" });
    expect(hostNoteIcon({ kind: "devLoopback" })).toEqual({ icon: "info", tone: "muted" });
    expect(hostNoteIcon(null)).toBeNull();
  });
});

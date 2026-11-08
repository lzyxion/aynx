// 생존·재부착 하네스의 공통 부품 (설계 docs/internal/session-server-design-2026-10-08.md 10절).
//
// **개발 앱만** 만진다 — GUI·서버 pid 는 언제나 `--exe`(기본: 이 저장소의 `src-tauri/target/debug/aynx.exe`)의
// 실행 파일 경로로 가린다. 사용자의 설치본(`Program Files`)·다른 워크트리의 개발 앱은 건드리지 않는다.
// 비밀·호스트 이름은 여기 적지 않는다 — SSH 행은 환경 변수(`SURVIVAL_SSH_TMUX` · `SURVIVAL_SSH_PLAIN`)로 받는다.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Date.now();

// ---------------------------------------------------------------------------
// 인자
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const o = { _: [], repeat: 1, cdp: 9222, exe: path.join(REPO, "src-tauri/target/debug/aynx.exe"), tiles: 16 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      o[k] = typeof o[k] === "number" ? Number(v) : v;
    } else o._.push(a);
  }
  o.exe = path.resolve(o.exe);
  return o;
}

// ---------------------------------------------------------------------------
// PowerShell · 프로세스
// ---------------------------------------------------------------------------

export function powershell(script, { timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(stdout)),
    );
  });
}

/** 모든 프로세스 — `{pid, ppid, name, exe, cmd, handles, ws}` (ws = 작업 집합 바이트) */
export async function procs() {
  const out = await powershell(
    "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;ppid=$_.ParentProcessId;name=$_.Name;exe=$_.ExecutablePath;cmd=$_.CommandLine;handles=$_.HandleCount;ws=$_.WorkingSetSize} } | ConvertTo-Json -Compress -Depth 2",
  );
  return JSON.parse(out);
}

const same = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * 이 개발 실행 파일의 GUI·서버 프로세스. 개발 빌드의 서버는 **그림자 사본**(`%APPDATA%\aynx-dev\server-bin\…`)에서
 * 돌 수 있어(cargo 가 exe 를 덮어쓸 수 있게) 서버는 명령줄 + 개발 데이터 폴더로도 가린다.
 */
export function devProcs(list, exe) {
  const shadow = path.join(process.env.APPDATA ?? "", "aynx-dev", "server-bin").toLowerCase();
  const mine = list.filter((p) => same(p.exe, exe) || (p.exe ?? "").toLowerCase().startsWith(shadow));
  return {
    gui: mine.filter((p) => same(p.exe, exe) && !/session-server|mcp-run|statusline/.test(p.cmd ?? "")),
    server: mine.filter((p) => /session-server/.test(p.cmd ?? "")),
  };
}

/** pid 의 자손 전부(자기 제외) */
export function descendants(list, pid) {
  const out = [];
  const seen = new Set([pid]);
  const q = [pid];
  while (q.length) {
    const cur = q.shift();
    for (const p of list)
      if (p.ppid === cur && !seen.has(p.pid)) {
        seen.add(p.pid);
        out.push(p);
        q.push(p.pid);
      }
  }
  return out;
}

/** 핸들 수·작업 집합·전용 메모리·스레드 수 */
export async function procStat(pid) {
  try {
    const out = await powershell(
      `$p = Get-Process -Id ${pid} -ErrorAction Stop; [pscustomobject]@{handles=$p.HandleCount; ws=$p.WorkingSet64; priv=$p.PrivateMemorySize64; threads=$p.Threads.Count} | ConvertTo-Json -Compress`,
    );
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function killPid(pid) {
  await powershell(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue; exit 0`).catch(() => {});
}

/** 하네스가 띄운 헤드리스 Edge(원격 디버깅 + 임시 프로필) 수 — 이 하네스는 하나도 띄우지 않는다(0 이어야 한다) */
export function headlessEdge(list) {
  const tmp = os.tmpdir().toLowerCase();
  return list.filter(
    (p) => /^msedge\.exe$/i.test(p.name) && /--remote-debugging-port/.test(p.cmd ?? "") && (p.cmd ?? "").toLowerCase().includes(tmp),
  ).length;
}

/**
 * 고아 셸 — 부모가 죽은 셸 중 **개발 앱이 띄운 흔적**이 있는 것.
 * 흔적 = 개발 앱의 셸 통합 스크립트(`aynx-dev`)를 명령줄에 품는다(로컬 타일의 pwsh 는 `-Command ". '<설정 루트>\integration.ps1'"`).
 */
export function orphanShells(list) {
  const pids = new Set(list.map((p) => p.pid));
  return list.filter(
    (p) => /^(pwsh|powershell|bash|cmd)\.exe$/i.test(p.name) && /aynx-dev/i.test(p.cmd ?? "") && !pids.has(p.ppid),
  );
}

/** 개발 앱이 띄운 셸 전부(부모 무관) */
export function devShells(list) {
  return list.filter((p) => /^(pwsh|powershell|bash|cmd)\.exe$/i.test(p.name) && /aynx-dev/i.test(p.cmd ?? ""));
}

// ---------------------------------------------------------------------------
// 찾기 파일
// ---------------------------------------------------------------------------

export function discovery() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.env.APPDATA ?? "", "aynx-dev", "server.json"), "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GUI 띄우기
// ---------------------------------------------------------------------------

/** 개발 GUI 를 CDP 포트를 켜서 띄운다(분리 — 하네스가 끝나도 남는다). 띄운 시각을 돌려준다. */
export function launchGui(o) {
  const t0 = now();
  const child = spawn(o.exe, [], {
    cwd: path.dirname(o.exe),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${o.cdp}` },
  });
  child.unref();
  return { t0, pid: child.pid };
}

// ---------------------------------------------------------------------------
// CDP
// ---------------------------------------------------------------------------

export class Cdp {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
  }
  static async connect(port, { timeoutMs = 30_000 } = {}) {
    const c = new Cdp(port);
    const until = now() + timeoutMs;
    for (;;) {
      try {
        await c.open();
        return c;
      } catch (e) {
        if (now() > until) throw new Error(`CDP ${port}: ${e.message}`);
        await sleep(50);
      }
    }
  }
  async open() {
    const list = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json();
    // 개발 앱의 페이지만(vite 1420). 설치본은 tauri.localhost 다.
    const t = list.find((x) => x.type === "page" && x.url.startsWith("http://localhost:1420"));
    if (!t) throw new Error("no dev page target");
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = () => j(new Error("ws error"));
    });
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) {
        this.pending.get(d.id)(d);
        this.pending.delete(d.id);
      } else if (d.method) this.events.push(d);
    };
    ws.onclose = () => {
      for (const r of this.pending.values()) r({ error: { message: "closed" } });
      this.pending.clear();
      this.ws = null;
    };
    this.ws = ws;
    // 죽은 렌더러의 페이지는 소켓은 열려도 답하지 않는다 — 시한을 둔다.
    const r = await Promise.race([this.send("Runtime.enable"), sleep(3000).then(() => ({ error: { message: "Runtime.enable timeout" } }))]);
    if (r.error) {
      this.close();
      throw new Error(r.error.message);
    }
  }
  send(method, params = {}) {
    if (!this.ws) return Promise.resolve({ error: { message: "closed" } });
    return new Promise((r) => {
      const id = ++this.seq;
      this.pending.set(id, r);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, { timeoutMs = 60_000 } = {}) {
    let timer;
    const r = await Promise.race([
      this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
      new Promise((res) => (timer = setTimeout(() => res({ error: { message: "eval timeout" } }), timeoutMs))),
    ]);
    clearTimeout(timer);
    if (r.error) throw new Error(r.error.message);
    if (r.result?.exceptionDetails)
      throw new Error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  }
  /** 콘솔 줄(이 연결이 본 것) */
  consoleLines() {
    return this.events
      .filter((e) => e.method === "Runtime.consoleAPICalled")
      .map((e) => e.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

/** 페이지에 도우미(`window.__sv`)를 심는다 — 리로드마다 다시. 앱과 같은 모듈 인스턴스를 쓰려고 vite 경로로 import 한다. */
export const HELPERS = String.raw`(async () => {
  const [tabs, tree, factory, sessions, tear, open] = await Promise.all([
    import('/src/lib/app/tabs.svelte.ts'), import('/src/lib/session/tree.ts'), import('/src/lib/session/factory.ts'),
    import('/src/lib/app/sessions.svelte.ts'), import('/src/lib/tear.ts'), import('/src/lib/session/open.ts'),
  ]);
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const allPanes = () => tabs.currentWorkspaceTabs().flatMap((t) => tree.listPanes(t.root).map((p) => ({ tab: t.id, pane: p })));
  const paneOf = (s) => allPanes().find(({ pane }) => open.sessionStreamOf(pane) === s)?.pane ?? null;
  window.__sv = {
    inv,
    panes: () => allPanes().map(({ tab, pane }) => ({ tab, id: pane.id, kind: pane.kind, stream: open.sessionStreamOf(pane), session: sessions.sessionOf(pane.id) })),
    byStream: paneOf,
    open(kind, cmd, { newTab = false, alias, tmux } = {}) {
      const base = kind === 'ssh' ? factory.newSshPane(alias) : factory.newLocalPane();
      const p = { ...base, ...(cmd ? { autorun: cmd } : {}), ...(tmux !== undefined ? { tmux } : {}) };
      if (newTab) tabs.openInNewTab(p, 'survival'); else tabs.openPaneHere(p);
      return { id: p.id, stream: open.sessionStreamOf(p), tab: tabs.tabOfPane(p.id)?.id ?? null };
    },
    snap(stream) {
      const p = paneOf(stream);
      if (!p) return null;
      const s = tear.snapshotPane(p.id);
      return s ? { buffer: s.buffer, consumed: s.consumed ?? null, cols: s.cols, rows: s.rows, session: sessions.sessionOf(p.id) } : null;
    },
    lease(stream) {
      const p = paneOf(stream);
      const id = p && sessions.sessionOf(p.id);
      return id == null ? null : open.leaseOf(p.kind, id);
    },
    write(stream, data) {
      const p = paneOf(stream);
      const id = p && sessions.sessionOf(p.id);
      return id == null ? Promise.reject(new Error('no session')) : open.writeSessionById(p.kind, id, data);
    },
    closeTab: (id) => tabs.closeTab(id),
    selectTab: (id) => tabs.selectTab(id),
    tabs: () => tabs.currentWorkspaceTabs().map((t) => t.id),
    active: () => tabs.activeTabId(),
  };
  return true;
})()`;

export async function helpers(cdp) {
  for (let i = 0; i < 150; i++) {
    try {
      if (await cdp.eval(HELPERS, { timeoutMs: 10_000 })) return;
    } catch {}
    await sleep(100);
  }
  throw new Error("page helpers did not load");
}

// ---------------------------------------------------------------------------
// 번호 루프 · 연속 검사
// ---------------------------------------------------------------------------

/** 로컬 pwsh 번호 루프 — `n=<번호>`(+ 채움) 를 `ms` 간격으로 `count` 번. 자체 종료한다(합성 Ctrl+C 는 pwsh 를 못 끊는다). */
export const pwshLoop = (count, ms, pad = 0) =>
  `1..${count} | % { "n=$_${pad > 0 ? ` ${"x".repeat(pad)}` : ""}"${ms > 0 ? `; Start-Sleep -Milliseconds ${ms}` : ""} }`;
/** 원격 bash 번호 루프 */
export const bashLoop = (count, ms, pad = 0) =>
  `for i in $(seq 1 ${count}); do echo "n=$i${pad > 0 ? ` ${"x".repeat(pad)}` : ""}"; sleep ${(ms / 1000).toFixed(3)}; done`;

export const stripAnsi = (s) =>
  String(s ?? "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "");

/** 화면 직렬화에서 `n=K` 줄을 뽑아 연속성을 본다(`n=K` 로 **시작하는 줄만** — 명령 메아리 `"n=$_"` 는 숫자가 아니라 빠진다) */
export function seqCheck(buffer) {
  const nums = [];
  for (const line of stripAnsi(buffer).split(/\r?\n/)) {
    const m = /^n=(\d+)(?: x+)?\s*$/.exec(line);
    if (m) nums.push(Number(m[1]));
  }
  let missing = 0;
  let dup = 0;
  const gaps = [];
  for (let i = 1; i < nums.length; i++) {
    const d = nums[i] - nums[i - 1];
    if (d === 1) continue;
    if (d <= 0) dup++;
    else {
      missing += d - 1;
      gaps.push([nums[i - 1], nums[i]]);
    }
  }
  return { first: nums[0] ?? null, last: nums.at(-1) ?? null, count: nums.length, missing, dup, gaps: gaps.slice(0, 8) };
}

// ---------------------------------------------------------------------------
// 앱 상태
// ---------------------------------------------------------------------------

export const status = (cdp) => cdp.eval(`window.__TAURI_INTERNALS__.invoke('session_server_status')`, { timeoutMs: 10_000 });

/** 스트림들이 모두 붙을 때까지(타일의 세션 id 가 선다) — 걸린 ms, 시한이면 null */
export async function waitAttached(cdp, streams, timeoutMs = 30_000) {
  const t0 = now();
  for (;;) {
    let panes = [];
    try {
      panes = await cdp.eval(`window.__sv ? window.__sv.panes() : []`, { timeoutMs: 5000 });
    } catch {}
    const ok = streams.every((s) => panes.some((p) => p.stream === s && p.session != null));
    if (ok) return now() - t0;
    if (now() - t0 > timeoutMs) return null;
    await sleep(30);
  }
}

/** 화면에 `re` 가 뜰 때까지 — 걸린 ms, 시한이면 null */
export async function waitText(cdp, stream, re, timeoutMs = 15_000) {
  const t0 = now();
  for (;;) {
    const s = await cdp.eval(`window.__sv.snap(${JSON.stringify(stream)})`).catch(() => null);
    if (s && re.test(stripAnsi(s.buffer))) return now() - t0;
    if (now() - t0 > timeoutMs) return null;
    await sleep(100);
  }
}

/** 마지막 번호가 `n` 이상이 될 때까지 — 마지막 검사 결과 */
export async function waitSeq(cdp, stream, n, timeoutMs = 60_000) {
  const t0 = now();
  for (;;) {
    const s = await cdp.eval(`window.__sv.snap(${JSON.stringify(stream)})`).catch(() => null);
    const c = s ? seqCheck(s.buffer) : null;
    if (c && c.last !== null && c.last >= n) return c;
    if (now() - t0 > timeoutMs) return c;
    await sleep(200);
  }
}

/**
 * 볼트 가림막을 걷는다(마스터 없는 볼트만 — [열기] 한 번). 창 0개·서버 교체 뒤의 가림막은 설계대로다(볼트가 잠겨 있다) — 그동안
 * SSH 열기·볼트 쓰는 일은 해제를 기다린다. 마스터가 걸린 볼트면 걷지 못한다(`SURVIVAL_VAULT_MASTER` 를 주면 그 값으로 연다).
 */
export async function unveil(cdp) {
  for (let i = 0; i < 50; i++) {
    const r = await cdp
      .eval(
        `(() => { const v = document.querySelector('.veil'); if (!v) return 'none'; const inp = v.querySelector('#veil-input'); const m = ${JSON.stringify(process.env.SURVIVAL_VAULT_MASTER ?? "")}; if (inp && m) { inp.value = m; inp.dispatchEvent(new Event('input', { bubbles: true })); } v.querySelector('button.open')?.click(); return 'clicked'; })()`,
        { timeoutMs: 5000 },
      )
      .catch(() => "error");
    if (r === "none") return i > 0;
    await sleep(200);
  }
  return false;
}

/** GUI 를 붙잡고 페이지를 준비한다(떠 있지 않으면 띄운다) */
export async function ensureApp(o) {
  let list = await procs();
  let { gui } = devProcs(list, o.exe);
  let launched = null;
  if (gui.length === 0) launched = launchGui(o);
  const cdp = await Cdp.connect(o.cdp, { timeoutMs: 90_000 });
  await helpers(cdp);
  // 주인 확인 — 이 CDP 포트의 페이지가 이 실행 파일의 GUI 것인가(다른 워크트리 앱을 건드리지 않는다).
  list = await procs();
  ({ gui } = devProcs(list, o.exe));
  if (gui.length === 0) throw new Error(`CDP ${o.cdp} 는 열렸지만 ${o.exe} 의 GUI 가 없다 — 다른 앱의 포트일 수 있다`);
  for (let i = 0; i < 100; i++) {
    const st = await status(cdp).catch(() => null);
    if (st?.connected) break;
    await sleep(100);
  }
  await unveil(cdp);
  // 고르기 — 한 번 다시 읽어 둔다. 서버가 바뀐 뒤 "세션 서버가 멈췄습니다" 로 남은 타일(다른 탭의 것)은 다시 읽으면 새 셸로 열린다 —
  // 그 새 셸·핸들이 행의 기준선(셸 pid·서버 핸들) 뒤에 생기면 측정이 흐려진다. 기준선은 이 뒤에 잰다.
  await cdp.send("Page.enable");
  await cdp.send("Page.reload", { ignoreCache: false });
  await sleep(800);
  await helpers(cdp);
  await unveil(cdp);
  await sleep(2500);
  return { cdp, launched };
}

/** 하네스가 연 타일의 탭을 닫는다(타일 닫기 = 세션 종료). 탭 id 는 페이지마다 새로 매겨지므로 **스트림으로** 지금 탭을 찾는다. */
export async function closeTabs(cdp, streams) {
  const panes = await cdp.eval('window.__sv.panes()').catch(() => []);
  const tabs = new Set(panes.filter((p) => streams.includes(p.stream)).map((p) => p.tab));
  for (const id of tabs) await cdp.eval('window.__sv.closeTab(' + JSON.stringify(id) + ')').catch(() => {});
  await sleep(500);
}

// 하네스 한 판의 수명 전부를 쥔다: vite → 헤드리스 Edge(새 임시 프로필) → 하네스 → **반드시 끈다**.
// 2026-09-30 에 손으로 띄운 Edge 약 75벌(msedge 686개)이 남아 PC 가 느려졌다 — 그래서 Edge 는 러너가 띄우고 러너가 끈다.
//
//   node scripts/dev/run-harness.mjs <harness.mjs> <outdir> [--size 1200x900] [--vite-port N] [--cdp-port N]
//        [--keep-vite] [--timeout 600] [--settle 3000] [--no-cdp-arg] [-- 하네스에 넘길 인자…]
//
// - 포트를 안 주면 빈 포트를 고른다. `--vite-port` 에 이미 vite 가 답하면 그것을 쓰고 끄지 않는다.
// - 하네스에는 `PAGE_PORT`·`CDP_PORT` 환경 변수와 위치 인자 `<outdir> <cdp>` 를 **둘 다** 준다
//   (둘째 인자를 다른 뜻으로 쓰는 판은 아래 ARG_STYLE 에 적어 둔다). `--` 뒤 인자는 그 뒤에 붙는다.
// - 끝(성공 · 실패 · 예외 · SIGINT/SIGTERM · `--timeout` 초과)에 Edge 트리 → 러너가 띄운 vite 트리 → 임시 프로필 폴더를 치운다.
// - Windows 에서 러너가 **강제로** 죽으면(taskkill /F · 부모 도구의 kill — Windows 에는 잡을 수 있는 시그널이 없다)
//   finally 가 돌지 못한다. 그래서 떨어져 나간 감시 프로세스(watchdog)가 러너의 생존을 1초마다 보다가,
//   러너가 사라지면 같은 정리를 대신한다.
// - Edge 경로: 환경 변수 `EDGE` > Windows 기본 경로.
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { killTree, listEdge, pickTargets } from "./kill-harness-edge.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const SELF = fileURLToPath(import.meta.url);
const isWin = process.platform === "win32";
const DEFAULT_EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

// 위치 인자 모양이 기본(`<outdir> <cdp>`)과 다른 판.
//   out — outdir 만(둘째 인자는 하네스 자기 뜻 — blocks 는 주입 스크립트 경로). CDP 는 환경 변수로만.
//   cdp — CDP 포트만(outdir 없음).
const ARG_STYLE = {
  "blocks-harness.mjs": "out",
  "messenger-harness.mjs": "cdp",
};

const log = (...a) => console.error("[run-harness]", ...a);
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (p) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();

// ─── 정리 (러너와 감시 프로세스가 함께 쓴다 · 전부 동기) ─────────────────────────
function rmDirRetry(dir) {
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
    if (!fs.existsSync(dir)) return true;
    sleepSync(500); // Windows 는 Edge 가 죽은 뒤에도 잠깐 파일을 쥐고 있다
  }
  return !fs.existsSync(dir);
}

function cleanup(state, say = log) {
  if (state.harnessPid) killTree(state.harnessPid);
  if (state.edgePid) killTree(state.edgePid);
  if (isWin && state.profileDir) {
    // 트리에서 떨어져 나간 같은 프로필의 Edge 가 있으면 명령줄로 한 번 더 쓸어 낸다.
    try {
      const mine = norm(state.profileDir);
      for (let i = 0; i < 3; i++) {
        const left = pickTargets(listEdge(), (d) => d != null && norm(d) === mine);
        if (!left.length) break;
        for (const t of left) killTree(t.pid);
        sleepSync(300);
      }
    } catch (e) { say("Edge 쓸어 내기 실패:", e.message); }
  }
  if (state.vitePid) killTree(state.vitePid);
  if (state.profileDir && !rmDirRetry(state.profileDir)) say("임시 프로필을 못 지웠다:", state.profileDir);
}

// ─── 감시 프로세스 ────────────────────────────────────────────────────────────
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }

if (process.argv[2] === "--watchdog-launch") {
  // 한 단 더 떨어뜨려 부모가 없는 감시자를 만든다(러너 트리째 끄는 kill 에 휩쓸리지 않게).
  spawn(process.execPath, [SELF, "--watchdog", process.argv[3]], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  process.exit(0);
}
if (process.argv[2] === "--watchdog") {
  const file = process.argv[3];
  for (;;) {
    let st;
    try { st = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(0); }
    if (st.done) { try { fs.rmSync(file, { force: true }); } catch {} process.exit(0); }
    if (!alive(st.runnerPid)) {
      cleanup(st, () => {});
      try { fs.rmSync(file, { force: true }); } catch {}
      process.exit(0);
    }
    sleepSync(1000);
  }
}

// ─── 인자 ────────────────────────────────────────────────────────────────────
function usage(msg) {
  if (msg) console.error("run-harness: " + msg);
  console.error("usage: node scripts/dev/run-harness.mjs <harness.mjs> <outdir> [--size WxH] [--vite-port N] [--cdp-port N] [--keep-vite] [--timeout SEC] [--settle MS] [--no-cdp-arg] [-- args…]");
  process.exit(2);
}
const argv = process.argv.slice(2);
const dd = argv.indexOf("--");
const extra = dd >= 0 ? argv.slice(dd + 1) : [];
const own = dd >= 0 ? argv.slice(0, dd) : argv;
const opt = { size: "1200x900", vitePort: null, cdpPort: null, keepVite: false, timeout: 600, noCdpArg: false, settle: 3000 };
const pos = [];
for (let i = 0; i < own.length; i++) {
  const a = own[i];
  const val = () => { if (i + 1 >= own.length) usage(`${a} 에 값이 없다`); return own[++i]; };
  if (a === "--size") opt.size = val();
  else if (a === "--vite-port") opt.vitePort = Number(val());
  else if (a === "--cdp-port") opt.cdpPort = Number(val());
  else if (a === "--timeout") opt.timeout = Number(val());
  else if (a === "--settle") opt.settle = Number(val());
  else if (a === "--keep-vite") opt.keepVite = true;
  else if (a === "--no-cdp-arg") opt.noCdpArg = true;
  else if (a === "-h" || a === "--help") usage();
  else if (a.startsWith("--")) usage(`모르는 옵션 ${a}`);
  else pos.push(a);
}
if (pos.length < 1) usage("하네스 파일이 없다");
let harness = pos[0];
if (!fs.existsSync(harness) && fs.existsSync(path.join(HERE, harness))) harness = path.join(HERE, harness);
if (!fs.existsSync(harness)) usage(`하네스를 못 찾았다: ${pos[0]}`);
harness = path.resolve(harness);
const style = opt.noCdpArg ? "out" : (ARG_STYLE[path.basename(harness)] ?? "out-cdp");
const outDir = pos[1];
if (style !== "cdp" && !outDir) usage("<outdir> 가 없다");
const m = /^(\d+)[x,](\d+)$/.exec(opt.size);
if (!m) usage(`--size 는 WxH: ${opt.size}`);
const edgeExe = process.env.EDGE || DEFAULT_EDGE;
if (!fs.existsSync(edgeExe)) {
  console.error(`run-harness: Edge 실행 파일이 없다: ${edgeExe}\n  EDGE 환경 변수로 경로를 준다 (예: EDGE=/usr/bin/microsoft-edge).`);
  process.exit(2);
}

// ─── 도움 함수 ────────────────────────────────────────────────────────────────
function portFree(port, host) {
  return new Promise((r) => {
    const s = net.createServer();
    s.once("error", (e) => r(e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT"));
    s.listen(port, host, () => s.close(() => r(true)));
  });
}
async function pickPort(avoid = []) {
  for (let i = 0; i < 200; i++) {
    const p = 20000 + Math.floor(Math.random() * 20000);
    if (avoid.includes(p)) continue;
    if ((await portFree(p, "127.0.0.1")) && (await portFree(p, "::1"))) return p;
  }
  throw new Error("빈 포트를 못 찾았다");
}
async function httpOk(url, ms = 1500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return r.status;
  } catch { return 0; }
}

async function waitSettled(wsUrl, settleMs, limitMs = 60_000) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("페이지 CDP 연결 실패")); });
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id); };
  const ev = (expression) => new Promise((r) => {
    const id = ++seq; pending.set(id, r);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  }).then((d) => d.result?.result?.value);
  const t0 = Date.now();
  let origin = null, since = 0;
  try {
    for (;;) {
      const v = await Promise.race([ev(`document.readyState + "|" + performance.timeOrigin`), sleep(2000).then(() => null)]);
      const [rs, o] = String(v ?? "|").split("|");
      if (rs === "complete" && o === origin) { if (Date.now() - since >= settleMs) break; }
      else { origin = rs === "complete" ? o : null; since = Date.now(); }
      if (Date.now() - t0 > limitMs) { log(`페이지가 ${limitMs / 1000}초 안에 가라앉지 않았다 — 그대로 하네스를 돌린다`); break; }
      await sleep(250);
    }
  } finally { ws.close(); }
  log(`페이지 적재 끝 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ─── 상태 · 정리 고리 ─────────────────────────────────────────────────────────
const runId = `${Date.now().toString(36)}-${process.pid}`;
const stateFile = path.join(os.tmpdir(), `aynx-harness-${runId}.state.json`);
const state = { runnerPid: process.pid, edgePid: 0, vitePid: 0, harnessPid: 0, profileDir: "", done: false };
const saveState = () => fs.writeFileSync(stateFile, JSON.stringify(state));
saveState();
spawn(process.execPath, [SELF, "--watchdog-launch", stateFile], { detached: true, stdio: "ignore", windowsHide: true }).unref();

let cleaned = false;
function finish() {
  if (cleaned) return;
  cleaned = true;
  cleanup(state);
  state.done = true; state.edgePid = state.vitePid = state.harnessPid = 0;
  try { saveState(); } catch {}
  try { fs.rmSync(stateFile, { force: true }); } catch {}
  log("정리 끝 (Edge · " + (viteStarted ? (opt.keepVite ? "vite 남김(--keep-vite)" : "vite") : "vite 재사용이라 그대로") + " · 프로필)");
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(sig, () => { log(`${sig} — 정리하고 끝낸다`); finish(); process.exit(130); });
}
process.on("exit", finish);

// ─── 본 판 ────────────────────────────────────────────────────────────────────
let viteStarted = false;
let exitCode = 1;
try {
  // vite
  let vitePort = opt.vitePort;
  if (vitePort && (await httpOk(`http://localhost:${vitePort}/`))) {
    log(`vite ${vitePort} 가 이미 답한다 — 그대로 쓰고 끄지 않는다`);
  } else {
    vitePort ??= await pickPort();
    const viteBin = path.join(REPO, "node_modules", "vite", "bin", "vite.js");
    if (!fs.existsSync(viteBin)) throw new Error(`vite 가 없다(${viteBin}) — npm ci 먼저`);
    const vite = spawn(process.execPath, [viteBin, "--port", String(vitePort), "--strictPort"], {
      // --keep-vite 면 러너가 끝난 뒤에도 살아야 하니 파이프를 물리지 않는다(닫힌 파이프에 쓰다 죽지 않게).
      // Windows 의 Node(libuv) 는 detached 가 아닌 자식을 "부모가 죽으면 같이 죽는" job 에 넣는다 — 남길 vite 는 떼어 낸다.
      cwd: REPO, stdio: opt.keepVite ? "ignore" : ["ignore", "pipe", "pipe"], windowsHide: true, detached: !isWin || opt.keepVite,
    });
    viteStarted = true;
    if (!opt.keepVite) { state.vitePid = vite.pid; saveState(); }
    let viteLog = "";
    const keep = (b) => { viteLog = (viteLog + b.toString()).slice(-4000); };
    vite.stdout?.on("data", keep); vite.stderr?.on("data", keep);
    let viteExit = null;
    vite.on("exit", (c) => { viteExit = c; });
    log(`vite ${vitePort} 띄움 (pid ${vite.pid})`);
    const t0 = Date.now();
    while ((await httpOk(`http://localhost:${vitePort}/`)) !== 200) {
      if (viteExit !== null) throw new Error(`vite 가 끝나 버렸다 (코드 ${viteExit})\n${viteLog}`);
      if (Date.now() - t0 > 90_000) throw new Error(`vite 가 90초 안에 200 을 안 준다\n${viteLog}`);
      await sleep(300);
    }
    if (opt.keepVite) vite.unref();
  }

  // Edge
  const cdpPort = opt.cdpPort ?? (await pickPort([vitePort]));
  state.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aynx-harness-"));
  saveState();
  const edge = spawn(edgeExe, [
    "--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${state.profileDir}`,
    `--window-size=${m[1]},${m[2]}`, "--no-first-run", "--no-default-browser-check",
    `http://localhost:${vitePort}/`,
  ], { stdio: "ignore", windowsHide: true, detached: !isWin });
  state.edgePid = edge.pid; saveState();
  edge.on("error", (e) => log("Edge 실행 오류:", e.message));
  log(`Edge cdp ${cdpPort} 띄움 (pid ${edge.pid}, 프로필 ${state.profileDir})`);
  let pageWs = null;
  {
    const t0 = Date.now();
    for (;;) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json`, { signal: AbortSignal.timeout(1500) })).json();
        pageWs = list.find((x) => x.type === "page" && x.url.includes(`localhost:${vitePort}`))?.webSocketDebuggerUrl ?? null;
      } catch {}
      if (pageWs) break;
      if (Date.now() - t0 > 30_000) throw new Error(`Edge CDP ${cdpPort} 가 30초 안에 페이지를 안 보인다`);
      await sleep(300);
    }
  }
  // 첫 적재가 **끝나고 가라앉을 때까지** 기다린다. 손으로 띄울 때는 사람이 몇 초 늦게 하네스를 돌려
  // 그동안 vite 가 모듈 변환을 데워 두었다 — 하네스들은 그걸 전제로 `Page.reload` 뒤 4~5초만 잰다.
  // 첫 판을 바로 붙이면 차가운 변환 중에 리로드가 겹쳐 타일이 안 떠 FAIL 이 난다(2026-09-30 file-tree · ui-scale).
  // 기준: readyState complete 이고 timeOrigin(= vite 가 새로고침을 쐈는지)이 settle 동안 그대로.
  await waitSettled(pageWs, opt.settle);

  // 하네스
  const hargs = style === "cdp" ? [String(cdpPort)] : style === "out" ? [outDir] : [outDir, String(cdpPort)];
  hargs.push(...extra);
  log(`하네스: ${path.relative(REPO, harness)} ${hargs.join(" ")}  (PAGE_PORT=${vitePort} CDP_PORT=${cdpPort}, 시한 ${opt.timeout}s)`);
  const child = spawn(process.execPath, [harness, ...hargs], {
    cwd: REPO, stdio: "inherit",
    env: { ...process.env, PAGE_PORT: String(vitePort), CDP_PORT: String(cdpPort) },
  });
  state.harnessPid = child.pid; saveState();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; log(`시한 ${opt.timeout}s 초과 — 하네스를 끈다`); killTree(child.pid); }, opt.timeout * 1000);
  exitCode = await new Promise((r) => {
    child.on("exit", (code, sig) => r(timedOut ? 124 : code ?? (sig ? 1 : 0)));
    child.on("error", (e) => { log("하네스 실행 오류:", e.message); r(1); });
  });
  clearTimeout(timer);
  state.harnessPid = 0; saveState();
  log(`하네스 종료 코드 ${exitCode}`);
} catch (e) {
  log("실패:", e?.message ?? e);
  exitCode = 1;
} finally {
  finish();
}
process.exit(exitCode);

// 생존·재부착 하네스 — 설계 10절 보장 표의 한 행을 개발 앱에서 돌리고 JSON 한 줄로 판정한다.
//
//   node scripts/dev/survival/run.mjs <행> [--repeat N] [--tiles N] [--cdp 9222] [--exe <개발 exe>]
//
// 행: f5 · webview-crash · gui-close · gui-kill · gui-relaunch · server-shutdown · server-kill · ssh-drop · stale-lease
//     · race · memory · vault-zero · boundary
// 판정: {"row", "verdict": "pass"|"fail"|"n/a", "reason"?, ...측정값}. 끝나면 하네스 Edge·고아 셸을 세고 0 이 아니면 fail.
// 개발 앱(`npm run tauri dev` 또는 vite 1420 + target/debug/aynx.exe, CDP 9222)이 떠 있지 않으면 하네스가 GUI 를 띄운다
// (vite 는 띄우지 않는다 — `npx vite --port 1420 --strictPort` 를 먼저). 자세한 것은 scripts/dev/README.md 의 "survival" 절.
import fs from "node:fs";
import path from "node:path";
import {
  Cdp,
  alive,
  bashLoop,
  closeTabs,
  devProcs,
  devShells,
  discovery,
  ensureApp,
  headlessEdge,
  helpers,
  killPid,
  unveil,
  launchGui,
  now,
  orphanShells,
  parseArgs,
  powershell,
  procStat,
  procs,
  pwshLoop,
  seqCheck,
  sleep,
  status,
  stripAnsi,
  waitAttached,
  waitSeq,
  waitText,
} from "./lib.mjs";

const o = parseArgs(process.argv.slice(2));
const row = o._[0];
const SERVER_LOG = path.join(process.env.APPDATA ?? "", "aynx-dev", "server.log");

// ---------------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------------

const opened = []; // {stream, tab}
async function openTiles(cdp, n, cmd, { perTab = 4, kind = "local", alias } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await cdp.eval(
      `window.__sv.open(${JSON.stringify(kind)}, ${JSON.stringify(typeof cmd === "function" ? cmd(i) : cmd)}, { newTab: ${i % perTab === 0}, alias: ${JSON.stringify(alias ?? null)} })`,
    );
    out.push(r);
    opened.push(r);
    // 셸 생성은 서버에서 직렬화된다 — 몰아서 열어도 되지만 탭 전환 애니메이션 틈을 둔다.
    if (i % perTab === 0) await sleep(150);
  }
  return out;
}

async function snap(cdp, stream) {
  return cdp.eval(`window.__sv.snap(${JSON.stringify(stream)})`).catch(() => null);
}

/** 여러 타일의 마지막 번호 — 화면 직렬화를 페이지 안에서 풀어 한 번에 */
async function lastNumbers(cdp, streams) {
  return cdp.eval(`(${String.raw`(streams) => streams.map((s) => {
      const v = window.__sv.snap(s);
      if (!v) return null;
      const t = v.buffer.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
      const m = [...t.matchAll(/^n=(\d+)/gm)];
      return m.length ? Number(m[m.length - 1][1]) : null;
    })`})(${JSON.stringify(streams)})`);
}

async function serverPid() {
  const list = await procs();
  return devProcs(list, o.exe).server.map((p) => p.pid);
}

async function shellPids() {
  return devShells(await procs())
    .map((p) => p.pid)
    .sort((a, b) => a - b);
}

async function killGui() {
  const { gui } = devProcs(await procs(), o.exe);
  for (const p of gui) await killPid(p.pid);
  for (let i = 0; i < 50 && gui.some((p) => alive(p.pid)); i++) await sleep(100);
  return gui.map((p) => p.pid);
}

/** GUI 를 다시 띄워(또는 single-instance 로 깨워) 스트림들이 다시 붙을 때까지 — {attachMs, liveMs, cdp} */
async function relaunchAndAttach(streams, { liveFrom } = {}) {
  const { t0 } = launchGui(o);
  const cdp = await Cdp.connect(o.cdp, { timeoutMs: 90_000 });
  await helpers(cdp);
  const left = await waitAttached(cdp, streams, 60_000);
  const attachMs = left === null ? null : now() - t0;
  // 창 0개 잠금 뒤의 가림막(설계대로) — 재부착을 잰 뒤에 걷는다(로컬 타일은 가림막 뒤에서도 붙는다).
  await unveil(cdp);
  // 갈래: 프로세스 시작 → 페이지 탐색 시작(웹뷰 생성) → DOMContentLoaded(모듈 적재 — 개발 빌드는 vite 가 낱개로 준다) → 마지막 붙기.
  const nav = await cdp
    .eval(`(() => { const e = performance.getEntriesByType('navigation')[0]; return { origin: performance.timeOrigin, dcl: e ? e.domContentLoadedEventEnd : null }; })()`)
    .catch(() => null);
  const phases = nav ? { webviewMs: Math.round(nav.origin - t0), domReadyMs: Math.round(nav.origin + (nav.dcl ?? 0) - t0) } : null;
  let liveMs = null;
  if (liveFrom) {
    // "실시간" = 모든 타일의 마지막 번호가 GUI 를 죽일 때보다 커졌다(재생이 아니라 새 출력이 화면에 섰다).
    for (;;) {
      const last = await lastNumbers(cdp, streams);
      if (last.every((n, i) => n !== null && n > liveFrom[i])) {
        liveMs = now() - t0;
        break;
      }
      if (now() - t0 > 60_000) break;
      await sleep(50);
    }
  }
  return { cdp, attachMs, liveMs, phases };
}

/**
 * 그 타일의 xterm 에 실제 키(Enter)를 넣는다 — CDP Input(합성 KeyboardEvent 는 xterm 키 처리에 닿지 않는다). 서버가 바뀌면 볼트
 * 가림막이 서서 포커스를 쥔다(설계대로 — 새 서버의 볼트는 잠겨 있다) — 그때는 Enter 한 번으로 가림막을 걷고(마스터 없음) 다시 넣는다.
 */
async function pressEnter(cdp, stream) {
  const focus = () =>
    cdp.eval(
      `(() => { const p = window.__sv.byStream(${JSON.stringify(stream)}); const el = document.querySelector('[data-pane="' + p.id + '"] textarea.xterm-helper-textarea'); el?.focus(); return document.activeElement === el; })()`,
    );
  const enter = async () => {
    for (const type of ["keyDown", "char", "keyUp"])
      await cdp.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type !== "keyUp" ? { text: String.fromCharCode(13) } : {}) });
  };
  let veil = false;
  for (let i = 0; i < 3 && !(await focus()); i++) {
    veil = true;
    await enter();
    await sleep(1000);
  }
  await enter();
  return { veil };
}

async function reloadPage(cdp) {
  const t0 = now();
  await cdp.send("Page.enable");
  await cdp.send("Page.reload", { ignoreCache: false });
  cdp.close();
  await sleep(300);
  const c2 = await Cdp.connect(o.cdp, { timeoutMs: 60_000 });
  await helpers(c2);
  return { cdp: c2, t0 };
}

function serverLogSince(offset) {
  try {
    const buf = fs.readFileSync(SERVER_LOG);
    return buf.subarray(Math.min(offset, buf.length)).toString("utf8");
  } catch {
    return "";
  }
}
const serverLogSize = () => {
  try {
    return fs.statSync(SERVER_LOG).size;
  } catch {
    return 0;
  }
};

// ---------------------------------------------------------------------------
// 행
// ---------------------------------------------------------------------------

const rows = {};

/** F5 — 출력 중 location.reload → 번호 연속·pid 동일·새 셸 0, N 회 반복 뒤 서버 핸들 ±16 */
rows.f5 = async () => {
  let { cdp } = await ensureApp(o);
  const [t] = await openTiles(cdp, 1, pwshLoop(100000, 40));
  await waitSeq(cdp, t.stream, 30, 20_000);
  const spid = (await serverPid())[0];
  const h0 = await procStat(spid);
  const shells0 = await shellPids();
  const runs = [];
  for (let i = 0; i < o.repeat; i++) {
    const before = seqCheck((await snap(cdp, t.stream))?.buffer).last;
    const r = await reloadPage(cdp);
    cdp = r.cdp;
    const left = await waitAttached(cdp, [t.stream], 30_000);
    const c = await waitSeq(cdp, t.stream, before + 25, 20_000);
    runs.push({ reattachMs: left === null ? null : now() - r.t0, before, after: c?.last, missing: c?.missing, dup: c?.dup, gaps: c?.gaps });
  }
  await sleep(1500);
  const h1 = await procStat(spid);
  const shells1 = await shellPids();
  const ok =
    runs.every((r) => r.reattachMs !== null && r.missing === 0 && r.dup === 0 && r.after > r.before) &&
    JSON.stringify(shells0) === JSON.stringify(shells1) &&
    Math.abs(h1.handles - h0.handles) <= 16;
  await closeTabs(cdp, opened.map((x) => x.stream));
  cdp.close();
  return {
    verdict: ok ? "pass" : "fail",
    repeat: o.repeat,
    reattachMs: runs.map((r) => r.reattachMs),
    missing: runs.reduce((a, r) => a + (r.missing ?? 0), 0),
    dup: runs.reduce((a, r) => a + (r.dup ?? 0), 0),
    shellsSame: JSON.stringify(shells0) === JSON.stringify(shells1),
    handles: [h0?.handles, h1?.handles],
    runs: o.verbose ? runs : undefined,
  };
};

/** 웹뷰 렌더러 kill — 이 GUI 의 msedgewebview2 --type=renderer(페이지 프로세스)를 고른다 */
rows["webview-crash"] = async () => {
  let { cdp } = await ensureApp(o);
  const [t] = await openTiles(cdp, 1, pwshLoop(100000, 40));
  await waitSeq(cdp, t.stream, 30, 20_000);
  // 첫 체크포인트(5초) 뒤에 죽인다 — 크래시는 pagehide 가 없어 주기 체크포인트 + 링으로만 복원된다.
  await sleep(6000);
  const shells0 = await shellPids();
  const runs = [];
  for (let i = 0; i < o.repeat; i++) {
    // 크래시 고리 가드(`webview_crash` — 60초 안 3번이면 더 다시 읽지 않는다) 밖에서: 셋째마다 1분 쉰다.
    if (i > 0 && i % 3 === 0) await sleep(61_000);
    const list = await procs();
    const { gui } = devProcs(list, o.exe);
    const guiPid = gui[0]?.pid;
    const tree = new Set([guiPid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of list) if (tree.has(p.ppid) && !tree.has(p.pid)) (tree.add(p.pid), (grew = true));
    }
    const renderers = list.filter((p) => tree.has(p.pid) && /msedgewebview2/i.test(p.name) && /--type=renderer/.test(p.cmd ?? ""));
    // 렌더러가 여럿이면(확장·서비스 워커) 페이지 프로세스만 — CDP 의 SystemInfo 로 고를 수 없어 "extension" 이 아닌 것.
    const page = renderers.filter((p) => !/--extension-process/.test(p.cmd ?? ""));
    if (page.length !== 1) {
      cdp.close();
      return { verdict: "n/a", reason: `renderer 후보 ${page.length}개 — 페이지 프로세스를 하나로 고르지 못함`, renderers: renderers.length };
    }
    const before = seqCheck((await snap(cdp, t.stream))?.buffer).last;
    const t0 = now();
    await killPid(page[0].pid);
    cdp.close();
    // 앱이 스스로 되살리나(ProcessFailed → Reload)? 새 페이지(탐색 시작이 kill 뒤)가 helpers 를 받을 때까지.
    let recovered = null;
    while (now() - t0 < 30_000) {
      try {
        cdp = await Cdp.connect(o.cdp, { timeoutMs: 1000 });
        const origin = await cdp.eval('performance.timeOrigin', { timeoutMs: 1000 });
        if (origin >= t0 - 50) {
          await helpers(cdp);
          recovered = Math.round(origin - t0);
          break;
        }
        cdp.close();
      } catch {
        cdp?.close?.();
      }
      await sleep(200);
    }
    if (recovered === null) {
      return { verdict: "fail", reason: `${i + 1}번째 렌더러 kill 뒤 페이지가 30초 안에 되살아나지 않음(앱이 다시 읽지 않는다)`, killed: page[0].pid, runs };
    }
    const left = await waitAttached(cdp, [t.stream], 30_000);
    const c = await waitSeq(cdp, t.stream, before + 25, 20_000);
    runs.push({ recoveredMs: recovered, reattachMs: left === null ? null : now() - t0, before, after: c?.last, missing: c?.missing, dup: c?.dup, gaps: c?.gaps });
  }
  const shells1 = await shellPids();
  const ok = runs.every((r) => r.reattachMs !== null && r.missing === 0 && r.dup === 0) && JSON.stringify(shells0) === JSON.stringify(shells1);
  await closeTabs(cdp, opened.map((x) => x.stream));
  cdp.close();
  return { verdict: ok ? "pass" : "fail", runs, shellsSame: JSON.stringify(shells0) === JSON.stringify(shells1) };
};

/** GUI 종료(마지막 창 닫기 → 트레이) → 셸·서버 그대로 → 다시 실행(single-instance 가 창을 연다) → 재부착 */
rows["gui-close"] = async () => guiCycle("close");
/** GUI 강제 종료(Stop-Process) → 셸·서버 그대로 → 다시 실행 → 재부착 */
rows["gui-kill"] = async () => guiCycle("kill");

async function guiCycle(how) {
  let { cdp } = await ensureApp(o);
  const tiles = await openTiles(cdp, 1, pwshLoop(100000, 40));
  const t = tiles[0];
  await waitSeq(cdp, t.stream, 30, 20_000);
  await sleep(6000); // 첫 체크포인트
  const runs = [];
  const spid0 = (await serverPid())[0];
  const h0 = await procStat(spid0);
  const shells0 = await shellPids();
  for (let i = 0; i < o.repeat; i++) {
    const before = seqCheck((await snap(cdp, t.stream))?.buffer).last;
    const gui0 = devProcs(await procs(), o.exe).gui.map((p) => p.pid);
    if (how === "close") {
      // 사람의 X 와 같은 길 — WM_CLOSE(CloseMainWindow). 트레이가 있으면 GUI 프로세스는 남고 창만 0개.
      await powershell(`(Get-Process -Id ${gui0[0]}).CloseMainWindow() | Out-Null`);
      cdp.close();
      await sleep(2500);
    } else {
      cdp.close();
      await killGui();
      await sleep(1500);
    }
    const mid = devProcs(await procs(), o.exe);
    const shellsMid = await shellPids();
    const st = discovery();
    const r = await relaunchAndAttach([t.stream]);
    cdp = r.cdp;
    const c = await waitSeq(cdp, t.stream, before + 25, 20_000);
    const gui1 = devProcs(await procs(), o.exe).gui.map((p) => p.pid);
    runs.push({
      guiAliveAfter: how === "close" ? mid.gui.length : undefined,
      guiSame: how === "close" ? JSON.stringify(gui0) === JSON.stringify(gui1) : undefined,
      serverSame: mid.server.map((p) => p.pid).includes(spid0) && st?.pid === spid0,
      shellsSameMid: JSON.stringify(shellsMid) === JSON.stringify(shells0),
      attachMs: r.attachMs,
      before,
      after: c?.last,
      missing: c?.missing,
      dup: c?.dup,
      gaps: c?.gaps,
    });
  }
  const shells1 = await shellPids();
  const h1 = await procStat(spid0);
  const ok =
    runs.every((r) => r.serverSame && r.shellsSameMid && r.attachMs !== null && r.missing === 0 && r.dup === 0 && r.after > r.before) &&
    (how !== "close" || runs.every((r) => r.guiAliveAfter >= 1 && r.guiSame)) &&
    JSON.stringify(shells0) === JSON.stringify(shells1) &&
    h1 &&
    Math.abs(h1.handles - h0.handles) <= 16;
  await closeTabs(cdp, opened.map((x) => x.stream));
  cdp.close();
  return {
    verdict: ok ? "pass" : "fail",
    repeat: o.repeat,
    attachMs: runs.map((r) => r.attachMs),
    missing: runs.reduce((a, r) => a + (r.missing ?? 0), 0),
    dup: runs.reduce((a, r) => a + (r.dup ?? 0), 0),
    serverSame: runs.every((r) => r.serverSame),
    shellsSame: JSON.stringify(shells0) === JSON.stringify(shells1),
    handles: [h0?.handles, h1?.handles],
    runs: o.verbose ? runs : undefined,
  };
}

/** GUI 재실행 → 재부착 시간(로컬 N타일, 기본 16 — `--tiles 64`). 판정: 16 ≤ 2s · 64 ≤ 5s(그 밖 N 은 5s) */
rows["gui-relaunch"] = async () => {
  const n = o.tiles;
  let { cdp } = await ensureApp(o);
  // 번호 간격 — "실시간" 판정(새 번호가 섰다)이 간격만큼 늦어지므로 16타일은 50ms, 64타일은 출력 부하를 줄이려 200ms.
  const tiles = await openTiles(cdp, n, pwshLoop(100000, n <= 16 ? 50 : 200));
  const streams = tiles.map((x) => x.stream);
  const openMs = await waitAttached(cdp, streams, 120_000);
  await sleep(7000); // 첫 체크포인트(5초) + 출력
  const shells0 = await shellPids();
  const runs = [];
  for (let i = 0; i < o.repeat; i++) {
    const last = await lastNumbers(cdp, streams);
    cdp.close();
    await killGui();
    await sleep(1000);
    const r = await relaunchAndAttach(streams, { liveFrom: last.map((v) => v ?? 0) });
    cdp = r.cdp;
    runs.push({ attachMs: r.attachMs, liveMs: r.liveMs, phases: r.phases });
    await sleep(2000);
  }
  // 연속성은 표본(첫·끝 타일)만 — 64 장 직렬화는 무겁다.
  const checks = [];
  for (const s of [streams[0], streams.at(-1)]) checks.push(seqCheck((await snap(cdp, s))?.buffer));
  const shells1 = await shellPids();
  const limit = n <= 16 ? 2000 : 5000;
  const ok =
    runs.every((r) => r.liveMs !== null && r.liveMs <= limit) &&
    checks.every((c) => c.missing === 0 && c.dup === 0) &&
    JSON.stringify(shells0) === JSON.stringify(shells1);
  await closeTabs(cdp, opened.map((x) => x.stream));
  cdp.close();
  return {
    verdict: ok ? "pass" : "fail",
    tiles: n,
    limitMs: limit,
    openMs,
    attachMs: runs.map((r) => r.attachMs),
    liveMs: runs.map((r) => r.liveMs),
    phases: runs.map((r) => r.phases),
    sample: checks.map((c) => ({ missing: c.missing, dup: c.dup, last: c.last })),
    shellsSame: JSON.stringify(shells0) === JSON.stringify(shells1),
  };
};

/** 서버 종료(정상) — [다시 시작](파이프 shutdown) → 옛 셸 0 · 타일 안내 ≤2s · Enter 로 새 셸 · autorun 재실행 0 */
rows["server-shutdown"] = async () => serverStop("shutdown");
/** 서버 kill — Stop-Process 서버 → 고아 0 · 안내 ≤2s */
rows["server-kill"] = async () => serverStop("kill");

async function serverStop(how) {
  let { cdp } = await ensureApp(o);
  const [t] = await openTiles(cdp, 1, pwshLoop(100000, 40));
  await waitSeq(cdp, t.stream, 20, 20_000);
  const list0 = await procs();
  const spid0 = devProcs(list0, o.exe).server[0]?.pid;
  const shells0 = devShells(list0).map((p) => p.pid);
  const t0 = now();
  if (how === "shutdown") {
    // 응답을 기다리지 않는다 — 안내 시각은 따로 잰다.
    void cdp.eval(`window.__TAURI_INTERNALS__.invoke('session_server_restart').then(()=>1,(e)=>String(e))`, { timeoutMs: 30_000 }).catch(() => {});
  } else {
    // TerminateProcess 바로(PowerShell 을 띄우는 1초를 재지 않게).
    process.kill(spid0, "SIGKILL");
  }
  const seen = await waitText(cdp, t.stream, /세션 서버가 멈췄습니다|session server stopped/i, 10_000);
  const noticeMs = seen === null ? null : now() - t0;
  // 고아: 옛 셸이 2초 안에 모두 사라지나(서버 잡 KILL_ON_JOB_CLOSE · 정상 종료의 pid 트리 종료).
  let orphans = shells0.length;
  for (let i = 0; i < 40; i++) {
    orphans = shells0.filter((p) => alive(p)).length;
    if (orphans === 0) break;
    await sleep(100);
  }
  const goneMs = now() - t0;
  // 새 서버에 다시 붙었나
  let st = null;
  for (let i = 0; i < 100; i++) {
    st = await status(cdp).catch(() => null);
    if (st?.connected && st.server_pid && st.server_pid !== spid0) break;
    await sleep(100);
  }
  // Enter → 새 셸. autorun(번호 루프)은 다시 돌면 안 된다.
  const beforeEnter = seqCheck((await snap(cdp, t.stream))?.buffer);
  const { veil } = await pressEnter(cdp, t.stream);
  await sleep(4000);
  const after = await snap(cdp, t.stream);
  const afterSeq = seqCheck(after?.buffer);
  const rerun = afterSeq.last !== null && beforeEnter.last !== null && afterSeq.count > beforeEnter.count;
  const list1 = await procs();
  const orphanList = orphanShells(list1).length;
  const ok = noticeMs !== null && noticeMs <= 2000 && orphans === 0 && orphanList === 0 && !rerun && st?.connected && after?.session != null;
  await closeTabs(cdp, opened.map((x) => x.stream));
  cdp.close();
  return {
    verdict: ok ? "pass" : "fail",
    how,
    noticeMs,
    oldShells: shells0.length,
    oldShellsAlive: orphans,
    shellsGoneMs: goneMs,
    orphanShells: orphanList,
    newServer: st?.server_pid !== spid0 ? st?.server_pid : null,
    reconnected: !!st?.connected,
    newSession: after?.session ?? null,
    autorunRerun: rerun,
    veilShown: veil,
  };
}

/** 옛 임대의 write/ACK 주입 — F5 뒤 옛 임대로 write → [stale-lease] 거부 · 옛 ACK 는 무해 · 붙은 세션에 둘째 attach 는 거절 */
rows["stale-lease"] = async () => {
  let { cdp } = await ensureApp(o);
  const [t] = await openTiles(cdp, 1, pwshLoop(100000, 40));
  await waitSeq(cdp, t.stream, 20, 20_000);
  const old = await cdp.eval(`window.__sv.lease(${JSON.stringify(t.stream)})`);
  const r = await reloadPage(cdp);
  cdp = r.cdp;
  await waitAttached(cdp, [t.stream], 30_000);
  const cur = await cdp.eval(`window.__sv.lease(${JSON.stringify(t.stream)})`);
  const marker = `STALE${Date.now()}`;
  const write = await cdp.eval(
    `window.__TAURI_INTERNALS__.invoke('write_session', { stream: ${JSON.stringify(old.stream)}, sessionEpoch: ${old.sessionEpoch}, leaseEpoch: ${old.leaseEpoch}, data: ${JSON.stringify(`echo ${marker}\r`)} }).then(()=>'accepted',(e)=>String(e))`,
  );
  const resize = await cdp.eval(
    `window.__TAURI_INTERNALS__.invoke('resize_session', { stream: ${JSON.stringify(old.stream)}, sessionEpoch: ${old.sessionEpoch}, leaseEpoch: ${old.leaseEpoch}, cols: 20, rows: 5 }).then(()=>'accepted',(e)=>String(e))`,
  );
  // 옛 ACK(큰 소비 오프셋) — 응답 없음. 크레딧을 망치지 않으면 출력이 계속 흐른다.
  await cdp.eval(
    `window.__TAURI_INTERNALS__.invoke('ack_local_output', { stream: ${JSON.stringify(old.stream)}, sessionEpoch: ${old.sessionEpoch}, leaseEpoch: ${old.leaseEpoch}, consumed: 1e12 }).then(()=>1,()=>0)`,
  );
  // 같은 스트림에 둘째 attach(take 없이) — 붙어 있으니 거절.
  const second = await cdp.eval(
    `window.__TAURI_INTERNALS__.invoke('attach_session', { stream: ${JSON.stringify(t.stream)}, expectedSessionEpoch: ${cur.sessionEpoch}, consumed: 0, take: false, onData: '__CHANNEL__:' + window.__TAURI_INTERNALS__.transformCallback(() => {}), cols: 80, rows: 24 }).then(()=>'accepted',(e)=>String(e))`,
  );
  const before = seqCheck((await snap(cdp, t.stream))?.buffer).last;
  const c = await waitSeq(cdp, t.stream, before + 25, 15_000);
  const screen = stripAnsi((await snap(cdp, t.stream))?.buffer);
  const ok =
    /stale-lease/.test(write) && /stale-lease/.test(resize) && !screen.includes(marker) && c.last > before && c.missing === 0 && c.dup === 0 && second !== "accepted";
  await closeTabs(cdp, opened.map((x) => x.stream));
  cdp.close();
  return {
    verdict: ok ? "pass" : "fail",
    oldLease: old.leaseEpoch,
    newLease: cur.leaseEpoch,
    write: write.slice(0, 80),
    resize: resize.slice(0, 80),
    injectedVisible: screen.includes(marker),
    flowAfterOldAck: c.last > before,
    secondAttach: String(second).slice(0, 80),
  };
};

/** 서버 동시 실행 경쟁 — 개발 GUI·서버를 내리고 `session-server` 10개를 한꺼번에 띄워 1개만 남는지 × repeat(기본 10) */
rows.race = async () => {
  const rounds = o.repeat > 1 ? o.repeat : 10;
  // 개발 GUI·서버를 내린다(개발 앱의 세션은 끝난다 — 사용자 설치본은 경로가 달라 건드리지 않는다).
  await killGui();
  for (const p of await serverPid()) await killPid(p);
  await sleep(1000);
  const counts = [];
  for (let r = 0; r < rounds; r++) {
    const { spawn } = await import("node:child_process");
    const kids = [];
    for (let i = 0; i < 10; i++)
      kids.push(spawn(o.exe, ["session-server", "--launch-mode", "race"], { detached: true, stdio: "ignore", windowsHide: true }));
    for (const k of kids) k.unref();
    await sleep(3000);
    const servers = await serverPid();
    counts.push(servers.length);
    for (const p of servers) await killPid(p);
    for (const k of kids) if (alive(k.pid)) await killPid(k.pid);
    await sleep(500);
  }
  // GUI 세 벌 동시 실행 × 3 → 매번 GUI 1 · 서버 1 · 페이지가 선다(바로 가기를 거듭 누른 모양)
  const gui = [];
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 3; i++) launchGui(o);
    await sleep(12_000);
    const d = devProcs(await procs(), o.exe);
    let page = false;
    try {
      const c = await Cdp.connect(o.cdp, { timeoutMs: 5000 });
      page = (await c.eval("location.href", { timeoutMs: 3000 })).startsWith("http://localhost:1420");
      c.close();
    } catch {}
    gui.push({ gui: d.gui.length, server: d.server.length, page });
    if (r < 2) {
      await killGui();
      await sleep(1500);
    }
  }
  const ok = counts.every((c) => c === 1) && gui.every((g) => g.gui === 1 && g.server === 1 && g.page);
  return { verdict: ok ? "pass" : "fail", rounds, servers: counts, guiRace: gui };
};

/** 메모리 상한 — 떨어진 세션 64개(링 가득) → 서버 RSS ≤ 고정분 + Σ(링 256 KiB + 체크포인트) */
rows.memory = async () => {
  const n = o.tiles === 16 ? 64 : o.tiles;
  let { cdp } = await ensureApp(o);
  const spid = (await serverPid())[0];
  const st0 = await status(cdp);
  const base = await procStat(spid);
  const tiles = await openTiles(cdp, n, "");
  const streams = tiles.map((x) => x.stream);
  await waitAttached(cdp, streams, 180_000);
  await sleep(3000);
  const empty = await procStat(spid);
  // 각 타일이 링(256 KiB)을 넘게 찍고 쉰다 — 약 300 KiB.
  for (const s of streams) await cdp.eval(`window.__sv.write(${JSON.stringify(s)}, ${JSON.stringify(`${pwshLoop(1200, 0, 240)}\r`)})`).catch(() => {});
  await sleep(Math.max(15_000, n * 400));
  // 체크포인트 크기(맡겨 둔 화면) — 직렬화 길이로 어림.
  const cpBytes = await cdp.eval(`(${String.raw`(ss) => ss.reduce((a, s) => a + (window.__sv.snap(s)?.buffer.length ?? 0), 0)`})(${JSON.stringify(streams)})`);
  cdp.close();
  await killGui();
  await sleep(5000);
  const full = await procStat(spid);
  const ring = 256 * 1024;
  const budget = n * ring + cpBytes;
  const perSession = (empty.ws - base.ws) / n;
  const delta = full.ws - empty.ws;
  const ok = delta <= budget * 1.1;
  // 정리 — 다시 띄워 탭을 닫는다.
  const r = await relaunchAndAttach(streams);
  await closeTabs(r.cdp, opened.map((x) => x.stream));
  r.cdp.close();
  return {
    verdict: ok ? "pass" : "fail",
    sessions: n,
    startSessions: st0.sessions,
    baseRssMiB: +(base.ws / 2 ** 20).toFixed(1),
    emptyRssMiB: +(empty.ws / 2 ** 20).toFixed(1),
    fullRssMiB: +(full.ws / 2 ** 20).toFixed(1),
    fullPrivMiB: +(full.priv / 2 ** 20).toFixed(1),
    perSessionFixedKiB: Math.round(perSession / 1024),
    ringDeltaMiB: +(delta / 2 ** 20).toFixed(1),
    budgetMiB: +(budget / 2 ** 20).toFixed(1),
    checkpointMiB: +(cpBytes / 2 ** 20).toFixed(1),
    threads: [base.threads, empty.threads, full.threads],
    handles: [base.handles, empty.handles, full.handles],
  };
};

rows["ssh-drop"] = async () => (await import("./ssh.mjs")).sshDrop(o, { openTiles, snap, opened, closeTabs });
rows["vault-zero"] = async () => (await import("./vault.mjs")).vaultZero(o, { openTiles, opened, killGui, relaunchAndAttach, closeTabs });
rows.boundary = async () =>
  (await import("./boundary.mjs")).boundary(o, { openTiles, snap, opened, killGui, relaunchAndAttach, reloadPage, serverLogSize, serverLogSince, closeTabs });

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

if (!rows[row]) {
  console.error(`usage: node scripts/dev/survival/run.mjs <${Object.keys(rows).join("|")}> [--repeat N] [--tiles N]`);
  process.exit(2);
}
let result;
try {
  result = await rows[row]();
} catch (e) {
  result = { verdict: "fail", reason: `exception: ${e?.stack ?? e}` };
}
// 실패·예외로 빠져나온 행이 남긴 탭을 닫는다(타일 닫기 = 세션 종료).
if (opened.length) {
  try {
    const c = await Cdp.connect(o.cdp, { timeoutMs: 5000 });
    await helpers(c);
    await closeTabs(c, opened.map((x) => x.stream));
    c.close();
    await sleep(1500);
  } catch {}
}
// 뒷정리 확인 — 헤드리스 Edge(이 하네스는 띄우지 않는다)·고아 셸
const list = await procs();
const edge = headlessEdge(list);
const orphans = orphanShells(list).length;
if (edge > 0 || orphans > 0) {
  result.verdict = "fail";
  result.reason = `${result.reason ? result.reason + " · " : ""}뒷정리: 하네스 Edge ${edge} · 고아 셸 ${orphans}`;
}
console.log(JSON.stringify({ row, ...result, edge, orphans }));
process.exit(result.verdict === "fail" ? 1 : 0);

// 남은 하네스용 헤드리스 Edge 를 찾아 끈다 (2026-09-30 — 에이전트가 남긴 Edge 약 75벌 · msedge 686개로
// PC 가 느려진 일이 있었다). **다른 Edge 는 건드리지 않는다**: 명령줄에 `--remote-debugging-port` 가 있고
// `--user-data-dir` 가 임시 폴더(os.tmpdir()) 아래이면서 `aynx-harness-` 또는 `claude`(스크래치패드) 를 품은
// 브라우저 프로세스만, 그 트리째 끈다. 부모가 죽고 남은 같은 프로필의 자식도 함께 거둔다.
//
//   node scripts/dev/kill-harness-edge.mjs            # 찾아서 끈다
//   node scripts/dev/kill-harness-edge.mjs --dry-run  # 무엇을 끌지 보기만
//
// Windows 만 구현(PowerShell `Get-CimInstance Win32_Process`). 다른 OS 는 명시적 스텁.
// run-harness.mjs 도 이 파일의 `listEdge`·`killTree` 를 쓴다(판이 끝나면 제 프로필의 Edge 를 한 번 더 쓸어 낸다).
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const isWin = process.platform === "win32";

/** 명령줄에서 `--user-data-dir` 값을 꺼낸다(따옴표 있든 없든). */
export function userDataDir(cmd) {
  const m = /--user-data-dir=(?:"([^"]+)"|(\S+))/.exec(cmd ?? "");
  return m ? (m[1] ?? m[2]) : null;
}

const norm = (p) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();

/** msedge 프로세스 목록 `{ pid, ppid, cmd }[]`. Windows 가 아니면 null(미구현). */
export function listEdge() {
  if (!isWin) return null;
  const ps =
    "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | " +
    "Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
  if (!out) return [];
  const rows = JSON.parse(out);
  return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
    pid: r.ProcessId,
    ppid: r.ParentProcessId,
    cmd: r.CommandLine ?? "",
  }));
}

/** 프로세스 트리를 강제로 끈다. Windows: taskkill /T /F · 그 밖: 프로세스 그룹(음수 pid). */
export function killTree(pid) {
  if (!pid) return false;
  if (isWin) {
    const r = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return r.status === 0;
  }
  try { process.kill(-pid, "SIGKILL"); return true; } catch {}
  try { process.kill(pid, "SIGKILL"); return true; } catch { return false; }
}

/** 하네스 것으로 볼 프로필 폴더인가 — 임시 폴더 아래 + `aynx-harness-` 또는 `claude`. */
export function isHarnessProfile(dir) {
  if (!dir) return false;
  const d = norm(dir);
  const tmp = norm(os.tmpdir());
  if (!(d === tmp || d.startsWith(tmp + path.sep.toLowerCase()) || d.startsWith(tmp + "/"))) return false;
  const rest = d.slice(tmp.length);
  return rest.includes("aynx-harness-") || rest.includes("claude");
}

/**
 * 끌 대상 고르기. `match(dir)` 가 참인 프로필의 (a) 디버그 포트를 연 브라우저 프로세스와
 * (b) 부모가 이미 없는 같은 프로필의 떠돌이 자식. 반환은 트리 뿌리들만.
 */
export function pickTargets(procs, match) {
  const alive = new Set(procs.map((p) => p.pid));
  const roots = [];
  for (const p of procs) {
    const dir = userDataDir(p.cmd);
    if (!match(dir)) continue;
    const browser = p.cmd.includes("--remote-debugging-port");
    const orphan = !alive.has(p.ppid);
    if (browser || orphan) roots.push({ ...p, dir, why: browser ? "browser" : "orphan" });
  }
  // 뿌리 아래에 든 뿌리는 뺀다(트리 kill 이 같이 거둔다).
  const rootPids = new Set(roots.map((r) => r.pid));
  return roots.filter((r) => !rootPids.has(r.ppid));
}

function main() {
  const dry = process.argv.includes("--dry-run");
  if (!isWin) {
    console.log("kill-harness-edge: not implemented on " + process.platform + " (Windows 전용 — 프로세스 그룹으로 띄운 run-harness 는 스스로 끈다)");
    process.exit(0);
  }
  const procs = listEdge();
  const targets = pickTargets(procs, isHarnessProfile);
  console.log(`msedge 프로세스 ${procs.length}개 · 하네스 것 뿌리 ${targets.length}개`);
  let killed = 0;
  for (const t of targets) {
    const port = /--remote-debugging-port=(\d+)/.exec(t.cmd)?.[1] ?? "-";
    const ok = dry ? true : killTree(t.pid);
    if (ok && !dry) killed++;
    console.log(`${dry ? "would kill" : ok ? "killed" : "FAILED"} pid ${t.pid} (${t.why}, cdp ${port}) ${t.dir}`);
  }
  if (!dry) {
    const after = listEdge();
    console.log(`끈 뿌리 ${killed}개 · msedge 남음 ${after.length}개 (하네스 것 ${pickTargets(after, isHarnessProfile).length}개)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

// SSH 끊김 행(설계 10절 "SSH 끊김(네트워크)") — `run.mjs ssh-drop`.
//
// 호스트는 환경 변수로만 받는다(공개 저장소에 호스트 이름을 적지 않는다):
//   SURVIVAL_SSH_TMUX=<tmux 로 붙는 호스트 별칭>   SURVIVAL_SSH_PLAIN=<일반 셸 호스트 별칭>
// 끊는 법: 원격에서 이 연결의 sshd 세션 프로세스를 `kill -9`(셸의 조상 중 첫 sshd — tmux 면 tmux 클라이언트의 조상). TCP 가 곧바로
// 닫히므로 "끊김 표시 ≤ keepalive 한도" 는 즉시 쪽만 잰다. **방화벽 차단(조용한 끊김 — keepalive 로만 알아챈다)·절전은 손 절차**다:
//   1) 타일에서 번호 루프를 돌린다  2) `New-NetFirewallRule -DisplayName survival-drop -Direction Outbound -RemoteAddress <IP> -Action Block`
//   3) keepalive 한도(ServerAliveInterval×CountMax) 안에 타일이 끊김을 보이는지 본다  4) 규칙을 지우고(`Remove-NetFirewallRule -DisplayName
//   survival-drop`) Enter 로 다시 붙는다 — tmux 면 번호가 이어지고, 아니면 새 셸이다.
// 판정: 끊김이 타일에 2초 안에 보인다 · Enter 로 다시 붙는다 · tmux 호스트는 같은 루프가 이어진다(번호가 1 로 돌아가지 않는다) ·
//       일반 호스트는 새 셸(루프는 유실 — 설계대로).
import { bashLoop, now, seqCheck, sleep, stripAnsi, unveil } from "./lib.mjs";

const WALK_KILL = (start) =>
  `p=${start}; while [ -n "$p" ] && [ "$p" != 1 ] && [ "$(ps -o comm= -p $p)" != sshd ]; do p=$(ps -o ppid= -p $p | tr -d ' '); done; [ "$(ps -o comm= -p $p)" = sshd ] && kill -9 $p`;

async function snapOf(cdp, stream) {
  return cdp.eval(`window.__sv.snap(${JSON.stringify(stream)})`).catch(() => null);
}

async function probe(cdp, stream) {
  return cdp.eval(`window.__TAURI_INTERNALS__.invoke('probe_session', { stream: ${JSON.stringify(stream)}, kind: 'ssh' })`).catch(() => null);
}

async function pressEnter(cdp, stream) {
  await cdp.eval(
    `(() => { const p = window.__sv.byStream(${JSON.stringify(stream)}); const el = document.querySelector('[data-pane="' + p.id + '"] textarea.xterm-helper-textarea'); el?.focus(); return document.activeElement === el; })()`,
  );
  for (const type of ["keyDown", "char", "keyUp"])
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      ...(type !== "keyUp" ? { text: String.fromCharCode(13) } : {}),
    });
}

async function oneHost(o, h, cdp, alias, tmux) {
  const [t] = await h.openTiles(cdp, 1, "", { kind: "ssh", alias });
  // 프롬프트(또는 tmux 화면)가 설 때까지
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    const s = await snapOf(cdp, t.stream);
    ready = s?.session != null && stripAnsi(s.buffer).trim().length > 0;
  }
  if (!ready) return { alias, verdict: "n/a", reason: "접속하지 못함(인증·호스트 키 물음·네트워크)" };
  const sessionBefore = (await snapOf(cdp, t.stream))?.session;
  // 6초 뒤 이 연결의 sshd 를 죽이는 일을 뒤에 걸어 두고 번호 루프를 돌린다.
  const start = tmux ? `$(tmux display -p '#{client_pid}' 2>/dev/null || echo $$)` : "$$";
  await cdp.eval(
    `window.__sv.write(${JSON.stringify(t.stream)}, ${JSON.stringify(`(sleep 6; ${WALK_KILL(start)}) >/dev/null 2>&1 & ${bashLoop(1200, 100)}\r`)})`,
  );
  const t0 = now();
  // 끊김: 서버 표의 상태가 disconnected 가 되는 순간(타일 배너와 같은 사건)
  let dropMs = null;
  let lastBefore = null;
  while (now() - t0 < 30_000) {
    const p = await probe(cdp, t.stream);
    if (p?.state === "disconnected" || p?.state === "none" || p?.state === "exited") {
      dropMs = now() - t0;
      break;
    }
    lastBefore = seqCheck((await snapOf(cdp, t.stream))?.buffer).last ?? lastBefore;
    await sleep(100);
  }
  if (dropMs === null) return { alias, verdict: "fail", reason: "30초 안에 끊기지 않음(원격 kill 실패?)" };
  // 끊긴 사실이 sshd kill(약 6초) 뒤 곧바로 보였나 — 6초를 빼면 표시 지연
  const shownMs = Math.max(0, dropMs - 6000);
  await sleep(1500);
  await unveil(cdp);
  await pressEnter(cdp, t.stream);
  // 다시 붙었나 — 새 세션 id
  let sessionAfter = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const s = await snapOf(cdp, t.stream);
    if (s?.session != null && s.session !== sessionBefore) {
      sessionAfter = s.session;
      break;
    }
  }
  await sleep(4000);
  const after = seqCheck((await snapOf(cdp, t.stream))?.buffer);
  const continued = tmux ? after.last !== null && lastBefore !== null && after.last > lastBefore : null;
  // 루프를 끊고(리눅스 PTY 의 Ctrl+C) 닫는다 — tmux 세션은 원격에 남을 수 있어 루프가 돌지 않게(유한 루프 1200×0.1초이기도 하다).
  await cdp.eval(`window.__sv.write(${JSON.stringify(t.stream)}, ${JSON.stringify(String.fromCharCode(3))})`).catch(() => {});
  await sleep(500);
  await h.closeTabs(cdp, [t.stream]);
  const ok = shownMs <= 2000 && sessionAfter !== null && (tmux ? continued : true);
  return { alias, tmux, verdict: ok ? "pass" : "fail", dropShownMs: shownMs, reconnected: sessionAfter !== null, lastBefore, lastAfter: after.last, loopContinued: continued };
}

export async function sshDrop(o, h) {
  const tmuxHost = process.env.SURVIVAL_SSH_TMUX;
  const plainHost = process.env.SURVIVAL_SSH_PLAIN;
  if (!tmuxHost && !plainHost) return { verdict: "n/a", reason: "SURVIVAL_SSH_TMUX / SURVIVAL_SSH_PLAIN 이 없다" };
  const { ensureApp } = await import("./lib.mjs");
  const { cdp } = await ensureApp(o);
  const out = [];
  if (tmuxHost) out.push(await oneHost(o, h, cdp, tmuxHost, true));
  if (plainHost) out.push(await oneHost(o, h, cdp, plainHost, false));
  cdp.close();
  const v = out.map((r) => r.verdict);
  return { verdict: v.includes("fail") ? "fail" : v.every((x) => x === "n/a") ? "n/a" : "pass", hosts: out };
}

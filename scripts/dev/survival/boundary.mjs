// 경계 행(설계 10절 "경계") — `run.mjs boundary [--case c1a|c1b|c2|c3|c4|c5|all]`.
//
// c1a 링 경계: GUI 를 죽인 사이 색·한글·이모지 줄을 링(256 KiB) 넘게 찍고 다시 붙는다 → 재생 첫 줄이 시퀀스·글자 중간에서
//     시작해 깨진 글자(`38;2;…m` 조각·U+FFFD·반쪽 줄)가 화면에 남는가.
// c1b 체크포인트 오프셋: 같은 줄을 쉬지 않고 찍는 동안 F5 를 거듭한다 → pagehide 체크포인트의 소비 오프셋이 배치 경계(시퀀스
//     중간일 수 있다)에 서므로, 재생이 시퀀스 꼬리부터 시작해 조각이 남는가.
// c2  대체 화면(로컬 vim · less): 대체 화면 중 F5 · GUI kill → 다시 붙은 화면이 대체 화면이고 내용이 같은가.
// c3  resize 중 재부착: 창(뷰포트) 폭을 바꾼 채 F5 → 번호 연속·조각 줄 0·커서가 프롬프트 줄.
// c4  재생 구간 억제: 떨어진 동안 찍힌 OSC 9 · OSC 52 · BEL · DSR 이 재생에서 다시 일어나지 않는가(+ 실시간 대조군은 일어난다).
// c5  체크포인트 없는 긴 공백: GUI kill 뒤 링을 넘긴 출력 → 배너·서버 로그의 유실 바이트 = 실제로 빠진 줄의 바이트.
import {
  Cdp,
  helpers,
  launchGui,
  now,
  seqCheck,
  sleep,
  stripAnsi,
  waitAttached,
  waitSeq,
  waitText,
} from "./lib.mjs";

const ESC = "\x1b";
/** 색(24비트)·한글·이모지를 섞은 줄 — `[char]27` 로 ESC 를 만든다(pwsh). 줄 = `한글😀 n=<번호> <채움>` */
const colorLoop = (from, count, pad, ms = 0) =>
  `${from}..${from + count - 1} | % { "$([char]27)[38;2;$($_ % 256);120;200m한글😀 n=$_ ${"z".repeat(pad)}$([char]27)[0m"${ms ? `; Start-Sleep -Milliseconds ${ms}` : ""} }`;

/** 화면의 깨진 흔적 — 시퀀스 조각·대체 문자·반쪽 줄. 프롬프트·명령 메아리 줄은 뺀다. */
export function garbage(buffer) {
  const lines = stripAnsi(buffer).split(/\r?\n/);
  const bad = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (/^PS [A-Z]:\\|^\[aynx\]|세션|출력 일부|\$\(\[char\]27\)|Start-Sleep|% \{/.test(line)) continue;
    if (line.includes("�")) bad.push({ why: "U+FFFD", line });
    else if (/\d+;\d+(;\d+)*m/.test(line) || line.includes(ESC)) bad.push({ why: "sequence fragment", line });
    else if (/n=\d+/.test(line) && !/^한글😀 n=\d+ z*$/.test(line)) bad.push({ why: "partial line", line });
  }
  return bad;
}

async function snap(cdp, stream) {
  return cdp.eval(`window.__sv.snap(${JSON.stringify(stream)})`).catch(() => null);
}
const colorNums = (buffer) => [...stripAnsi(buffer).matchAll(/^한글😀 n=(\d+)/gm)].map((m) => Number(m[1]));

export async function boundary(o, h) {
  const which = (o.case ?? "all").split(",");
  const out = {};
  let cdp = await Cdp.connect(o.cdp, { timeoutMs: 60_000 });
  await helpers(cdp);
  // c6 은 5분 넘게 걸려 `all` 에 넣지 않는다 — `--case c6` 으로만.
  const want = (c) => (which.includes("all") && c !== "c6") || which.includes(c);
  const ctx = { o, h, get cdp() { return cdp; }, set cdp(v) { cdp = v; } };
  for (const [name, fn] of Object.entries(CASES)) {
    if (!want(name)) continue;
    try {
      out[name] = await fn(ctx);
    } catch (e) {
      out[name] = { verdict: "fail", reason: `exception: ${e?.message ?? e}` };
    }
  }
  cdp.close();
  const verdicts = Object.values(out).map((r) => r.verdict);
  return { verdict: verdicts.includes("fail") ? "fail" : verdicts.every((v) => v === "n/a") ? "n/a" : "pass", cases: out };
}

/** GUI 를 죽이고 `waitMs` 뒤 다시 띄워 붙는다 */
async function killAndReturn(ctx, streams, waitMs) {
  ctx.cdp.close();
  await ctx.h.killGui();
  await sleep(waitMs);
  const r = await ctx.h.relaunchAndAttach(streams);
  ctx.cdp = r.cdp;
  return r;
}

const CASES = {
  async c1a(ctx) {
    // 줄 ≈ 113 바이트(색 시퀀스 23 + 한글·이모지 10 + 번호 + 채움 60) — 링(256 KiB)에 약 2300줄이라 재생 첫 줄이 스크롤백(5000줄) 안에
    // 남아 직렬화로 보인다. 줄 수를 바꿔 가며 링 경계가 줄의 다른 자리에 서게 한다.
    const rounds = Math.max(ctx.o.repeat, 3);
    const runs = [];
    for (let i = 0; i < rounds; i++) {
      const logAt = ctx.h.serverLogSize();
      const count = 4000 + i * 37;
      // 12초 뒤에 찍기 시작 — 그 사이 첫 체크포인트(5초)가 서고 GUI 가 죽는다.
      const [t] = await ctx.h.openTiles(ctx.cdp, 1, `Start-Sleep 12; ${colorLoop(1, count, 60)}`);
      await sleep(7000);
      await killAndReturn(ctx, [t.stream], 22_000);
      await sleep(2500);
      const s = await snap(ctx.cdp, t.stream);
      const bad = garbage(s?.buffer);
      const nums = colorNums(s?.buffer);
      const log = ctx.h.serverLogSince(logAt);
      const lost = Number(/ring overrun, lost (\d+) bytes/.exec(log)?.[1] ?? 0);
      runs.push({ count, overrunBytes: lost, firstReplayed: nums[0] ?? null, last: nums.at(-1) ?? null, garbage: bad.length, sample: bad[0] });
      await ctx.h.closeTabs(ctx.cdp, [t.stream]);
    }
    const overran = runs.filter((r) => r.overrunBytes > 0);
    return {
      verdict: overran.length === 0 ? "n/a" : overran.every((r) => r.garbage === 0) ? "pass" : "fail",
      roundsWithGarbage: runs.filter((r) => r.garbage > 0).length,
      runs,
    };
  },

  async c1b(ctx) {
    const rounds = Math.max(ctx.o.repeat, 8);
    // 쉬지 않고 찍는다(배치가 64 KiB 로 잘려 시퀀스 중간에서 끊길 기회가 많다) — 그동안 F5 를 거듭한다.
    const [t] = await ctx.h.openTiles(ctx.cdp, 1, colorLoop(1, 400000, 40));
    await sleep(3000);
    const found = [];
    for (let i = 0; i < rounds; i++) {
      const r = await ctx.h.reloadPage(ctx.cdp);
      ctx.cdp = r.cdp;
      await waitAttached(ctx.cdp, [t.stream], 30_000);
      await sleep(1500);
      const bad = garbage((await snap(ctx.cdp, t.stream))?.buffer);
      if (bad.length) found.push({ round: i + 1, n: bad.length, sample: bad[0] });
    }
    await ctx.h.closeTabs(ctx.cdp, [t.stream]);
    return { verdict: found.length === 0 ? "pass" : "fail", rounds, roundsWithGarbage: found.length, found: found.slice(0, 4) };
  },

  async c2(ctx) {
    // 대체 화면 — 로컬 vim(Git 의 vim), 그리고 `SURVIVAL_SSH_PLAIN` 이 있으면 원격 less. 표식 글자를 넣은 파일을 연다.
    const marker = `ALT${Date.now() % 100000}`;
    const res = {};
    const targets = [
      {
        name: "local-vim",
        open: async () =>
          (
            await ctx.h.openTiles(
              ctx.cdp,
              1,
              `$f = Join-Path $env:TEMP 'survival-alt.txt'; 1..200 | % { "${marker} line $_" } | Set-Content $f; $v = (Get-Command vim -ErrorAction SilentlyContinue).Source; if (-not $v) { $v = Join-Path $env:ProgramFiles 'Git\\usr\\bin\\vim.exe' }; & $v -n $f`,
            )
          )[0],
        quit: `${ESC}:q!\r`,
      },
    ];
    if (process.env.SURVIVAL_SSH_PLAIN)
      // 원격 — 최소 이미지에는 less·vim 이 없을 수 있어(실측: lab 컨테이너는 top 뿐) 대체 화면을 쥐고 표식 줄을 그린 채 기다리는 셸
      // 한 줄(TUI 흉내)로 잰다. Ctrl+C 면 대체 화면을 풀고 끝난다.
      targets.push({
        name: "remote-alt",
        open: async () => {
          const [t] = await ctx.h.openTiles(ctx.cdp, 1, "", { kind: "ssh", alias: process.env.SURVIVAL_SSH_PLAIN });
          for (let i = 0; i < 60; i++) {
            await sleep(500);
            const s = await snap(ctx.cdp, t.stream);
            if (s?.session != null && /[$#] $/.test(stripAnsi(s.buffer).trimEnd() + " ")) break;
          }
          const tui = `( trap 'printf "\\033[?1049l"; exit' INT; printf '\\033[?1049h\\033[H'; seq 1 30 | sed 's/^/${marker} line /'; sleep 600 )`;
          await ctx.cdp.eval(`window.__sv.write(${JSON.stringify(t.stream)}, ${JSON.stringify(`${tui}\r`)})`);
          return t;
        },
        quit: String.fromCharCode(3),
      });
    for (const target of targets)
    for (const how of ["f5", "kill"]) {
      const t = await target.open();
      await waitText(ctx.cdp, t.stream, new RegExp(`${marker} line 1`), 15_000);
      await sleep(how === "kill" ? 6500 : 1000); // kill 은 체크포인트(5초) 뒤
      const before = await snap(ctx.cdp, t.stream);
      if (how === "f5") {
        const r = await ctx.h.reloadPage(ctx.cdp);
        ctx.cdp = r.cdp;
        await waitAttached(ctx.cdp, [t.stream], 30_000);
      } else {
        await killAndReturn(ctx, [t.stream], 1500);
      }
      await sleep(2500);
      const after = await snap(ctx.cdp, t.stream);
      const vis = (b) => stripAnsi(b?.buffer?.split(`${ESC}[?1049h`).at(-1) ?? "").split(/\r?\n/).filter((l) => l.includes(marker));
      const vb = vis(before);
      const va = vis(after);
      res[`${target.name}-${how}`] = {
        altBefore: (before?.buffer ?? "").includes(`${ESC}[?1049h`),
        altAfter: (after?.buffer ?? "").includes(`${ESC}[?1049h`),
        markerLinesBefore: vb.length,
        markerLinesAfter: va.length,
        sameFirstLine: vb[0] === va[0],
      };
      // 끈다(vim `:q!` · less `q`) — 타일 닫기로도 끝나지만 깨끗이
      await ctx.cdp.eval(`window.__sv.write(${JSON.stringify(t.stream)}, ${JSON.stringify(target.quit)})`).catch(() => {});
      await sleep(500);
      await ctx.h.closeTabs(ctx.cdp, [t.stream]);
    }
    const ok = Object.values(res).every((r) => r.altAfter && r.markerLinesAfter > 0 && r.sameFirstLine);
    return { verdict: ok ? "pass" : "fail", ...res };
  },

  async c3(ctx) {
    const loop = `1..100000 | % { "n=$_ " + ('x' * 50); Start-Sleep -Milliseconds 30 }`;
    // 대조군 — 재부착 없이 같은 폭 바꾸기만. ConPTY 는 폭이 줄면 화면을 다시 그리며 위쪽 줄 하나를 덮을 수 있다(살아 있는 resize 도 같다 —
    // 재부착과 무관한 ConPTY 성질). 재부착 판정은 이 대조군보다 더 잃지 않는가로 한다.
    const [k] = await ctx.h.openTiles(ctx.cdp, 1, loop);
    await waitSeq(ctx.cdp, k.stream, 40, 20_000);
    for (const width of [700, 1500, 900]) {
      await ctx.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await sleep(2500);
    }
    const control = seqCheck((await snap(ctx.cdp, k.stream))?.buffer);
    await ctx.cdp.send("Emulation.clearDeviceMetricsOverride");
    await ctx.h.closeTabs(ctx.cdp, [k.stream]);
    await sleep(1000);

    const [t] = await ctx.h.openTiles(ctx.cdp, 1, loop);
    await waitSeq(ctx.cdp, t.stream, 40, 20_000);
    // 재부착 전부터 있던 빈칸은 따로 센다.
    const pre = seqCheck((await snap(ctx.cdp, t.stream))?.buffer);
    const runs = [];
    for (const width of [700, 1500, 900]) {
      const before = await snap(ctx.cdp, t.stream);
      await ctx.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await sleep(200);
      const r = await ctx.h.reloadPage(ctx.cdp);
      ctx.cdp = r.cdp;
      // 새 연결에도 같은 뷰포트(덮어쓰기는 연결마다다 — 새 페이지가 이 폭으로 부팅하게 곧바로 다시 건다)
      await ctx.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await waitAttached(ctx.cdp, [t.stream], 30_000);
      const c = await waitSeq(ctx.cdp, t.stream, seqCheck(before?.buffer).last + 30, 20_000);
      const s = await snap(ctx.cdp, t.stream);
      const lines = stripAnsi(s?.buffer).split(/\r?\n/);
      const fragments = lines.filter((l) => /^x+\s*$/.test(l)).length;
      runs.push({ width, colsBefore: before?.cols, colsAfter: s?.cols, missing: c?.missing, dup: c?.dup, gaps: c?.gaps, fragments, around: c?.gaps?.length ? lines.filter((l) => { const m = /^n=(\d+)/.exec(l); return m && Math.abs(Number(m[1]) - c.gaps[0][0]) <= 2; }).map((l) => l.slice(0, 20)) : undefined });
    }
    await ctx.cdp.send("Emulation.clearDeviceMetricsOverride");
    await ctx.h.closeTabs(ctx.cdp, [t.stream]);
    // 재부착이 만든 빈칸만 센다 — 재부착 전 화면의 빈칸(`pre`)과 같은 폭 바꾸기의 ConPTY 몫(대조군)을 넘지 않아야 한다.
    const extra = Math.max(...runs.map((r) => r.missing - pre.missing));
    const ok = extra <= control.missing && runs.every((r) => r.dup === 0 && r.fragments === 0);
    return { verdict: ok ? "pass" : "fail", controlMissing: control.missing, controlGaps: control.gaps, preExistingMissing: pre.missing, reattachMissing: extra, runs };
  },

  async c4(ctx) {
    const marker = `SVN${Date.now() % 100000}`;
    // 새 문서마다 심는다 — 세션 쓰기(IPC 는 `fetch(ipc://…/write_session)` — `__TAURI_INTERNALS__.invoke` 는 고칠 수 없는 속성)와
    // 클립보드 쓰기·벨 번쩍임을 기록한다(앱 코드는 바꾸지 않는다).
    const hook = String.raw`(() => {
      window.__svlog = { writes: [], clip: [], bells: 0 };
      const f = window.fetch.bind(window);
      window.fetch = (url, init) => {
        try {
          if (String(url).includes('write_session') && typeof init?.body === 'string') window.__svlog.writes.push(String(JSON.parse(init.body).data ?? ''));
        } catch {}
        return f(url, init);
      };
      try {
        const w = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = (t) => { window.__svlog.clip.push(String(t)); return w(t).catch(() => {}); };
      } catch {}
      new MutationObserver((ms) => { for (const m of ms) if (m.type === 'attributes' && m.target.classList?.contains('bell')) window.__svlog.bells++; })
        .observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    })()`;
    await ctx.cdp.send("Page.enable");
    const reg = await ctx.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: hook });
    // 이 페이지에도 심어 대조군(실시간)을 잰다.
    await ctx.cdp.eval(hook);
    const [t] = await ctx.h.openTiles(ctx.cdp, 1, "");
    await waitAttached(ctx.cdp, [t.stream], 20_000);
    await sleep(2500);
    // OSC 9 알림 · OSC 52(base64 표식) · BEL · DSR(커서 위치 질의) 한 줄
    const b64 = Buffer.from(marker).toString("base64");
    const emit = `[Console]::Write("$([char]27)]9;${marker}$([char]7)$([char]27)]52;c;${b64}$([char]7)$([char]7)$([char]27)[6n")`;
    const count = async () =>
      ctx.cdp.eval(
        `(async () => { const n = await import('/src/lib/app/notifications.svelte.ts'); return { notes: n.notificationList().filter((e) => String(e.text).includes(${JSON.stringify(marker)})).length, clip: window.__svlog.clip.filter((c) => c.includes(${JSON.stringify(marker)})).length, bells: window.__svlog.bells, dsr: window.__svlog.writes.filter((w) => /\\x1b\\[\\d+;\\d+R/.test(w)).length }; })()`,
      );
    // 대조군 — 붙어 있는 동안 찍으면 넷 다 일어난다.
    await ctx.cdp.eval(`window.__sv.write(${JSON.stringify(t.stream)}, ${JSON.stringify(`${emit}\r`)})`);
    await sleep(2000);
    const live = await count();
    // 프로그램이 끝난 뒤 닿은 DSR 답(`[3;1R`)이 프롬프트에 입력으로 남는다(ConPTY 의 알려진 모양) — ESC(PSReadLine 줄 되돌리기)로 지운다.
    await ctx.cdp.eval(`window.__sv.write(${JSON.stringify(t.stream)}, ${JSON.stringify(ESC)})`);
    await sleep(300);
    // 재생 — F5 를 걸고 0.6초 뒤(떨어진 사이) 같은 것을 찍게 한다. 그 바이트는 링에만 적히고 새 페이지가 재생한다.
    await ctx.cdp.eval(`window.__sv.write(${JSON.stringify(t.stream)}, ${JSON.stringify(`Start-Sleep -Milliseconds 600; ${emit}; "EMIT" + "TED-${marker}"\r`)})`);
    // 같은 연결로 다시 읽는다 — 새 문서 스크립트는 건 연결이 끊기면 함께 사라진다.
    await ctx.cdp.send("Page.reload", { ignoreCache: false });
    await sleep(800);
    await helpers(ctx.cdp);
    await waitAttached(ctx.cdp, [t.stream], 30_000);
    await sleep(3000);
    const replay = await count();
    // 떨어진 사이 찍힌 표식 줄(`EMITTED-…` — 명령 메아리는 `"EMIT" + "TED…"` 라 다르다)이 보이면 그 바이트는 재생으로 왔다.
    const tail = stripAnsi((await snap(ctx.cdp, t.stream))?.buffer);
    const replayed = tail.includes(`EMITTED-${marker}`);
    if (ctx.o.verbose) console.error(JSON.stringify(tail.slice(-500)));
    await ctx.cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: reg.result?.identifier }).catch(() => {});
    await ctx.h.closeTabs(ctx.cdp, [t.stream]);
    // DSR: 로컬(ConPTY)은 프로그램의 `ESC[6n` 에 conhost 가 스스로 답해 터미널로 내보내지 않는다 — 대조군이 0 이면 DSR 칸은
    // 이 타일로는 못 잰다(원격 SSH 타일에서 잰다). 나머지 셋은 대조군이 일어나야 판정한다.
    const liveOk = live.notes >= 1 && live.clip >= 1 && live.bells >= 1;
    const muted = replay.notes === 0 && replay.clip === 0 && replay.bells === 0 && replay.dsr === 0;
    return {
      verdict: !liveOk || !replayed ? "n/a" : muted ? "pass" : "fail",
      live,
      replay,
      dsr: live.dsr >= 1 ? (replay.dsr === 0 ? "muted" : "re-fired") : "n/a (ConPTY answers DSR itself)",
      replayedBytesVisible: replayed,
    };
  },

  async c5(ctx) {
    const logAt = ctx.h.serverLogSize();
    const pad = 100;
    // 12초 뒤 6000줄(≈ 650 KiB) — 링(256 KiB)을 넘는다. 줄 바이트를 알 수 있게 고정 모양(`n=<번호> <z×100>`).
    const [t] = await ctx.h.openTiles(ctx.cdp, 1, `Start-Sleep 12; 1..6000 | % { "n=$_ " + ('z' * ${pad}) }`);
    await sleep(7000);
    const cp = seqCheck((await snap(ctx.cdp, t.stream))?.buffer);
    await killAndReturn(ctx, [t.stream], 25_000);
    await sleep(2500);
    const s = await snap(ctx.cdp, t.stream);
    const text = stripAnsi(s?.buffer);
    const nums = [...text.matchAll(/^n=(\d+) z+/gm)].map((m) => Number(m[1]));
    const log = ctx.h.serverLogSince(logAt);
    const lost = Number(/ring overrun, lost (\d+) bytes/.exec(log)?.[1] ?? 0);
    const banner = /출력 일부 유실\D*(\d+)\s*KiB/.exec(text)?.[1] ?? null;
    // 실제로 빠진 줄: 체크포인트 화면의 마지막 번호 뒤부터 재생 첫 번호 앞까지 + 명령 메아리 줄(체크포인트 뒤에 찍힘).
    const firstReplayed = nums.find((n) => n > (cp.last ?? 0)) ?? null;
    const from = (cp.last ?? 0) + 1;
    let lineBytes = 0;
    for (let n = from; firstReplayed !== null && n < firstReplayed; n++) lineBytes += `n=${n} `.length + pad + 2;
    const ratio = lineBytes > 0 ? +(lost / lineBytes).toFixed(3) : null;
    await ctx.h.closeTabs(ctx.cdp, [t.stream]);
    const bannerOk = banner !== null && Math.abs(Number(banner) - Math.max(1, Math.round(lost / 1024))) <= 0;
    return {
      verdict: lost > 0 && bannerOk && ratio !== null && ratio >= 0.95 && ratio <= 1.15 ? "pass" : lost === 0 ? "n/a" : "fail",
      overrunBytes: lost,
      bannerKiB: banner === null ? null : Number(banner),
      missingLines: firstReplayed === null ? null : firstReplayed - from,
      missingLineBytes: lineBytes,
      ratio,
      checkpointLast: cp.last,
      firstReplayed,
    };
  },

  // c6 — GUI 를 끈 채 5분(체크포인트 옛 수명)을 넘긴 뒤 재실행: 링(256 KiB)을 넘는 출력을 다 찍고 체크포인트가 선 다음 GUI 를 죽이고
  // `--gap` 초(기본 330) 뒤 다시 띄운다. 체크포인트가 남아 있으면 화면은 번호 1 부터 이어지고 유실 배너가 없다. 버렸으면(②의 5분 수명)
  // 링만 재생돼 앞 번호를 잃고 "출력 일부 유실" 이 뜬다.
  async c6(ctx) {
    const gap = Number(ctx.o.gap ?? 330) * 1000;
    const logAt = ctx.h.serverLogSize();
    const [t] = await ctx.h.openTiles(ctx.cdp, 1, `1..3000 | % { "n=$_ " + ('x' * 110) }`);
    await waitSeq(ctx.cdp, t.stream, 3000, 60_000);
    await sleep(7000); // 체크포인트(5초 뒤 첫 장 — 출력이 멎은 뒤의 화면)
    await killAndReturn(ctx, [t.stream], gap);
    await sleep(2500);
    const s = await snap(ctx.cdp, t.stream);
    const c = seqCheck(s?.buffer);
    const lost = Number(/ring overrun, lost (\d+) bytes/.exec(ctx.h.serverLogSince(logAt))?.[1] ?? 0);
    await ctx.h.closeTabs(ctx.cdp, [t.stream]);
    return { verdict: c.first === 1 && c.missing === 0 && lost === 0 ? "pass" : "fail", gapSec: gap / 1000, first: c.first, last: c.last, missing: c.missing, overrunBytes: lost };
  },
};

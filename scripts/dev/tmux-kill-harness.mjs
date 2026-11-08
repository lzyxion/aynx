// Headless harness: tmux 세션 목록 팝오버의 **끄기 단추**(2026-10-27) — 칩 → 목록 → 줄 끝 끄기 → 확인 대화 →
// `ssh_tmux_kill` 인자 · 목록 다시 읽기 · 실패 알림 · 이 타일이 붙은 세션의 글 · 콘솔 오류 없음.
// `polish-harness.mjs` 의 tmux 판 사본 — 스텁 표와 시나리오만 다르다.
//
//   node scripts/dev/run-harness.mjs scripts/dev/tmux-kill-harness.mjs <outdir>
//
// 만드는 것: <outdir>/tmux-kill-*.png
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const outdir = process.argv[2] ?? ".";
const port = process.env.CDP_PORT ?? process.argv[3] ?? "9224";
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const p = path.join(outdir, name); const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(p, Buffer.from(r.result.data, "base64")); return p; };
let bad = 0;
const want = (label, got, expected) => { const ok = JSON.stringify(got) === JSON.stringify(expected); if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(expected)})`}`); };
await send("Page.enable"); await send("Runtime.enable");

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  let nextSession = 100;
  const now = Math.floor(Date.now() / 1000);
  // 서버의 tmux 세션 — 끄기가 성공하면 이 표에서 빠진다(다시 읽은 목록이 줄어드는지 본다).
  window.__tmux = [
    { name: 'aynx-1', windows: 2, attached: 1, created: now - 3600 },   // 이 타일이 붙은 세션
    { name: 'work', windows: 3, attached: 2, created: now - 7200 },     // 다른 클라이언트 둘
    { name: '배포', windows: 1, attached: 0, created: now - 120 },
    { name: 'fail', windows: 1, attached: 0, created: now - 60 },       // 스텁이 끄기를 거절한다
  ];
  const answers = {
    list_hosts: { hosts: [{ name: 'web-01', host_name: '10.0.0.1', user: 'deploy', port: 22, meta: { tags: [], forwards: [], tmux: true } }], warnings: [] },
    list_shells: [{ id: 'pwsh', label: 'PowerShell 7' }],
    list_group_meta: {}, list_host_meta: {},
    load_snippets: JSON.stringify({ version: 1, snippets: [] }), save_snippets: null,
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_input: null, send_keepalive: 12,
    session_info: { auth: 'publickey', keyLabel: null, jump: null, banner: null, connectedAt: Date.now() },
    reap_window_sessions: null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_ssh_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, tmux: 'aynx-1' }); }
      if (cmd === 'ssh_tmux_list') return Promise.resolve(window.__tmux.map(s => ({ ...s })));
      if (cmd === 'ssh_tmux_kill') {
        if (args?.name === 'fail') return Promise.reject("can't find session: =fail");
        window.__tmux = window.__tmux.filter(s => s.name !== args?.name);
        return Promise.resolve(null);
      }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__count = (c) => window.__calls.filter(x => x[0] === c).length;
  window.__kills = () => window.__calls.filter(x => x[0] === 'ssh_tmux_kill').map(x => x[1]);
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await waitBoot(ev);

const importer = (p, into) => `(async () => {
  const url = performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('${p}'));
  if (!url) return 'not loaded: ${p}';
  window.${into} = await import(url);
  return Object.keys(window.${into}).length + ' exports';
})()`;
console.log("import hosts:", await ev(importer("/src/lib/app/hosts.svelte.ts", "__H")));
console.log("connect web-01:", await ev(`(() => { window.__H.connect({ name: 'web-01', meta: { tags: [], forwards: [], tmux: true } }); return 'ok'; })()`));
await sleep(2500);
want("tmux 칩이 머리줄에 있다", await ev(`document.querySelectorAll('[data-tmux-menu-btn]').length > 0`), true);

// 사건 시각 이후의 콘솔 오류 · 예외만 센다(부팅 중 스텁 거절은 판 밖).
const mark = events.length;
const click = (sel) => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return 'missing ' + ${JSON.stringify(sel)}; b.click(); return 'clicked'; })()`);
const menuOpen = () => ev(`!!document.querySelector('.tmuxmenu')`);
const dialog = () => ev(`(() => { const d = document.querySelector('[role=alertdialog]'); if (!d) return null; return {
  title: d.querySelector('#confirm-dialog-title span')?.textContent.trim() ?? null,
  body: d.querySelector('#confirm-dialog-body')?.textContent.trim() ?? null,
  points: [...d.querySelectorAll('.points li')].map(l => l.textContent.trim()),
  ok: d.querySelector('[data-confirm-choice=Ok]')?.textContent.trim() ?? null,
  focus: document.activeElement?.getAttribute('data-confirm-choice') ?? null,
}; })()`);
const rowNames = () => ev(`[...document.querySelectorAll('.tmuxmenu .row .name')].map(e => e.textContent.trim())`);
const killSel = (name) => `.tmuxmenu [data-tmux-kill="${name}"]`;

// ① 목록 — 줄마다 끄기 단추 · 이 타일 줄의 툴팁은 다르다
console.log("open popover:", await click("[data-tmux-menu-btn]"));
await sleep(900);
want("팝오버가 떴다", await menuOpen(), true);
want("네 줄", await rowNames(), ["aynx-1", "work", "배포", "fail"]);
want("줄마다 끄기 단추", await ev(`document.querySelectorAll('.tmuxmenu [data-tmux-kill]').length`), 4);
want("남의 줄 툴팁", await ev(`document.querySelector('${killSel("배포")}')?.title`), "'배포' 세션을 끕니다 (tmux kill-session — 확인을 먼저 묻습니다)");
want("이 타일 줄 툴팁", await ev(`document.querySelector('${killSel("aynx-1")}')?.title.includes('이 타일의 연결도 끝납니다')`), true);
console.log("capture:", await shot("tmux-kill-list.png"));

// ② 빈 세션 — 취소하면 끄지 않고 같은 목록으로 돌아온다
let lists = await ev(`window.__count('ssh_tmux_list')`);
console.log("kill 배포:", await click(killSel("배포")));
await sleep(600);
want("팝오버가 닫혔다(통로: 스냅샷 → 닫기 → 실행)", await menuOpen(), false);
const d1 = await dialog();
want("확인 제목", d1?.title, "tmux 세션 끄기");
want("확인 본문", d1?.body, "'배포' 세션을 끕니다. 그 안에서 돌던 프로그램도 모두 끝납니다.");
want("확인 점", d1?.points, ["창 1개 · 되돌릴 수 없습니다."]);
want("확인 단추", d1?.ok, "끄기");
want("첫 포커스는 취소", d1?.focus, "Cancel");
console.log("capture:", await shot("tmux-kill-confirm.png"));
console.log("cancel:", await click("[data-confirm-choice=Cancel]"));
await sleep(900);
want("취소하면 끄지 않는다", await ev(`window.__kills().length`), 0);
want("취소 뒤 팝오버가 다시 열렸다", await menuOpen(), true);
want("다시 열며 목록을 다시 읽었다", (await ev(`window.__count('ssh_tmux_list')`)) > lists, true);

// ③ 확인 → ssh_tmux_kill{id, name} → 다시 열린 목록에서 빠짐
lists = await ev(`window.__count('ssh_tmux_list')`);
console.log("kill 배포:", await click(killSel("배포")));
await sleep(600);
console.log("ok:", await click("[data-confirm-choice=Ok]"));
await sleep(1200);
const k1 = await ev(`JSON.stringify(window.__kills())`);
want("ssh_tmux_kill 인자(이름만 — 명령 글자 없음)", JSON.parse(k1).map((a) => [typeof a.id, a.name, Object.keys(a).sort()]), [["number", "배포", ["id", "name"]]]);
want("끈 뒤 팝오버가 다시 열렸다", await menuOpen(), true);
want("끈 뒤 목록을 다시 읽었다", (await ev(`window.__count('ssh_tmux_list')`)) > lists, true);
want("목록에서 빠졌다", await rowNames(), ["aynx-1", "work", "fail"]);

// ④ 다른 클라이언트가 붙은 세션 — 글에 그 수
console.log("kill work:", await click(killSel("work")));
await sleep(600);
const d2 = await dialog();
want("다른 클라이언트 문구", d2?.points, ["다른 클라이언트 2개가 붙어 있습니다 — 그 화면도 함께 끝납니다.", "창 3개 · 되돌릴 수 없습니다."]);
await click("[data-confirm-choice=Cancel]");
await sleep(900);

// ⑤ 실패 — 알림 한 줄 · 목록은 그대로 다시 열린다
console.log("kill fail:", await click(killSel("fail")));
await sleep(600);
await click("[data-confirm-choice=Ok]");
await sleep(1200);
want("실패 알림", await ev(`[...document.querySelectorAll('.toast .text')].map(e => e.textContent.trim()).find(s => s.includes('fail')) ?? null`),
  "tmux 세션을 끄지 못했습니다: can't find session: =fail");
want("실패 뒤에도 팝오버가 다시 열렸다", await menuOpen(), true);
want("실패한 세션은 목록에 남는다", await rowNames(), ["aynx-1", "work", "fail"]);
console.log("capture:", await shot("tmux-kill-failed.png"));

// ⑥ 이 타일이 붙은 세션 — 제목 · 단추 · 첫 점이 다르고, 끄면 다시 열지 않는다
console.log("kill aynx-1:", await click(killSel("aynx-1")));
await sleep(600);
const d3 = await dialog();
want("이 타일 제목", d3?.title, "이 타일의 tmux 세션 끄기");
want("이 타일 단추", d3?.ok, "끄고 이 타일도 끝내기");
want("이 타일 점(자기 몫은 다른 클라이언트로 세지 않는다)", d3?.points, ["이 타일이 지금 붙어 있는 세션입니다 — 끄면 이 타일의 연결도 끝납니다.", "창 2개 · 되돌릴 수 없습니다."]);
console.log("capture:", await shot("tmux-kill-here.png"));
await click("[data-confirm-choice=Ok]");
await sleep(1200);
want("이 타일 세션 끄기 호출", JSON.parse(await ev(`JSON.stringify(window.__kills().map(a => a.name))`)), ["배포", "fail", "aynx-1"]);
want("이 타일 세션을 끈 뒤에는 다시 열지 않는다", await menuOpen(), false);

// 콘솔 오류 · 예외(클릭 이후)
const after = events.slice(mark);
const exc = after.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text ?? "").split("\n")[0]);
const cerr = after.filter((e) => e.method === "Runtime.consoleAPICalled" && e.params.type === "error").map((e) => e.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0]).filter((s) => !/stub:/.test(s));
want("클릭 이후 예외 없음", exc, []);
want("클릭 이후 콘솔 오류 없음", cerr, []);

console.log(bad === 0 ? "\nALL OK" : `\n${bad} FAILED`);
ws.close();
process.exit(bad === 0 ? 0 : 1);

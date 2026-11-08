// 헤드리스 검증 — **후속 셋** 중 화면에 보이는 둘
// (docs/log/2026-09-19-vault.md 6절 · docs/log/2026-09-19-identity-file-auth.md §11).
//
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9228 --user-data-dir=%TEMP%/edge-aynx-idonly \
//     --window-size=1200,900 http://localhost:1420/
//   node scripts/dev/identities-only-harness.mjs <outdir> [port]
//
// 만드는 것: <outdir>/vault-remove-warn.png · <outdir>/identities-only-toggle.png
//
// 보는 것:
//   ⓐ 마스터 **해제** 모달에 머리말과 **별개의 경고 줄**(`.warn`)이 있다.
//   ⓑ 호스트 폼의 "이 키만 사용" 스위치 — `IdentityFile` 이 있으면 켤 수 있고, 켜서 저장하면
//      `edit_host` 인자에 `identities_only: true` 가 실리며, 칸을 비우면 재워지고 곁말이 뜬다.
//
// **비밀은 절대 찍지 않는다** — 금고 명령이 받은 값은 "있는가" 로만 기록한다
// (`vault-settings-harness.mjs` 의 같은 줄).
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";

const [outdir = ".", port = "9228"] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else if (d.method) events.push(d);
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  return r.result?.exceptionDetails
    ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0]
    : r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (path) => {
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) {
      fs.writeFileSync(path, Buffer.from(r.result.data, "base64"));
      return "ok";
    }
    await sleep(500);
  }
  return "capture failed";
};
await send("Page.enable");
await send("Runtime.enable");

await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  let nextSession = 100;

  window.__vault = { state: 'unlocked', hasMaster: true, master: 'correct-master' };
  window.__vaultCalls = [];
  const has = (v) => (typeof v === 'string' ? (v.length > 0 ? 'present' : 'empty') : (v === null ? 'null' : 'absent'));
  const noteVault = (cmd, args) => {
    window.__vaultCalls.push({ cmd, master: has(args?.master), new: has(args?.new), current: has(args?.current) });
  };

  // \`edit_host\` 가 받은 인자를 **그대로** 적는다 — 여기엔 비밀이 없다(접속 설정뿐).
  window.__editCalls = [];

  const HOSTS = [
    {
      name: 'web-01', host_name: '10.0.0.9', user: 'deploy', port: 22,
      identity_file: '~/.ssh/id_ed25519',
      // 자기 블록에 적혀 있지 않다 = 스위치는 꺼진 채로 열린다.
      identities_only: false, identities_only_own: false,
      proxy_jump: null,
    },
    {
      // 공용 블록에서 **물려받기만** 한 호스트 — 스위치는 꺼지고 곁말이 "(상속: 켬)".
      name: 'db-01', host_name: '10.0.0.10', user: 'deploy', port: 22,
      identity_file: '~/.ssh/id_rsa',
      identities_only: true, identities_only_own: false,
      proxy_jump: null,
    },
  ];

  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [], load_settings: null,
    session_logs_dir: 'C:\\\\Users\\\\wl\\\\AppData\\\\Roaming\\\\aynx\\\\logs',
    agent_status: { pipe_alive: true, key_count: 0 }, agent_has_key: false,
    list_ssh_key_files: [],
    set_host_meta: null,
    get_host_meta: {
      color: null, icon: null, group: null, tags: [], scrollback: null, on_connect: null,
      log: null, shell_integration: null, tmux: null, forwards: [],
    },
  };

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);

      if (cmd === 'vault_status') {
        return Promise.resolve({
          state: window.__vault.state, hasMaster: window.__vault.hasMaster,
          autoLockMinutes: 30, entryCount: 0,
        });
      }
      if (cmd === 'vault_list') return Promise.resolve([]);
      if (cmd === 'vault_has_password' || cmd === 'vault_has_passphrase') return Promise.resolve(false);
      if (cmd === 'vault_set_master') {
        noteVault(cmd, args);
        if (window.__vault.hasMaster && args?.current !== window.__vault.master) {
          return Promise.reject('[vault-wrong-master] 금고를 열지 못했습니다');
        }
        window.__vault.hasMaster = typeof args?.new === 'string';
        return Promise.resolve(null);
      }
      if (cmd === 'vault_create' || cmd === 'vault_unlock' || cmd === 'vault_lock'
          || cmd === 'vault_delete' || cmd === 'vault_delete_all') {
        noteVault(cmd, args);
        return Promise.resolve(null);
      }

      if (cmd === 'edit_host') {
        window.__editCalls.push(args?.host ?? null);
        return Promise.resolve([]);
      }
      if (cmd === 'save_settings') return Promise.resolve(null);

      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(4500);

const VK = { Comma: 188, F2: 113, Escape: 27, Enter: 13 };
const key = async (code, modifiers, keyName) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : (VK[code] ?? 0);
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};

const text = async (sel) =>
  await ev(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);

const clickText = async (scope, label) =>
  await ev(`(() => {
    const root = document.querySelector(${JSON.stringify(scope)});
    if (!root) return 'no scope';
    const b = [...root.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === ${JSON.stringify(label)});
    if (!b) return 'no button: ' + [...root.querySelectorAll('button')].map((e) => (e.textContent||'').trim()).join(' | ');
    b.click();
    return 'clicked';
  })()`);

const fill = async (sel, value) =>
  await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'no field';
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled';
  })()`);

/** 스위치는 안쪽이 진짜 체크박스다 — 클릭 한 번이 곧 사람의 동작이다 */
const toggle = async (sel) =>
  await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'no toggle';
    if (el.disabled) return 'disabled';
    el.click();
    return el.checked ? 'on' : 'off';
  })()`);

/** 호스트 독을 열고 별칭 한 줄을 골라 F2 (수정 폼) */
const openEdit = async (alias) => {
  // **깨끗한 페이지에서 시작한다.** `Ctrl+Shift+H` 는 토글이고 독 하나를 설정과 나눠 쓰므로,
  // 앞 시나리오가 무엇을 열어 뒀느냐에 따라 같은 키가 열기도 닫기도 한다 — 그 분기를 두면
  // 실패가 "화면이 틀렸다" 인지 "하네스가 길을 잃었다" 인지 갈리지 않는다.
  await send("Page.reload", { ignoreCache: true });
  await sleep(4500);
  await key("KeyH", 10, "H"); // Ctrl+Shift+H — 호스트 독
  await sleep(1200);
  const picked = await ev(`(() => {
    const el = [...document.querySelectorAll('[data-id]')].find((e) => new RegExp(${JSON.stringify(alias)}).test(e.textContent || ''));
    if (!el) return 'no row';
    const b = el.closest('li')?.querySelector('button') ?? el;
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    b.focus?.();
    return 'clicked';
  })()`);
  await sleep(600);
  await key("F2", 0, "F2");
  await sleep(1500);
  return picked;
};

// ═══ ⓐ 마스터 해제 모달 — 경고가 **따로 한 줄** ═══════════════════════════════
console.log("── ⓐ master remove warning ────────────────────────────────────");
await key("Comma", 2, ","); // Ctrl+,
await sleep(1200);
console.log("settings open:", await ev(`!!document.querySelector('.settings-view')`));
console.log("open remove modal:", await clickText(".settings-view", "해제…"));
await sleep(600);
console.log("modal title:", JSON.stringify(await text("#vault-master-title")));
console.log("lead still there:", await ev(`!!document.querySelector('.modal .lead')`));
console.log("warn row present:", await ev(`!!document.querySelector('.modal .warn')`));
console.log("warn text:", JSON.stringify(await text(".modal .warn")));
console.log("warn has an icon:", await ev(`!!document.querySelector('.modal .warn svg')`));
console.log(
  "warn sits above the current-password field:",
  await ev(`(() => {
    const w = document.querySelector('.modal .warn');
    const f = document.querySelector('#vault-master-current');
    if (!w || !f) return 'missing';
    return w.compareDocumentPosition(f) === Node.DOCUMENT_POSITION_FOLLOWING;
  })()`),
);
console.log("warn uses the warn colour:", await ev(`(() => {
  const w = document.querySelector('.modal .warn');
  if (!w) return 'missing';
  const s = getComputedStyle(w);
  return s.color + ' / ' + s.backgroundColor;
})()`));
console.log("capture:", await shot(`${outdir}/vault-remove-warn.png`));
await key("Escape", 0, "Escape");
await sleep(400);
await key("Escape", 0, "Escape");
await sleep(400);

// ═══ ⓑ 호스트 폼 — "이 키만 사용" ═════════════════════════════════════════════
console.log("── ⓑ host form: IdentitiesOnly toggle ─────────────────────────");
console.log("select web-01:", await openEdit("web-01"));
console.log("host form open:", await ev(`!!document.querySelector('#f-identity')`));
console.log("identity field:", JSON.stringify(await ev(`document.querySelector('#f-identity')?.value ?? null`)));
console.log("toggle present:", await ev(`!!document.querySelector('#f-identities-only')`));
console.log("toggle enabled (key set):", await ev(`document.querySelector('#f-identities-only')?.disabled === false`));
console.log("toggle starts off (own value):", await ev(`document.querySelector('#f-identities-only')?.checked === false`));
console.log("summary:", JSON.stringify(await text('label[for="f-identities-only"] + .log-row .note-head')));
console.log("no need-key note while a key is set:", await ev(`!document.querySelector('label[for="f-identities-only"] + .log-row .note-full')`));
await ev(`(() => { document.querySelector('#f-identities-only')?.closest('.log-row')?.scrollIntoView({ block: 'center' }); return 'scrolled'; })()`);
await sleep(300);
console.log("capture:", await shot(`${outdir}/identities-only-toggle.png`));

console.log("turn it on:", await toggle("#f-identities-only"));
await sleep(300);
console.log("save:", await ev(`(() => {
  const f = document.querySelector('.host-modal form');
  if (!f) return 'no form';
  f.requestSubmit();
  return 'submitted';
})()`));
await sleep(1200);
console.log("edit_host args:", JSON.stringify(await ev(`window.__editCalls`)));
console.log(
  "identities_only === true:",
  await ev(`window.__editCalls.at(-1)?.identities_only === true`),
);

// 칸을 비우면 재워지고 곁말이 뜬다 (그리고 저장 값은 거짓으로 접힌다).
console.log("reopen web-01:", await openEdit("web-01"));
console.log("clear IdentityFile:", await fill("#f-identity", ""));
await sleep(400);
console.log("toggle disabled (no key):", await ev(`document.querySelector('#f-identities-only')?.disabled === true`));
console.log("need-key note:", JSON.stringify(await text('label[for="f-identities-only"] + .log-row .note-full')));
console.log("click is refused:", await toggle("#f-identities-only"));

// 물려받기만 한 호스트 — 스위치는 꺼져 있고 곁말이 "(상속: 켬)".
await key("Escape", 0, "Escape");
await sleep(500);
console.log("select db-01 (inherits):", await openEdit("db-01"));
console.log("toggle off (own value is false):", await ev(`document.querySelector('#f-identities-only')?.checked === false`));
console.log("inherited hint:", JSON.stringify(await text('label[for="f-identities-only"] + .log-row .note-head strong')));

const exc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0])
  .filter((s) => !/stub:/.test(s))
  .slice(0, 6);
if (exc.length) console.log("EXC", exc);
ws.close();

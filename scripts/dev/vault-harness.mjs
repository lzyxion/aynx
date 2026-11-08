// 헤드리스 검증 — **자격증명 금고 ② 인증 연결** (docs/log/2026-09-19-vault.md).
// `passphrase-harness.mjs` 의 사본에 금고 스텁(`vault_*`)만 얹었다 — 스텁 표와 시나리오만
// 다르다.
//
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9226 --user-data-dir=%TEMP%/edge-aynx-vault \
//     --window-size=1100,800 http://localhost:1420/
//   node scripts/dev/vault-harness.mjs <outdir> [port]
//
// 만드는 것: <outdir>/vault-save-check.png · <outdir>/vault-unlock.png
//
// **비밀은 절대 찍지 않는다** — 단언은 `typeof`·`length` 로 "보냈는가" 만 본다
// (`keygen-harness.mjs`·`passphrase-harness.mjs` 의 같은 줄). 스텁이 값을 받아도 그 값을
// 기록에 남기지 않는다: 남기는 것은 길이뿐이다.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";

const [outdir = ".", port = "9226"] = process.argv.slice(2);
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

const KEY_PATH = "C:\\\\Users\\\\wl\\\\.ssh\\\\id_ed25519_x";
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  let nextSession = 100;

  // ── 하네스가 갈아 끼우는 금고 상태 ─────────────────────────────────────────
  // 'absent'  = 아직 안 만들었다 (체크를 켜면 vault_create(null) 이 돌아야 한다)
  // 'locked'  = 마스터가 걸려 있고 잠겼다 (접속 전에 잠금 해제 모달이 떠야 한다)
  // 'unlocked'
  // 시나리오마다 **새로고침으로 초기화**한다 — 앱이 금고 상태를 몇 초 기억하기 때문에
  // (lib/vault 의 TTL), 같은 페이지에서 상태를 갈아 끼우면 옛 답이 남는다.
  // 그래서 하네스는 localStorage 에 적고 페이지를 다시 연다(이 스크립트는 문서보다 먼저 돈다).
  const wanted = (() => {
    try { return JSON.parse(localStorage.getItem('__harness_vault') || 'null'); } catch { return null; }
  })();
  window.__vault = wanted ?? { state: 'absent', hasMaster: false, master: 'correct-master' };
  window.__vault.master = 'correct-master';
  // 금고 명령이 받은 **모양**만 적는다 — 값은 길이로만 남는다.
  window.__vaultCalls = [];
  const noteVault = (cmd, args) => {
    window.__vaultCalls.push({
      cmd,
      alias: args?.alias ?? null,
      path: args?.path ?? null,
      // 값은 "있는가·몇 글자인가" 만. 이 파일은 비밀을 절대 찍지 않는다.
      value: typeof args?.value === 'string' ? args.value.length : null,
      master: typeof args?.master === 'string' ? args.master.length : (args?.master === null ? 'null' : null),
    });
  };

  // ── SSH 스텁 ───────────────────────────────────────────────────────────────
  // 'password'        = 첫 호출은 password_required, 비밀번호를 받으면 붙는다
  // 'stored_rejected' = 담아 둔 비밀번호가 거부됐다고 답한다 (모달이 미리 켜져야 한다)
  // 'passphrase'      = 잠긴 키 파일을 물어 온다 (에이전트 체크가 없어야 한다)
  window.__sshMode = localStorage.getItem('__harness_ssh') || 'password';
  window.__sshCalls = [];
  const PW_REQUIRED = (stored) => ({
    kind: 'password_required',
    message: '키 인증이 거부되어 비밀번호가 필요합니다',
    diag: { cause: 'auth_key_rejected' },
    stored_rejected: stored,
  });

  const answers = {
    list_hosts: {hosts:[{name:'web-01', host_name:'10.0.0.9', user:'deploy', port:22}],warnings:[]},
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [], load_settings: null,
    agent_status: { pipe_alive: true, key_count: 0 }, agent_has_key: false,
    session_info: {
      server_version: 'OpenSSH_9.6p1', auth_method: 'password_vault', identity: null,
      identity_stored: false,
      jump: null, connected_at_ms: Date.now(), keepalive_secs: 30, rtt_ms: 12,
    },
  };

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);

      if (cmd === 'vault_status') {
        return Promise.resolve({
          state: window.__vault.state,
          hasMaster: window.__vault.hasMaster,
          autoLockMinutes: 30,
          entryCount: 0,
        });
      }
      if (cmd === 'vault_create') {
        noteVault(cmd, args);
        window.__vault.state = 'unlocked';
        window.__vault.hasMaster = typeof args?.master === 'string';
        return Promise.resolve(null);
      }
      if (cmd === 'vault_unlock') {
        noteVault(cmd, args);
        if (args?.master !== window.__vault.master) {
          return Promise.reject('[vault-wrong-master] 금고를 열지 못했습니다');
        }
        window.__vault.state = 'unlocked';
        return Promise.resolve(null);
      }
      if (cmd === 'vault_store_password' || cmd === 'vault_store_passphrase') {
        noteVault(cmd, args);
        return Promise.resolve(null);
      }
      if (cmd === 'vault_lock') { window.__vault.state = 'locked'; return Promise.resolve(null); }

      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'open_ssh_session') {
        const gotPassword = typeof args?.password === 'string' && args.password.length > 0;
        const gotPassphrase = typeof args?.passphrase === 'string' && args.passphrase.length > 0;
        window.__sshCalls.push({
          password: gotPassword ? args.password.length : null,
          passphrase: gotPassphrase ? args.passphrase.length : null,
          passphraseFor: args?.passphraseFor ?? null,
        });
        if (window.__sshMode === 'passphrase') {
          if (!gotPassphrase) {
            return Promise.reject({
              kind: 'passphrase_required', path: '${KEY_PATH}',
              fingerprint: 'SHA256:PPPPaaaabbbbccccddddeeeeffff000011112222333',
              wrong: false, stored_rejected: false,
            });
          }
        } else if (!gotPassword) {
          return Promise.reject(PW_REQUIRED(window.__sshMode === 'stored_rejected'));
        }
        const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 };
        return Promise.resolve({ id, tmux: null });
      }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(4500);

const key = async (code, modifiers, keyName) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : code === "Escape" ? 27 : code === "Enter" ? 13 : 0;
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};

const openHost = async () =>
  await ev(`(() => {
    const el = [...document.querySelectorAll('[data-id]')].find((e) => /web-01/.test(e.textContent || ''));
    if (!el) return 'no row';
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'clicked';
  })()`);

const fill = async (sel, value) =>
  await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'no field';
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.form.requestSubmit();
    return 'submitted';
  })()`);

/**
 * 시나리오 하나를 **깨끗한 페이지에서** 시작한다.
 *
 * 앱은 금고 상태를 몇 초 기억한다(`$lib/vault` 의 TTL) — 같은 페이지에서 상태만 갈아
 * 끼우면 옛 답이 남아 관문이 뜨지 않는다. 그래서 상태를 `localStorage` 에 적고 새로고침한다.
 * 덤으로 앞 시나리오가 남긴 타일·모달도 함께 사라진다.
 */
const scenario = async (vaultState, sshMode) => {
  const seed = JSON.stringify(JSON.stringify({ ...vaultState, master: "correct-master" }));
  await ev(
    `(() => {
      localStorage.setItem('__harness_vault', ${seed});
      localStorage.setItem('__harness_ssh', ${JSON.stringify(sshMode)});
      return 'set';
    })()`,
  );
  await send("Page.reload", { ignoreCache: true });
  await sleep(4500);
  await key("KeyH", 10, "H"); // Ctrl+Shift+H — 호스트 독
  await sleep(900);
  const opened = await openHost();
  await sleep(1800);
  await key("KeyH", 10, "H"); // 독을 닫는다 (캡처에 모달만 보이게)
  await sleep(700);
  return opened;
};

// ═══ ① 금고가 없다 · 저장 체크를 켜고 접속 ═══════════════════════════════════
console.log("── ① absent + save ────────────────────────────────────────────");
console.log(
  "open host:",
  await scenario({ state: "absent", hasMaster: false }, "password"),
);

console.log("password modal:", await ev(`!!document.querySelector('#pw-input')`));
console.log("save checkbox present:", await ev(`!!document.querySelector('.saveopt input')`));
console.log("save default (want false):", await ev(`document.querySelector('.saveopt input')?.checked ?? null`));
console.log(
  "note (no master):",
  JSON.stringify(await ev(`document.querySelector('.saveopt .note')?.textContent.trim() ?? null`)),
);
console.log("stored line shown (want false):", await ev(`!!document.querySelector('.modal .wrong')`));
console.log("tick:", await ev(`(() => { const b = document.querySelector('.saveopt input'); if (!b) return 'no box'; b.click(); return b.checked; })()`));
console.log("capture:", await shot(`${outdir}/vault-save-check.png`));

const SECRET = "harness-password-1234";
console.log("submit:", await fill("#pw-input", SECRET));
await sleep(2000);

// vault_create(null) → vault_store_password({alias}) 두 줄이어야 한다.
console.log("vault calls:", JSON.stringify(await ev(`window.__vaultCalls`)));
console.log("ssh calls:", JSON.stringify(await ev(`window.__sshCalls`)));
console.log("xterm tiles:", await ev(`document.querySelectorAll('.xterm').length`));
// **값이 어디에도 안 남는다** — DOM 에도, 우리가 찍는 기록에도.
console.log("secret gone from DOM:", await ev(`!document.body.innerHTML.includes(${JSON.stringify(SECRET)})`));
console.log(
  "secret not in any printed call log:",
  await ev(`!JSON.stringify(window.__vaultCalls).includes(${JSON.stringify(SECRET)})`),
);
// 말풍선의 인증 한 줄 — `password_vault` 가 "비밀번호 (저장됨)" 으로 나와야 한다.
// 말풍선의 인증 한 줄 — `password_vault` 와 `identity_stored` 가 사람의 말이 되는지 본다.
// 모듈을 경로로 들인다(개발 서버가 그대로 서빙한다) — 순수 함수라 사본이어도 답이 같다.
console.log("auth labels:", JSON.stringify(await ev(`(async () => {
  const info = await import('/src/lib/session-info.ts');
  const i18n = await import('/src/lib/i18n/i18n.svelte.js');
  const base = {
    server_version: '', jump: null, connected_at_ms: Date.now(), keepalive_secs: 30, rtt_ms: null,
  };
  return [
    info.sessionInfoLines({ ...base, auth_method: 'password_vault', identity: null }, i18n.t, Date.now())[0],
    info.sessionInfoLines({ ...base, auth_method: 'key_file', identity: '~/.ssh/id_ed25519_x', identity_stored: true }, i18n.t, Date.now())[0],
  ];
})()`)));

// ═══ ② 잠긴 금고 — 접속 전에 잠금 해제 모달 ═══════════════════════════════════
console.log("── ② locked → unlock gate ─────────────────────────────────────");
console.log(
  "open host:",
  await scenario({ state: "locked", hasMaster: true }, "password"),
);

console.log("unlock modal before connect:", await ev(`!!document.querySelector('#vault-input')`));
console.log("password modal not yet:", await ev(`!document.querySelector('#pw-input')`));
console.log("no ssh call yet:", await ev(`window.__sshCalls.length === 0`));
console.log("title:", JSON.stringify(await ev(`document.querySelector('#vault-title')?.textContent ?? null`)));
console.log("capture:", await shot(`${outdir}/vault-unlock.png`));

console.log("submit wrong master:", await fill("#vault-input", "nope"));
await sleep(1200);
console.log("still open after wrong:", await ev(`!!document.querySelector('#vault-input')`));
console.log("wrong line:", JSON.stringify(await ev(`document.querySelector('.modal .wrong')?.textContent.trim() ?? null`)));
console.log("bracket code hidden:", await ev(`!(document.querySelector('.modal .wrong')?.textContent ?? '').includes('[vault-')`));

// 커서는 모달 칸에 있어야 한다 — 타일이 포커스를 가져가면 Escape 를 xterm 이 삼킨다
// (2026-09-19 ② 에 실제로 겪은 일이다: `Terminal.svelte` 의 rAF 포커스에 가드를 달았다).
console.log("focus is in the modal:", await ev(`document.activeElement?.id === 'vault-input'`));
console.log("skip (Escape):", await (async () => { await key("Escape", 0, "Escape"); return "sent"; })());
await sleep(1800);
console.log("unlock closed:", await ev(`!document.querySelector('#vault-input')`));
// 건너뛰면 **금고 없이** 접속이 이어진다 → 비밀번호 모달 차례.
console.log("connect proceeded (password modal):", await ev(`!!document.querySelector('#pw-input')`));
console.log("ssh attempted:", await ev(`window.__sshCalls.length >= 1`));

// ═══ ③ 담아 둔 비밀번호가 거부됐다 — 줄 + 미리 켜진 체크 ══════════════════════
console.log("── ③ stored_rejected ──────────────────────────────────────────");
console.log(
  "open host:",
  await scenario({ state: "unlocked", hasMaster: true }, "stored_rejected"),
);
console.log("password modal:", await ev(`!!document.querySelector('#pw-input')`));
console.log("stored line:", JSON.stringify(await ev(`document.querySelector('.modal .wrong')?.textContent.trim() ?? null`)));
console.log("save pre-ticked (want true):", await ev(`document.querySelector('.saveopt input')?.checked ?? null`));
console.log(
  "note (master set):",
  JSON.stringify(await ev(`document.querySelector('.saveopt .note')?.textContent.trim() ?? null`)),
);

// ═══ ④ 암호구 모달 — 에이전트 체크가 없다 ════════════════════════════════════
console.log("── ④ passphrase modal has no agent checkbox ───────────────────");
console.log(
  "open host:",
  await scenario({ state: "unlocked", hasMaster: false }, "passphrase"),
);
console.log("passphrase modal:", await ev(`!!document.querySelector('#pp-input')`));
console.log("agent checkbox gone:", await ev(`!document.querySelector('.agentopt')`));
console.log("save checkbox instead:", await ev(`!!document.querySelector('.saveopt input')`));
console.log(
  "checkbox label:",
  JSON.stringify(await ev(`document.querySelector('.saveopt span')?.firstChild?.textContent?.trim() ?? null`)),
);
// 모달 안에는 ssh-add 이야기가 한 글자도 없다 (에이전트 온보딩 배너는 이 검사 밖이다).
console.log("no ssh-add inside the modal:", await ev(`!(document.querySelector('.modal')?.innerText ?? '').includes('ssh-add')`));

// ═══ ⑤ 여럿이 한꺼번에 기다린다 — 한 번의 답이 줄 전체에 간다 ════════════════
// (docs/log/2026-09-22-vault-unlock-queue.md — `Ctrl+Shift+R` 이 만든 증상)
// 타일을 세 개 세우는 대신 **앱의 모듈 인스턴스**를 직접 불러 관문에 셋을 줄 세운다 —
// 검증할 것이 큐의 계약 하나라 접속 경로 전체를 다시 태울 이유가 없다.
console.log("── ⑤ three waiters → one answer wakes all ─────────────────────");
const queueUp = async () => {
  await ev(
    `(() => {
      localStorage.setItem('__harness_vault', ${JSON.stringify(JSON.stringify({ state: "locked", hasMaster: true, master: "correct-master" }))});
      localStorage.setItem('__harness_ssh', 'password');
      return 'set';
    })()`,
  );
  await send("Page.reload", { ignoreCache: true });
  await sleep(4500);
  return await ev(`(async () => {
    // URL 은 실제 기록에서 찾는다 — 손으로 적으면 Vite 의 질의가 달라 모듈 상태를
    // 공유하지 않는 **사본**이 생긴다 (keygen-harness.mjs 의 같은 줄).
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => /app\\/prompts\\.svelte/.test(u));
    if (!url) return 'prompts module not loaded yet';
    const m = await import(url);
    window.__woke = [];
    for (const i of [0, 1, 2]) m.ensureVaultUnlocked().then(() => window.__woke.push(i));
    await new Promise((r) => setTimeout(r, 800));
    return { modal: !!document.querySelector('#vault-input'), woke: window.__woke.length };
  })()`);
};

console.log("queued (want modal:true woke:0):", JSON.stringify(await queueUp()));
console.log("submit wrong master:", await fill("#vault-input", "nope"));
await sleep(1200);
// 틀린 답은 아무도 깨우지 않는다 — 모달은 선 채로 남는다.
console.log("still open after wrong:", await ev(`!!document.querySelector('#vault-input')`));
console.log("woke after wrong (want 0):", await ev(`window.__woke.length`));
console.log("submit right master:", await fill("#vault-input", "correct-master"));
await sleep(1500);
console.log("modal closed:", await ev(`!document.querySelector('#vault-input')`));
console.log("woke after unlock (want 3):", await ev(`window.__woke.length`));
console.log("unlock calls (want 2 — 틀린 것 하나, 맞은 것 하나):", await ev(`window.__vaultCalls.filter((c) => c.cmd === 'vault_unlock').length`));

console.log("── ⑤-b skip also drains ───────────────────────────────────────");
console.log("queued (want modal:true woke:0):", JSON.stringify(await queueUp()));
await key("Escape", 0, "Escape");
await sleep(1200);
console.log("modal closed:", await ev(`!document.querySelector('#vault-input')`));
console.log("woke after skip (want 3):", await ev(`window.__woke.length`));
// 건너뛴 것은 **그때 줄 서 있던 무리뿐**이다 — 뒤에 오는 접속은 상태를 새로 보고 다시 묻는다.
console.log("asks again for a later connection:", await ev(`(async () => {
  const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => /app\\/prompts\\.svelte/.test(u));
  const m = await import(url);
  m.ensureVaultUnlocked();
  await new Promise((r) => setTimeout(r, 600));
  return !!document.querySelector('#vault-input');
})()`));

const exc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0])
  .filter((s) => !/stub:/.test(s))
  .slice(0, 6);
if (exc.length) console.log("EXC", exc);
ws.close();

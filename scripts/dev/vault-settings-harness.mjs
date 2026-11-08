// 헤드리스 검증 — **자격증명 볼트 ③ 설정·호스트 폼** (docs/log/2026-09-19-vault.md).
// `vault-harness.mjs`(② 인증 연결)의 짝이다: 저쪽은 접속 흐름을, 이쪽은 **화면**을 본다.
//
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9227 --user-data-dir=%TEMP%/edge-aynx-vault3 \
//     --window-size=1200,900 http://localhost:1420/
//   node scripts/dev/vault-settings-harness.mjs <outdir> [port]
//
// 만드는 것: <outdir>/vault-settings.png · <outdir>/vault-host-form.png · <outdir>/delegation.png
//
// 2026-09-21 에 이 섹션에 **AI 위임 호스트** 표가 들어왔다(관제판의 위임 탭에서 옮겨 왔다 —
// docs/log/2026-09-21-fleet-delegation-ui.md). 그래서 `delegation_list_targets` 스텁이 있고,
// 시나리오 ⑤가 그 표(권한 칩 · 고아 줄 · 두 번 눌러 지우기)를 본다.
//
// 잠금 자체(가림막이 걸 때 함께 잠긴다 · 마스터 없는 잠금 해제)는 셋째 짝인
// `vault-veil-harness.mjs` 가 본다.
//
// 2026-10-21 — 보안은 **들어갈 때마다 관문**(`.gate` 카드 — 잠김 = 잠금 해제 모달 · 열림 + 마스터 = 마스터 확인
// `vault_verify_master` · 그 밖 = [열기])을 지나야 보이고, 목록 셋은 요약의 [관리 ›](`#vault-items` · `#delegation-targets`)
// 이 여는 하위 화면(`.cred-list`)이다. 상태 줄의 [잠그기] · [잠금 해제…]는 걷었다(잠금 = 가림막 하나). 이 하네스는 그 구조에
// 맞춰 선택자만 고쳤고 아직 다시 돌려 보지 않았다.
//
// **비밀은 절대 찍지 않는다** — 금고 명령이 받은 값은 `typeof`·길이로만 기록한다
// (`vault-harness.mjs` 의 같은 줄). 마스터 암호도 예외가 아니다.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";

const [outdir = ".", port = "9227"] = process.argv.slice(2);
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

// 담긴 항목 둘 — 종류가 갈리는 두 줄이라 목록의 그림·라벨·삭제가 모두 이 한 쌍으로 덮인다.
const KEY_PATH = "C:\\\\Users\\\\wl\\\\.ssh\\\\id_ed25519";

await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  let nextSession = 100;

  // ── 하네스가 갈아 끼우는 금고 상태 (시나리오마다 새로고침으로 초기화) ──────
  const wanted = (() => {
    try { return JSON.parse(localStorage.getItem('__harness_vault') || 'null'); } catch { return null; }
  })();
  window.__vault = wanted ?? { state: 'absent', hasMaster: false };
  window.__vault.master = 'correct-master';

  // 금고 명령이 받은 **모양**만 적는다 — 값은 "있는가" 로만 남는다.
  window.__vaultCalls = [];
  const has = (v) => (typeof v === 'string' ? (v.length > 0 ? 'present' : 'empty') : (v === null ? 'null' : 'absent'));
  const noteVault = (cmd, args) => {
    window.__vaultCalls.push({
      cmd,
      kind: args?.kind ?? null,
      target: args?.target ?? null,
      alias: args?.alias ?? null,
      path: args?.path ?? null,
      master: has(args?.master),
      new: has(args?.new),
      current: has(args?.current),
    });
  };

  window.__savedSettings = [];

  // ── AI 위임 호스트 (설정 › 보안의 표) ────────────────────────────────────
  // 아는 별칭 하나 + **고아** 하나. 고아는 ~/.ssh/config 에 없는 별칭이라
  // alias_known:false 로 온다 (Rust 의 ssh_config::config_index 가 판정한다).
  // 2026-09-22: 권한이 다섯이다 — vault_passphrase(볼트의 키 암호구 사용)가 접속 아래에
  // 붙었다. 아는 별칭 쪽만 켜 둬 칩 다섯 중 하나가 갈리는 것을 본다(역따옴표 금지: 스텁 글자).
  window.__delegation = [
    { alias: 'web-01', client: 'any', connect: true, read: true, propose: true, auto_execute: false, vault_passphrase: true, alias_known: true },
    { alias: 'old-host', client: 'any', connect: true, read: true, propose: false, auto_execute: false, vault_passphrase: false, alias_known: false },
  ];
  window.__delegationRemoved = [];

  const VAULT_ITEMS = [
    { kind: 'host_password', target: 'web-01' },
    { kind: 'key_passphrase', target: '${KEY_PATH}' },
  ];

  const answers = {
    list_hosts: {
      hosts: [{ name: 'web-01', host_name: '10.0.0.9', user: 'deploy', port: 22, identity_file: '~/.ssh/id_ed25519' }],
      warnings: [],
    },
    delegation_remove_targets: 1,
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [], load_settings: null,
    session_logs_dir: 'C:\\\\Users\\\\wl\\\\AppData\\\\Roaming\\\\aynx\\\\logs',
    agent_status: { pipe_alive: true, key_count: 0 }, agent_has_key: false,
    list_ssh_key_files: [],
    // 수정 폼이 원본 메타를 읽는다 — 빈 메타 한 벌이면 족하다.
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
          state: window.__vault.state,
          hasMaster: window.__vault.hasMaster,
          entryCount: window.__vault.state === 'unlocked' ? VAULT_ITEMS.length : 0,
        });
      }
      if (cmd === 'vault_list') {
        if (window.__vault.state === 'locked') return Promise.reject('[vault-locked] 금고가 잠겨 있습니다');
        if (window.__vault.state === 'absent') return Promise.reject('[vault-absent] 금고가 없습니다');
        return Promise.resolve(VAULT_ITEMS);
      }
      if (cmd === 'vault_has_password') {
        return Promise.resolve(args?.alias === 'web-01' && window.__vault.state === 'unlocked');
      }
      if (cmd === 'vault_has_passphrase') return Promise.resolve(false);
      if (cmd === 'vault_create') {
        noteVault(cmd, args);
        window.__vault.state = 'unlocked';
        window.__vault.hasMaster = typeof args?.master === 'string';
        return Promise.resolve(null);
      }
      if (cmd === 'vault_set_master') {
        noteVault(cmd, args);
        // 현재 암호가 필요한데 틀리면 디스크는 그대로다 (vault.rs 의 순서 셋).
        if (window.__vault.hasMaster && args?.current !== window.__vault.master) {
          return Promise.reject('[vault-wrong-master] 금고를 열지 못했습니다');
        }
        window.__vault.hasMaster = typeof args?.new === 'string';
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
      if (cmd === 'vault_verify_master') {
        noteVault(cmd, args);
        if (!window.__vault.hasMaster) return Promise.resolve({ result: 'no-master' });
        return Promise.resolve({ result: args?.master === window.__vault.master ? 'ok' : 'bad' });
      }
      if (cmd === 'vault_lock') { noteVault(cmd, args); window.__vault.state = 'locked'; return Promise.resolve(null); }
      if (cmd === 'vault_delete' || cmd === 'vault_delete_all') {
        noteVault(cmd, args);
        return Promise.resolve(null);
      }
      if (cmd === 'delegation_list_targets') return Promise.resolve(window.__delegation);
      if (cmd === 'delegation_remove_targets') {
        const aliases = args?.aliases ?? [];
        window.__delegationRemoved.push(...aliases);
        window.__delegation = window.__delegation.filter((t) => !aliases.includes(t.alias));
        return Promise.resolve(aliases.length);
      }
      if (cmd === 'save_settings') {
        // **값이 아니라 모양만** 남긴다 — 설정에는 비밀이 없지만 규칙은 한 벌로 지킨다.
        window.__savedSettings.push(args?.settings?.vault ?? null);
        return Promise.resolve(null);
      }

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

const VK = { Comma: 188, F2: 113, Escape: 27, Enter: 13 };
const key = async (code, modifiers, keyName) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : (VK[code] ?? 0);
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};

const text = async (sel) =>
  await ev(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);

/** 글자로 버튼을 찾아 누른다 (라벨이 곧 계약인 자리들 — [설정…]·[지우기]·[삭제]) */
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

const submitModal = async () =>
  await ev(`(() => {
    const f = document.querySelector('.modal form');
    if (!f) return 'no form';
    f.requestSubmit();
    return 'submitted';
  })()`);

/** 시나리오 하나를 **깨끗한 페이지에서** — 금고 상태는 몇 초 기억되므로 새로고침이 유일한 초기화다 */
const scenario = async (vaultState) => {
  await ev(
    `(() => { localStorage.setItem('__harness_vault', ${JSON.stringify(JSON.stringify(vaultState))}); return 'set'; })()`,
  );
  await send("Page.reload", { ignoreCache: true });
  await sleep(4500);
};

/**
 * 보안의 **들어가기 관문**을 지난다 — 관문 단추를 누르고, 뜬 모달(잠금 해제 `#vault-input` · 마스터 확인
 * `#vault-master-current`)이 있으면 스텁의 맞는 마스터를 넣어 낸다. 값은 찍지 않는다.
 */
const passGate = async () => {
  const kind = await ev(`document.querySelector('.gate')?.dataset.credGate ?? null`);
  if (kind === null) return "no gate";
  await ev(`(() => { document.querySelector('.gate .btn-primary')?.click(); return 'clicked'; })()`);
  await sleep(700);
  const field = await ev(
    `document.querySelector('#vault-input') ? '#vault-input' : document.querySelector('#vault-master-current') ? '#vault-master-current' : null`,
  );
  if (field !== null) {
    await fill(field, "correct-master");
    await submitModal();
    await sleep(900);
  }
  return `${kind} → ${(await ev(`!document.querySelector('.gate')`)) ? "passed" : "still gated"}`;
};

/** 요약의 [관리 ›] 하나를 눌러 그 하위 화면으로 (`#vault-items` · `#delegation-targets` · `#db-ai-targets`) */
const openManage = async (id) => {
  const r = await ev(`(() => { const b = document.getElementById(${JSON.stringify(id)}); if (!b) return 'no button'; b.click(); return 'clicked'; })()`);
  await sleep(500);
  return r;
};

/**
 * 설정 독을 열고 **보안** 칸을 고른다 (예전 라벨은 “자격증명” · id 는 `credentials` 그대로).
 *
 * 볼트는 2026-09-19 밤에 일반의 소제목에서 **자기 섹션**으로 나갔다
 * (docs/log/2026-09-19-vault.md §2). 첫 칸은 여전히 일반이라 내비를 한 번 눌러야 한다.
 */
const openSettings = async () => {
  await key("Comma", 2, ","); // Ctrl+,
  await sleep(1200);
  const opened = await ev(`!!document.querySelector('.settings-view')`);
  if (opened !== true) return opened;
  const picked = await ev(`(() => {
    const b = [...document.querySelectorAll('.settings-nav .nav-item')].find((e) => e.textContent.trim() === '보안');
    if (!b) return 'no nav item';
    b.click();
    return 'clicked';
  })()`);
  await sleep(400);
  return picked === "clicked" ? true : picked;
};

// ═══ ① 볼트가 없다 ═════════════════════════════════════════════════════════
console.log("── ① absent ───────────────────────────────────────────────────");
await scenario({ state: "absent", hasMaster: false });
console.log("settings open:", await openSettings());
// 내비에서 **보안은 맨 아래** 혼자 한 묶음이다 (2026-09-30 — docs/log/2026-09-30-settings-nav-order.md).
console.log(
  "nav labels:",
  await ev(`[...document.querySelectorAll('.settings-nav .nav-item')].map((e) => e.textContent.trim())`),
);
console.log("gate shown:", await ev(`!!document.querySelector('.settings-panel > section:not([hidden]) .gate')`));
console.log("gate passed:", await passGate());
console.log(
  "credentials section visible:",
  await ev(`!!document.querySelector('.settings-panel > section:not([hidden]) #vault-state')`),
);
// 옛 자리(일반 안의 소제목)는 **비어 있어야 한다** — 두 곳에 그려지면 상태가 갈린다.
console.log(
  "no vault subhead in 일반:",
  await ev(`![...document.querySelectorAll('.settings-view .subhead')].some((e) => /볼트/.test(e.textContent))`),
);
console.log("state summary:", JSON.stringify(await text('.vault-state-note')));
// 상태 줄은 글자 안내뿐이다(2026-10-21 — 잠금 = 가림막 하나). 단추는 마스터 줄의 것 하나.
console.log("no lock/unlock button:", await ev(`!document.querySelector('#vault-state')?.closest('.srow')?.querySelector('button')`));
console.log("master button label:", await ev(`document.querySelector('.vault-actions button')?.textContent.trim() ?? null`));
// 자동 잠금 줄은 2026-09-19 저녁에 사라졌다 — 잠그는 시점은 프라이버시 가림막 하나다
// (docs/log/2026-09-19-vault.md 의 "가림막과 함께 잠긴다"). 그 줄이 **없다**는 것이 단언이다.
console.log("no autolock row:", await ev(`!document.querySelector('#vault-autolock')`));
console.log("items summary:", JSON.stringify(await ev(`document.querySelector('#vault-items')?.closest('.srow')?.querySelector('.cred-summary')?.textContent.replace(/\\s+/g,' ').trim() ?? null`)));
console.log("capture:", await shot(`${outdir}/vault-settings.png`));

// [설정…] → 마스터 암호 모달 (금고가 없으므로 현재 칸은 없어야 한다)
console.log("open master modal:", await clickText(".settings-view", "설정…"));
await sleep(500);
console.log("modal title:", JSON.stringify(await text("#vault-master-title")));
console.log("no current field (absent vault):", await ev(`!document.querySelector('#vault-master-current')`));
console.log("new + confirm fields:", await ev(`!!document.querySelector('#vault-master-new') && !!document.querySelector('#vault-master-confirm')`));

// 불일치 — **부르지도 않는다**
await fill("#vault-master-new", "master-one");
await fill("#vault-master-confirm", "master-two");
console.log("submit (mismatch):", await submitModal());
await sleep(400);
console.log("mismatch line:", JSON.stringify(await text(".modal .wrong")));
console.log("still open after mismatch:", await ev(`!!document.querySelector('#vault-master-new')`));
console.log("no vault call yet:", await ev(`window.__vaultCalls.length === 0`));

// 맞춰서 다시 — 금고가 없으므로 `vault_create(master)` 다
await fill("#vault-master-confirm", "master-one");
console.log("submit (match):", await submitModal());
await sleep(900);
console.log("vault calls:", JSON.stringify(await ev(`window.__vaultCalls`)));
console.log("modal closed:", await ev(`!document.querySelector('#vault-master-new')`));
console.log(
  "secret gone from DOM:",
  await ev(`!document.body.innerHTML.includes('master-one') && !JSON.stringify(window.__vaultCalls).includes('master-one')`),
);

// ═══ ② 열림 + 마스터 ═══════════════════════════════════════════════════════
console.log("── ② unlocked + master ────────────────────────────────────────");
await scenario({ state: "unlocked", hasMaster: true });
console.log("settings open:", await openSettings());
console.log("state summary:", JSON.stringify(await text('.vault-state-note')));
console.log("gate passed (master check):", await passGate());
console.log("verify call:", JSON.stringify(await ev(`window.__vaultCalls.filter((c) => c.cmd === 'vault_verify_master')`)));
console.log("state row has no button:", await ev(`!document.querySelector('#vault-state')?.closest('.srow')?.querySelector('button')`));
console.log("open items:", await openManage("vault-items"));
console.log(
  "item rows:",
  await ev(`[...document.querySelectorAll('.cred-list li')].map((li) => li.textContent.replace(/\\s+/g,' ').trim())`),
);

// 줄 하나 삭제 → `vault_delete {kind, target}`
console.log(
  "delete first row:",
  await ev(`(() => {
    const b = document.querySelector('.cred-list li button');
    if (!b) return 'no row';
    b.click();
    return 'clicked';
  })()`),
);
await sleep(900);
console.log("vault calls:", JSON.stringify(await ev(`window.__vaultCalls.filter((c) => c.cmd === 'vault_delete')`)));

// 하위 화면 → 요약(Escape) — [변경…] 은 요약의 마스터 줄에 있다
await key("Escape", 0, "Escape");
await sleep(500);

// [변경…] — 현재 + 새 + 확인
console.log("open change modal:", await clickText(".settings-view", "변경…"));
await sleep(500);
console.log("modal title:", JSON.stringify(await text("#vault-master-title")));
console.log("current field present:", await ev(`!!document.querySelector('#vault-master-current')`));
console.log("focus is in the modal:", await ev(`document.activeElement?.id === 'vault-master-current'`));
await fill("#vault-master-current", "correct-master");
await fill("#vault-master-new", "master-two");
await fill("#vault-master-confirm", "master-two");
console.log("submit:", await submitModal());
await sleep(900);
console.log(
  "set_master call:",
  JSON.stringify(await ev(`window.__vaultCalls.filter((c) => c.cmd === 'vault_set_master')`)),
);
console.log("modal closed:", await ev(`!document.querySelector('#vault-master-new')`));

// ═══ ③ 잠김 ════════════════════════════════════════════════════════════════
console.log("── ③ locked ───────────────────────────────────────────────────");
await scenario({ state: "locked", hasMaster: true });
console.log("settings open:", await openSettings());
console.log("state summary:", JSON.stringify(await text('.vault-state-note')));
// 잠긴 볼트 — 요약 대신 관문 카드(`data-cred-gate="locked"`), 단추는 접속 관문과 **같은** 잠금 해제 모달을 연다
console.log("gate kind:", await ev(`document.querySelector('.gate')?.dataset.credGate ?? null`));
console.log("summary hidden:", await ev(`!document.querySelector('#vault-state')`));
console.log(
  "unlock opens the **same** gate modal:",
  await (async () => {
    await ev(`(() => { document.querySelector('.gate .btn-primary')?.click(); return 'clicked'; })()`);
    await sleep(700);
    return await ev(`!!document.querySelector('#vault-input')`);
  })(),
);
await key("Escape", 0, "Escape");
await sleep(500);
console.log("still gated after cancel:", await ev(`!!document.querySelector('.gate')`));

// ═══ ④ 호스트 목록 표식 · 호스트 폼의 저장된 자격증명 ════════════════════════
console.log("── ④ host list marker + host form ─────────────────────────────");
await scenario({ state: "unlocked", hasMaster: false });
await key("KeyH", 10, "H"); // Ctrl+Shift+H — 호스트 독
await sleep(1200);
console.log(
  "row marker on web-01:",
  await ev(`(() => {
    const el = [...document.querySelectorAll('[data-id]')].find((e) => /web-01/.test(e.textContent || ''));
    if (!el) return 'no row';
    return !!el.querySelector('.vault');
  })()`),
);
console.log(
  "marker tooltip:",
  await ev(`(() => {
    const el = [...document.querySelectorAll('[data-id]')].find((e) => /web-01/.test(e.textContent || ''));
    return el?.querySelector('.vault')?.getAttribute('title') ?? null;
  })()`),
);

// 줄을 고르고 F2 — 수정 폼
console.log(
  "select row:",
  await ev(`(() => {
    const el = [...document.querySelectorAll('[data-id]')].find((e) => /web-01/.test(e.textContent || ''));
    if (!el) return 'no row';
    const b = el.closest('li')?.querySelector('button') ?? el;
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    b.focus?.();
    return 'clicked';
  })()`),
);
await sleep(600);
await key("F2", 0, "F2");
await sleep(1500);
console.log("host form open:", await ev(`!!document.querySelector('#f-identity')`));
console.log("vault row:", JSON.stringify(await text(".vault-row")));
console.log("password line shown:", await ev(`/비밀번호 저장됨/.test(document.querySelector('.vault-row')?.textContent ?? '')`));
// 폼은 칸이 열 몇 개라 이 줄이 화면 밖이다 — 캡처 전에 그 자리로 굴린다.
await ev(`(() => { document.querySelector('.vault-row')?.scrollIntoView({ block: 'center' }); return 'scrolled'; })()`);
await sleep(400);
console.log("capture:", await shot(`${outdir}/vault-host-form.png`));
console.log(
  "clear:",
  await ev(`(() => {
    const b = document.querySelector('.vault-row button');
    if (!b) return 'no button';
    b.click();
    return 'clicked';
  })()`),
);
await sleep(900);
console.log(
  "vault_delete call:",
  JSON.stringify(await ev(`window.__vaultCalls.filter((c) => c.cmd === 'vault_delete')`)),
);

// ═══ ⑤ AI 위임 호스트 표 (2026-09-21 — 관제판의 위임 탭에서 옮겨 왔다) ══════
console.log("── ⑤ AI delegation table ──────────────────────────────────────");
await scenario({ state: "unlocked", hasMaster: false });
console.log("settings open:", await openSettings());
console.log("gate passed (no master):", await passGate());
console.log("hosts summary:", JSON.stringify(await ev(`document.querySelector('#delegation-targets')?.closest('.srow')?.querySelector('.cred-summary')?.textContent.replace(/\\s+/g,' ').trim() ?? null`)));
console.log("open hosts:", await openManage("delegation-targets"));
const delegationRows = async () =>
  await ev(`JSON.stringify([...document.querySelectorAll('.cred-list.grant-list li')].map((li) => ({
    alias: li.querySelector('.target')?.textContent.trim() ?? null,
    grants: [...li.querySelectorAll('.gchip')].map((c) => c.textContent.trim() + (c.classList.contains('on') ? '+' : '-')),
    warn: li.querySelector('.warn')?.textContent.trim() ?? null,
    buttons: [...li.querySelectorAll('button')].map((b) => b.textContent.trim()),
    dim: li.classList.contains('orphan'),
  })))`);
console.log("delegation label:", JSON.stringify(await text(".sub-title")));
console.log("delegation rows:", await delegationRows());
// 칩은 **다섯**이어야 한다 (읽기 · 접속 · 볼트 암호구 · 작업안 · 무인 실행 — 2026-09-22).
console.log("chips per row:", await ev(`JSON.stringify([...document.querySelectorAll('.cred-list.grant-list li')].map((li) => li.querySelectorAll('.gchip').length))`));
console.log("capture:", await shot(`${outdir}/delegation.png`));

// [제거]는 **두 번**이다 — 한 번은 확인(버튼 글자가 그 자리에서 바뀐다), 두 번째가 지운다.
const clickRemove = async (i) =>
  await ev(`(() => {
    const li = document.querySelectorAll('.cred-list.grant-list li')[${i}];
    if (!li) return 'no row';
    const b = [...li.querySelectorAll('button')].pop();
    b.click();
    return b.textContent.trim();
  })()`);
console.log("remove (1st press):", await clickRemove(1));
await sleep(300);
console.log("confirm label:", await ev(`[...document.querySelectorAll('.cred-list.grant-list li')][1]?.querySelector('button:last-of-type')?.textContent.trim() ?? null`));
console.log("not removed yet:", await ev(`window.__delegationRemoved.length === 0`));
console.log("remove (2nd press):", await clickRemove(1));
await sleep(900);
console.log("removed:", JSON.stringify(await ev(`window.__delegationRemoved`)));
console.log("rows after:", await delegationRows());

// [호스트 설정…] — 아는 별칭 줄에만 있고, 폼을 **세션 탭**으로 연다.
console.log("open host settings:", await ev(`(() => {
  const li = document.querySelectorAll('.cred-list.grant-list li')[0];
  const b = [...li.querySelectorAll('button')].find((x) => /호스트 설정/.test(x.textContent));
  if (!b) return 'no button';
  b.click();
  return 'clicked';
})()`));
await sleep(1600);
console.log("host form open:", await ev(`!!document.querySelector('#f-name')`));
// 폼의 왼쪽 내비는 설정 화면과 **같은 컴포넌트**(`settings/SectionNav.svelte`)라 선택 표시도
// 같은 `aria-current="page"` 다. 설정 독이 아직 떠 있으므로 **폼 안의** 내비만 본다.
console.log("on session tab:", await ev(`document.querySelector('.modal .settings-nav .nav-item[aria-current="page"], .host-form .settings-nav .nav-item[aria-current="page"]')?.textContent.trim() ?? [...document.querySelectorAll('.settings-nav .nav-item[aria-current="page"]')].map((b) => b.textContent.trim()).join(',')`));
await key("Escape", 0, "Escape");
await sleep(400);

const exc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0])
  .filter((s) => !/stub:/.test(s))
  .slice(0, 6);
if (exc.length) console.log("EXC", exc);
ws.close();

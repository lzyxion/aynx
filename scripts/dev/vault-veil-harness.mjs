// 헤드리스 검증 — **가림막이 곧 관문이다** (docs/log/2026-09-19-vault.md 의 "가림막이 곧
// 관문"). `vault-harness.mjs`(② 접속 흐름) · `vault-settings-harness.mjs`(③ 화면)의 셋째
// 짝이고, 보는 것은 **잠그는 사건과 걷는 문**이다.
//
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9228 --user-data-dir=%TEMP%/edge-aynx-veil \
//     --window-size=1200,900 http://localhost:1420/
//   node scripts/dev/vault-veil-harness.mjs <outdir> [port]
//
// 만드는 것: <outdir>/veil-gate-uniform.png · <outdir>/veil-gate-master.png
//
// **비밀은 절대 찍지 않는다** — 볼트 명령이 받은 값은 `present`/`empty`/`null`/`absent`
// 넷으로만 기록한다 (`vault-settings-harness.mjs` 의 같은 줄). 여기서 `null` 과 `empty` 를
// 굳이 가르는 이유가 이 판의 전부다: 마스터 없는 볼트는 **`master: null`** 로 열려야 하고
// (빈 문자열이면 백엔드에서 "틀린 마스터" 가 된다), 그 차이를 이 기록이 본다.
//
// 이 판에서 달라진 단언 셋 (옛 판은 "아무 키로 걷어도 잠긴 채" 를 봤다):
//   ① 아무 키(`a`)로는 **걷히지 않는다** — 걷는 문은 관문 하나다.
//   ② 떠 있는 가림막은 `Ctrl+Shift+B` 로도 꺼지지 않는다.
//   ③ 걷는 순간 **볼트가 열린다** — 그래서 이어지는 접속에 관문이 서지 않는다.
//
// 되먹임 판(2026-09-19 밤, `Veil.svelte` 머리말의 "관문의 꼴은 하나다")에서 더 보는 것:
//   ④ **세 경우 모두 `#veil-input` 이 선다** — 마스터가 없어도, 볼트가 없어도.
//   ⑤ 마스터 없는 꼴에서 **빈 값만이 답이다** — `x` 를 치면 같은 "맞지 않습니다" 줄이 서고
//      `vault_unlock` 은 **나가지 않는다**.
//   ⑥ 틀린 뒤에는 **칸이 비고 커서가 칸으로 돌아온다**(세 꼴 공통).
//   ⑦ **Escape 는 어느 꼴에서도 걷지 않는다** (옛 판은 마스터가 없을 때 걷었다).
//
// 둘째 되먹임(같은 날 밤 — "화면은 마스터의 있고 없음을 말하지 않는다"):
//   ⑧ **곁말이 없다** — "… 비워 두고 Enter" 줄(`.hint`)은 세 꼴 어디에도 서지 않는다.
//      그 줄은 잠긴 화면을 들여다본 바깥 사람에게 "빈 Enter 로 열린다" 를 알려 줬다.
//   ⑨ **카드의 `outerHTML` 이 두 꼴에서 글자까지 같다** — ①(마스터 없음)과 ②(마스터 있음)의
//      `.veil .card` 를 받아 두었다가 맞대 본다. 시계(`HH:MM`)처럼 시간이 흐르며 달라지는
//      값만 고르게 덮고 비교한다. 이 단언이 이 판의 **전부**다: 클래스·`data-*`·`disabled`·
//      `placeholder`·`aria-describedby` 무엇도 갈리면 안 된다.
//   ⑩ 설정 쪽 `vault-unlock` 모달도 **같은 한 폼**이다(칸 + [열기]), 칸 없는 안내 줄 없음.
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

  // ── 하네스가 갈아 끼우는 볼트 상태 (시나리오마다 새로고침으로 초기화) ────────
  const wanted = (() => {
    try { return JSON.parse(localStorage.getItem('__harness_vault') || 'null'); } catch { return null; }
  })();
  window.__vault = wanted ?? { state: 'unlocked', hasMaster: false };
  window.__vault.master = 'correct-master';

  // 볼트 명령이 받은 **모양**만 적는다 — 값은 넷 중 하나로만 남는다.
  window.__vaultCalls = [];
  const has = (v) =>
    typeof v === 'string' ? (v.length > 0 ? 'present' : 'empty') : (v === null ? 'null' : 'absent');
  const noteVault = (cmd, args) => {
    window.__vaultCalls.push({ cmd, master: has(args?.master) });
  };

  window.__sshCalls = [];

  const answers = {
    list_hosts: {hosts:[{name:'web-01', host_name:'10.0.0.9', user:'deploy', port:22}],warnings:[]},
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [], load_settings: null,
    agent_status: { pipe_alive: true, key_count: 0 }, agent_has_key: false,
    list_ssh_key_files: [], delegation_summary: null,
    session_info: {
      server_version: 'OpenSSH_9.6p1', auth_method: 'password_vault', identity: null,
      identity_stored: false,
      jump: null, connected_at_ms: Date.now(), keepalive_secs: 30, rtt_ms: 12,
    },
  };

  const VAULT_ITEMS = [{ kind: 'host_password', target: 'web-01' }];

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
        if (window.__vault.state === 'locked') return Promise.reject('[vault-locked] 볼트가 잠겨 있습니다');
        if (window.__vault.state === 'absent') return Promise.reject('[vault-absent] 볼트가 없습니다');
        return Promise.resolve(VAULT_ITEMS);
      }
      if (cmd === 'vault_has_password') return Promise.resolve(window.__vault.state === 'unlocked');
      if (cmd === 'vault_has_passphrase') return Promise.resolve(false);
      if (cmd === 'vault_lock') {
        noteVault(cmd, args);
        // **없는 볼트는 잠겨도 여전히 없다** — 백엔드의 \`vault_status\` 도 그렇게 답한다
        // (상태가 \`Locked\` 여도 봉투 파일이 없으면 ABSENT 다).
        if (window.__vault.state !== 'absent') window.__vault.state = 'locked';
        return Promise.resolve(null);
      }
      if (cmd === 'vault_unlock') {
        noteVault(cmd, args);
        if (window.__vault.state === 'absent') return Promise.reject('[vault-absent] 볼트가 없습니다');
        // 백엔드와 같은 규칙: 마스터가 걸린 볼트만 값을 본다(열려 있어도 본다 — 봉투에
        // 맞춰 보기 때문이다). 마스터가 없으면 **무엇이 오든** 열린다(확인 관문이다).
        if (window.__vault.hasMaster && args?.master !== window.__vault.master) {
          return Promise.reject('[vault-wrong-master] 볼트를 열지 못했습니다');
        }
        window.__vault.state = 'unlocked';
        return Promise.resolve(null);
      }
      if (cmd === 'vault_delete' || cmd === 'vault_delete_all' || cmd === 'vault_set_master' || cmd === 'vault_create') {
        noteVault(cmd, args);
        return Promise.resolve(null);
      }
      if (cmd === 'save_settings') return Promise.resolve(null);

      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'open_ssh_session') {
        // 볼트가 열려 있으면 담아 둔 비밀번호로 붙은 셈 친다(모달 없음) — 이 하네스가
        // 재는 것은 "관문이 언제 서는가" 이지 인증 그 자체가 아니다.
        window.__sshCalls.push({ vault: window.__vault.state });
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
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });

const VK = { Comma: 188, Escape: 27, Enter: 13, Space: 32 };
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

const openHost = async () =>
  await ev(`(() => {
    const el = [...document.querySelectorAll('[data-id]')].find((e) => /web-01/.test(e.textContent || ''));
    if (!el) return 'no row';
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'clicked';
  })()`);

/** 시나리오 하나를 **깨끗한 페이지에서** — 볼트 상태는 몇 초 기억되므로 새로고침이 유일한 초기화다 */
const scenario = async (vaultState) => {
  await ev(
    `(() => { localStorage.setItem('__harness_vault', ${JSON.stringify(JSON.stringify(vaultState))}); return 'set'; })()`,
  );
  await send("Page.reload", { ignoreCache: true });
  await sleep(4500);
};

/** 가림막을 켠다 — `toggle-veil`(기본 `Ctrl+Shift+B`). 무입력 자동 가림도 **같은 문**을 지난다 */
const raiseVeil = async () => {
  await key("KeyB", 10, "B"); // Ctrl+Shift+B
  await sleep(900);
  return await ev(`!!document.querySelector('.veil')`);
};

const veilUp = async () => await ev(`!!document.querySelector('.veil')`);
const unlockCalls = async () =>
  JSON.stringify(await ev(`window.__vaultCalls.filter((c) => c.cmd === 'vault_unlock')`));

/**
 * 관문 카드의 **DOM 그 자체** — ⑨의 맞댐에 쓴다.
 *
 * 시계만 덮는다(`HH:MM` → `__CLOCK__`). 그 밖에는 **한 글자도 손대지 않는다** — 손대는 만큼
 * 이 단언이 보는 것이 줄어든다. 두 시나리오는 같은 스텁·같은 빈 위임 목록을 보므로 나머지는
 * 모두 결정적이다.
 */
const cardHtml = async () =>
  await ev(`(() => {
    const el = document.querySelector('.veil .card');
    if (!el) return null;
    return el.outerHTML.replace(/>\\s*\\d{2}:\\d{2}\\s*</g, '>__CLOCK__<');
  })()`);

/** 두 꼴의 카드를 맞대 **첫 다른 곳**을 짚는다 (같으면 `"identical"`) */
const diffCards = (a, b) => {
  if (a === null || b === null) return `missing card (a=${a === null}, b=${b === null})`;
  if (a === b) return "identical";
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return `DIFFERS at ${i}: …${a.slice(Math.max(0, i - 60), i + 60)}… vs …${b.slice(Math.max(0, i - 60), i + 60)}…`;
};

/** ①·②의 카드를 담아 두었다가 ②의 끝에서 맞댄다 (⑨) */
let cardNoMaster = null;
let cardMaster = null;

// ═══ ① 마스터 없는 볼트 — **같은 폼**이 서고, 빈 값만이 답이다 ═══════════════
console.log("── ① no master: same form, only the empty value opens ──────────");
await scenario({ state: "unlocked", hasMaster: false });

console.log("veil up:", await raiseVeil());
console.log(
  "vault_lock called once:",
  JSON.stringify(await ev(`window.__vaultCalls.filter((c) => c.cmd === 'vault_lock')`)),
);
console.log("vault now locked:", await ev(`window.__vault.state`));

console.log("lock icon:", await ev(`!!document.querySelector('.veil .lock svg')`));
console.log("heading:", JSON.stringify(await text(".veil .heading")));
console.log("sub:", JSON.stringify(await text(".veil .sub")));
// ④ 마스터가 없어도 칸은 선다 — 라벨도 마스터 꼴과 **같은 글자**다.
console.log("password field:", await ev(`!!document.querySelector('#veil-input')`));
console.log("field is a password input:", await ev(`document.querySelector('#veil-input')?.type`));
console.log("label:", JSON.stringify(await text('.veil label[for="veil-input"]')));
// ⑧ 곁말은 **없다** — 마스터가 없다는 사실이 화면에 적히지 않는다.
console.log("no hint element:", await ev(`!document.querySelector('.veil .hint')`));
console.log(
  "no 'leave it empty' wording:",
  await ev(`!/비워 두고|leave it empty/.test(document.querySelector('.veil')?.textContent || '')`),
);
console.log("focus in the field:", await ev(`document.activeElement?.id === 'veil-input'`));
// ⑨ 이 꼴의 카드를 담아 둔다 — ②의 카드와 맞댄다.
cardNoMaster = await cardHtml();
console.log("capture:", await shot(`${outdir}/veil-gate-uniform.png`));

// 아무 키(`a`)는 **아무 일도 하지 않는다** — 옛 판의 "아무 키·클릭에 해제" 가 사라진 자리다.
// (`text` 없이 보내는 키라 칸에도 찍히지 않는다. 그래도 다음 단언이 빈 칸을 전제하므로
//  아래에서 한 번 비워 두고 간다.)
await key("KeyA", 0, "a");
console.log("still up after a random key:", await veilUp());
console.log("no vault_unlock yet:", await unlockCalls());
await fill("#veil-input", "");

// ⑦ Escape 는 이 꼴에서도 걷지 않는다 (옛 판은 여기서 걷었다).
await key("Escape", 0, "Escape");
await sleep(600);
console.log("still up after Escape:", await veilUp());
console.log("still no vault_unlock:", await unlockCalls());

// ⑤ 빈 값이 아니면 **틀린 것이다** — 같은 줄이 서고 명령은 나가지 않는다.
await fill("#veil-input", "x");
await key("Enter", 0, "Enter");
await sleep(900);
console.log("wrong line:", JSON.stringify(await text(".veil .wrong")));
console.log("veil still up:", await veilUp());
console.log("still no vault_unlock:", await unlockCalls());
// ⑥ 칸은 비고 커서는 칸으로 돌아온다 — 마우스 없이 곧바로 다시 친다.
console.log("field emptied:", await ev(`document.querySelector('#veil-input')?.value === ''`));
console.log("focus back in the field:", await ev(`document.activeElement?.id === 'veil-input'`));

// 비운 채 Enter → `vault_unlock{master:null}` → 걷힌다. **`empty` 가 아니라 `null` 이다**(머리말).
await key("Enter", 0, "Enter");
await sleep(1200);
console.log("vault_unlock args:", await unlockCalls());
console.log("veil gone:", await ev(`!document.querySelector('.veil')`));
console.log("vault now:", await ev(`window.__vault.state`));

// 걷는 것이 곧 여는 것이라, 이어지는 접속에는 **관문이 서지 않는다**.
await key("KeyH", 10, "H"); // Ctrl+Shift+H — 호스트 독
await sleep(900);
console.log("open host:", await openHost());
await sleep(1600);
console.log("no unlock modal:", await ev(`!document.querySelector('.modal [id="vault-title"]')`));
console.log("ssh proceeded:", JSON.stringify(await ev(`window.__sshCalls`)));

// ═══ ② 마스터가 걸린 볼트 — 칸이 서고, 틀리면 줄만 서고 가림막은 남는다 ═════════
console.log("── ② with master: field, wrong line, Ctrl+Shift+B cannot close ──");
await scenario({ state: "unlocked", hasMaster: true });

console.log("veil up:", await raiseVeil());
console.log("vault locked:", await ev(`window.__vault.state === 'locked'`));
console.log("lock icon:", await ev(`!!document.querySelector('.veil .lock svg')`));
console.log("password field:", await ev(`!!document.querySelector('#veil-input')`));
console.log("field is a password input:", await ev(`document.querySelector('#veil-input')?.type`));
console.log("no hint element:", await ev(`!document.querySelector('.veil .hint')`));
console.log("focus in the field:", await ev(`document.activeElement?.id === 'veil-input'`));
console.log("capture:", await shot(`${outdir}/veil-gate-master.png`));

// ⑨ **이 판의 전부** — 두 꼴의 카드가 글자까지 같다(시계만 덮었다).
cardMaster = await cardHtml();
console.log("card outerHTML nomaster vs master:", diffCards(cardNoMaster, cardMaster));

await fill("#veil-input", "wrong-master");
await key("Enter", 0, "Enter");
await sleep(1200);
console.log("wrong line:", JSON.stringify(await text(".veil .wrong")));
console.log("veil still up:", await veilUp());
console.log("field still there:", await ev(`!!document.querySelector('#veil-input')`));
// ⑥ 여기서도 칸은 비고 커서는 칸에 있다.
console.log("field emptied:", await ev(`document.querySelector('#veil-input')?.value === ''`));
console.log("focus back in the field:", await ev(`document.activeElement === document.querySelector('#veil-input')`));
console.log("no bracket code on screen:", await ev(`!/\\[vault-/.test(document.body.textContent || '')`));
console.log("vault still locked:", await ev(`window.__vault.state === 'locked'`));

// 떠 있는 가림막은 **그 키로도 꺼지지 않는다** — 걷는 문은 관문 하나다.
await key("KeyB", 10, "B");
await sleep(600);
console.log("still up after Ctrl+Shift+B:", await veilUp());
// Escape 도 마찬가지다 (마스터가 걸려 있으면 칠 것이 있는 관문이다).
await key("Escape", 0, "Escape");
await sleep(600);
console.log("still up after Escape:", await veilUp());

await fill("#veil-input", "correct-master");
await key("Enter", 0, "Enter");
await sleep(1200);
console.log("vault_unlock args:", await unlockCalls());
console.log("veil gone:", await ev(`!document.querySelector('.veil')`));
console.log("vault now:", await ev(`window.__vault.state`));
console.log(
  "secret gone from DOM and log:",
  await ev(`!document.body.innerHTML.includes('correct-master') && !JSON.stringify(window.__vaultCalls).includes('correct-master')`),
);

// ═══ ③ 볼트가 아예 없는 사람 — 폼은 같고, 잠근 것이 없으니 **부를 명령도 없다** ═══
console.log("── ③ no vault at all: same form, empty Enter clears it ─────────");
await scenario({ state: "absent", hasMaster: false });

console.log("veil up:", await raiseVeil());
console.log("still absent:", await ev(`window.__vault.state === 'absent'`));
// ④ 볼트가 없어도 칸이 선다 — ⑧ 여기서도 곁말은 없다(볼트의 있고 없음도 화면에 없다).
console.log("password field:", await ev(`!!document.querySelector('#veil-input')`));
console.log("label:", JSON.stringify(await text('.veil label[for="veil-input"]')));
console.log("no hint element:", await ev(`!document.querySelector('.veil .hint')`));
console.log("card matches the master form:", diffCards(await cardHtml(), cardMaster));
console.log("focus in the field:", await ev(`document.activeElement?.id === 'veil-input'`));

// ⑦ 여기서도 Escape 는 걷지 않는다.
await key("Escape", 0, "Escape");
await sleep(600);
console.log("still up after Escape:", await veilUp());

// ⑤ 볼트가 없어도 무언가 친 값은 틀린 값이다 — 줄이 서고, 칸이 비고, 커서가 돌아온다.
await fill("#veil-input", "x");
await key("Enter", 0, "Enter");
await sleep(900);
console.log("wrong line:", JSON.stringify(await text(".veil .wrong")));
console.log("veil still up:", await veilUp());
console.log("field emptied:", await ev(`document.querySelector('#veil-input')?.value === ''`));
console.log("focus back in the field:", await ev(`document.activeElement?.id === 'veil-input'`));

await key("Enter", 0, "Enter");
await sleep(1200);
console.log("veil gone:", await ev(`!document.querySelector('.veil')`));
// 열 것이 없으므로 **`vault_unlock` 을 부르지 않는다** (부르면 `[vault-absent]` 로 거절당하고
// 걷히지 않는 화면이 남는다).
console.log("no vault_unlock call:", await unlockCalls());

// ═══ ④ 가림막 밖의 관문은 그대로다 — 설정 › [잠그기] → [잠금 해제…] 모달 ═══════
console.log("── ④ the separate unlock modal still stands (settings) ─────────");
await scenario({ state: "unlocked", hasMaster: false });
await key("Comma", 2, ","); // Ctrl+,
await sleep(1400);

console.log("settings open:", await ev(`!!document.querySelector('.settings-view')`));
console.log("press lock:", await clickText(".settings-view", "잠그기"));
await sleep(1200);
console.log("state summary now:", JSON.stringify(await text('.vault-state-note')));
console.log("press unlock:", await clickText(".settings-view", "잠금 해제…"));
await sleep(900);
// ⑩ 마스터가 없어도 **칸이 선다** — 칸 없는 "Enter 로 엽니다" 줄은 사라졌다.
console.log("field stands:", await ev(`!!document.querySelector('#vault-input')`));
console.log("no hint line:", await ev(`!document.querySelector('.modal .nomaster')`));
console.log(
  "no 'no master password' wording:",
  await ev(`!/마스터 암호가 없습니다|no master password/i.test(document.querySelector('.modal')?.textContent || '')`),
);
console.log("lead:", JSON.stringify(await text(".modal .lead")));
console.log("focus in the field:", await ev(`document.activeElement?.id === 'vault-input'`));
// 빈 값만이 답이다 — 무언가 치면 같은 줄이 서고 `vault_unlock` 은 나가지 않는다.
//
// 여기서는 Enter 대신 **[열기] 를 누른다**: 이 모달은 가림막과 달리 제 keydown 리스너가
// 없고 브라우저의 **암묵적 폼 제출**에 기댄다. CDP 의 `Input.dispatchKeyEvent` 는 `text`
// 없이는 `keypress` 를 만들지 않아 그 길이 헤드리스에서 서지 않는다(실기에서는 선다).
// 재는 것은 **받아들이는 값의 규칙**이지 키 배선이 아니므로 같은 문(`submitVaultUnlock`)을
// 버튼으로 지난다.
const unlockCountBefore = await ev(`window.__vaultCalls.filter((c) => c.cmd === 'vault_unlock').length`);
await fill("#vault-input", "x");
await clickText(".modal", "열기");
await sleep(900);
console.log("wrong line:", JSON.stringify(await text(".modal .wrong")));
console.log("modal still up:", await ev(`!!document.querySelector('.modal [id="vault-title"]')`));
console.log("field emptied:", await ev(`document.querySelector('#vault-input')?.value === ''`));
console.log(
  "no vault_unlock sent:",
  (await ev(`window.__vaultCalls.filter((c) => c.cmd === 'vault_unlock').length`)) === unlockCountBefore,
);
// 비운 채 [열기] → `vault_unlock{master:null}` → 모달이 닫힌다. **`empty` 가 아니라 `null`**.
await clickText(".modal", "열기");
await sleep(1200);
console.log("vault_unlock args:", await unlockCalls());
console.log("modal gone:", await ev(`!document.querySelector('.modal [id="vault-title"]')`));

const exc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0])
  .filter((s) => !/stub:/.test(s))
  .slice(0, 6);
if (exc.length) console.log("EXC", exc);
ws.close();

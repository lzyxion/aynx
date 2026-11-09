// AYNX 원격 창 폴리필(R1a-3 — 설계 14.3) — 관문이 앱 셸(index.html)의 **첫 스크립트**로 끼운다(`/remote/polyfill.js`).
//
// 같은 앱 번들이 브라우저에서 돌도록 `window.__TAURI_INTERNALS__` 를 세운다 — `@tauri-apps/api/{core,event,window,webview,app,path}` 와
// 플러그인 JS 는 이 표면만 쓰므로 **호출부를 고치지 않고** 관문의 ws(`/remote/ws`)로 간다. `window.__AYNX_REMOTE__ = true` 가
// 프런트의 `isRemote`(`src/lib/ipc.ts`)다.
//
// - 창 라벨·부팅 표는 관문이 같은 HTML 의 `<meta name="aynx-remote">` 에 싣는다(동기로 읽힌다 — 앱 모듈이 뜨기 전에
//   `getCurrentWindow().label` 이 맞아야 한다). invoke 는 ws 의 `hello` 가 오기 전까지 줄에 쌓였다가 그 뒤 나간다.
// - 프레임 모양은 `src-tauri/src/remote/frames.rs` 머리말. Channel 은 이진 프레임 `[1][세대][콜백][순번][종류][본문]` — 세대가
//   다르면 버린다. 순서는 `@tauri-apps/api` 의 `Channel` 이 순번으로 다시 세운다.
// - 연결이 끊기면 **페이지를 다시 읽는다** — 라벨이 페이지 수명과 같다(새 연결 = 새 숨은 창). 세션이 끝났으면 관문이
//   잠금 해제 쪽을 낸다.
// - 플러그인 명령은 여기서 가른다(아래 `PLUGINS` 표): 브라우저로 대신하거나 · 무해한 흉내 · "원격에서 지원하지 않음" 거절 ·
//   그대로 관문(`event` 의 emit · `path` — `capabilities/remote.json` 이 연다). 표에 없는 `plugin:*` 는 거절하고 콘솔에 남긴다.
// - 앱 명령의 문은 관문(`remote/deny.rs` — 집 PC 전용 · 재확인 · 미지원 · 허용)이다. 여기서 하는 것은 둘뿐이다:
//   (1) **재확인**(R1a-4): 부팅 표의 `reauth` 명령은 보내기 전에 `POST /remote/reauth {cmd, password?}` 로 1회용 표를 받아 프레임의
//   `reauth` 에 싣는다. 마스터가 없으면 관문이 곧바로 표를 주고, 있으면 암호 칸이 뜬다. R4 부터 칸·확인은 **앱 모달**
//   (`window.__AYNX_REMOTE_UI__` — 앱이 부팅에서 건다 · 마스터가 없으면 확인 단추만)이고, 앱이 뜨기 전에만 이 파일의 작은 칸.
//   **암호는 그 HTTP 몸으로만 간다** — ws 프레임에 싣지 않는다. 앱 프런트는 `window.__AYNX_REMOTE_REAUTH__(이름)` 으로 같은
//   확인을 부를 수 있다(로컬 타일 "AI 읽기 허용" 켜기 — `ipc.ts` 의 `confirmRemoteMaster`). 묻기(`plugin:dialog|message`)도
//   손잡이가 있으면 앱 모달로 간다(R4 — 브라우저 `confirm` 대신).
//   (2) `NOOP` 명령(관문이 "원격 미지원" 으로 거절하는 것 중 브라우저에선 "아무것도 안 함" 이 맞는 것)은 보내지 않고 `null`.
//
// 앱 모듈을 부르지 않는 잎이다(빌드를 거치지 않는 그대로의 파일 — CSP `script-src 'self'`).
"use strict";
(() => {
  const meta = document.querySelector('meta[name="aynx-remote"]');
  if (!meta) return;
  let boot;
  try {
    boot = JSON.parse(meta.getAttribute("content") || "{}");
  } catch {
    return;
  }
  meta.remove(); // 부팅 표는 한 번 쓰면 끝 — DOM 에 남기지 않는다
  const LABEL = String(boot.label || "");
  const GEN = Number(boot.gen) >>> 0;
  // 이 파일 자신의 문구 언어 — 앱 모듈이 뜨기 전에는 관문이 실은 집 PC 의 앱 언어(`boot.lang`), 뜬 뒤에는 앱이 적는
  // `<html lang>`(`i18n.svelte.ts` 의 `setLocale` — 원격에서 언어를 바꿔도 따라간다). 셸의 처음 `lang` 은 고정값이라 보지 않는다.
  let lang = boot.lang === "en" ? "en" : "ko";
  new MutationObserver(() => {
    const l = document.documentElement.lang;
    if (l === "en" || l === "ko") lang = l;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  /** `[한국어, English]` 둘 중 지금 언어 쪽 */
  const L = (pair) => (lang === "en" ? pair[1] : pair[0]);
  const UNSUPPORTED = ["원격에서는 할 수 없습니다", "Not available in the remote client"];
  const CLOSED = ["원격 연결이 끊겼습니다", "The remote connection was closed"];
  const CANCELLED = ["마스터 암호 확인을 취소했습니다", "Master password check cancelled"];
  // 거절 문구의 사람 말 이름(R1a-5) — 명령 이름 대신.
  const PLUGIN_LABEL = {
    "plugin:opener|open_path": ["메인 PC 에서 파일 열기", "Open a file on the main PC"],
    "plugin:opener|reveal_item_in_dir": ["탐색기에서 보기", "Show in File Explorer"],
    "plugin:dialog|open": ["파일·폴더 고르기", "Choose a file or folder"],
    "plugin:dialog|save": ["저장 위치 고르기", "Choose where to save"],
    "plugin:drag|start_drag": ["탐색기로 끌어내기", "Drag out to File Explorer"],
  };
  // 재확인 칸에 보일 사람 말(R1a-5) — 표에 없으면 받은 글자 그대로(`confirmRemoteMaster(what)` 의 화면 이름 포함).
  const REAUTH_LABEL = {
    approve_operation: ["작업안 승인", "Approve a task plan"],
    modify_operation_targets: ["작업안 대상 고치기", "Change task plan targets"],
    delegation_set_target: ["호스트의 AI 권한 바꾸기", "Change a host's AI permission"],
    db_ai_set: ["DB 연결의 AI 권한 바꾸기", "Change a DB connection's AI permission"],
    orchestration_approve_verify: ["오케스트레이션 검증 실행", "Run orchestration verification"],
    orchestration_override_verify: ["오케스트레이션 검증 실패 덮어쓰기", "Override a failed orchestration verification"],
    orchestration_delete_archived: ["보관한 앨범 영구 삭제", "Permanently delete an archived album"],
  };
  const unsupportedFor = (cmd) => `${L(UNSUPPORTED)} — ${PLUGIN_LABEL[cmd] ? L(PLUGIN_LABEL[cmd]) : cmd}`;
  // 재확인 명령(관문 `deny.rs` 의 REAUTH — 부팅 표로 온다).
  const REAUTH = new Set(Array.isArray(boot.reauth) ? boot.reauth.map(String) : []);
  // 관문이 "원격 미지원" 으로 거절하는 것 중 브라우저에서 "아무것도 안 함" 이 맞는 것(창 조작 흉내와 같은 결) — 보내지 않고 null.
  // 이름은 모두 `deny.rs` 의 UNSUPPORTED 여야 한다(시험 `polyfill_noops_are_unsupported`).
  const NOOP = new Set(["set_app_icon", "focus_window", "take_tray_intent"]);

  // ── 콜백 표 (transformCallback) ──
  const callbacks = new Map();
  let nextCallback = 1;
  function transformCallback(callback, once = false) {
    const id = nextCallback++;
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      return callback && callback(data);
    });
    return id;
  }
  function unregisterCallback(id) {
    callbacks.delete(id);
  }
  function runCallback(id, data) {
    const cb = callbacks.get(id);
    if (cb) cb(data);
  }
  // listen 이 돌려준 eventId → 그 핸들러 콜백(unregisterListener 가 걷는다).
  const listenerCallbacks = new Map();

  // ── ws ──
  let ws = null;
  let ready = false;
  let version = null;
  const versionWaiters = [];
  const queue = [];
  const pending = new Map();
  let nextId = 1;
  let reloading = false;

  function reloadSoon(ms) {
    if (reloading) return;
    reloading = true;
    for (const p of pending.values()) p.reject(L(CLOSED));
    pending.clear();
    setTimeout(() => location.reload(), ms);
  }

  function send(frame) {
    if (ready && ws && ws.readyState === 1) ws.send(frame);
    else queue.push(frame);
  }

  function connect() {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${scheme}://${location.host}/remote/ws?t=${encodeURIComponent(String(boot.ticket || ""))}`);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev) => (typeof ev.data === "string" ? onText(ev.data) : onBinary(ev.data));
    ws.onclose = () => reloadSoon(ready ? 1500 : 4000);
    ws.onerror = () => {};
  }

  function onText(text) {
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    switch (m.t) {
      case "hello":
        version = m.version;
        for (const w of versionWaiters.splice(0)) w(version);
        ready = true;
        for (const f of queue.splice(0)) ws.send(f);
        break;
      case "res": {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        if (m.ok) p.resolve(m.b);
        else p.reject(m.b);
        break;
      }
      case "event":
        runCallback(m.h, { event: m.e, id: m.i, payload: m.p });
        break;
      case "bye":
        console.warn("[remote] 관문이 연결을 닫습니다:", m.reason);
        break;
    }
  }

  const decoder = new TextDecoder();
  function onBinary(buf) {
    const v = new DataView(buf);
    const kind = v.getUint8(0);
    if (kind === 1) {
      if (v.getUint32(1, true) !== GEN) return; // 옛 연결의 늦은 메시지
      const cb = v.getUint32(5, true);
      const index = v.getUint32(9, true);
      const raw = v.getUint8(13) === 1;
      const body = buf.slice(14);
      let message;
      try {
        message = raw ? body : JSON.parse(decoder.decode(body));
      } catch {
        return;
      }
      runCallback(cb, { message, index });
    } else if (kind === 2) {
      const id = v.getUint32(1, true);
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      p.resolve(buf.slice(5));
    }
  }

  // `__TAURI_TO_IPC_KEY__` 를 가진 값(Channel 등)은 그 직렬화로 — tauri 의 processIpcMessage 와 같은 규칙.
  function replacer(_key, value) {
    if (value && typeof value === "object" && typeof value.__TAURI_TO_IPC_KEY__ === "function") {
      return value.__TAURI_TO_IPC_KEY__();
    }
    return value;
  }

  function headersObject(options) {
    const out = {};
    const h = options && options.headers;
    if (!h) return out;
    const entries = typeof h.entries === "function" && !Array.isArray(h) ? Array.from(h.entries()) : Array.isArray(h) ? h : Object.entries(h);
    for (const [k, val] of entries) out[k] = String(val);
    return out;
  }

  function call(frameFor) {
    return new Promise((resolve, reject) => {
      if (reloading) return reject(L(CLOSED));
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send(frameFor(id));
    });
  }

  function remoteInvoke(cmd, args, options, reauth) {
    const raw = args instanceof ArrayBuffer ? new Uint8Array(args) : ArrayBuffer.isView(args) ? new Uint8Array(args.buffer, args.byteOffset, args.byteLength) : null;
    if (raw) {
      return call((id) => {
        const head = new TextEncoder().encode(JSON.stringify({ cmd, headers: headersObject(options) }));
        const out = new Uint8Array(9 + head.length + raw.length);
        const dv = new DataView(out.buffer);
        out[0] = 3;
        dv.setUint32(1, id, true);
        dv.setUint32(5, head.length, true);
        out.set(head, 9);
        out.set(raw, 9 + head.length);
        return out.buffer;
      });
    }
    const json = JSON.stringify(args === undefined ? {} : args, replacer);
    const extra = reauth ? `,"reauth":${JSON.stringify(reauth)}` : "";
    return call((id) => `{"t":"invoke","id":${id},"cmd":${JSON.stringify(cmd)},"args":${json},"headers":${JSON.stringify(headersObject(options))}${extra}}`);
  }

  // ── 재확인(R1a-4) ──
  // 한 번에 하나 — 칸이 떠 있는 동안 온 다른 재확인은 그 뒤에 선다.
  let reauthChain = Promise.resolve();

  async function postReauth(body) {
    let res;
    try {
      res = await fetch("/remote/reauth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return { status: 0, data: {} };
    }
    let data = {};
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, data };
  }

  function reauthFailure(r) {
    if (r.status === 429) {
      const s = Math.ceil((Number(r.data.retryAfterMs) || 0) / 1000);
      return L([`잠시 뒤 다시 하세요 (${s}초)`, `Try again in a moment (${s}s)`]);
    }
    if (r.status === 401 && r.data.error === "session") return L(["원격 세션이 끝났습니다 — 다시 여세요", "The remote session has ended — open it again"]);
    if (r.status === 401) return L(["마스터 암호가 맞지 않습니다", "Wrong master password"]);
    return L(["마스터 암호를 확인하지 못했습니다", "Couldn't check the master password"]);
  }

  // 작은 암호 칸 — 인라인 스크립트·스타일 없이(DOM + CSSOM). 앱의 단축키가 가로채지 않게 키 이벤트는 여기서 멈춘다.
  function askMaster(cmd) {
    return new Promise((resolve, reject) => {
      const veil = document.createElement("div");
      Object.assign(veil.style, {
        position: "fixed", inset: "0", zIndex: "2147483647", display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,.45)", font: "14px system-ui, sans-serif",
      });
      const box = document.createElement("form");
      Object.assign(box.style, {
        background: "#1e1f24", color: "#e8e8ea", padding: "20px", borderRadius: "10px", width: "min(360px, calc(100vw - 32px))",
        boxShadow: "0 12px 40px rgba(0,0,0,.4)", display: "flex", flexDirection: "column", gap: "10px",
      });
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      const title = document.createElement("strong");
      title.textContent = L(["마스터 암호 확인", "Confirm master password"]);
      const lead = document.createElement("div");
      lead.textContent = L([
        "원격에서 이 일을 하려면 메인 PC 볼트의 마스터 암호를 다시 확인합니다.",
        "To do this remotely, confirm the master password of the main PC's vault again.",
      ]);
      lead.style.opacity = "0.8";
      const what = document.createElement("code");
      what.textContent = REAUTH_LABEL[cmd] ? L(REAUTH_LABEL[cmd]) : cmd;
      what.style.opacity = "0.6";
      const input = document.createElement("input");
      input.type = "password";
      input.autocomplete = "current-password";
      input.maxLength = 1024;
      input.setAttribute("aria-label", L(["마스터 암호", "Master password"]));
      Object.assign(input.style, {
        padding: "8px", borderRadius: "6px", border: "1px solid #444", background: "#111216", color: "inherit", font: "inherit",
      });
      const msg = document.createElement("div");
      msg.setAttribute("role", "status");
      msg.style.color = "#ff8a80";
      msg.style.minHeight = "1.2em";
      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", gap: "8px", justifyContent: "flex-end" });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = L(["취소", "Cancel"]);
      const ok = document.createElement("button");
      ok.type = "submit";
      ok.textContent = L(["확인", "OK"]);
      for (const b of [cancel, ok]) Object.assign(b.style, { padding: "6px 14px", borderRadius: "6px", border: "1px solid #555", background: "#2b2d34", color: "inherit", font: "inherit" });
      row.append(cancel, ok);
      box.append(title, lead, what, input, msg, row);
      veil.append(box);
      const done = (fn) => {
        input.value = "";
        veil.remove();
        fn();
      };
      for (const type of ["keydown", "keyup", "keypress"]) {
        veil.addEventListener(type, (e) => {
          if (type === "keydown" && e.key === "Escape") done(() => reject(L(CANCELLED)));
          e.stopPropagation();
        });
      }
      cancel.addEventListener("click", () => done(() => reject(L(CANCELLED))));
      box.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!input.value) return;
        ok.disabled = true;
        msg.textContent = "";
        const r = await postReauth({ cmd, password: input.value });
        ok.disabled = false;
        if (r.status === 200 && typeof r.data.ticket === "string") return done(() => resolve(r.data.ticket));
        input.value = "";
        msg.textContent = reauthFailure(r);
        input.focus();
      });
      document.body.append(veil);
      input.focus();
    });
  }

  // 앱이 건 모달 손잡이(R4 — `src/lib/app/remote-dialog.svelte.ts`). 앱이 뜨기 전에는 없다 → 이 파일의 칸·네이티브 대화.
  function appUi(name) {
    const ui = window.__AYNX_REMOTE_UI__;
    return ui && typeof ui[name] === "function" ? ui : null;
  }

  // 마스터 없음의 표를 받은 뒤 사람이 확인하기까지 이보다 오래 걸렸으면 표를 새로 받는다(표 60초 — `auth.rs` REAUTH_TTL).
  const REAUTH_FRESH_MS = 45000;

  // 이 명령 한 번의 재확인 표. 앱 모달이 있으면(R4) 마스터가 없어도 **확인 단추 한 번**을 받는다(그 사실을 모달이 밝힌다) —
  // 앱이 뜨기 전이면 예전처럼 칸 없이 곧바로. 마스터가 있으면 앱 모달의 암호 칸(없으면 이 파일의 칸) — 암호는 여기서
  // `POST /remote/reauth` 몸으로만 간다(앱 모달은 `submit` 을 부를 뿐 암호를 쥐고 있지 않는다).
  function reauthTicket(cmd) {
    const run = async () => {
      const started = Date.now();
      const first = await postReauth({ cmd });
      if (first.status === 200 && typeof first.data.ticket === "string") {
        const ui = appUi("reauth");
        if (!ui) return first.data.ticket;
        await ui.reauth({ cmd, hasMaster: false }); // 취소면 거절이 그대로 위로
        if (Date.now() - started < REAUTH_FRESH_MS) return first.data.ticket;
        const again = await postReauth({ cmd });
        if (again.status === 200 && typeof again.data.ticket === "string") return again.data.ticket;
        throw reauthFailure(again);
      }
      if (first.status === 400 && first.data.error === "password") {
        const ui = appUi("reauth");
        if (ui) return ui.reauth({ cmd, hasMaster: true, submit: (password) => postReauth({ cmd, password: String(password) }) });
        return askMaster(cmd);
      }
      throw reauthFailure(first);
    };
    const next = reauthChain.then(run, run);
    reauthChain = next.catch(() => {});
    return next;
  }


  // ── 플러그인 가르기 ──
  const resolved = (v) => () => Promise.resolve(v);

  function dialogMessage(a) {
    // 앱 모달(R4) — 단추·결과 글자는 앱이 같은 규칙으로 고른다(`src/lib/remote-dialog.ts` 의 `dialogChoices`).
    const ui = appUi("message");
    if (ui) {
      return Promise.resolve(ui.message({ message: a && a.message, title: a && a.title, kind: a && a.kind, buttons: a && a.buttons }));
    }
    const message = String((a && a.message) || "");
    const text = a && a.title ? `${a.title}\n\n${message}` : message;
    const b = a && a.buttons;
    if (b === "YesNo") return Promise.resolve(window.confirm(text) ? "Yes" : "No");
    if (b === "OkCancel") return Promise.resolve(window.confirm(text) ? "Ok" : "Cancel");
    if (b === "YesNoCancel") return Promise.resolve(window.confirm(text) ? "Yes" : "Cancel");
    if (b && b.OkCancelCustom) return Promise.resolve(window.confirm(text) ? b.OkCancelCustom[0] : b.OkCancelCustom[1]);
    if (b && b.YesNoCancelCustom) return Promise.resolve(window.confirm(text) ? b.YesNoCancelCustom[0] : b.YesNoCancelCustom[2]);
    window.alert(text);
    return Promise.resolve(b && b.OkCustom ? b.OkCustom : "Ok");
  }

  function notify(a) {
    const o = (a && a.options) || a || {};
    try {
      if (window.Notification && Notification.permission === "granted") new Notification(o.title || "AYNX", { body: o.body });
    } catch {}
    return Promise.resolve(null);
  }

  // 창·웹뷰 조작 — 브라우저 탭에는 뜻이 없다. 부팅이 부르는 것은 무해하게 흉내 내고, 값을 묻는 것은 그럴듯한 값.
  const windowGetters = {
    is_maximized: () => false,
    is_minimized: () => false,
    is_fullscreen: () => false,
    is_focused: () => document.hasFocus(),
    is_visible: () => true,
    is_decorated: () => false,
    is_resizable: () => true,
    is_maximizable: () => false,
    is_minimizable: () => false,
    is_closable: () => false,
    is_enabled: () => true,
    is_always_on_top: () => false,
    scale_factor: () => window.devicePixelRatio || 1,
    inner_size: () => ({ width: Math.round(innerWidth * (devicePixelRatio || 1)), height: Math.round(innerHeight * (devicePixelRatio || 1)) }),
    outer_size: () => ({ width: Math.round(outerWidth * (devicePixelRatio || 1)), height: Math.round(outerHeight * (devicePixelRatio || 1)) }),
    inner_position: () => ({ x: 0, y: 0 }),
    outer_position: () => ({ x: 0, y: 0 }),
    title: () => document.title,
    theme: () => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    get_all_windows: () => [LABEL],
  };

  const PLUGINS = {
    // 이벤트: listen/unlisten 은 관문이 Rust 리스너로 대신 단다 · emit/emit_to 는 그대로(출처 = 이 원격 창).
    "event|listen": (a) =>
      call((id) => JSON.stringify({ t: "listen", id, event: a.event, target: a.target, handler: a.handler })).then((eventId) => {
        listenerCallbacks.set(eventId, a.handler);
        return eventId;
      }),
    "event|unlisten": (a) => call((id) => JSON.stringify({ t: "unlisten", id, event: a.event, eventId: a.eventId })),
    "event|emit": null,
    "event|emit_to": null,
    // 경로: 집 PC 의 경로가 맞는 답이다(관문 — capabilities/remote.json).
    "path|*": null,
    // 클립보드 읽기 → 브라우저(보안 컨텍스트 — tailscale serve 의 https).
    "clipboard-manager|read_text": () => navigator.clipboard.readText(),
    "clipboard-manager|write_text": (a) => navigator.clipboard.writeText(String((a && (a.text ?? (a.data && a.data.plainText && a.data.plainText.text))) || "")),
    // 여는 것: URL 은 새 탭 · 집 PC 의 파일·폴더 열기는 뜻이 없다.
    "opener|open_url": (a) => {
      window.open(String(a.url), "_blank", "noopener");
      return Promise.resolve(null);
    },
    "opener|open_path": () => Promise.reject(unsupportedFor("plugin:opener|open_path")),
    "opener|reveal_item_in_dir": () => Promise.reject(unsupportedFor("plugin:opener|reveal_item_in_dir")),
    // 알림 → 웹 Notification(처음 쓸 때 브라우저가 묻는다 — 플러그인 JS 의 requestPermission 이 직접 부른다).
    "notification|is_permission_granted": () =>
      Promise.resolve(window.Notification ? Notification.permission === "granted" : false),
    "notification|request_permission": () =>
      window.Notification ? Notification.requestPermission() : Promise.resolve("denied"),
    "notification|notify": notify,
    // 대화상자: 묻기·알림은 브라우저 confirm/alert · 파일 고르기는 아직 없다(앱 안 선택기는 다음 단계).
    "dialog|message": dialogMessage,
    "dialog|ask": (a) => dialogMessage({ ...a, buttons: "YesNo" }).then((r) => r === "Yes"),
    "dialog|confirm": (a) => dialogMessage({ ...a, buttons: "OkCancel" }).then((r) => r === "Ok"),
    "dialog|open": () => Promise.reject(unsupportedFor("plugin:dialog|open")),
    "dialog|save": () => Promise.reject(unsupportedFor("plugin:dialog|save")),
    // 탐색기로 끌어내기 — 원격에는 집 PC 탐색기가 없다.
    "drag|start_drag": () => Promise.reject(unsupportedFor("plugin:drag|start_drag")),
    // 앱 정보.
    "app|version": () => (version !== null ? Promise.resolve(version) : new Promise((r) => versionWaiters.push(r))),
    "app|name": resolved("AYNX"),
    // 웹뷰 확대(설정의 UI 크기) → CSS zoom. 웹뷰 확대와 달리 CSS zoom 은 px 값에도 곱해지니, 화면에서 잰 높이를 쓰는 폰 배치가 되돌리게 계수를 함께 알린다.
    "webview|set_webview_zoom": (a) => {
      const factor = String(Number(a && a.value) || 1);
      document.documentElement.style.zoom = factor;
      document.documentElement.style.setProperty("--css-zoom", factor);
      return Promise.resolve(null);
    },
  };

  function pluginHandler(cmd) {
    const name = cmd.slice("plugin:".length);
    if (Object.prototype.hasOwnProperty.call(PLUGINS, name)) return PLUGINS[name] === null ? "pass" : PLUGINS[name];
    const plugin = name.split("|")[0];
    const command = name.split("|")[1] || "";
    if (Object.prototype.hasOwnProperty.call(PLUGINS, `${plugin}|*`)) return PLUGINS[`${plugin}|*`] === null ? "pass" : PLUGINS[`${plugin}|*`];
    if (plugin === "window" || plugin === "webview") {
      if (Object.prototype.hasOwnProperty.call(windowGetters, command)) return () => Promise.resolve(windowGetters[command]());
      // 조작(보이기·최소화·최대화·닫기·끌기·크기·포커스 …) — 아무것도 하지 않는다.
      if (/^(show|hide|close|destroy|minimize|unminimize|maximize|unmaximize|toggle_maximize|start_dragging|start_resize_dragging|set_[a-z_]+|center|request_user_attention|webview_show|webview_hide|webview_close)$/.test(command)) {
        return resolved(null);
      }
    }
    return null;
  }

  function invoke(cmd, args = {}, options) {
    if (typeof cmd === "string" && cmd.startsWith("plugin:")) {
      const h = pluginHandler(cmd);
      if (h === null) {
        console.error(`[remote] 원격에서 지원하지 않는 플러그인 명령: ${cmd}`);
        return Promise.reject(unsupportedFor(cmd));
      }
      if (h !== "pass") {
        try {
          return Promise.resolve(h(args || {}));
        } catch (e) {
          return Promise.reject(String(e));
        }
      }
    }
    if (NOOP.has(cmd)) return Promise.resolve(null);
    if (REAUTH.has(cmd)) return reauthTicket(cmd).then((ticket) => remoteInvoke(cmd, args, options, ticket));
    return remoteInvoke(cmd, args, options);
  }

  function convertFileSrc(filePath) {
    return `${location.origin}/remote/asset?path=${encodeURIComponent(String(filePath))}`;
  }

  window.__AYNX_REMOTE__ = true;
  // 이 원격 기기의 이름(R1a-5 — 상태바 "원격 — <이름>". 관문이 부팅 표에 싣는다 · 이름을 바꾸면 다음 새로 고침부터).
  window.__AYNX_REMOTE_DEVICE__ = String(boot.device || "");
  // 이 원격 기기의 id(10-20 — 폰 설정의 [이 기기 페어링 해제]). 비밀이 아니다 — 기기 목록이 이미 내보내는 값.
  window.__AYNX_REMOTE_DEVICE_ID__ = String(boot.deviceId || "");
  // 앱 프런트가 부르는 재확인(표는 쓰지 않는다 — 60초 뒤 사라진다). 통과면 true, 취소·실패면 거절.
  window.__AYNX_REMOTE_REAUTH__ = (what) => reauthTicket(String(what || "")).then(() => true);
  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback,
    runCallback,
    callbacks,
    convertFileSrc,
    metadata: {
      currentWindow: { label: LABEL },
      currentWebview: { windowLabel: LABEL, label: LABEL },
    },
    plugins: { path: { sep: String(boot.sep || "/"), delimiter: String(boot.delimiter || ":") } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(_event, eventId) {
      const handler = listenerCallbacks.get(eventId);
      listenerCallbacks.delete(eventId);
      if (handler !== undefined) unregisterCallback(handler);
    },
  };

  // 사람이 입력했다 — 원격 세션의 무입력 시계를 되감는다(20초에 한 번까지).
  let lastActive = 0;
  const active = () => {
    const now = Date.now();
    if (now - lastActive < 20000) return;
    lastActive = now;
    send('{"t":"active"}');
  };
  for (const type of ["keydown", "pointerdown", "wheel", "touchstart"]) {
    window.addEventListener(type, active, { capture: true, passive: true });
  }

  // 백그라운드에서 돌아왔다(R5 — 폰 브라우저) — 10초 넘게 숨어 있었으면 ws 가 살아 있는지 가벼운 명령 하나로 본다. 폰은 뒤로 간 탭의
  // 연결을 소리 없이 끊기도 해서(열린 것처럼 보이는 죽은 소켓) 6초 안에 답이 없으면 닫는다 → 늘 하던 다시 읽기(재동기화 · 거울 다시 받기).
  // 끊긴 것이 이미 보이면(`onclose`) 그쪽이 다시 읽는다.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (away < 10000 || reloading || !ready || !ws || ws.readyState !== 1) return;
    const sock = ws;
    const timer = setTimeout(() => {
      try {
        sock.close();
      } catch {
        /* 이미 닫힘 */
      }
      reloadSoon(0);
    }, 6000);
    remoteInvoke("tray_status", {}).then(
      () => clearTimeout(timer),
      () => clearTimeout(timer),
    );
  });

  connect();
})();

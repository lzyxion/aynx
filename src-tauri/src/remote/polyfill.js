// Aynx 원격 창 폴리필 — 관문이 앱 셸(index.html)의 **첫 스크립트**로 끼워 `window.__TAURI_INTERNALS__` 를 관문 ws 로 세운다.
// 빌드를 거치지 않는 그대로의 파일이다(CSP `script-src 'self'` — 인라인 스크립트·스타일을 쓰지 않는다). 프레임 모양은 `remote/frames.rs` 와 맞춘다.
// 앱 명령의 문은 관문 `remote/deny.rs` 하나다 — 여기서는 재확인 표 받기와 `NOOP` 만 한다.
// 재확인 암호는 `POST /remote/reauth` 몸으로만 간다 — ws 프레임에 싣지 않는다.
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
  meta.remove(); // 부팅 표는 DOM 에 남기지 않는다
  const LABEL = String(boot.label || "");
  const GEN = Number(boot.gen) >>> 0;
  // 셸의 처음 `<html lang>` 은 고정값이라 보지 않는다 — 앱이 `setLocale` 로 적은 뒤의 값만 따른다.
  let lang = boot.lang === "en" ? "en" : "ko";
  new MutationObserver(() => {
    const l = document.documentElement.lang;
    if (l === "en" || l === "ko") lang = l;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  const L = (pair) => (lang === "en" ? pair[1] : pair[0]);
  const UNSUPPORTED = ["원격에서는 할 수 없습니다", "Not available in the remote client"];
  const CLOSED = ["원격 연결이 끊겼습니다", "The remote connection was closed"];
  const CANCELLED = ["마스터 암호 확인을 취소했습니다", "Master password check cancelled"];
  const PLUGIN_LABEL = {
    "plugin:opener|open_path": ["메인 PC 에서 파일 열기", "Open a file on the main PC"],
    "plugin:opener|reveal_item_in_dir": ["탐색기에서 보기", "Show in File Explorer"],
    "plugin:dialog|open": ["파일·폴더 고르기", "Choose a file or folder"],
    "plugin:dialog|save": ["저장 위치 고르기", "Choose where to save"],
    "plugin:drag|start_drag": ["탐색기로 끌어내기", "Drag out to File Explorer"],
  };
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
  const REAUTH = new Set(Array.isArray(boot.reauth) ? boot.reauth.map(String) : []);
  // 이름은 모두 `deny.rs` 의 UNSUPPORTED 여야 한다(시험 `polyfill_noops_are_unsupported`).
  const NOOP = new Set(["set_app_icon", "focus_window", "take_tray_intent"]);

  // ── 콜백 표 ──
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

  // tauri 의 processIpcMessage 와 같은 규칙.
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

  // ── 재확인 ──
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

  // 앱이 뜨기 전에만 쓰는 암호 칸. 앱의 단축키가 가로채지 않게 키 이벤트는 여기서 멈춘다.
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

  // 앱이 건 모달 손잡이(`src/lib/app/remote-dialog.svelte.ts`) — 앱이 뜨기 전에는 없다.
  function appUi(name) {
    const ui = window.__AYNX_REMOTE_UI__;
    return ui && typeof ui[name] === "function" ? ui : null;
  }

  // 표 수명(`auth.rs` REAUTH_TTL 60초)보다 짧아야 한다 — 확인이 이보다 오래 걸렸으면 표를 새로 받는다.
  const REAUTH_FRESH_MS = 45000;

  // 앱 모달은 `submit` 을 부를 뿐 암호를 쥐지 않는다.
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
    // 아래 단추·결과 글자 규칙은 `src/lib/remote-dialog.ts` 의 `dialogChoices` 와 같아야 한다.
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
      if (window.Notification && Notification.permission === "granted") new Notification(o.title || "Aynx", { body: o.body });
    } catch {}
    return Promise.resolve(null);
  }

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
    // null = 그대로 관문으로 — `capabilities/remote.json` 이 여는 것만 둔다.
    "event|listen": (a) =>
      call((id) => JSON.stringify({ t: "listen", id, event: a.event, target: a.target, handler: a.handler })).then((eventId) => {
        listenerCallbacks.set(eventId, a.handler);
        return eventId;
      }),
    "event|unlisten": (a) => call((id) => JSON.stringify({ t: "unlisten", id, event: a.event, eventId: a.eventId })),
    "event|emit": null,
    "event|emit_to": null,
    "path|*": null,
    // 보안 컨텍스트(tailscale serve 의 https)에서만 된다.
    "clipboard-manager|read_text": () => navigator.clipboard.readText(),
    "clipboard-manager|write_text": (a) => navigator.clipboard.writeText(String((a && (a.text ?? (a.data && a.data.plainText && a.data.plainText.text))) || "")),
    "opener|open_url": (a) => {
      window.open(String(a.url), "_blank", "noopener");
      return Promise.resolve(null);
    },
    "opener|open_path": () => Promise.reject(unsupportedFor("plugin:opener|open_path")),
    "opener|reveal_item_in_dir": () => Promise.reject(unsupportedFor("plugin:opener|reveal_item_in_dir")),
    "notification|is_permission_granted": () =>
      Promise.resolve(window.Notification ? Notification.permission === "granted" : false),
    "notification|request_permission": () =>
      window.Notification ? Notification.requestPermission() : Promise.resolve("denied"),
    "notification|notify": notify,
    "dialog|message": dialogMessage,
    "dialog|ask": (a) => dialogMessage({ ...a, buttons: "YesNo" }).then((r) => r === "Yes"),
    "dialog|confirm": (a) => dialogMessage({ ...a, buttons: "OkCancel" }).then((r) => r === "Ok"),
    "dialog|open": () => Promise.reject(unsupportedFor("plugin:dialog|open")),
    "dialog|save": () => Promise.reject(unsupportedFor("plugin:dialog|save")),
    "drag|start_drag": () => Promise.reject(unsupportedFor("plugin:drag|start_drag")),
    "app|version": () => (version !== null ? Promise.resolve(version) : new Promise((r) => versionWaiters.push(r))),
    "app|name": resolved("Aynx"),
    // CSS zoom 은 웹뷰 확대와 달리 px 값에도 곱해진다 — `--css-zoom` 을 빼면 폰 배치의 `--app-h` 높이가 어긋난다.
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
  window.__AYNX_REMOTE_DEVICE__ = String(boot.device || "");
  // 비밀이 아니다 — 기기 목록이 이미 내보내는 값.
  window.__AYNX_REMOTE_DEVICE_ID__ = String(boot.deviceId || "");
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

  // 원격 세션의 무입력 시계를 되감는다.
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

  // 폰 브라우저는 뒤로 간 탭의 연결을 소리 없이 끊기도 한다(열린 것처럼 보이는 죽은 소켓) — 돌아오면 답을 확인하고 없으면 다시 읽는다.
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

// CDP helper: node cdp.mjs eval "<expr>"          -> evaluates (awaits promise), prints JSON
//             node cdp.mjs console <seconds>       -> prints console messages for N seconds
//             node cdp.mjs key <combo> [count]     -> dispatches key combo e.g. Ctrl+Shift+KeyW
//             node cdp.mjs script <file>           -> evaluates file contents (awaits promise)
//             CDP_PORT=9223 node cdp.mjs …         -> 그 포트에만 붙는다(릴리스 앱이 9222 를 쓸 때 — 잘못 붙지 않게)
import fs from "node:fs";
const PORTS = process.env.CDP_PORT ? [Number(process.env.CDP_PORT)] : [9222, 9223];
let target = null;
for (const port of PORTS) { try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = list.find((t) => t.type === "page" && (t.url.startsWith("http://localhost:1420")||t.url.startsWith("http://tauri.localhost")||t.url.startsWith("tauri://"))); if (target) break; } catch {} }
if (!target) { console.error("no page target"); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send("Runtime.enable");
const [mode, ...rest] = process.argv.slice(2);
const fmt = (a) => a.map((x) => x.value ?? x.description ?? JSON.stringify(x)).join(" ");
if (mode === "eval" || mode === "script") {
  const expression = mode === "script" ? fs.readFileSync(rest[0], "utf8") : rest.join(" ");
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log("EXC", JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
  else console.log(JSON.stringify(r.result?.result?.value, null, 1));
} else if (mode === "console") {
  const secs = Number(rest[0] ?? 5);
  await new Promise((r) => setTimeout(r, secs * 1000));
  for (const e of events) if (e.method === "Runtime.consoleAPICalled") console.log(e.params.type.toUpperCase(), fmt(e.params.args));
  for (const e of events) if (e.method === "Runtime.exceptionThrown") console.log("EXC", e.params.exceptionDetails.exception?.description);
} else if (mode === "shot") {
  // node cdp.mjs shot <out.png> [reload]  -> screenshot of the webview content (independent of window z-order)
  if (rest[1] === "reload") { await send("Page.enable"); await send("Page.reload", { ignoreCache: true }); await new Promise((r) => setTimeout(r, 3500)); }
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(rest[0], Buffer.from(r.result.data, "base64")); console.log("saved", rest[0]);
} else if (mode === "key") {
  const combo = rest[0]; const count = Number(rest[1] ?? 1);
  const parts = combo.split("+"); const code = parts.pop();
  let modifiers = 0; for (const p of parts) modifiers |= { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 }[p] ?? 0;
  const keyOf = (c) => c.startsWith("Key") ? (modifiers & 8 ? c.slice(3) : c.slice(3).toLowerCase()) : c === "Enter" ? "Enter" : c === "Escape" ? "Escape" : c;
  const vk = { Enter: 13, Escape: 27 }[code] ?? (code.startsWith("Key") ? code.charCodeAt(3) : 0);
  for (let i = 0; i < count; i++) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers, key: keyOf(code), code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers, key: keyOf(code), code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log("sent", combo, count);
}
ws.close();

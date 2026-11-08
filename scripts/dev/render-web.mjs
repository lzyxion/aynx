import fs from "node:fs";
const width = Number(process.argv[2] ?? 520); const out = process.argv[3];
const list = await (await fetch(`http://127.0.0.1:9224/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes("localhost:1420"));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd) => (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') ? Promise.resolve(null) : Promise.reject(new Error('stub: ' + cmd)),
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 4000));
console.log(JSON.stringify(await ev(`(() => { const s=document.querySelector('.start'); if(!s) return {err:'no .start', body: document.body.innerText.slice(0,120)}; const cards=[...s.querySelectorAll('.card')]; const cols=new Set(cards.map(c=>Math.round(c.getBoundingClientRect().left))).size; return { cols, cards: cards.map(c=>{const t=c.querySelector('.text'); const r=c.getBoundingClientRect(); return { label:t.textContent.trim(), truncated: t.scrollWidth>t.clientWidth, textW:t.clientWidth, cardW:Math.round(r.width), cardH:Math.round(r.height), combo: c.querySelector('.combo')?.textContent.trim() ?? null } }) } })()`)));
const exc = events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0]).slice(0, 3);
if (exc.length) console.log("EXC", exc);
if (out) { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(out, Buffer.from(r.result.data, "base64")); }
ws.close();

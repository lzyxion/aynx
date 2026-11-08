// 헤드리스 가짜 작업자(3차 3a) — **개발 빌드 전용**. 모델을 부르지 않고 오케스트레이션을 끝에서 끝까지 돌린다.
//
// 켜는 법(개발 앱을 띄우기 전 환경 변수):
//   AYNX_DEV_FAKE_AGENT=C:/<절대 경로>/scripts/dev/fake-agent-headless.mjs
// 그러면 세션 서버의 서버 손(`src-tauri/src/server/workers.rs` · `find_cli`)이 작업자 · 검토자 CLI 대신 `node <이 파일> <원래 CLI 인자…>` 를
// 띄운다(릴리스 빌드에는 이 길이 없다). 인자는 진짜 턴과 똑같다(`orchestration/turn.rs` 의 `turn_argv`) — 이 스크립트는 그것을 읽어
//   - Claude(`-p --output-format stream-json …`)면 stream-json 사건을, Codex(`-a never exec --json …`)면 `--json` 사건을 stdout 에 JSONL 로 내고,
//   - 그 턴의 작업자 토큰으로 우리 MCP(`commit_changes` · `report_done` · 판정형은 `report_review`)를 부른다.
//     Claude: `--mcp-config` 파일의 url · Authorization 머리. Codex: `-c mcp_servers.<이름>.url=…` · `bearer_token_env_var=<환경 변수>`.
// 진짜 CLI 의 init 확인(대화 id · MCP 연결 · 권한 모드 · 내장 도구)을 지나도록 인자에서 값을 그대로 돌려준다.
//
// 지시문(마지막 인자 — `--` 뒤 `[` 로 시작하는 지시)에 표식을 넣어 갈래를 고른다(조정자가 보내는 글에 섞으면 된다):
//   [fake:blocked]   report_done{blocked}(필요: "fake needs a permission") — Attempt 는 idle · blocked 표지
//   [fake:noreport]  아무 보고 없이 턴을 끝낸다 — idle
//   [fake:mismatch]  init 의 대화 id 를 다르게 낸다 — 서버가 conversation-mismatch 로 끊는다(대화 끊김)
//   [fake:fail]      result 없이 끝 코드 1 — 턴 실패(no-result)
//   [fake:changes]   판정형이면 changes-requested(기본은 pass)
//   [fake:slow]      끝내기 전 20초 쉰다(busy · 중단 시험용)
// 표식이 없으면: 쓰기형은 cwd 에 `fake-<시각>.txt` 를 쓰고 commit_changes → report_done{success}, 판정형은 report_review{pass}.
//
// 의존성 없음 · Node 22+(전역 fetch). 본문 · 토큰은 stderr 에도 찍지 않는다.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const opts = dash >= 0 ? argv.slice(0, dash) : argv;
const prompt = dash >= 0 ? argv.slice(dash + 1).join(" ") : "";
const has = (w) => opts.includes(w);
const after = (w) => {
  const i = opts.indexOf(w);
  return i >= 0 ? opts[i + 1] : undefined;
};
const mark = (m) => prompt.includes(`[fake:${m}]`);

const cli = has("-p") ? "claude" : has("exec") ? "codex" : null;
if (!cli) {
  process.stderr.write("fake-agent-headless: unknown CLI arguments\n");
  process.exit(2);
}

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

// --- MCP 끝점 · 토큰 -------------------------------------------------------
function mcpEndpoint() {
  if (cli === "claude") {
    const file = after("--mcp-config");
    if (!file) return null;
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    const [name, s] = Object.entries(cfg.mcpServers ?? {})[0] ?? [];
    if (!s) return null;
    return { name, url: s.url, auth: s.headers?.Authorization ?? "" };
  }
  let name = null;
  let url = null;
  let env = null;
  for (let i = 0; i < opts.length; i++) {
    if (opts[i] !== "-c") continue;
    const v = opts[i + 1] ?? "";
    let m = /^mcp_servers\.([^.]+)\.url='(.*)'$/.exec(v);
    if (m) [name, url] = [m[1], m[2]];
    m = /^mcp_servers\.([^.]+)\.bearer_token_env_var='(.*)'$/.exec(v);
    if (m) env = m[2];
  }
  if (!url || !env) return null;
  return { name, url, auth: `Bearer ${process.env[env] ?? ""}` };
}

let sessionHeader = null;
let rpcId = 1;
async function rpc(ep, method, params) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: ep.auth };
  if (sessionHeader) headers["mcp-session-id"] = sessionHeader;
  const res = await fetch(ep.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionHeader = sid;
  const text = await res.text();
  // JSON 이거나 SSE(`data: {…}`) 한 덩이.
  const body = text.trim().startsWith("{") ? text : (text.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5);
  try {
    return JSON.parse(body);
  } catch {
    return { error: { message: `http ${res.status}` } };
  }
}

async function tool(ep, name, args) {
  const r = await rpc(ep, "tools/call", { name, arguments: args });
  const err = r.error?.message ?? (r.result?.isError ? r.result?.content?.[0]?.text : null);
  if (err) process.stderr.write(`fake-agent-headless: ${name} refused: ${String(err).slice(0, 200)}\n`);
  return !err;
}

// --- 턴 ------------------------------------------------------------------
const judge = cli === "claude" ? after("--tools") === "Read,Grep,Glob" : opts.includes("read-only") || opts.includes("sandbox_mode='read-only'");
const resumeId = cli === "claude" ? after("--resume") : has("resume") ? opts[opts.length - 1] : undefined;
const pinned = cli === "claude" ? resumeId ?? after("--session-id") : resumeId ?? randomUUID();
const conv = mark("mismatch") ? randomUUID() : pinned;
const cwd = cli === "codex" && !resumeId ? after("-C") ?? process.cwd() : process.cwd();
const ep = mcpEndpoint();

if (cli === "claude") {
  const tools = (after("--tools") ?? "").split(",").filter(Boolean);
  if (ep) tools.push(...["get_task", "commit_changes", "report_done", "get_diff", "report_review"].map((t) => `mcp__${ep.name}__${t}`));
  out({
    type: "system",
    subtype: "init",
    session_id: conv,
    model: "fake-headless",
    permissionMode: after("--permission-mode") ?? "default",
    claude_code_version: "0.0.0-fake",
    mcp_servers: ep ? [{ name: ep.name, status: "connected" }] : [],
    tools,
  });
} else {
  out({ type: "thread.started", thread_id: conv });
  out({ type: "turn.started" });
}

const toolEvent = (name) =>
  cli === "claude"
    ? out({ type: "assistant", message: { content: [{ type: "tool_use", name: `mcp__${ep?.name}__${name}` }] } })
    : out({ type: "item.completed", item: { type: "mcp_tool_call", tool: name } });

async function work() {
  if (mark("mismatch")) return; // 서버가 init 에서 끊는다.
  if (!ep) {
    process.stderr.write("fake-agent-headless: no MCP endpoint in the arguments\n");
    return;
  }
  await rpc(ep, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-agent-headless", version: "0" } });
  const req = (k) => `fake-${k}-${Date.now()}`;
  if (judge) {
    toolEvent("report_review");
    await tool(ep, "report_review", {
      requestId: req("v"),
      verdict: mark("changes") ? "changes-requested" : "pass",
      summary: "fake judge looked at the fixed commit",
      findings: mark("changes") ? ["fake: please change something"] : [],
    });
    return;
  }
  if (mark("noreport")) return;
  if (mark("blocked")) {
    toolEvent("report_done");
    await tool(ep, "report_done", { requestId: req("b"), outcome: "blocked", summary: "fake blocked", notes: "fake needs a permission" });
    return;
  }
  const file = join(cwd, `fake-${Date.now()}.txt`);
  writeFileSync(file, `fake work at ${new Date().toISOString()}\n`);
  toolEvent("commit_changes");
  const ok = await tool(ep, "commit_changes", { requestId: req("c"), message: "fake: add a file", selection: "all" });
  toolEvent("report_done");
  await tool(ep, "report_done", { requestId: req("r"), outcome: ok ? "success" : "failure", summary: ok ? "fake done" : "fake commit failed" });
}

await work().catch((e) => process.stderr.write(`fake-agent-headless: ${String(e?.message ?? e).slice(0, 200)}\n`));
if (mark("slow")) await new Promise((r) => setTimeout(r, 20_000));
if (mark("fail") || mark("mismatch")) process.exit(1);
if (cli === "claude") {
  out({ type: "assistant", message: { content: [{ type: "text", text: "fake turn finished" }] } });
  out({ type: "result", subtype: "success", is_error: false, session_id: conv, permission_denials: [] });
} else {
  out({ type: "item.completed", item: { type: "agent_message", text: "fake turn finished" } });
  out({ type: "turn.completed", usage: {} });
}

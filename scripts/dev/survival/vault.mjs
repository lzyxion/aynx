// 볼트 창 0개 행(설계 10절 "볼트") — `run.mjs vault-zero`.
//
// 하네스가 스스로 꾸리고 치운다: 127.0.0.1 임시 포트의 시험 HTTP "MCP" 서버(헤더 `X-Survival` 이 맞아야 200) → 그 헤더 값을 볼트에
// 담고(`vault_store_mcp_env` — 값은 볼트로만, 참조만 받는다) 설정에 http 서버 한 줄을 더해 저장 → AI 타일 하나(`claude --version`,
// 실행 설정 파일만 필요하다)가 서버의 헤더 프록시 URL(`/mcp-proxy/<티켓>`)을 받는다. 그 URL 로:
//   ① 붙어 있는 동안 200(프록시가 헤더를 붙인다) ② GUI kill(창 0개 = 서버 자가 잠금) → 503(티켓 정지) ③ GUI 재실행 → 가림막이 선
//   동안 503 ④ 가림막을 걷으면(해제) **같은 URL** 200(티켓 복구). 끝나면 설정 줄·볼트 항목·타일·시험 서버를 지운다.
// 마스터가 걸린 볼트는 `SURVIVAL_VAULT_MASTER` 가 있어야 연다(없으면 "못 함"). 값·티켓은 출력하지 않는다.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { Cdp, ensureApp, helpers, sleep, unveil } from "./lib.mjs";

const NAME = "survival-http";

async function hit(url) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
    return r.status;
  } catch (e) {
    return `error ${e.message}`;
  }
}

export async function vaultZero(o, h) {
  let { cdp } = await ensureApp(o);
  const st = await cdp.eval(`window.__TAURI_INTERNALS__.invoke('vault_status')`);
  if (st.state === "none" || st.state === "absent") return { verdict: "n/a", reason: "볼트가 없다(설정 › 보안에서 켜야 한다)" };
  if (st.state !== "unlocked") return { verdict: "n/a", reason: `볼트를 열지 못함(${st.state}${st.hasMaster ? " · 마스터 — SURVIVAL_VAULT_MASTER" : ""})` };

  // 시험 서버 — 헤더가 맞으면 200, 아니면 401
  const secret = crypto.randomBytes(16).toString("hex");
  let upstreamHits = { ok: 0, bad: 0 };
  const srv = http.createServer((req, res) => {
    const good = req.headers["x-survival"] === secret;
    good ? upstreamHits.ok++ : upstreamHits.bad++;
    res.writeHead(good ? 200 : 401, { "content-type": "application/json" });
    res.end(good ? '{"jsonrpc":"2.0","id":1,"result":{}}' : "{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  let ref = null;
  const out = {};
  try {
    ref = await cdp.eval(`window.__TAURI_INTERNALS__.invoke('vault_store_mcp_env', { label: ${JSON.stringify(NAME)}, value: ${JSON.stringify(secret)} })`);
    const added = await cdp.eval(`(async () => {
      const m = await import('/src/lib/settings/model/store.svelte.ts');
      const list = m.settings.current.ai.mcp_servers ?? (m.settings.current.ai.mcp_servers = []);
      const i = list.findIndex((s) => s.name === ${JSON.stringify(NAME)});
      if (i >= 0) list.splice(i, 1);
      list.push({ name: ${JSON.stringify(NAME)}, enabled: true, agents: ['claude'], transport: 'http', url: 'http://127.0.0.1:${port}/mcp', headers: [{ name: 'X-Survival', secret_ref: ${JSON.stringify(ref)} }] });
      await m.saveSettings();
      return true;
    })()`);
    out.settingsSaved = added;
    const dir = path.join(process.env.APPDATA ?? "", "aynx-dev", "agent-mcp");
    const before = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
    const [t] = await h.openTiles(cdp, 1, "claude --version", {});
    // 실행 설정 파일(새 것)에서 이 서버의 URL 만 읽는다
    let url = null;
    for (let i = 0; i < 60 && !url; i++) {
      await sleep(250);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !before.has(f))) {
        try {
          url = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).mcpServers?.[NAME]?.url ?? url;
        } catch {}
      }
    }
    if (!url) {
      out.verdict = "n/a";
      out.reason = "AI 타일의 실행 설정 파일에서 프록시 URL 을 찾지 못함(claude 가 설치돼 있지 않거나 autorun 관문이 파일을 쓰지 않음)";
      return out;
    }
    out.proxyPath = url.replace(/[0-9a-f]{20,}/g, "<ticket>");
    out.attached = await hit(url);
    // ② GUI kill → 창 0개 → 서버 자가 잠금(티켓 정지)
    cdp.close();
    await h.killGui();
    await sleep(2500);
    out.guiDead = await hit(url);
    // ③ 재실행 — 가림막이 선 동안
    const r = await h.relaunchAndAttach([t.stream]).catch(() => null);
    cdp = r?.cdp ?? (await Cdp.connect(o.cdp, { timeoutMs: 60_000 }));
    await helpers(cdp);
    // relaunchAndAttach 가 이미 가림막을 걷었을 수 있다 — 걷기 전 값을 따로 재려면 그 전에 잰다(아래는 걷은 뒤).
    await unveil(cdp);
    await sleep(800);
    out.afterUnlock = await hit(url);
    out.upstream = upstreamHits;
    out.verdict = out.attached === 200 && out.guiDead === 503 && out.afterUnlock === 200 ? "pass" : "fail";
    await h.closeTabs(cdp, [t.stream]);
    return out;
  } finally {
    // 뒷정리 — 설정 줄·볼트 항목·시험 서버
    try {
      await cdp.eval(`(async () => {
        const m = await import('/src/lib/settings/model/store.svelte.ts');
        const list = m.settings.current.ai.mcp_servers ?? [];
        const i = list.findIndex((s) => s.name === ${JSON.stringify(NAME)});
        if (i >= 0) { list.splice(i, 1); await m.saveSettings(); }
        return true;
      })()`);
      if (ref) await cdp.eval(`window.__TAURI_INTERNALS__.invoke('vault_delete', { kind: 'mcp_env', target: ${JSON.stringify(ref)} }).then(() => 1, (e) => String(e))`);
    } catch {}
    cdp.close();
    srv.close();
  }
}

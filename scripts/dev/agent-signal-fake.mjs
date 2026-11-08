// `agent-signal` 가짜 이벤트 — Rust 와 **같은 모양**의 페이로드를 만드는 곳은 여기 하나다.
//
// 상태의 권위는 Rust 표(`src-tauri/src/agent_state.rs`)다: 신호 하나를 받으면 표가 전이(`apply`)를 돌리고
// seq 를 매긴 뒤, 훅 필드(`agent_signal.rs` 의 `payload` — stream · event · detail · session · agent · cli ·
// hookVersion · hookLatest · at)에 표의 몫(`attach` — seq · state · agentState · completed · notify)을 더해
// 방송한다. 창(`src/lib/app/agent-status.svelte.ts` 의 `agentSignal`)은 그 몫을 **그대로 적고** 제 전이를 돌리지
// 않는다. 그래서 `window.__emit('agent-signal', { stream, event })` 만 쏘면 점·완료가 움직이지 않는다.
//
// 여기서는 페이지 안에서 순수 층 `stepHookSignal`(`src/lib/agent-status.ts` — Rust `apply` 와 같은 규칙의 명세)로
// 스트림별 이전 상태를 들고 전이를 계산해 그 몫을 채운다. seq 는 페이지 안에서 단조 증가하는 계수기 하나
// (Rust 처럼 표 전체에서 하나). 창이 Rust 에 알리는 `agent_state_forget` 도 가로채 그 스트림의 이전 상태를 버린다.
//
// 쓰는 법 — 하네스가 페이지에서 평가하는 식 안에 넣는다:
//   import { fakeAgentSignal } from "./agent-signal-fake.mjs";
//   await ev(fakeAgentSignal(`{ stream: 's1', event: 'stop', detail: null, at: Date.now() }`));
//   await ev(fakeAgentSignal({ stream: 's1', event: 'start' }));   // 객체면 JSON 으로 넣는다
// 인자는 **페이지 JS 식**(문자열) 또는 JSON 으로 옮길 객체다. 식은 Promise(= `window.__emit` 의 반환값)로 끝난다.
// `hookLatest` 는 넘겼을 때만 싣는다 — Rust 는 늘 싣지만, 하네스 신호는 판을 싣지 않아 "옛 훅" 안내가 뜬다.

/** 페이지 안에서 평가하면 가짜 신호 함수(한 번만 깐다)가 되는 식 */
export const FAKE_AGENT_SIGNAL_FN = `(window.__fakeAgentSignal ??= (() => {
  const states = new Map();
  let seq = 0;
  const internals = window.__TAURI_INTERNALS__;
  if (internals && typeof internals.invoke === 'function' && !internals.__fakeAgentForget) {
    const inner = internals.invoke;
    internals.invoke = (cmd, args, ...rest) => {
      if (cmd === 'agent_state_forget' && args && typeof args.stream === 'string') states.delete(args.stream);
      return inner.call(internals, cmd, args, ...rest);
    };
    internals.__fakeAgentForget = true;
  }
  const blank = (m) => {
    const { exitedAt, ...sig } = m.emptyAgentSignals();
    return { cli: null, agentRunId: null, sig };
  };
  return async (p) => {
    const m = await import('/src/lib/agent-status.ts');
    const base = {
      stream: p.stream,
      event: p.event,
      detail: p.detail ?? null,
      session: p.session ?? null,
      agent: p.agent ?? null,
      cli: p.cli ?? null,
      hookVersion: p.hookVersion ?? null,
    };
    // Rust 는 모르는 이벤트를 받지 않는다(방송 없음) — 하네스가 일부러 쏘면 그대로 흘려 창이 버리는지 보게 둔다.
    if (!m.isHookSignalEvent(p.event) || typeof p.stream !== 'string') return window.__emit('agent-signal', { ...p });
    const at = typeof p.at === 'number' ? p.at : Date.now();
    const prev = states.get(p.stream) ?? blank(m);
    const step = m.stepHookSignal(prev.sig, p.event, base.detail, base.agent, at);
    const sig = step.sig;
    // Rust \`phase_of\` — 가장 늦은 훅 신호, 끝인데 서브 에이전트가 돌면 끝을 뺀 나머지(없으면 실행)
    let last = m.lastHookSignal(sig);
    if (last === 'stop' && sig.subagents.length > 0) last = m.lastHookSignal({ ...sig, signalStopAt: null }) ?? 'running';
    const state = last === 'stop' ? 'finished' : last;
    const cli = m.signalCli(p.cli) ?? prev.cli;
    const agentRunId = typeof p.session === 'string' && p.session !== '' ? p.session : prev.agentRunId;
    seq += 1;
    states.set(p.stream, { cli, agentRunId, sig });
    const agentState = {
      cli,
      state,
      agentRunId,
      seq,
      at,
      subagents: [...sig.subagents],
      lastEvent: p.event,
      signalRunningAt: sig.signalRunningAt,
      signalPermissionAt: sig.signalPermissionAt,
      signalStopAt: sig.signalStopAt,
      signalSubagentAt: sig.signalSubagentAt,
      mainStopped: sig.mainStopped,
    };
    const payload = { ...p, ...base, at, seq, state, agentState, completed: step.completed, notify: step.notify };
    return window.__emit('agent-signal', payload);
  };
})())`;

/**
 * 가짜 `agent-signal` 하나를 쏘는 **페이지 식**. `payload` 는 페이지 JS 식 문자열(페이지 값 `Date.now()` · 지역 변수를
 * 쓸 수 있다) 또는 JSON 으로 옮길 객체.
 */
export function fakeAgentSignal(payload) {
  const expr = typeof payload === "string" ? payload : JSON.stringify(payload);
  return `${FAKE_AGENT_SIGNAL_FN}(${expr})`;
}

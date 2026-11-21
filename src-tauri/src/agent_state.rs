//! **에이전트 상태 표** — 타일(스트림)마다 에이전트 훅 신호를 접은 상태의 **권위**(docs/internal/session-server-design-2026-10-08.md).
//! 세션 서버 프로세스에 산다 — GUI 를 다시 켜도 이어지고, 서버가 끝나면 함께 끝난다.
//!
//! - 신호마다 이 표를 **먼저** 갱신하고, 이벤트는 표가 매긴 `seq` 를 싣는다 — 창은 스냅숏보다 낮거나 같은 seq 의 상태를 버린다.
//!   `seq` 는 표 전체에서 하나인 계수기라 지웠다 다시 서도 스트림별로 단조 증가한다.
//! - 실행 신호의 10분 시효와 "완료는 안 본 타일에만" 은 보는 쪽(창)의 일이라 여기서 하지 않는다.
//! - 전이 [`apply`] 는 프런트 `stepHookSignal` 을 옮긴 것이다(docs/log/2026-10-04-subagent-signals.md).
//! - 알림(`notify`)은 메인의 `stop` 으로 선 완료뿐이다 — 서브 에이전트의 끝에서 알리면 메인이 결과를 받아 아직 도는 중에 "끝남" 이 온다.
//! - 분류는 여기서 하지 않는다 — `cli` 없는 옛 신호(스크립트 7판 이하)도 표는 갱신하고, 그 타일을 AI 로 칠지는 창의 규칙이다.
//! - 세션 닫기의 지우기는 토큰을 **주인으로서** 거둘 때만이다 — 새 세션이 이미 갈아 치웠으면 지우지 않는다.
//! - 띄우며 적은 연결([`AgentStates::note_launch`]) — Codex 는 첫 질문 전에 대화 신호가 없어, Aynx 가 재개 명령을 쓰는 순간 창이 알린다.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde::Serialize;
use serde_json::{json, Value};

use crate::agent_signal::{AgentSignal, SignalEvent};

pub(crate) mod convo;

use convo::{ConvoLinkRow, ConvoLinks};

/// 프런트 `AgentStatus` 와 같은 이름.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Phase {
    Running,
    Permission,
    Finished,
}

/// 창으로 나가는 모양(camelCase)이 곧 프런트 `AgentSignals` 의 재료다.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentState {
    pub cli: Option<&'static str>,
    /// 시효 · 안 봄을 얹기 전의 값
    pub state: Option<Phase>,
    /// 실행 회차 — 지금은 훅이 싣는 대화 id(`session`)뿐이다
    pub agent_run_id: Option<String>,
    pub seq: u64,
    /// epoch ms
    #[serde(rename = "at")]
    pub at_ms: u64,
    pub subagents: Vec<String>,
    pub last_event: Option<&'static str>,
    pub signal_running_at: Option<u64>,
    pub signal_permission_at: Option<u64>,
    pub signal_stop_at: Option<u64>,
    pub signal_subagent_at: Option<u64>,
    pub main_stopped: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Step {
    pub next: AgentState,
    pub completed: bool,
    pub notify: bool,
}

/// 같은 시각이면 끝 > 권한 > 실행 (프런트 `lastHookSignal`).
fn last_hook(running: Option<u64>, permission: Option<u64>, stop: Option<u64>) -> Option<Phase> {
    let mut best = None;
    let mut at = 0u64;
    for (kind, v) in [
        (Phase::Running, running),
        (Phase::Permission, permission),
        (Phase::Finished, stop),
    ] {
        if let Some(v) = v {
            if best.is_none() || v >= at {
                best = Some(kind);
                at = v;
            }
        }
    }
    best
}

pub(crate) fn phase_of(s: &AgentState) -> Option<Phase> {
    let last = last_hook(
        s.signal_running_at,
        s.signal_permission_at,
        s.signal_stop_at,
    );
    if last == Some(Phase::Finished) && !s.subagents.is_empty() {
        return Some(
            last_hook(s.signal_running_at, s.signal_permission_at, None).unwrap_or(Phase::Running),
        );
    }
    last
}

/// 순수 전이 — `seq` 는 표가 매긴다.
pub(crate) fn apply(prev: &AgentState, sig: &AgentSignal, at_ms: u64) -> Step {
    let mut next = prev.clone();
    next.cli = sig.cli.or(prev.cli);
    if let Some(run) = &sig.session {
        next.agent_run_id = Some(run.clone());
    }
    next.at_ms = at_ms;
    next.last_event = Some(sig.event.as_str());
    let busy = !prev.subagents.is_empty();
    let mut completed = false;
    match sig.event {
        SignalEvent::Start => {
            next.signal_running_at = Some(at_ms);
            next.main_stopped = false;
        }
        SignalEvent::Tool | SignalEvent::ToolDone => {
            next.signal_running_at = Some(at_ms);
            if !busy {
                next.main_stopped = false;
            }
        }
        SignalEvent::Waiting => {
            if sig.detail.as_deref() == Some("permission") {
                next.signal_permission_at = Some(at_ms);
            }
        }
        SignalEvent::Stop => {
            next.signal_stop_at = Some(at_ms);
            next.main_stopped = true;
            completed = !busy;
        }
        SignalEvent::SubagentStart => {
            if let Some(id) = &sig.agent {
                if !prev.subagents.contains(id) {
                    next.subagents.push(id.clone());
                }
                next.signal_subagent_at = Some(at_ms);
            }
        }
        SignalEvent::SubagentStop => {
            if let Some(id) = sig.agent.as_ref().filter(|id| prev.subagents.contains(id)) {
                next.subagents.retain(|x| x != id);
                next.signal_subagent_at = Some(at_ms);
                if next.subagents.is_empty() && prev.main_stopped {
                    next.signal_stop_at = Some(at_ms);
                    completed = true;
                }
            }
        }
        SignalEvent::Interrupt => {
            // 사람이 끊었다 — 끝으로 두되 완료 · 알림은 아니다
            next.signal_stop_at = Some(at_ms);
            next.main_stopped = true;
        }
        SignalEvent::Session => {
            // 연결 전용 — 상태 재료는 그대로 둔다
        }
        SignalEvent::SessionEnd => {
            // 판정 재료만 비운다 — `cli` · `agent_run_id` 는 이벤트에 남긴다.
            next.signal_running_at = None;
            next.signal_permission_at = None;
            next.signal_stop_at = None;
            next.signal_subagent_at = None;
            next.subagents.clear();
            next.main_stopped = false;
        }
    }
    let notify = completed && sig.event == SignalEvent::Stop;
    next.state = phase_of(&next);
    Step {
        next,
        completed,
        notify,
    }
}

#[derive(Default)]
pub(crate) struct AgentStates {
    map: HashMap<String, AgentState>,
    last_seq: u64,
    convos: ConvoLinks,
    launches: HashMap<String, Launch>,
}

/// (cli, 대화 id 소문자)
type ConvoKey = (&'static str, String);

/// `cli_started` 는 그 재개 명령의 OSC 133 `C`([`ForgetCause::CliStart`])를 이미 지났는가.
#[derive(Clone, Debug)]
struct Launch {
    key: ConvoKey,
    cli_started: bool,
}

fn convo_key(s: &AgentState) -> Option<ConvoKey> {
    Some((s.cli?, s.agent_run_id.as_deref()?.to_ascii_lowercase()))
}

/// 띄우며 적은 연결의 수명이 이것으로 갈린다 — `CliStart` 의 처음 한 번은 그 재개 명령 자신이라 두고, `Replay`(F5 · 다시 붙기의
/// 링 재생)는 손대지 않고, 나머지는 놓는다. 신호가 밝힌 대화(표의 항목)는 어느 까닭이든 지운다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ForgetCause {
    Session,
    CliStart,
    Replay,
    ShellReturn,
}

impl ForgetCause {
    /// 없거나 모르는 글자는 [`Self::Session`] — 까닭을 싣지 않는 옛 창.
    pub(crate) fn parse(s: Option<&str>) -> Self {
        match s {
            Some("cli-start") => Self::CliStart,
            Some("replay") => Self::Replay,
            Some("shell-return") => Self::ShellReturn,
            _ => Self::Session,
        }
    }
}

impl AgentStates {
    /// 신호가 밝힌 것 ∪ 띄우며 적은 것 — 둘 중 하나라도 쥐면 놓지 않는다.
    fn held(&self, stream: &str) -> Vec<ConvoKey> {
        let mut v: Vec<ConvoKey> = self.map.get(stream).and_then(convo_key).into_iter().collect();
        if let Some(l) = self.launches.get(stream) {
            if !v.contains(&l.key) {
                v.push(l.key.clone());
            }
        }
        v
    }

    fn settle(&mut self, stream: &str, before: &[ConvoKey], at_ms: u64) {
        let after = self.held(stream);
        for (agent, id) in before.iter().filter(|k| !after.contains(k)) {
            self.convos.release(agent, id, stream, at_ms);
        }
        for (agent, id) in &after {
            self.convos.link(agent, id, stream);
        }
    }

    /// 같은 잠금 안이라 seq 순서 = 적은 순서다.
    pub(crate) fn record(&mut self, sig: &AgentSignal, at_ms: u64) -> Step {
        let prev = self.map.get(&sig.stream).cloned().unwrap_or_default();
        let before = self.held(&sig.stream);
        let mut step = apply(&prev, sig, at_ms);
        self.last_seq += 1;
        step.next.seq = self.last_seq;
        let ends_launch = sig.event == SignalEvent::SessionEnd
            || convo_key(&step.next).is_some_and(|k| self.launches.get(&sig.stream).is_some_and(|l| l.key != k));
        if ends_launch {
            self.launches.remove(&sig.stream);
        }
        if sig.event == SignalEvent::SessionEnd {
            // 끝난 CLI 는 표에 남기지 않는다 — 그 뒤 스냅숏을 받는 새 창이 끝난 CLI 를 AI 로 분류하지 않게.
            self.map.remove(&sig.stream);
        } else {
            self.map.insert(sig.stream.clone(), step.next.clone());
        }
        self.settle(&sig.stream, &before, at_ms);
        step
    }

    /// `PermissionRequest` 없는 Codex 질문만 서버가 신호를 보충한다. 답은 대기 시각도 걷는다 — 같은 ms 의 다음 훅과 경합하지 않게.
    pub(crate) fn question_signal(&mut self, stream: &str, waiting: bool, now: u64) -> Value {
        let at = self.map.get_mut(stream).map_or(now, |s| {
            if !waiting {
                s.signal_permission_at = None;
            }
            now.max(s.at_ms)
        });
        let sig = AgentSignal {
            stream: stream.to_string(),
            event: if waiting { SignalEvent::Waiting } else { SignalEvent::Tool },
            detail: waiting.then(|| "permission".to_string()),
            session: None,
            version: Some(crate::agent_hooks::SCRIPT_VERSION),
            agent: None,
            cli: Some("codex"),
        };
        let step = self.record(&sig, at);
        let mut payload = sig.payload(at as i64);
        attach(&mut payload, &step);
        payload
    }

    pub(crate) fn forget(&mut self, stream: &str, at_ms: u64) {
        self.forget_by(stream, ForgetCause::Session, at_ms);
    }

    pub(crate) fn forget_by(&mut self, stream: &str, cause: ForgetCause, at_ms: u64) {
        let before = self.held(stream);
        self.map.remove(stream);
        match cause {
            ForgetCause::Replay => {}
            ForgetCause::CliStart => match self.launches.get_mut(stream) {
                Some(l) if !l.cli_started => l.cli_started = true,
                _ => {
                    self.launches.remove(stream);
                }
            },
            ForgetCause::Session | ForgetCause::ShellReturn => {
                self.launches.remove(stream);
            }
        }
        self.settle(stream, &before, at_ms);
    }

    /// 재개 명령을 쓰기 직전에 창이 알린다 — 다음 `C` 하나가 그 명령 자신이다. 같은 스트림의 옛 것은 갈아 치운다.
    pub(crate) fn note_launch(&mut self, stream: &str, agent: &'static str, id: &str, at_ms: u64) {
        let before = self.held(stream);
        self.launches.insert(
            stream.to_owned(),
            Launch {
                key: (agent, id.to_ascii_lowercase()),
                cli_started: false,
            },
        );
        self.settle(stream, &before, at_ms);
    }

    pub(crate) fn conversation_links(&mut self, now_ms: u64) -> Vec<ConvoLinkRow> {
        self.convos.prune(now_ms);
        self.convos.rows()
    }

    pub(crate) fn snapshot(&self) -> Vec<(String, AgentState)> {
        self.map
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
}

/// 세션 서버 프로세스의 표 — 잠금은 문장 하나 안에서 끝난다.
static TABLE: LazyLock<Mutex<AgentStates>> = LazyLock::new(Default::default);

fn table() -> std::sync::MutexGuard<'static, AgentStates> {
    TABLE.lock().unwrap_or_else(|e| e.into_inner())
}

/// 신호 평면(`crate::server::signal_http`)이 방송 **직전에** 부른다.
pub(crate) fn record(sig: &AgentSignal, at_ms: u64) -> Step {
    table().record(sig, at_ms)
}

pub(crate) fn question_signal(stream: &str, waiting: bool) -> Value {
    table().question_signal(stream, waiting, crate::agent_signal::now_ms())
}

pub(crate) fn forget(stream: &str) {
    table().forget(stream, crate::agent_signal::now_ms());
}

/// 대화 면 [중지] — Claude 는 Esc 로 끊을 때 훅이 하나도 오지 않는다(`Stop` · `StopFailure` 없음). 판정 · 적기는 표 잠금 하나 안에서.
pub(crate) fn interrupt(stream: &str) -> Option<Value> {
    let at = crate::agent_signal::now_ms();
    let mut t = table();
    let cur = t.map.get(stream)?;
    if !matches!(cur.state, Some(Phase::Running | Phase::Permission)) {
        return None;
    }
    let sig = AgentSignal {
        stream: stream.to_owned(),
        event: SignalEvent::Interrupt,
        detail: None,
        session: None,
        version: None,
        agent: None,
        cli: cur.cli,
    };
    let step = t.record(&sig, at);
    drop(t);
    let mut payload = sig.payload(at as i64);
    attach(&mut payload, &step);
    Some(payload)
}

/// GUI 가 같은 이름으로 창에 중계한다(`client::RELAYED`).
pub(crate) const SEEN_EVENT: &str = "agent-seen";

/// 완료 확인 공유 — 표는 바꾸지 않는다("안 봄" 표식은 창마다 산다). 몸은 스트림과 표의 seq 뿐이다.
pub(crate) fn seen(stream: &str, seq: u64) -> Option<Value> {
    let t = table();
    let cur = t.map.get(stream)?;
    if cur.seq > seq {
        return None;
    }
    Some(serde_json::json!({ "stream": stream, "seq": cur.seq }))
}

pub(crate) fn forget_by(stream: &str, cause: ForgetCause) {
    table().forget_by(stream, cause, crate::agent_signal::now_ms());
}

/// 산 신호 토큰이 있을 때만 적는다 — 그래야 세션이 닫힐 때의 토큰 회수([`forget`])가 연결을 놓는다. 토큰 표는 표 잠금 **안에서**
/// 본다(잠금 순서 표 → 토큰 표 — 거꾸로 쥐는 곳은 없다).
pub(crate) fn note_launch(stream: &str, agent: &'static str, id: &str) -> bool {
    let mut t = table();
    if !crate::agent_signal::is_live(stream) {
        return false;
    }
    t.note_launch(stream, agent, id, crate::agent_signal::now_ms());
    true
}

pub(crate) fn note_released(agent: &'static str, id: &str) {
    table().convos.mark_released(agent, id, crate::agent_signal::now_ms());
}

pub(crate) fn conversation_links() -> Vec<ConvoLinkRow> {
    table().conversation_links(crate::agent_signal::now_ms())
}

/// 기존 필드(`event` · `detail` · `agent` …)는 그대로 둔다 — 옛 프런트 호환.
pub(crate) fn attach(payload: &mut Value, step: &Step) {
    if let Value::Object(map) = payload {
        map.insert("seq".into(), json!(step.next.seq));
        map.insert("state".into(), json!(step.next.state));
        map.insert("agentState".into(), json!(step.next));
        map.insert("completed".into(), json!(step.completed));
        map.insert("notify".into(), json!(step.notify));
    }
}

pub(crate) fn get(stream: &str) -> Option<AgentState> {
    table().map.get(stream).cloned()
}

pub(crate) fn snapshot() -> Vec<(String, AgentState)> {
    table().snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(event: SignalEvent) -> AgentSignal {
        AgentSignal {
            stream: "s1".into(),
            event,
            detail: None,
            session: None,
            version: None,
            agent: None,
            cli: None,
        }
    }

    fn with_detail(event: SignalEvent, detail: &str) -> AgentSignal {
        AgentSignal {
            detail: Some(detail.into()),
            ..sig(event)
        }
    }

    #[test]
    fn codex_question_signals_wait_and_resume_in_the_same_ms() {
        let mut t = AgentStates::default();
        let waiting = t.question_signal("s1", true, 10);
        assert_eq!(waiting["event"], "waiting");
        assert_eq!(waiting["detail"], "permission");
        assert_eq!(waiting["state"], "permission");
        assert_eq!(waiting["cli"], "codex");
        assert_eq!(waiting["session"], Value::Null);
        let answered = t.question_signal("s1", false, 10);
        assert_eq!(answered["event"], "tool");
        assert_eq!(answered["state"], "running");
        assert_eq!(answered["detail"], Value::Null);
        assert!(answered["seq"].as_u64().unwrap() > waiting["seq"].as_u64().unwrap());
        assert_eq!(answered["agentState"]["signalPermissionAt"], Value::Null);
        assert_eq!(t.record(&sig(SignalEvent::Tool), 10).next.state, Some(Phase::Running));
        assert_eq!(t.record(&sig(SignalEvent::ToolDone), 10).next.state, Some(Phase::Running));
        assert_eq!(answered["completed"], false);
        assert_eq!(answered["notify"], false);
    }

    fn sub(event: SignalEvent, id: &str) -> AgentSignal {
        AgentSignal {
            agent: Some(id.into()),
            ..sig(event)
        }
    }

    #[test]
    fn start_tool_permission_stop_walks_the_phases() {
        let s0 = AgentState::default();
        assert_eq!(phase_of(&s0), None);
        let s1 = apply(&s0, &sig(SignalEvent::Start), 10);
        assert_eq!(s1.next.state, Some(Phase::Running));
        assert_eq!(s1.next.last_event, Some("start"));
        let s2 = apply(&s1.next, &sig(SignalEvent::Tool), 20);
        assert_eq!(s2.next.state, Some(Phase::Running));
        let s3 = apply(
            &s2.next,
            &with_detail(SignalEvent::Waiting, "permission"),
            30,
        );
        assert_eq!(s3.next.state, Some(Phase::Permission));
        let s4 = apply(&s3.next, &sig(SignalEvent::ToolDone), 40);
        assert_eq!(s4.next.state, Some(Phase::Running));
        let s5 = apply(&s4.next, &sig(SignalEvent::Stop), 50);
        assert_eq!(s5.next.state, Some(Phase::Finished));
        assert!(s5.completed && s5.notify);
        assert!(s5.next.main_stopped);
    }

    /// 사람이 끊었다 — 실행이 끝으로 풀리지만 완료 · 알림은 아니다.
    #[test]
    fn interrupt_ends_the_turn_without_completion() {
        let s1 = apply(&AgentState::default(), &sig(SignalEvent::Start), 10);
        let i = apply(&s1.next, &sig(SignalEvent::Interrupt), 20);
        assert_eq!(i.next.state, Some(Phase::Finished));
        assert!(!i.completed && !i.notify);
        assert!(i.next.main_stopped);
        assert_eq!(i.next.last_event, Some("interrupt"));
        let again = apply(&i.next, &sig(SignalEvent::Start), 30);
        assert_eq!(again.next.state, Some(Phase::Running));
        let p = apply(&s1.next, &with_detail(SignalEvent::Waiting, "permission"), 15);
        assert_eq!(apply(&p.next, &sig(SignalEvent::Interrupt), 25).next.state, Some(Phase::Finished));
    }

    #[test]
    fn seen_is_display_only_and_drops_stale() {
        let s = "agent-state-test-seen";
        assert!(seen(s, 1).is_none(), "항목 없음");
        let mut stop = sig(SignalEvent::Stop);
        stop.stream = s.into();
        stop.cli = Some("claude");
        record(&stop, 10);
        let before = table().map.get(s).cloned().unwrap();
        assert!(seen(s, before.seq - 1).is_none(), "낡은 seq");
        let p = seen(s, before.seq).expect("지금 seq");
        assert_eq!(p, serde_json::json!({ "stream": s, "seq": before.seq }));
        assert_eq!(seen(s, before.seq + 9).unwrap()["seq"], before.seq);
        let after = table().map.get(s).cloned().unwrap();
        assert_eq!((after.seq, after.state, after.at_ms), (before.seq, before.state, before.at_ms), "표는 그대로");
    }

    #[test]
    fn interrupt_op_only_touches_a_working_stream() {
        let s = "agent-state-test-interrupt-op";
        assert!(interrupt(s).is_none(), "항목 없음");
        let mut start = sig(SignalEvent::Start);
        start.stream = s.into();
        start.cli = Some("claude");
        record(&start, 10);
        let p = interrupt(s).expect("실행 중이면 적는다");
        assert_eq!(p["event"], "interrupt");
        assert_eq!(p["state"], "finished");
        assert_eq!(p["completed"], false);
        assert_eq!(p["notify"], false);
        assert_eq!(p["cli"], "claude");
        assert!(interrupt(s).is_none(), "이미 끝이면 그대로");
        forget(s);
    }

    #[test]
    fn idle_waiting_keeps_the_material() {
        let s = apply(&AgentState::default(), &sig(SignalEvent::Stop), 10).next;
        let w = apply(&s, &with_detail(SignalEvent::Waiting, "idle"), 20);
        assert_eq!(w.next.state, Some(Phase::Finished));
        assert_eq!(w.next.signal_permission_at, None);
        assert!(!w.completed);
        assert_eq!(w.next.last_event, Some("waiting"));
    }

    #[test]
    fn same_instant_stop_beats_permission_beats_running() {
        let s = AgentState {
            signal_running_at: Some(5),
            signal_permission_at: Some(5),
            ..Default::default()
        };
        assert_eq!(phase_of(&s), Some(Phase::Permission));
        let s = AgentState {
            signal_stop_at: Some(5),
            ..s
        };
        assert_eq!(phase_of(&s), Some(Phase::Finished));
    }

    #[test]
    fn finished_only_when_no_subagent_is_running() {
        let s = apply(&AgentState::default(), &sig(SignalEvent::Start), 10).next;
        let s = apply(&s, &sub(SignalEvent::SubagentStart, "a1"), 20).next;
        let stop = apply(&s, &sig(SignalEvent::Stop), 30);
        assert!(
            !stop.completed && !stop.notify,
            "서브 에이전트가 돌면 완료가 아니다"
        );
        assert_eq!(stop.next.state, Some(Phase::Running));
        let odd = apply(&stop.next, &sub(SignalEvent::SubagentStop, "zz"), 35);
        assert_eq!(odd.next.subagents, vec!["a1".to_string()]);
        let none = apply(&stop.next, &sig(SignalEvent::SubagentStop), 36);
        assert_eq!(none.next.subagents, vec!["a1".to_string()]);
        let done = apply(&stop.next, &sub(SignalEvent::SubagentStop, "a1"), 40);
        assert!(done.completed && !done.notify, "서브 에이전트의 끝은 알리지 않는다");
        assert_eq!(done.next.state, Some(Phase::Finished));
        assert_eq!(done.next.signal_stop_at, Some(40));
        let woke = apply(&done.next, &sig(SignalEvent::Tool), 45).next;
        assert_eq!(woke.state, Some(Phase::Running));
        let fin = apply(&woke, &sig(SignalEvent::Stop), 50);
        assert!(fin.completed && fin.notify);
    }

    #[test]
    fn tools_while_busy_do_not_release_main_stopped() {
        let s = apply(
            &AgentState::default(),
            &sub(SignalEvent::SubagentStart, "a1"),
            10,
        )
        .next;
        let s = apply(&s, &sig(SignalEvent::Stop), 20).next;
        let t = apply(&s, &sig(SignalEvent::Tool), 30).next;
        assert!(t.main_stopped, "진행 중일 때의 도구는 메인의 것인지 모른다");
        let done = apply(&t, &sub(SignalEvent::SubagentStop, "a1"), 40);
        assert!(done.completed && !done.notify);
    }

    #[test]
    fn cli_and_run_id_stick_until_replaced() {
        let s = apply(
            &AgentState::default(),
            &AgentSignal {
                cli: Some("codex"),
                session: Some("11111111-1111-1111-1111-111111111111".into()),
                ..sig(SignalEvent::Start)
            },
            10,
        )
        .next;
        assert_eq!(s.cli, Some("codex"));
        let s = apply(&s, &sig(SignalEvent::Tool), 20).next;
        assert_eq!(s.cli, Some("codex"));
        assert_eq!(
            s.agent_run_id.as_deref(),
            Some("11111111-1111-1111-1111-111111111111")
        );
    }

    #[test]
    fn table_assigns_increasing_seq_and_forgets() {
        let mut t = AgentStates::default();
        let a = t.record(&sig(SignalEvent::Start), 10);
        let b = t.record(&sig(SignalEvent::Stop), 20);
        assert!(b.next.seq > a.next.seq);
        assert!(b.completed);
        let other = t.record(
            &AgentSignal {
                stream: "s2".into(),
                ..sig(SignalEvent::Start)
            },
            30,
        );
        assert!(other.next.seq > b.next.seq);
        let snap = t.snapshot();
        assert_eq!(snap.len(), 2);
        let s1 = snap.iter().find(|(k, _)| k == "s1").unwrap();
        assert_eq!(s1.1.state, Some(Phase::Finished));
        assert_eq!(s1.1.seq, b.next.seq);
        t.forget("s1", 35);
        assert_eq!(t.snapshot().len(), 1);
        let again = t.record(&sig(SignalEvent::Start), 40);
        assert!(again.next.seq > other.next.seq);
        assert_eq!(again.next.signal_stop_at, None, "지운 뒤에는 처음부터");
    }

    #[test]
    fn payload_keeps_old_fields_and_adds_the_table_share() {
        let mut t = AgentStates::default();
        let s = sig(SignalEvent::Stop);
        let step = t.record(&s, 20);
        let mut payload = s.payload(20);
        attach(&mut payload, &step);
        assert_eq!(payload["event"], "stop");
        assert_eq!(payload["stream"], "s1");
        assert_eq!(payload["seq"], step.next.seq);
        assert_eq!(payload["state"], "finished");
        assert_eq!(payload["completed"], true);
        assert_eq!(payload["notify"], true);
        assert_eq!(payload["agentState"]["signalStopAt"], 20);
        assert_eq!(payload["agentState"]["mainStopped"], true);
        assert_eq!(payload["agentState"]["at"], 20);
        assert_eq!(payload["agentState"]["subagents"], json!([]));
    }

    #[test]
    fn global_table_snapshot_and_forget() {
        // 전역 표 — 다른 테스트와 겹치지 않는 스트림 이름
        let s = AgentSignal {
            stream: "agent-state-global-test".into(),
            ..sig(SignalEvent::Start)
        };
        record(&s, 10);
        let snap = snapshot();
        assert!(snap
            .iter()
            .any(|(k, v)| k == "agent-state-global-test" && v.state == Some(Phase::Running)));
        forget("agent-state-global-test");
        let snap = snapshot();
        assert!(!snap.iter().any(|(k, _)| k == "agent-state-global-test"));
    }

    /// `session` — 연결 전용: 대화 id · cli 만 적고 상태는 그대로다.
    #[test]
    fn session_start_only_links_the_conversation() {
        let mut t = AgentStates::default();
        let fresh = t.record(
            &AgentSignal {
                cli: Some("claude"),
                session: Some("0123abcd-0000-0000-0000-000000000001".into()),
                ..sig(SignalEvent::Session)
            },
            10,
        );
        assert_eq!(fresh.next.state, None, "새 CLI 의 SessionStart 는 실행 중이 아니다");
        assert_eq!(fresh.next.agent_run_id.as_deref(), Some("0123abcd-0000-0000-0000-000000000001"));
        assert!(!fresh.completed && !fresh.notify);
        t.record(&sig(SignalEvent::Stop), 11);
        let cleared = t.record(
            &AgentSignal {
                session: Some("0123abcd-0000-0000-0000-000000000002".into()),
                ..sig(SignalEvent::Session)
            },
            12,
        );
        assert_eq!(cleared.next.state, Some(Phase::Finished), "끝난 턴은 끝난 채(/clear 뒤)");
        assert_eq!(cleared.next.signal_stop_at, Some(11));
        assert_eq!(cleared.next.agent_run_id.as_deref(), Some("0123abcd-0000-0000-0000-000000000002"));
        assert_eq!(cleared.next.cli, Some("claude"));
        assert!(!cleared.completed && !cleared.notify);
    }

    #[test]
    fn session_end_clears_the_entry_and_leaves_the_table() {
        let mut t = AgentStates::default();
        let start = AgentSignal {
            cli: Some("claude"),
            session: Some("0123abcd-0000-0000-0000-000000000000".into()),
            ..sig(SignalEvent::Start)
        };
        t.record(&start, 10);
        t.record(
            &AgentSignal {
                agent: Some("sub1".into()),
                ..sig(SignalEvent::SubagentStart)
            },
            11,
        );
        let end = t.record(&sig(SignalEvent::SessionEnd), 12);
        assert_eq!(end.next.state, None);
        assert!(end.next.subagents.is_empty());
        assert_eq!(
            (end.next.signal_running_at, end.next.signal_stop_at, end.next.signal_subagent_at),
            (None, None, None)
        );
        assert!(!end.next.main_stopped && !end.completed && !end.notify);
        assert_eq!(end.next.cli, Some("claude"), "누구였는지는 이벤트에 남는다");
        assert_eq!(
            end.next.agent_run_id.as_deref(),
            Some("0123abcd-0000-0000-0000-000000000000")
        );
        assert_eq!(end.next.last_event, Some("session-end"));
        assert_eq!(end.next.seq, 3);
        assert!(t.snapshot().is_empty(), "끝난 CLI 는 표에 남지 않는다");
        let again = t.record(&sig(SignalEvent::Start), 13);
        assert_eq!(again.next.seq, 4);
        assert!(again.next.subagents.is_empty() && again.next.cli.is_none(), "새 항목");
    }

    fn links_of(t: &mut AgentStates, at: u64) -> Vec<(String, Vec<String>, Option<u64>)> {
        let mut v: Vec<_> = t
            .conversation_links(at)
            .into_iter()
            .map(|r| (format!("{}:{}", r.agent, r.id), r.streams, r.released_at))
            .collect();
        v.sort();
        v
    }

    const A: &str = "0123abcd-0000-4000-8000-00000000000a";
    const B: &str = "0123abcd-0000-4000-8000-00000000000b";

    fn with_session(event: SignalEvent, stream: &str, id: &str) -> AgentSignal {
        AgentSignal {
            stream: stream.into(),
            cli: Some("claude"),
            session: Some(id.into()),
            ..sig(event)
        }
    }

    #[test]
    fn conversation_ledger_follows_the_streams() {
        let mut t = AgentStates::default();
        t.record(&with_session(SignalEvent::Session, "s1", A), 10);
        assert_eq!(links_of(&mut t, 10), vec![(format!("claude:{A}"), vec!["s1".to_string()], None)]);
        t.record(&with_session(SignalEvent::Start, "s1", A), 11);
        t.record(&AgentSignal { stream: "s1".into(), ..sig(SignalEvent::Tool) }, 12);
        t.record(&with_session(SignalEvent::Stop, "s1", A), 13);
        assert_eq!(links_of(&mut t, 13)[0].1, vec!["s1".to_string()]);
        t.record(&with_session(SignalEvent::Session, "s1", B), 20);
        assert_eq!(
            links_of(&mut t, 20),
            vec![
                (format!("claude:{A}"), vec![], Some(20)),
                (format!("claude:{B}"), vec!["s1".to_string()], None),
            ]
        );
        t.record(&with_session(SignalEvent::Start, "s2", B), 30);
        t.record(&AgentSignal { stream: "s1".into(), ..sig(SignalEvent::SessionEnd) }, 31);
        assert_eq!(links_of(&mut t, 31)[1], (format!("claude:{B}"), vec!["s2".to_string()], None));
        t.forget("s2", 40);
        assert_eq!(links_of(&mut t, 40)[1], (format!("claude:{B}"), vec![], Some(40)));
        t.forget("nope", 41);
        t.record(&AgentSignal { stream: "s3".into(), session: Some(A.into()), ..sig(SignalEvent::Start) }, 42);
        assert_eq!(links_of(&mut t, 42)[0], (format!("claude:{A}"), vec![], Some(20)));
        assert!(links_of(&mut t, 40 + convo::KEEP_MS).is_empty());
    }

    #[test]
    fn conversation_ledger_relinks_after_session_end() {
        let mut t = AgentStates::default();
        t.record(&with_session(SignalEvent::Start, "s1", A), 10);
        t.record(&with_session(SignalEvent::SessionEnd, "s1", A), 11);
        assert_eq!(links_of(&mut t, 11), vec![(format!("claude:{A}"), vec![], Some(11))]);
        t.record(&with_session(SignalEvent::Session, "s1", A), 12);
        assert_eq!(links_of(&mut t, 12), vec![(format!("claude:{A}"), vec!["s1".to_string()], Some(11))]);
    }

    fn codex(event: SignalEvent, stream: &str, id: &str) -> AgentSignal {
        AgentSignal {
            cli: Some("codex"),
            ..with_session(event, stream, id)
        }
    }

    /// 띄우며 적은 연결 — 그 재개 명령의 `C` 는 지우지 않고, 질문 없이 닫으면(토큰 회수) 그때 놓인다.
    #[test]
    fn launch_link_survives_its_own_cli_start_and_ends_on_close() {
        let mut t = AgentStates::default();
        t.forget("s1", 5);
        t.note_launch("s1", "codex", &A.to_ascii_uppercase(), 10);
        assert_eq!(links_of(&mut t, 10), vec![(format!("codex:{A}"), vec!["s1".to_string()], None)]);
        t.forget_by("s1", ForgetCause::CliStart, 11);
        assert_eq!(links_of(&mut t, 11)[0].1, vec!["s1".to_string()], "재개 명령의 C 는 지우지 않는다");
        t.forget_by("s1", ForgetCause::Replay, 12);
        assert_eq!(links_of(&mut t, 12)[0].1, vec!["s1".to_string()], "링 재생은 손대지 않는다");
        t.forget("s1", 20);
        assert_eq!(links_of(&mut t, 20), vec![(format!("codex:{A}"), vec![], Some(20))]);
    }

    #[test]
    fn launch_link_ends_on_the_next_cli_shell_return_session_end_or_another_id() {
        let mut t = AgentStates::default();
        t.note_launch("s1", "codex", A, 10);
        t.forget_by("s1", ForgetCause::CliStart, 11);
        t.forget_by("s1", ForgetCause::CliStart, 12);
        assert_eq!(links_of(&mut t, 12), vec![(format!("codex:{A}"), vec![], Some(12))]);
        let mut t = AgentStates::default();
        t.note_launch("s1", "codex", A, 10);
        t.forget_by("s1", ForgetCause::ShellReturn, 13);
        assert_eq!(links_of(&mut t, 13), vec![(format!("codex:{A}"), vec![], Some(13))]);
        let mut t = AgentStates::default();
        t.note_launch("s1", "codex", A, 10);
        t.record(&AgentSignal { stream: "s1".into(), cli: Some("codex"), ..sig(SignalEvent::SessionEnd) }, 14);
        assert_eq!(links_of(&mut t, 14), vec![(format!("codex:{A}"), vec![], Some(14))]);
        let mut t = AgentStates::default();
        t.note_launch("s1", "codex", A, 10);
        t.record(&codex(SignalEvent::Start, "s1", B), 15);
        assert_eq!(
            links_of(&mut t, 15),
            vec![(format!("codex:{A}"), vec![], Some(15)), (format!("codex:{B}"), vec!["s1".to_string()], None)]
        );
    }

    #[test]
    fn launch_and_signal_hold_the_same_conversation_together() {
        let mut t = AgentStates::default();
        t.note_launch("s1", "codex", A, 10);
        t.record(&codex(SignalEvent::Start, "s1", A), 11); // 순서가 뒤집혀 신호가 C 보다 먼저 와도
        t.forget_by("s1", ForgetCause::CliStart, 12);
        assert_eq!(links_of(&mut t, 12), vec![(format!("codex:{A}"), vec!["s1".to_string()], None)]);
        t.forget("s1", 20);
        assert_eq!(links_of(&mut t, 20), vec![(format!("codex:{A}"), vec![], Some(20))]);
        let mut t = AgentStates::default();
        t.note_launch("s3", "codex", A, 40);
        t.note_launch("s3", "claude", B, 41);
        assert_eq!(
            links_of(&mut t, 41),
            vec![(format!("claude:{B}"), vec!["s3".to_string()], None), (format!("codex:{A}"), vec![], Some(41))]
        );
    }

    #[test]
    fn forget_cause_parses_the_window_words() {
        assert_eq!(ForgetCause::parse(Some("cli-start")), ForgetCause::CliStart);
        assert_eq!(ForgetCause::parse(Some("replay")), ForgetCause::Replay);
        assert_eq!(ForgetCause::parse(Some("shell-return")), ForgetCause::ShellReturn);
        assert_eq!(ForgetCause::parse(None), ForgetCause::Session, "옛 창");
        assert_eq!(ForgetCause::parse(Some("??")), ForgetCause::Session);
    }
}

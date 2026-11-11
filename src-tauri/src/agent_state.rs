//! **에이전트 상태 표** — 타일(스트림)마다 에이전트 훅 신호를 접은 상태의 **권위**
//! (세션 서버 설계 9절 ① · docs/internal/session-server-design-2026-10-08.md).
//!
//! 예전에는 Rust 가 신호를 방송만 하고 상태는 창마다 프런트 메모리(`src/lib/app/agent-status.svelte.ts`)가
//! 셈했다 — 탭을 다른 창으로 떼어 가면 다음 신호까지 점이 비었고(리뷰 R12), 서로 다른 스레드에서 받은
//! 신호의 순서도 창이 받은 순서였다. 이제 `/agent-signal` 이 인증을 지난 신호마다 **이 표를 먼저 갱신하고**
//! ([`record`]), 이벤트는 표가 매긴 `seq` 와 전이 결과를 함께 싣는다(세션 서버의 `crate::server::signal_http` — ③-3a).
//! 창은 이 표의 구독자다 — 부팅·이관 재부착에서 스냅숏([`snapshot`] — Tauri 명령 `agent_states_snapshot`)을 받고, 이벤트를 seq 로 이어 받는다
//! (스냅숏보다 낮거나 같은 seq 의 **상태**는 버린다).
//!
//! ## 상태 셋 — 프런트 `src/lib/agent-status.ts` 와 같은 이름
//!
//! [`Phase`] = `running`(실행 중) · `permission`(권한 대기) · `finished`(턴 끝 · 진행 중 서브 에이전트 0).
//! 프런트의 점과 다른 점 둘은 **보는 쪽의 일**이라 여기서 하지 않는다: 실행 신호의 10분 시효
//! (`AGENT_SIGNAL_TTL_MS` — "지금" 시계가 필요하다)와 "완료는 안 본 타일에만"(안 봄 표식은 창의 것이다).
//! 그래서 이 표는 판정 재료(시각 넷 · 서브 에이전트 집합 · 메인 멈춤)를 그대로 들고,
//! 창은 그것으로 프런트의 `agentStatus` 를 그대로 돌린다 — 소비처(탭 점 · 대시보드 · 상태바)는 바뀌지 않는다.
//!
//! ## 전이 — [`apply`] (프런트 `stepHookSignal` 을 옮긴 것, docs/log/2026-10-04-subagent-signals.md)
//!
//! | 이벤트 | 하는 일 |
//! | --- | --- |
//! | `start` | 실행 시각 · 메인 돈다 (서브 에이전트 집합은 둔다) |
//! | `tool`·`tool-done` | 실행 시각. 진행 중이 없을 때만 메인 돈다 |
//! | `waiting` + `permission` | 권한 시각 (그 밖의 범주는 재료를 바꾸지 않는다) |
//! | `stop` | 끝 시각 · 메인 멈춤. 진행 중이 없으면 **완료 · 알림** |
//! | `subagent-start` + id | 집합에 더함 · 서브 에이전트 시각 |
//! | `subagent-stop` + id | 집합에서 뺌 — 0 이 됐고 메인이 멈춰 있으면 끝 시각 = 지금 · **완료(알리지 않음)** |
//! | id 없는 서브 에이전트 신호 · 모르는 id 의 끝 | 재료를 바꾸지 않는다(세지 않는다) |
//! | `session` | **대화가 섰다 · 바뀌었다**(10판 — Claude `SessionStart`) — 대화 id(`agent_run_id`) · `cli` 만 적는다. 시각 · 집합 · 멈춤은 그대로라 상태가 바뀌지 않는다(연결 전용) |
//! | `interrupt` | **사람이 턴을 끊었다**(2026-11-02 — Codex `Interrupt` 훅 · 대화 면 [중지]) — 끝 시각 · 메인 멈춤. **완료도 알림도 아니다**(사람이 끊었다). 서브 에이전트 집합은 둔다 |
//! | `session-end` | **CLI 가 끝났다**(9판 · ①b) — 시각 넷·서브 에이전트 집합·메인 멈춤을 비워 상태 `null`(`cli`·`agent_run_id` 는 둔다). 이벤트는 그 모양을 싣고 표에서는 항목을 지운다([`AgentStates::record`]) |
//!
//! 알림(`notify`)은 **메인의 `stop` 으로 선 완료**뿐이다(2026-10-21). 서브 에이전트의 끝은 점만 완료로 두고 알리지 않는다 —
//! 백그라운드 서브 에이전트가 끝나면 메인이 결과를 받아 다시 돌고 그 턴의 `stop` 이 진짜 끝이라, 예전처럼 마지막
//! `subagent-stop` 에서 알리면 메인이 아직 일하는 중에 "끝남" 이 왔다(그 뒤의 진짜 끝은 문지기가 삼켰다).
//!
//! ## 분류는 여기서 하지 않는다
//!
//! `cli` 가 없는 옛 신호(스크립트 7판 이하)도 표는 갱신한다 — 그 타일을 AI 로 칠지(`admitHookSignal` ·
//! `attestedAgents`)는 여전히 창의 규칙이고, 분류되지 않은 타일의 항목은 창이 쓰지 않을 뿐이다.
//!
//! ## 지우는 때 — 세 곳 (모두 [`forget`])
//!
//! - **새 세션**: 그 스트림에 신호 토큰을 새로 뽑을 때(`crate::agent_signal::issue` — 첫 열기 · 재연결 · F5 뒤 다시 열기).
//!   옛 세션의 재료(남은 서브 에이전트 집합 …)를 새 세션에 물려주지 않는다.
//! - **세션 닫기**: 그 스트림의 토큰을 **주인으로서** 거둘 때(`crate::agent_signal::revoke` — pty `shut_down` ·
//!   `ssh/session.rs` 닫기). 열쇠는 토큰 표와 같은 스트림이고, 주인이 다르면(새 세션이 이미 갈아 치움) 지우지 않는다.
//! - **창이 본 사건**: 같은 타일에서 새 CLI 가 뜸(OSC 133 `C`) · 에이전트가 끝나 셸로 돌아옴(`A`) — Rust 는 이
//!   둘을 모르므로 창이 Tauri 명령 `agent_state_forget`(→ 서버 op 같은 이름 → [`forget`])으로 알린다.
//! - **CLI 의 `session-end` 신호**(9판): 셸 복귀 표식이 없는 tmux 타일도 CLI 가 나간 것을 안다 — 이벤트를 낸 뒤 항목을 지운다
//!   (그 뒤 스냅숏을 받는 새 창이 끝난 CLI 를 AI 로 분류하지 않게).
//!
//! ## 대화 ↔ 스트림 장부 — [`convo`]
//!
//! 스트림의 대화 id 가 서고 · 바뀌고 · 지워지는 곳이 모두 이 표라서, 같은 잠금 안에서 **그 대화를 지금 쥔 스트림들과 놓인 시각**도
//! 적는다([`AgentStates::record`] — 대화 id 가 바뀌면 옛 것을 놓고 새 것을 쥔다 · `session-end` 는 놓는다, [`AgentStates::forget`] 은
//! 놓는다). 지난 대화 목록의 "열림 · 밖에서 열림" 과 이름 바꾸기 · 지우기의 문이 읽는다(서버 op `agent_conversation_links`).
//!
//! **띄우며 적은 연결**([`AgentStates::note_launch`] — 서버 op `agent_conversation_launched`): Aynx 가 재개 명령을 그 타일에 쓰는 순간 창이
//! 알린다 — 신호를 기다리지 않는다. Codex 는 첫 질문 전에 대화 신호가 없는데 `codex resume` 은 뜨자마자 기록에 한 줄
//! (`thread_settings_applied`)을 덧붙여, 질문 없이 닫은 타일의 대화가 2분 동안 "밖에서 열림" 이었다(2026-10-24 실측). 스트림이 쥔 대화 =
//! 신호가 밝힌 것 ∪ 띄우며 적은 것([`AgentStates::held`]) — 둘 중 하나라도 쥐면 놓지 않는다. 띄우며 적은 것이 끝나는 때와 끝나지 않는 때는
//! [`ForgetCause`] 와 [`AgentStates::record`] 가 정한다(재개 명령 자신의 OSC 133 `C` 는 그 연결을 지우지 않는다).
//!
//! `seq` 는 표 전체에서 하나인 계수기라 지웠다 다시 서도 스트림별로 단조 증가한다(창이 들고 있는 옛 seq 보다 늘 크다).
//! 이 표는 **세션 서버 프로세스**에 산다(③-3a) — GUI 를 강제 종료했다 다시 켜도 이어지고, 서버가 끝나면 함께 끝난다
//! (서버 끝 = 세션 끝).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde::Serialize;
use serde_json::{json, Value};

use crate::agent_signal::{AgentSignal, SignalEvent};

pub(crate) mod convo;

use convo::{ConvoLinkRow, ConvoLinks};

/// 상태 셋 — 프런트 `AgentStatus` 와 같은 이름. 시효·안 봄은 보는 쪽이 얹는다(모듈 머리말).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Phase {
    Running,
    Permission,
    Finished,
}

/// 스트림 하나의 에이전트 상태 — 창으로 나가는 모양(camelCase)이 곧 프런트 `AgentSignals` 의 재료다.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentState {
    /// 신호가 밝힌 CLI(`claude`·`codex`, 스크립트 8판) — 한 번 밝혀지면 옛 신호가 와도 둔다
    pub cli: Option<&'static str>,
    /// 전이 결과 — 시효·안 봄을 얹기 전의 값. 신호가 하나도 없으면 `None`
    pub state: Option<Phase>,
    /// 실행 회차 — 지금은 훅이 싣는 **대화 id**(`session`)뿐이다. 설계의 sessionEpoch 를 붙일 자리
    pub agent_run_id: Option<String>,
    /// 표가 매긴 순번 — 스트림별로 단조 증가(표 전체 계수기)
    pub seq: u64,
    /// 마지막 신호를 받은 시각(epoch ms)
    #[serde(rename = "at")]
    pub at_ms: u64,
    /// 진행 중인 서브 에이전트 id (들어온 순서)
    pub subagents: Vec<String>,
    /// 마지막 사건(훅 이벤트 이름)
    pub last_event: Option<&'static str>,
    /// `start`·`tool`·`tool-done` 의 마지막 시각
    pub signal_running_at: Option<u64>,
    /// `waiting` + `permission` 의 마지막 시각
    pub signal_permission_at: Option<u64>,
    /// `stop` — 또는 메인이 멈춘 뒤 마지막 서브 에이전트가 끝난 시각
    pub signal_stop_at: Option<u64>,
    /// 마지막 서브 에이전트 신호 시각 — 진행 중이 있을 때 실행 시효를 잰다
    pub signal_subagent_at: Option<u64>,
    /// 메인이 멈춰 있는가
    pub main_stopped: bool,
}

/// 전이 하나의 결과.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Step {
    pub next: AgentState,
    /// 이 신호로 **완료**가 섰다
    pub completed: bool,
    /// 완료를 **알린다** — 메인의 `stop` 으로 선 완료만(모듈 머리말)
    pub notify: bool,
}

/// 가장 늦은 훅 신호 — 같은 시각이면 끝 > 권한 > 실행 (프런트 `lastHookSignal`).
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

/// 재료 → 상태 (시효·안 봄 없이). 진행 중 서브 에이전트가 있으면 끝은 완료가 아니다 — 끝을 뺀 나머지, 없으면 실행.
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

/// **순수 전이** — 신호 하나 → 다음 상태. `seq` 는 건드리지 않는다(표가 매긴다). 규칙은 모듈 머리말의 표.
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
            // 사람이 끊었다 — 끝으로 두되 완료 · 알림은 아니다(백그라운드 서브 에이전트가 남았으면 그 집합이 상태를 쥔다)
            next.signal_stop_at = Some(at_ms);
            next.main_stopped = true;
        }
        SignalEvent::Session => {
            // 대화가 섰다 · 바뀌었다(SessionStart) — 연결 전용: 대화 id · cli 는 위에서 적었고, 상태 재료는 그대로 둔다
        }
        SignalEvent::SessionEnd => {
            // CLI 가 끝났다 — 판정 재료를 비운다(상태 `null`). 누구였는지(`cli`·`agent_run_id`)는 이벤트에 남긴다.
            next.signal_running_at = None;
            next.signal_permission_at = None;
            next.signal_stop_at = None;
            next.signal_subagent_at = None;
            next.subagents.clear();
            next.main_stopped = false;
        }
    }
    // 서브 에이전트로 선 완료는 알리지 않는다 — 메인이 결과를 받아 다시 돌고, 그 `stop` 이 알린다(모듈 머리말).
    let notify = completed && sig.event == SignalEvent::Stop;
    next.state = phase_of(&next);
    Step {
        next,
        completed,
        notify,
    }
}

/// 스트림 → 상태. 순수 자료구조라 테스트가 제 것을 만든다 — 앱은 전역 하나([`TABLE`]).
#[derive(Default)]
pub(crate) struct AgentStates {
    map: HashMap<String, AgentState>,
    /// 마지막으로 매긴 seq — 표 전체에서 하나(지웠다 다시 서도 단조 증가)
    last_seq: u64,
    /// 대화 ↔ 스트림 장부(모듈 머리말 · [`convo`])
    convos: ConvoLinks,
    /// 스트림 → **띄우며 적은 대화**(모듈 머리말 · [`AgentStates::note_launch`])
    launches: HashMap<String, Launch>,
}

/// 장부의 열쇠 — (cli, 대화 id 소문자).
type ConvoKey = (&'static str, String);

/// 띄우며 적은 대화 하나 — `cli_started` 는 그 재개 명령의 OSC 133 `C`(창의 [`ForgetCause::CliStart`])를 이미 지났는가.
#[derive(Clone, Debug)]
struct Launch {
    key: ConvoKey,
    cli_started: bool,
}

/// 그 항목이 쥔 대화 — `cli` 와 대화 id 를 둘 다 알 때만(옛 신호의 스트림은 장부에 적지 않는다).
fn convo_key(s: &AgentState) -> Option<ConvoKey> {
    Some((s.cli?, s.agent_run_id.as_deref()?.to_ascii_lowercase()))
}

/// 무엇이 그 스트림의 항목을 지우나 — 띄우며 적은 연결([`AgentStates::note_launch`])의 수명이 이것으로 갈린다. 신호가 밝힌 대화(표의 항목)는
/// 어느 까닭이든 지운다(예전 그대로).
///
/// | 까닭 | 어디서 | 띄우며 적은 연결 |
/// | --- | --- | --- |
/// | [`Session`](Self::Session) | 새 세션(토큰 발급) · 세션 닫기(주인의 토큰 회수 = 타일 닫기 · 회수) · 고아 정리 · 까닭을 싣지 않은 옛 창 | 놓는다 |
/// | [`CliStart`](Self::CliStart) | 창이 본 OSC 133 `C`(링 재생 아님) | **처음 한 번은 둔다** — 그 `C` 가 바로 그 재개 명령이다. 그 뒤의 `C` 는 새 CLI 라 놓는다 |
/// | [`Replay`](Self::Replay) | F5 · 다시 붙기의 링 재생이 다시 보인 `C`(이미 지난 명령) | 둔다(손대지 않는다) |
/// | [`ShellReturn`](Self::ShellReturn) | 창이 본 OSC 133 `A` — 에이전트가 끝나 셸로 돌아옴 | 놓는다 |
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ForgetCause {
    Session,
    CliStart,
    Replay,
    ShellReturn,
}

impl ForgetCause {
    /// 서버 op `agent_state_forget` 의 `cause` 글자 — 없거나 모르는 글자는 [`Self::Session`](예전 뜻).
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
    /// 그 스트림이 지금 쥔 대화 — 신호가 밝힌 것 ∪ 띄우며 적은 것(같으면 하나).
    fn held(&self, stream: &str) -> Vec<ConvoKey> {
        let mut v: Vec<ConvoKey> = self.map.get(stream).and_then(convo_key).into_iter().collect();
        if let Some(l) = self.launches.get(stream) {
            if !v.contains(&l.key) {
                v.push(l.key.clone());
            }
        }
        v
    }

    /// 바꾸기 전에 쥐었던 것(`before`)과 지금 쥔 것을 견줘 장부를 맞춘다 — 빠진 것은 `at_ms` 에 놓고, 남은 것은 쥔다(멱등).
    fn settle(&mut self, stream: &str, before: &[ConvoKey], at_ms: u64) {
        let after = self.held(stream);
        for (agent, id) in before.iter().filter(|k| !after.contains(k)) {
            self.convos.release(agent, id, stream, at_ms);
        }
        for (agent, id) in &after {
            self.convos.link(agent, id, stream);
        }
    }

    /// 신호 하나를 적는다 — 전이 뒤 새 seq 를 매긴다. 같은 잠금 안이라 seq 순서 = 적은 순서다.
    ///
    /// 장부 — 끝난 CLI 는 대화를 놓고, 대화 id 가 바뀌었으면(`/clear` · `/resume`) 옛 것을 놓고 새 것을 쥔다. 띄우며 적은 연결은
    /// `session-end` 와 **다른** 대화 id 를 실은 신호(그 타일에서 다른 대화가 섰다)가 끝낸다 — 같은 id 면 둔다(신호가 함께 쥘 뿐).
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
            // 끝난 CLI 는 표에 남기지 않는다 — 이벤트(step)가 끝을 알리고, 다음 신호는 새 항목으로 선다(seq 는 계속 커진다).
            self.map.remove(&sig.stream);
        } else {
            self.map.insert(sig.stream.clone(), step.next.clone());
        }
        self.settle(&sig.stream, &before, at_ms);
        step
    }

    /// Codex 질문의 시작 · 답 — `PermissionRequest` 없는 질문만 서버가 신호를 보충. 답은 대기 시각도 걷어 같은 ms 의 다음 훅과 경합하지 않게
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

    /// 그 스트림의 항목을 버린다(없으면 조용히) — 까닭을 모르는 자리(새 세션 · 세션 닫기 · 고아)라 [`ForgetCause::Session`].
    pub(crate) fn forget(&mut self, stream: &str, at_ms: u64) {
        self.forget_by(stream, ForgetCause::Session, at_ms);
    }

    /// 그 스트림의 항목을 버린다 — 신호가 밝힌 대화는 늘 놓이고, 띄우며 적은 연결은 까닭([`ForgetCause`] 의 표)대로.
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

    /// **띄우며 적은 연결** — Aynx 가 그 스트림에 대화 `(agent, id)` 를 여는 명령(재개 autorun)을 쓴다 — 쓰기 직전에 창이 알린다. 신호를
    /// 기다리지 않고 곧바로 쥔다. 다음 `C` 하나가 그 명령 자신이다. 같은 스트림의 옛 것은 갈아 치운다.
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

    /// 대화 ↔ 스트림 장부 전체 — 오래 놓인 항목을 먼저 버린다.
    pub(crate) fn conversation_links(&mut self, now_ms: u64) -> Vec<ConvoLinkRow> {
        self.convos.prune(now_ms);
        self.convos.rows()
    }

    /// 지금 표 전체 (스트림 순서는 정하지 않는다).
    pub(crate) fn snapshot(&self) -> Vec<(String, AgentState)> {
        self.map
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
}

/// **세션 서버 프로세스의** 표(③-3a) — 신호 수신 스레드(`crate::server::signal_http`)와 파이프 op(지우기·스냅숏 —
/// `crate::server::signals`)가 함께 본다. GUI 의 Tauri 명령 `agent_states_snapshot`·`agent_state_forget` 은
/// `crate::server::proxy` 의 같은 이름 프록시다. 잠금은 문장 하나 안에서 끝난다.
static TABLE: LazyLock<Mutex<AgentStates>> = LazyLock::new(Default::default);

fn table() -> std::sync::MutexGuard<'static, AgentStates> {
    TABLE.lock().unwrap_or_else(|e| e.into_inner())
}

/// 인증을 지난 신호 하나를 표에 적는다 — 신호 평면(`crate::server::signal_http`)이 방송 **직전에** 부른다.
pub(crate) fn record(sig: &AgentSignal, at_ms: u64) -> Step {
    table().record(sig, at_ms)
}

pub(crate) fn question_signal(stream: &str, waiting: bool) -> Value {
    table().question_signal(stream, waiting, crate::agent_signal::now_ms())
}

/// 그 스트림의 항목을 버린다 — 새 세션(토큰 발급) · 세션 닫기(주인의 토큰 회수) · 창이 본 새 CLI/셸 복귀.
pub(crate) fn forget(stream: &str) {
    table().forget(stream, crate::agent_signal::now_ms());
}

/// **대화 면 [중지]**(2026-11-02 — 서버 op `agent_state_interrupt`) — 사람이 그 타일 TUI 에 Esc 를 보낸 뒤 창이 알린다. Claude 는 Esc 로 끊을 때
/// 훅이 하나도 오지 않아(실측 — `Stop` · `StopFailure` 없음) 실행이 다음 신호까지 남았다. 그 스트림이 **지금 실행 · 권한 대기일 때만**
/// `interrupt` 신호 하나를 적고 방송할 페이로드를 돌려준다(그 밖 — 항목 없음 · 이미 끝 — 은 `None`, 아무것도 바꾸지 않는다). 다음 훅 신호
/// (새 프롬프트 · 도구)가 오면 다시 실행이다. 판정 · 적기는 표 잠금 하나 안에서.
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

/// 완료를 사람이 봤다는 방송 이름(2026-11-04 — 서버 op `agent_state_seen`). GUI 가 같은 이름으로 창에 중계한다(`client::RELAYED`).
pub(crate) const SEEN_EVENT: &str = "agent-seen";

/// **완료 확인 공유**(2026-11-04 — 서버 op `agent_state_seen`) — 어느 창에서 사람이 그 타일의 턴 끝을 봤다. 표는 바꾸지 않는다(표시 전용 — "안 봄" 표식은 창마다
/// 산다 · `src/lib/app/agent-seen.svelte.ts`). 항목이 없거나 그 사이 새 신호가 와서(표의 seq 가 더 크다) 그 확인이 낡았으면 `None`. 몸은 스트림과 표의 seq 뿐이다.
pub(crate) fn seen(stream: &str, seq: u64) -> Option<Value> {
    let t = table();
    let cur = t.map.get(stream)?;
    if cur.seq > seq {
        return None;
    }
    Some(serde_json::json!({ "stream": stream, "seq": cur.seq }))
}

/// 창이 본 사건으로 그 스트림의 항목을 버린다 — 서버 op `agent_state_forget`(`cause` — [`ForgetCause`]).
pub(crate) fn forget_by(stream: &str, cause: ForgetCause) {
    table().forget_by(stream, cause, crate::agent_signal::now_ms());
}

/// 띄우며 적은 연결([`AgentStates::note_launch`]) — 서버 op `agent_conversation_launched`. **그 스트림에 산 신호 토큰이 있을 때만** 적고 참:
/// 그래야 그 세션이 닫힐 때의 토큰 회수([`forget`])가 반드시 뒤따라 연결이 영영 남지 않는다. 토큰 표는 표 잠금 **안에서** 본다 —
/// 회수는 토큰 표를 먼저 비우고(그 잠금을 놓은 뒤) 이 표를 잠그므로, 회수가 먼저면 여기서 산 토큰이 없고, 나중이면 그 지우기가
/// 이 연결을 놓는다(잠금 순서 표 → 토큰 표 — 거꾸로 쥐는 곳은 없다).
pub(crate) fn note_launch(stream: &str, agent: &'static str, id: &str) -> bool {
    let mut t = table();
    if !crate::agent_signal::is_live(stream) {
        return false;
    }
    t.note_launch(stream, agent, id, crate::agent_signal::now_ms());
    true
}

/// 사이드 채팅 프로세스가 끝나 그 대화를 놓았다([`ConvoLinks::mark_released`]) — `crate::server::side_chat` 의 프로세스 끝이 부른다.
pub(crate) fn note_released(agent: &'static str, id: &str) {
    table().convos.mark_released(agent, id, crate::agent_signal::now_ms());
}

/// 대화 ↔ 스트림 장부(모듈 머리말) — 서버 op `agent_conversation_links`(읽기)가 돌려준다. 창 쪽은 `crate::server::proxy` 의 같은 이름 명령.
pub(crate) fn conversation_links() -> Vec<ConvoLinkRow> {
    table().conversation_links(crate::agent_signal::now_ms())
}

/// 이벤트 페이로드에 표의 몫을 더한다 — 기존 필드(`event`·`detail`·`agent` …)는 그대로 둔다(옛 프런트 호환).
/// `seq` · `state`(전이 결과 — [`Phase`] 또는 `null`) · `agentState`(항목 전체) · `completed` · `notify`.
pub(crate) fn attach(payload: &mut Value, step: &Step) {
    if let Value::Object(map) = payload {
        map.insert("seq".into(), json!(step.next.seq));
        map.insert("state".into(), json!(step.next.state));
        map.insert("agentState".into(), json!(step.next));
        map.insert("completed".into(), json!(step.completed));
        map.insert("notify".into(), json!(step.notify));
    }
}

/// 지금 표 전체 — 창이 부팅·이관 재부착에서 한 번 받아 채운다(그 뒤는 `agent-signal` 이벤트를 seq 로 이어 받는다).
/// 서버 op `agent_states_snapshot`(읽기)이 이것을 돌려준다 — 창 쪽 Tauri 명령은 `crate::server::proxy`.
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

    /// 사람이 끊었다(2026-11-02) — 실행이 끝으로 풀리지만 완료 · 알림은 아니다. 다음 `start` 면 다시 실행.
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
        // 권한 대기 중의 끊음도 끝으로
        let p = apply(&s1.next, &with_detail(SignalEvent::Waiting, "permission"), 15);
        assert_eq!(apply(&p.next, &sig(SignalEvent::Interrupt), 25).next.state, Some(Phase::Finished));
    }

    /// 완료 확인 — 표를 바꾸지 않고, 없는 스트림 · 낡은 seq 는 방송하지 않으며, 몸은 스트림과 seq 뿐이다.
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
        // 더 큰 seq 는 표의 값으로 고쳐 싣는다
        assert_eq!(seen(s, before.seq + 9).unwrap()["seq"], before.seq);
        let after = table().map.get(s).cloned().unwrap();
        assert_eq!((after.seq, after.state, after.at_ms), (before.seq, before.state, before.at_ms), "표는 그대로");
    }

    /// 서버 op 의 몸 — 실행 · 권한 대기일 때만 적고 페이로드(끝 · 완료 아님)를 돌려준다. 모르는 · 끝난 스트림은 손대지 않는다.
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
        // 모르는 id 의 끝 · id 없는 끝은 세지 않는다
        let odd = apply(&stop.next, &sub(SignalEvent::SubagentStop, "zz"), 35);
        assert_eq!(odd.next.subagents, vec!["a1".to_string()]);
        let none = apply(&stop.next, &sig(SignalEvent::SubagentStop), 36);
        assert_eq!(none.next.subagents, vec!["a1".to_string()]);
        // 마지막 서브 에이전트가 끝났고 메인이 멈춰 있다 → 점은 완료지만 알리지 않는다
        let done = apply(&stop.next, &sub(SignalEvent::SubagentStop, "a1"), 40);
        assert!(done.completed && !done.notify, "서브 에이전트의 끝은 알리지 않는다");
        assert_eq!(done.next.state, Some(Phase::Finished));
        assert_eq!(done.next.signal_stop_at, Some(40));
        // 메인이 결과를 받아 다시 돌고 멈춘다 — 그 stop 이 알린다(한 번)
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
        // 옛 신호(cli · session 없음)도 표는 갱신하고, 밝혀진 값은 둔다
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
        // 닫기 — 항목이 사라진다. 다시 서도 seq 는 옛 것보다 크다(창의 낮은 seq 버림과 어긋나지 않게)
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

    /// `session`(10판 — Claude `SessionStart`) — 연결 전용: 대화 id · cli 만 적고 상태는 그대로다(실행 중으로 보이지 않는다).
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

    /// `session-end`(9판) — CLI 가 끝났다: 재료를 비워 상태 `null`, 서브 에이전트 집합도 비운다. 누구였는지(`cli`·대화 id)는
    /// 이벤트에 남고, 표에서는 항목이 사라진다(다음 신호는 새 항목·더 큰 seq). 완료·알림은 서지 않는다.
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

    /// 장부 — `session`·`start` 가 쥐고, 대화 id 가 바뀌면(`/clear`) 옛 것을 놓고, `session-end` · 지우기(새 세션 · 닫기 · 고아 ·
    /// 창이 본 새 CLI)가 놓는다. 다른 스트림이 같은 대화를 쥐면 그 스트림이 놓을 때까지 연결이다.
    #[test]
    fn conversation_ledger_follows_the_streams() {
        let mut t = AgentStates::default();
        t.record(&with_session(SignalEvent::Session, "s1", A), 10);
        assert_eq!(links_of(&mut t, 10), vec![(format!("claude:{A}"), vec!["s1".to_string()], None)]);
        // 같은 대화의 다른 신호 · id 없는 신호 — 그대로
        t.record(&with_session(SignalEvent::Start, "s1", A), 11);
        t.record(&AgentSignal { stream: "s1".into(), ..sig(SignalEvent::Tool) }, 12);
        t.record(&with_session(SignalEvent::Stop, "s1", A), 13);
        assert_eq!(links_of(&mut t, 13)[0].1, vec!["s1".to_string()]);
        // /clear — A 를 놓고 B 를 쥔다
        t.record(&with_session(SignalEvent::Session, "s1", B), 20);
        assert_eq!(
            links_of(&mut t, 20),
            vec![
                (format!("claude:{A}"), vec![], Some(20)),
                (format!("claude:{B}"), vec!["s1".to_string()], None),
            ]
        );
        // 다른 타일(s2)이 B 를 재개 — s1 이 끝나도 B 는 열림
        t.record(&with_session(SignalEvent::Start, "s2", B), 30);
        t.record(&AgentSignal { stream: "s1".into(), ..sig(SignalEvent::SessionEnd) }, 31);
        assert_eq!(links_of(&mut t, 31)[1], (format!("claude:{B}"), vec!["s2".to_string()], None));
        // s2 닫기(토큰 회수 = forget) — 놓인 시각
        t.forget("s2", 40);
        assert_eq!(links_of(&mut t, 40)[1], (format!("claude:{B}"), vec![], Some(40)));
        // 모르는 스트림 지우기 · cli 를 모르는 옛 신호는 장부를 바꾸지 않는다
        t.forget("nope", 41);
        t.record(&AgentSignal { stream: "s3".into(), session: Some(A.into()), ..sig(SignalEvent::Start) }, 42);
        assert_eq!(links_of(&mut t, 42)[0], (format!("claude:{A}"), vec![], Some(20)));
        // 오래 놓인 항목은 빠진다
        assert!(links_of(&mut t, 40 + convo::KEEP_MS).is_empty());
    }

    /// `session-end` 뒤 같은 스트림의 새 CLI 가 같은 대화를 다시 열면(재개) 다시 쥔다.
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

    /// 띄우며 적은 연결 — Codex 재개는 첫 질문 전 신호가 없다. 쓰는 순간 쥐고, **그 재개 명령의 `C`** 는 지우지 않고, 질문 없이 닫으면
    /// (토큰 회수 = `Session`) 그때 놓인다(2026-10-24 — 예전엔 장부에 기록이 없어 시작 때 쓰인 줄로 "밖에서 열림").
    #[test]
    fn launch_link_survives_its_own_cli_start_and_ends_on_close() {
        let mut t = AgentStates::default();
        t.forget("s1", 5); // 새 세션(토큰 발급) — 띄우기 전
        t.note_launch("s1", "codex", &A.to_ascii_uppercase(), 10);
        assert_eq!(links_of(&mut t, 10), vec![(format!("codex:{A}"), vec!["s1".to_string()], None)]);
        t.forget_by("s1", ForgetCause::CliStart, 11); // 그 재개 명령 자신의 `C`
        assert_eq!(links_of(&mut t, 11)[0].1, vec!["s1".to_string()], "재개 명령의 C 는 지우지 않는다");
        t.forget_by("s1", ForgetCause::Replay, 12); // F5 의 링 재생
        assert_eq!(links_of(&mut t, 12)[0].1, vec!["s1".to_string()], "링 재생은 손대지 않는다");
        t.forget("s1", 20); // 타일 닫기
        assert_eq!(links_of(&mut t, 20), vec![(format!("codex:{A}"), vec![], Some(20))]);
    }

    /// 그 뒤의 `C`(같은 셸의 새 CLI) · 셸 복귀(`A`) · `session-end` · 다른 대화 id 의 신호가 띄우며 적은 연결을 끝낸다.
    #[test]
    fn launch_link_ends_on_the_next_cli_shell_return_session_end_or_another_id() {
        // 두 번째 C
        let mut t = AgentStates::default();
        t.note_launch("s1", "codex", A, 10);
        t.forget_by("s1", ForgetCause::CliStart, 11);
        t.forget_by("s1", ForgetCause::CliStart, 12);
        assert_eq!(links_of(&mut t, 12), vec![(format!("codex:{A}"), vec![], Some(12))]);
        // 셸 복귀
        let mut t = AgentStates::default();
        t.note_launch("s1", "codex", A, 10);
        t.forget_by("s1", ForgetCause::ShellReturn, 13);
        assert_eq!(links_of(&mut t, 13), vec![(format!("codex:{A}"), vec![], Some(13))]);
        // session-end
        let mut t = AgentStates::default();
        t.note_launch("s1", "codex", A, 10);
        t.record(&AgentSignal { stream: "s1".into(), cli: Some("codex"), ..sig(SignalEvent::SessionEnd) }, 14);
        assert_eq!(links_of(&mut t, 14), vec![(format!("codex:{A}"), vec![], Some(14))]);
        // 다른 대화 id(`/new` 뒤 첫 질문)
        let mut t = AgentStates::default();
        t.note_launch("s1", "codex", A, 10);
        t.record(&codex(SignalEvent::Start, "s1", B), 15);
        assert_eq!(
            links_of(&mut t, 15),
            vec![(format!("codex:{A}"), vec![], Some(15)), (format!("codex:{B}"), vec!["s1".to_string()], None)]
        );
    }

    /// 같은 대화의 신호는 띄우며 적은 연결과 함께 쥔다 — 첫 질문 뒤 그 타일의 `C` 가 와도 둘 중 하나(여기선 띄운 것)가 쥐면 놓지 않고,
    /// 둘 다 놓일 때 한 번 놓인다.
    #[test]
    fn launch_and_signal_hold_the_same_conversation_together() {
        let mut t = AgentStates::default();
        t.note_launch("s1", "codex", A, 10);
        t.record(&codex(SignalEvent::Start, "s1", A), 11); // 순서가 뒤집혀 신호가 C 보다 먼저 와도
        t.forget_by("s1", ForgetCause::CliStart, 12);
        assert_eq!(links_of(&mut t, 12), vec![(format!("codex:{A}"), vec!["s1".to_string()], None)]);
        t.forget("s1", 20);
        assert_eq!(links_of(&mut t, 20), vec![(format!("codex:{A}"), vec![], Some(20))]);
        // 같은 스트림에 다시 띄우면 옛 것을 놓는다
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

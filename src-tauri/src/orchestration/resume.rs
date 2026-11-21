//! **이어지는 지시**(조정자 `send_prompt`) = `idle` 작업자의 같은 대화를 resume 하는 **새 턴** — PTY 붙여넣기가 아니라 실행 인자다.
//!
//! 불변식:
//! - **AI 문자열 → PTY 길은 없다.** 대상은 사람이 연 앨범의 Run 이 띄운 헤드리스 쓰기형 작업자뿐이고, 글은 셸 없는 인자 배열의 `--` 뒤
//!   `[` 로 시작하는 한 칸으로만 간다(시험 `send_prompt_is_resume_turn_not_pty`) → docs/invariants.md 전문 4.
//! - 관문 · 턴 예약 · 턴 토큰은 **잠금 하나 안에서** — 도는 턴이 있으면 `busy{attemptIds}`(큐 없음). 역할 · 구성은 지금 값으로 다시 본다.
//! - 생성 대기 상한을 넘으면 `started{launching:true}` — 뒤에 못 서면 그 턴이 `failed:spawn-failed` · `idle` · 사건으로 보인다(끝내 모르는 상태는 없다).
//! - 같은 `requestId` 는 효과를 낸 호출만 적는다 — 서지 못한 턴은 다시 시도할 수 있다.
//! - 지시 본문은 영속 · 감사 · 로그에 싣지 않는다(감사에는 길이 · SHA-1 만).

use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::model::*;
use super::spawn::{self, Base, LaunchJob, TurnPlan};
use super::store::{reason, release_request, request_seen, reserve_request, writable, Binding, OrchError, Orchestration};
use super::tools::{coordinator_slot, req_text, request_id};
use crate::audit::OrchestrationAudit;

pub(crate) const TURN_START_WAIT_MS: u64 = 20_000;

/// 머리줄 · 끝맺는 줄 몫을 남긴다.
pub(crate) const RESUME_TEXT_MAX: usize = spawn::PROMPT_ARG_MAX - 512;

fn sha1_hex(s: &str) -> String {
    use sha1::{Digest, Sha1};
    Sha1::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// 메시지는 JSON `{attemptIds, hint}` — 조정자가 기다릴 대상을 읽는다.
fn busy(attempt_id: &str) -> OrchError {
    OrchError::new(
        reason::BUSY,
        json!({
            "attemptIds": [attempt_id],
            "hint": format!("a turn of {attempt_id} is still running — wait with wait_run until=ready attemptIds=[\"{attempt_id}\"], then send again"),
        })
        .to_string(),
    )
}

impl Orchestration {
    pub(super) fn send_prompt(&self, run_id: &str, gen: u32, args: Option<&Value>) -> Result<Value, OrchError> {
        let request_id = request_id(args)?;
        let attempt_id = req_text(args, "attemptId", 64)?;
        let raw = req_text(args, "text", 4 * RESUME_TEXT_MAX)?;
        let text = spawn::sanitize_text(&raw).trim().to_string();
        if text.is_empty() {
            return Err(super::tools::bad("text must not be empty"));
        }
        // 구성 · 역할은 잠금 밖에서 읽는다(파일 · git).
        let lookup = self.run_inputs(run_id);
        let token = crate::token::generate_token().ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
        let now = self.now();
        let (job, n, detail) = {
            let mut g = self.lock();
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            if let Some(first) = request_seen(slot, &request_id, "send_prompt", &super::store::request_sha(args))? {
                return Ok(first);
            }
            writable(&slot.run)?;
            if self.launcher().is_none() {
                return Err(OrchError::new(reason::SPAWN_UNAVAILABLE, "this server cannot start worker turns"));
            }
            let Some(a) = slot.run.attempts.iter().find(|a| a.id == attempt_id).cloned() else {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no attempt {attempt_id} in this run")));
            };
            // 판정형은 한 턴 — 이어지는 지시가 없다.
            if a.kind != Some(AttemptKind::Write) {
                return Err(OrchError::new(
                    reason::NOT_A_WORKER,
                    format!("attempt {attempt_id} is not a headless worker — a judge runs one turn; start a new judge for a new report"),
                ));
            }
            if a.attempt_closed() {
                return Err(if a.state == AttemptState::Reported {
                    OrchError::new(
                        reason::REPORTED,
                        format!("attempt {attempt_id} already reported — accept or reject the task; rework is a new attempt (spawn_worker)"),
                    )
                } else {
                    OrchError::new(reason::CLOSED, format!("attempt {attempt_id} is {} — start a new attempt", a.state.as_str()))
                });
            }
            if a.turn_may_live() {
                return Err(busy(&attempt_id));
            }
            let Some(conversation) = a.conversation_id.clone() else {
                return Err(OrchError::new(
                    reason::NO_CONVERSATION,
                    format!("attempt {attempt_id} has no pinned conversation (its first turn never reported one) — stop it and start a new attempt"),
                ));
            };
            if a.conversation_broken {
                return Err(OrchError::new(
                    reason::CONVERSATION_BROKEN,
                    format!("the conversation of attempt {attempt_id} could not be resumed — stop it (stop_worker) and start a new attempt (reuseWorktreeOf keeps its clean worktree)"),
                ));
            }
            lookup.gate(&slot.run)?;
            let role = lookup.role_for_turn(&slot.run, &a)?;
            lookup.remember(slot);
            super::attempts::check_concurrent_slot(slot)?;
            if slot.run.resume_turns() + slot.run.legacy_deliveries() >= slot.run.limits.max_deliveries {
                return Err(OrchError::new(
                    reason::TURN_LIMIT,
                    format!("this run may start at most {} follow-up turns — they are used up", slot.run.limits.max_deliveries),
                ));
            }
            if text.len() > RESUME_TEXT_MAX {
                return Err(OrchError::new(
                    reason::TEXT_TOO_LONG,
                    format!("the instruction is {} bytes — at most {RESUME_TEXT_MAX} bytes fit in one turn's arguments", text.len()),
                ));
            }
            let (Some(path), Some(branch), Some(base)) = (a.worktree.clone(), a.branch.clone(), a.base_commit.clone()) else {
                return Err(OrchError::new(reason::INVALID_STATE, format!("attempt {attempt_id} has no worktree")));
            };
            let Some(task) = slot.run.task(&a.task_id).cloned() else {
                return Err(OrchError::new(reason::NOT_FOUND, "no such task"));
            };
            // 같은 잠금에서 턴을 예약한다. 이 턴은 지금 세대의 것이다(늦은 보고 판정이 `gen` 을 본다).
            let n = a.turn_no() + 1;
            let run_gen = slot.run.gen;
            if let Some(x) = slot.run.attempts.iter_mut().find(|x| x.id == attempt_id) {
                x.state = AttemptState::Running;
                x.gen = run_gen;
                x.stop_requested = false;
            }
            reserve_request(slot, &request_id, "send_prompt", &super::store::request_sha(args));
            slot.run.bump(now, Actor::Coordinator, "turn_requested", Some(&attempt_id), &format!("turn {n}"));
            let detail = OrchestrationAudit {
                gen: run_gen,
                actor: Actor::Coordinator.as_str().into(),
                task_id: Some(a.task_id.clone()),
                attempt_id: Some(attempt_id.clone()),
                request_id: Some(request_id.clone()),
                turn: Some(n),
                resume: Some(true),
                role_id: Some(role.id.clone()),
                text_len: Some(text.len() as u32),
                text_sha1: Some(sha1_hex(&text)),
                ..Default::default()
            };
            let job = LaunchJob {
                run_id: run_id.to_string(),
                attempt_id: attempt_id.clone(),
                task,
                cli: a.cli,
                repo: slot.run.repo.clone(),
                worktree_dir: slot.run.worktree_dir.clone(),
                base: Base::Commit(base.clone()),
                reuse: Some(spawn::Reuse {
                    path,
                    branch,
                    base_commit: base,
                }),
                token: token.clone(),
                stream: spawn::turn_claim_key(&attempt_id, n),
                session_id: None,
                seed: None,
                review: None,
                turn: TurnPlan {
                    n,
                    resume: Some(conversation),
                    text: Some(text),
                    turn_minutes: lookup.turn_minutes(&slot.run)?,
                    role,
                },
            };
            // 턴 단위 토큰 — 그 턴의 트리 종료 확인 뒤 거둔다.
            g.tokens.push((
                token,
                Binding {
                    role: Role::Worker,
                    run_id: run_id.to_string(),
                    gen: run_gen,
                    attempt_id: Some(attempt_id.clone()),
                },
            ));
            self.after_change(&g, run_id);
            (job, n, detail)
        };
        self.audit("turn_requested", run_id, detail);
        if let Some(l) = self.launcher() {
            l.launch(job);
        }
        let wait = Duration::from_millis(self.turn_start_wait_ms.load(std::sync::atomic::Ordering::SeqCst));
        let started = Instant::now();
        let mut g = self.lock();
        let result = loop {
            let Some(slot) = g.runs.get(run_id) else {
                break json!({ "state": "rejected", "reason": "not-found" });
            };
            let rec = slot
                .run
                .attempts
                .iter()
                .find(|a| a.id == attempt_id)
                .and_then(|a| a.turns.iter().find(|t| t.n == n));
            match rec {
                Some(t) if t.outcome == "failed" && t.reason.as_deref() == Some("spawn-failed") => {
                    break json!({ "state": "rejected", "reason": "spawn-failed", "turn": n, "latestSeq": slot.run.seq });
                }
                Some(_) => break json!({ "state": "started", "turn": n, "latestSeq": slot.run.seq }),
                None => {}
            }
            let waited = started.elapsed();
            if waited >= wait {
                break json!({ "state": "started", "turn": n, "launching": true, "latestSeq": slot.run.seq });
            }
            g = self.changed.wait_timeout(g, wait - waited).unwrap_or_else(|e| e.into_inner()).0;
        };
        if let Some(slot) = g.runs.get_mut(run_id) {
            release_request(slot, &request_id);
            if result["state"] == "started" {
                slot.run.remember(&request_id, "send_prompt", &super::store::request_sha(args), result.clone());
            }
        }
        Ok(result)
    }
}

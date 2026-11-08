//! **이어지는 지시 = 같은 대화를 resume 하는 새 턴**(헤드리스 설계 4-5 · E3 · E8 · D6 · D9 · D14 — 3차 3a). 조정자 `send_prompt` 는 이제
//! PTY 붙여넣기가 아니라 **실행 인자**다: `idle` 작업자 하나에 그 대화를 이어 가는 턴 프로세스 하나를 띄운다(Claude `-p --resume <고정 id>` ·
//! Codex `exec resume <thread>` — 인자 표는 `turn.rs`). 2차의 `deliver.rs`(붙여넣기 · 입력 상태 · 개입 잠금 · `needs-recovery` · [복구 완료])는
//! 이 파일로 대체돼 걷혔다.
//!
//! 불변식:
//! - **AI 문자열 → PTY 길은 없다.** AI 문자열 → 프로세스는 오케스트레이션 턴 하나뿐(첫 지시 · 이 파일의 이어지는 지시): 대상은 **사람이 맡긴
//!   저장소의 Run 이 띄운 헤드리스 작업자**(쓰기형)뿐, 셸 없이 인자 배열(옵션 → `--` → `[` 로 시작하는 지시 하나 — 시험
//!   `send_prompt_is_resume_turn_not_pty`).
//! - **관문은 잠금 하나 안에서 순서대로**(4-5 표): 조정자 · 세대 · Run running · 보류 없음 → 작업자(쓰기형) · 닫히지 않음 → **턴이 도는 중이
//!   아님**(아니면 `busy{attemptIds}` — 큐 없음) → 고정 대화 있음 · 끊기지 않음 → 맡기기 · 역할(지금 값 — CLI · 종류는 사본과 같아야) → 동시 한도 ·
//!   턴 한도 → 글 상한(24 KiB). 통과하면 같은 잠금에서 `running` 을 세우고(턴 예약) 그 턴의 작업자 토큰을 뽑은 뒤 잠금 밖에서 서버 손에 맡긴다.
//! - 결과는 **`started{turn}`**(프로세스가 섰다 — 인자를 받았다) 또는 **`rejected{spawn-failed}`**(서지 못했다 — 아무것도 전달되지 않았다 ·
//!   Attempt 는 `idle` 그대로)다. 다만 **예약 수락과 실제 시작이 나뉠 수 있다**: 생성 결과를 [`TURN_START_WAIT_MS`] 안에 못 보면
//!   `started{turn, launching: true}`(예약은 섰고 서버 손이 아직 띄우는 중) — 그 뒤 서지 못하면 그 턴 기록이 `failed:spawn-failed` ·
//!   Attempt 는 `idle` · 사건 `spawn_failed`(+ 알림)로 `wait_run` · `get_run` 에 보인다. 결과를 끝내 모르는 전달(`pasted-unconfirmed` ·
//!   `needs-recovery`)은 없다 — 인자 전달은 원자적이다. (기다리는 동안 Run 이 사라지면 `rejected{not-found}`.)
//! - 같은 `requestId` 는 처음 결과(효과를 낸 호출만 적는다 — 거절은 아무 일도 없었으니 다시 시도한다). 도는 동안은 `request-in-progress`.
//! - 지시 본문은 영속 · 감사 · 로그에 싣지 않는다(감사 `turn_requested` 에 길이 · SHA-1 만 — 1차 E-2).

use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::model::*;
use super::spawn::{self, Base, LaunchJob, TurnPlan};
use super::store::{reason, release_request, request_seen, reserve_request, writable, Binding, OrchError, Orchestration};
use super::tools::{coordinator_slot, req_text, request_id};
use crate::audit::OrchestrationAudit;

/// 생성 결과를 기다리는 상한(제품) — 이어지는 턴은 worktree 를 만들지 않으므로 보통 1초 안에 선다.
pub(crate) const TURN_START_WAIT_MS: u64 = 20_000;

/// 인자 본문 상한(정화 뒤 · 머리줄 · 끝맺는 줄 몫을 남긴다 — 1b `PROMPT_ARG_MAX` 24 KiB).
pub(crate) const RESUME_TEXT_MAX: usize = spawn::PROMPT_ARG_MAX - 512;

fn sha1_hex(s: &str) -> String {
    use sha1::{Digest, Sha1};
    Sha1::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// `busy` 의 거절(메시지 = JSON `{attemptIds, hint}` — 기다릴 대상을 돌려준다 · D14).
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
    /// 조정자 `send_prompt{requestId, attemptId, text}` — `idle` 작업자 하나의 같은 대화를 이어 가는 새 턴(머리말).
    pub(super) fn send_prompt(&self, run_id: &str, gen: u32, args: Option<&Value>) -> Result<Value, OrchError> {
        let request_id = request_id(args)?;
        let attempt_id = req_text(args, "attemptId", 64)?;
        let raw = req_text(args, "text", 4 * RESUME_TEXT_MAX)?;
        let text = spawn::sanitize_text(&raw).trim().to_string();
        if text.is_empty() {
            return Err(super::tools::bad("text must not be empty"));
        }
        // 맡기기 · 역할을 지금 읽는다(잠금 밖 — 파일 · git).
        let lookup = self.run_inputs(run_id);
        let token = crate::token::generate_token().ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
        let now = self.now();
        let (job, n, detail) = {
            let mut g = self.lock();
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            if let Some(first) = request_seen(slot, &request_id, "send_prompt", &super::store::request_sha(args))? {
                return Ok(first);
            }
            // ① Run running · 보류 없음(조정자 · 세대는 위에서).
            writable(&slot.run)?;
            if self.launcher().is_none() {
                return Err(OrchError::new(reason::SPAWN_UNAVAILABLE, "this server cannot start worker turns"));
            }
            let Some(a) = slot.run.attempts.iter().find(|a| a.id == attempt_id).cloned() else {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no attempt {attempt_id} in this run")));
            };
            // ② 작업자(쓰기형)이고 닫히지 않음. 판정형은 한 턴 — 이어지는 지시가 없다. 옛 PTY 작업자(2차 파일)도 아니다.
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
            // ③ 턴이 도는 중이 아님(4-5 — 큐 없음).
            if a.turn_may_live() {
                return Err(busy(&attempt_id));
            }
            // ④ 고정 대화(E8 · D6).
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
            // ⑤ 맡기기 · 역할(지금 값 — E5 · E17).
            lookup.gate(&slot.run)?;
            let role = lookup.role_for_turn(&slot.run, &a)?;
            lookup.remember(slot);
            // ⑥ 동시 한도 · 턴 한도.
            super::attempts::check_concurrent_slot(slot)?;
            if slot.run.resume_turns() + slot.run.legacy_deliveries() >= slot.run.limits.max_deliveries {
                return Err(OrchError::new(
                    reason::TURN_LIMIT,
                    format!("this run may start at most {} follow-up turns — they are used up", slot.run.limits.max_deliveries),
                ));
            }
            // ⑦ 글 상한(정화 뒤).
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
            // 통과 — 같은 잠금에서 턴을 예약한다(`running` — 지금 `Slot.delivering` 의 자리 · 4-5). 이 턴은 지금 세대의 것이다(늦은 보고 판정).
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
            // 이 턴의 작업자 토큰(턴 단위 — 그 턴의 트리 종료 확인 뒤 거둔다 · D9).
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
        // 생성 결과를 기다린다(잠금은 자는 동안 풀린다) — 섰다(턴 기록 n 이 `running` · 끝) · 못 섰다(`failed:spawn-failed`).
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
                // 서버 손이 아직 생성 중이다(드묾) — 예약은 섰고 프로세스는 곧 선다 · 서지 못하면 Attempt 는 `idle` 로 돌아온다.
                break json!({ "state": "started", "turn": n, "launching": true, "latestSeq": slot.run.seq });
            }
            g = self.changed.wait_timeout(g, wait - waited).unwrap_or_else(|e| e.into_inner()).0;
        };
        if let Some(slot) = g.runs.get_mut(run_id) {
            release_request(slot, &request_id);
            // 효과를 낸 호출만 적는다 — 서지 못한 턴(`rejected`)은 아무것도 전달하지 않았으니 같은 requestId 로 다시 시도할 수 있다.
            if result["state"] == "started" {
                slot.run.remember(&request_id, "send_prompt", &super::store::request_sha(args), result.clone());
            }
        }
        Ok(result)
    }
}

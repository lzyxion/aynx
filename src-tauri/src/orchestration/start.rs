//! 프로듀서의 앨범 이어받기와 조율 요청. 새 앨범은 사람 시작 op만 연다.

use serde_json::{json, Value};

use super::model::*;
use super::store::{bind_seat, coordinates, has_coordinator, reason, unbind_coordinator, OrchError, Orchestration, Seat, Slot};
use crate::server::chat_proc::ProcId;
use super::tools::{bad, req_text, request_id};

/// 조정자가 되기 **전**에도 부를 수 있는 프로듀서 도구(이름은 옛 "타일" 그대로).
pub(crate) const TILE_TOOLS: &[&str] = &["adopt_run"];

/// 채팅 하나 = 앨범 하나.
fn already_produced(run_id: &str) -> OrchError {
    OrchError::new(
        reason::ALREADY_PRODUCED,
        json!({ "runId": run_id, "hint": "this chat already made an album — keep working in it (adopt_run with this runId if you are not its coordinator); a new album needs a new chat" }).to_string(),
    )
}

/// 그 세대의 토큰 칸으로 본다(표 잠금 안에서 — L1 → L2).
fn seat_alive(seat: &Seat) -> bool {
    crate::chat_token::still_current(&seat.chat, seat.proc)
}

/// 낱말 `not-a-tile` 은 옛 이름 그대로다.
fn caller_gone(what: &str) -> OrchError {
    OrchError::new(
        reason::NOT_A_TILE,
        format!("this producer process ended while the album was being {what} — nothing was bound to this chat; tell the person"),
    )
}

// 시험 이음매 — 묶음을 세우는 잠금 **바로 앞**에서 한 번 부른다(경쟁을 결정적으로 끼운다). 제품 빌드에서는 빈 함수.
#[cfg(test)]
thread_local! {
    static BEFORE_BIND: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(super) fn set_before_bind(f: impl FnOnce() + 'static) {
    BEFORE_BIND.with(|h| *h.borrow_mut() = Some(Box::new(f)));
}

pub(super) fn before_bind() {
    #[cfg(test)]
    if let Some(f) = BEFORE_BIND.with(|h| h.borrow_mut().take()) {
        f();
    }
}

fn already(run_id: &str, gen: u32) -> OrchError {
    OrchError::new(
        reason::ALREADY_COORDINATING,
        json!({ "runId": run_id, "gen": gen, "hint": "this chat already coordinates that album — keep coordinating it (get_run)" }).to_string(),
    )
}

pub(crate) fn tile_tool_schemas() -> Vec<Value> {
    vec![
        json!({
            "name": "adopt_run",
            "description": "Takes over a paused run with no coordinator (its producer ended) when the person asks you to continue it: this chat becomes its coordinator (gen + 1). It runs again at once if its producer ended; if a person paused it, it stays paused (paused: true) until they resume. Other runs: not-adoptable. Returns {runId, gen}.",
            "inputSchema": {
                "type": "object",
                "properties": { "requestId": { "type": "string" }, "runId": { "type": "string" } },
                "required": ["requestId", "runId"],
                "additionalProperties": false
            }
        }),
    ]
}

pub(crate) fn complete_run_schema() -> Value {
    json!({
        "name": "complete_run",
        "description": "Completes your run when nothing is open (else not-completable): closes idle workers and exports the integration branch. Returns {state, export {ok, branch} or {ok: false, reason}, serverTemp} — if export failed, tell the person to use [Export as branch] on the album page. serverTemp counts only the app's temp folders: worker worktrees and branches stay — the person removes them with [Clean up worktrees] in the album menu. You cannot merge: the person uses [Merge] on the album page, or the album merged itself if they turned on auto-merge — autoMerge in the result says what happened; tell them, and that nothing is pushed.",
        "inputSchema": {
            "type": "object",
            "properties": { "runId": { "type": "string" }, "gen": { "type": "number" }, "requestId": { "type": "string" } },
            "required": ["runId", "gen", "requestId"],
            "additionalProperties": false
        }
    })
}

/// **블로킹**.
pub(crate) fn repo_toplevel(dir: &str) -> Result<String, OrchError> {
    use super::git::{child_env, Git};
    let p = std::path::Path::new(dir);
    if !p.is_absolute() || !p.is_dir() {
        return Err(bad("this folder is not an existing folder"));
    }
    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let g = Git::new(p, &hooks, &env, reason::NOT_A_REPO)?;
    let top = g
        .ok(&["rev-parse", "--show-toplevel"], &[], None)
        .map_err(|_| OrchError::new(reason::NOT_A_REPO, "this folder is not inside a git repository"))?;
    let top = top.trim();
    if top.is_empty() {
        return Err(OrchError::new(reason::NOT_A_REPO, "git did not name a repository root"));
    }
    // git 은 `/` 구분자로 말한다 — 비교하는 쪽(`worktree::comparable`)이 구분자를 편다.
    Ok(top.to_string())
}

impl Orchestration {
    /// 멱등 기록은 역할 판정보다 **먼저** 그 세대의 토큰 칸에서 찾는다(→ docs/invariants.md 전문 9). `now` 는 기록에 싣지 않는다.
    /// 호출자의 `(chat, proc)` 은 인증 때 확정한 그대로 — 여기서 지금 세대를 다시 읽지 않는다.
    pub(super) fn producer_tool(&self, chat: &str, proc: ProcId, name: &str, args: Option<&Value>) -> Result<Value, String> {
        let seat = Seat { chat: chat.to_string(), proc };
        if TILE_TOOLS.contains(&name) || name == "complete_run" {
            let req = request_id(args).map_err(|e| e.to_string())?;
            let input = without_request_id(args);
            let out = crate::chat_token::with_request(chat, proc, &req, name, &input, || self.seat_tool_body(&seat, name, args))?;
            return Ok(self.with_now(out));
        }
        let c = self.seat_coordinator(&seat, name, args).map_err(|e| e.to_string())?;
        let out = self.call_tool(&c, name, args)?;
        self.note_seen(&seat, name, &out);
        Ok(out)
    }

    fn seat_tool_body(&self, seat: &Seat, name: &str, args: Option<&Value>) -> Result<Value, String> {
        let out = match name {
            "adopt_run" => self.adopt_run_seat(seat, args).map_err(|e| e.to_string())?,
            // 역할 판정은 기록 **안** — 성공 뒤 Run 이 끝나 묶음이 풀려도 재시도는 처음 결과.
            _ => {
                let c = self.seat_coordinator(seat, name, args).map_err(|e| e.to_string())?;
                self.call_tool(&c, name, args)?
            }
        };
        self.note_seen(seat, name, &out);
        Ok(out)
    }

    /// 잠정 커서 — 성공 응답으로 그 자리에 돌려준 스냅숏 범위만 올린다(오류 · 풀린 자리 · 취소된 대기는 올리지 못한다).
    fn note_seen(&self, seat: &Seat, name: &str, out: &Value) {
        if !matches!(name, "get_run" | "wait_run" | "adopt_run") {
            return;
        }
        let Some(seq) = out.get("latestSeq").and_then(Value::as_u64) else { return };
        let mut g = self.lock();
        if let Some(slot) = g.runs.values_mut().find(|s| coordinates(s, seat)) {
            slot.cursor.pending = slot.cursor.pending.max(seq);
        }
    }

    /// 멱등 재시도가 처음 결과와 함께 지금 상태를 보게 한다.
    fn with_now(&self, mut out: Value) -> Value {
        let Some(run_id) = out.get("runId").and_then(Value::as_str).map(str::to_string) else { return out };
        let now = {
            let g = self.lock();
            g.runs.get(&run_id).map(|s| {
                json!({
                    "state": s.run.state,
                    "gen": s.run.gen,
                    "coordinating": s.coordinator.as_ref().filter(|(gen, _)| *gen == s.run.gen).is_some()
                        && matches!(s.run.state, RunState::Running | RunState::Paused),
                })
            })
        };
        if let (Some(now), Some(o)) = (now, out.as_object_mut()) {
            o.insert("now".into(), now);
        }
        out
    }

    /// 대상 판정은 [`adopt_verdict`] 하나(목록 요약의 `adoptable` 과 같은 함수).
    fn adopt_run_seat(&self, seat: &Seat, args: Option<&Value>) -> Result<Value, OrchError> {
        let run_id = req_text(args, "runId", 64)?;
        if crate::chat_token::album_of(&seat.chat, seat.proc).is_some_and(|id| id != run_id) {
            return Err(OrchError::new("out-of-scope:run", "토큰에 귀속된 앨범만 이어받을 수 있습니다"));
        }
        if let Some((other, gen)) = self.bound_seat(seat) {
            if other != run_id {
                return Err(already(&other, gen));
            }
        }
        // 앨범 구성 조회는 잠금 밖에서(파일 · git) — 판정은 잠금 안에서 그 Run 의 신원 사본과 함께.
        let lookup = self.run_inputs(&run_id);
        let studio = crate::chat_token::repo_of(&seat.chat, seat.proc).ok_or_else(|| caller_gone("taken over"))?;
        let now = self.now();
        before_bind();
        let (result, gen, state) = {
            let mut g = self.lock();
            // 부른 자리의 생존은 묶는 이 잠금 안에서 다시 본다 — 아니면 Run 은 손대지 않는다.
            if !seat_alive(seat) {
                return Err(caller_gone("taken over"));
            }
            if let Some((id, s)) = g.runs.iter().find(|(id, s)| id.as_str() != run_id && coordinates(s, seat)) {
                return Err(already(id, s.run.gen));
            }
            if let Some(other) = g.producer_ever.get(&seat.chat).filter(|r| **r != run_id) {
                return Err(already_produced(other));
            }
            let slot = g.runs.get_mut(&run_id).ok_or_else(super::store::not_found_run)?;
            if crate::chat_token::album_of(&seat.chat, seat.proc).as_deref() != Some(&run_id) {
                return Err(OrchError::new("out-of-scope:run", "사람이 이 채팅에 연 이어받기 대상이 아닙니다"));
            }
            if crate::worktree::comparable(&studio) != crate::worktree::comparable(&slot.run.repo) {
                return Err(OrchError::new(
                    reason::OUT_OF_SCOPE_REPO,
                    "that album belongs to another studio — a producer chat takes over albums of its own studio only",
                ));
            }
            let verdict = adopt_verdict(slot, now);
            if slot.run.state == RunState::Orphaned {
                return Err(super::store::not_found_run());
            }
            if let Some(why) = verdict.why {
                return Err(OrchError::new(
                    reason::NOT_ADOPTABLE,
                    json!({
                        "why": why,
                        "hint": "only a paused run with no coordinator (not on hold, within its coordination time) can be taken over — a person resumes or stops the others on the album page",
                    })
                    .to_string(),
                ));
            }
            if !slot.run.producers.contains(&seat.chat) && slot.run.producers.len() >= PRODUCERS_MAX {
                return Err(OrchError::new(
                    reason::NOT_ADOPTABLE,
                    json!({ "why": "too-many-producers", "hint": "this album was taken over too many times — tell the person" }).to_string(),
                ));
            }
            lookup.gate(&slot.run)?;
            slot.run.gen += 1;
            let gen = slot.run.gen;
            // 옛 세대가 요청한 통합 작업은 커밋 단계 전이면 거둔다.
            super::integrate::abort_cancellable(slot, now, Actor::Coordinator, "generation");
            unbind_coordinator(slot);
            bind_seat(slot, gen, seat.clone());
            if !slot.run.producers.contains(&seat.chat) {
                slot.run.producers.push(seat.chat.clone());
            }
            // 사람이 멈춘 Run 은 귀속만 복원하고 paused 그대로 — 사람이 [재개] 해야 돈다(→ docs/invariants.md 전문 9).
            let resumed = verdict.auto_resume;
            if resumed {
                slot.run.state = RunState::Running;
                slot.run.pause_reason = None;
            }
            let seq = slot.run.bump(now, Actor::Coordinator, "run_adopted", None, &format!("gen {gen}"));
            self.raise(slot, "run-adopted", None, None);
            lookup.remember(slot);
            g.producer_ever.insert(seat.chat.clone(), run_id.clone());
            self.after_change(&g, &run_id);
            let mut v = json!({ "runId": run_id, "gen": gen, "latestSeq": seq });
            if !resumed {
                v["paused"] = json!(true);
                v["hint"] = json!("a person paused this run — wait_run until it is resumed");
            }
            (v, gen, if resumed { RunState::Running } else { RunState::Paused })
        };
        self.audit(
            "run_adopted",
            &run_id,
            crate::audit::OrchestrationAudit {
                gen,
                actor: Actor::Coordinator.as_str().into(),
                run_state: Some(state.as_str().into()),
                ..Default::default()
            },
        );
        Ok(result)
    }

    pub(super) fn coordinator_complete(&self, run_id: &str, gen: u32, args: Option<&Value>) -> Result<Value, OrchError> {
        self.complete_run_by(run_id, Actor::Coordinator, Some((gen, args)))
    }

}

fn without_request_id(args: Option<&Value>) -> Value {
    let mut input = args.cloned().unwrap_or_else(|| json!({}));
    if let Some(o) = input.as_object_mut() {
        o.remove("requestId");
    }
    input
}

/// 이어받기 판정 — `adopt_run` 과 목록 요약(`adoptable`)이 **같은 함수**를 부른다. `auto_resume` 은 조정자 CLI 가 끝나 멈춘 Run 만이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AdoptVerdict {
    pub restore: bool,
    pub auto_resume: bool,
    pub why: Option<&'static str>,
}

impl AdoptVerdict {
    fn no(why: &'static str) -> AdoptVerdict {
        AdoptVerdict { restore: false, auto_resume: false, why: Some(why) }
    }

    pub(crate) fn view(&self) -> Value {
        let mut v = json!({ "restore": self.restore, "autoResume": self.auto_resume });
        if let Some(w) = self.why {
            v["why"] = json!(w);
        }
        v
    }
}

pub(crate) fn adopt_verdict(slot: &Slot, now: u64) -> AdoptVerdict {
    match slot.run.state {
        RunState::Paused => {
            let reason_word = slot.run.pause_reason.as_deref();
            if slot.run.hold.is_some() {
                AdoptVerdict::no("on-hold")
            } else if reason_word == Some("coordination-limit") || now >= slot.run.coordination_deadline_at {
                AdoptVerdict::no("coordination-limit")
            } else if has_coordinator(slot) {
                AdoptVerdict::no(if reason_word == Some("human") { "paused-by-person" } else { "has-coordinator" })
            } else {
                AdoptVerdict { restore: true, auto_resume: reason_word == Some("coordinator-exited"), why: None }
            }
        }
        RunState::Running => AdoptVerdict::no("running"),
        RunState::Orphaned => AdoptVerdict::no("not-found"),
        _ => AdoptVerdict::no("ended"),
    }
}

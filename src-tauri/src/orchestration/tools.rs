//! 오케스트레이션 MCP 조율 도구 — 조정자 · 작업자 · 검토자. 스키마 · 설명은 영어 계약 글자다(MCP 표면은 표시 언어를 타지 않는다).
//!
//! 불변식:
//! - 도구는 역할에 따라서만 보이고 불린다 — 역할은 `/mcp` 인증이 서버 표에서 정한 [`Caller`] 다. 전역 토큰 · 타일 토큰에는 이 도구들이 없다
//!   (전역의 조율은 `not-a-tile`, 타일은 모르는 도구).
//! - 조정자의 조율은 자기 Run 안에서만 — 다른 `runId` 는 `not-found`(있는지 없는지도 흘리지 않는다). 조정자는 프로듀서 채팅의 호출자를
//!   서버 표의 묶음과 요청의 필수 `runId` · `gen` 으로 올린 것이다(`tile.rs`).
//! - 쓰기 도구의 같은 `(runId, requestId)` 는 처음 결과를 돌려준다 — 효과가 난 호출만 적으므로 거절된 호출은 같은 id 로 다시 시도할 수 있다.
//! - 키 전송 · 권한 응답 · 승인 · 실행 · 위임(역할 · 수락 규칙) 편집 도구는 어느 역할에도 없다. `send_prompt` 는 키 전송이 아니라 같은 대화를
//!   resume 하는 새 턴 하나다(`resume.rs`) — PTY 에 쓰는 길은 없다.
//! - `wait_run` 은 컨텍스트(거울) 잠금을 잡지 않는다(`mcp/rpc.rs` 가 그 앞에서 갈라낸다).

use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::model::*;
use super::store::{
    admit_call, check_dependencies, conflict, not_found_run, reason, state_error, view, writable, Caller, Inner,
    OrchError, Orchestration, Slot,
};
use crate::audit::OrchestrationAudit;

pub(crate) const COORDINATOR_TOOLS: &[&str] = &[
    "get_run",
    "create_task",
    "update_task",
    "wait_run",
    "spawn_worker",
    "stop_worker",
    "send_prompt",
    "read_worker",
    "get_diff",
    "complete_run",
];
pub(crate) const WORKER_TOOLS: &[&str] = &["get_task", "commit_changes", "report_done"];
/// 커밋 · 보고(`report_done`) · 조율 도구는 없다.
pub(crate) const REVIEWER_TOOLS: &[&str] = &["get_task", "get_diff", "report_review"];

const TITLE_MAX: usize = 200;
const GOAL_MAX: usize = 16 * 1024;
const TEXT_MAX: usize = 4 * 1024;
const REQUEST_ID_MAX: usize = 128;

const WAIT_DEFAULT_SECONDS: u64 = 60;
const WAIT_MAX_SECONDS: u64 = 120;

/// 프로듀서는 조율 도구 이름이면 늘 이 갈래로 온다 — 조정자인지는 [`Orchestration::call_tool`] 이 서버 표에서 판정한다.
/// 타일에는 이 갈래가 없어야 한다 — 조율 도구 이름이 모르는 도구로 거절된다(시험 `tile_token_cannot_open_or_coordinate`).
pub(crate) fn is_tool_for(caller: &Caller, name: &str) -> bool {
    match caller {
        Caller::Global | Caller::SideChat { .. } | Caller::Tile { .. } => false,
        // `adopt_run` 은 프로듀서 채팅만(조정자가 되기 전에도).
        Caller::Producer { .. } => COORDINATOR_TOOLS.contains(&name) || super::start::TILE_TOOLS.contains(&name),
        Caller::Coordinator { .. } => COORDINATOR_TOOLS.contains(&name),
        Caller::Worker { .. } => WORKER_TOOLS.contains(&name),
        Caller::Reviewer { .. } => REVIEWER_TOOLS.contains(&name),
    }
}

// 프로듀서 채팅은 깨움 턴마다 이 스키마를 싣는다 — 조율 스키마의 합은 예산 안이어야 한다(시험 `coordination_schemas_fit_budget`).
// 그래서 칸 설명은 비우고 `runId` · `gen` · `requestId` 의 뜻은 INSTRUCTIONS(`mcp/schema.rs`) · `get_run` 설명에 한 번만 둔다.

fn run_id_req() -> Value {
    json!({ "type": "string" })
}

fn gen_prop() -> Value {
    json!({ "type": "number" })
}

fn request_id_prop() -> Value {
    json!({ "type": "string" })
}

/// 예산 밖 — 작업자 · 검토자는 INSTRUCTIONS 의 조정자 절을 받지 않는다.
fn worker_request_id_prop() -> Value {
    json!({ "type": "string", "description": "a unique id you choose for this write (≤128 chars). Retrying with the same requestId returns the first result instead of doing it twice — reuse it exactly when you retry after a lost response, never for a different call (request-id-reused)." })
}

fn s() -> Value {
    json!({ "type": "string" })
}

fn ids() -> Value {
    json!({ "type": "array", "items": { "type": "string" } })
}

pub(crate) fn coordinator_tool_schemas() -> Vec<Value> {
    vec![
        json!({
            "name": "get_run",
            "description": "Reads your run: tasks (version, state, acceptReadiness), attempts (idle — continue with send_prompt; blocked — tell the person what it needs), jobs (awaiting-approval waits for a person), reviewState, roles (pick by id), acceptRules. Every other tool requires runId and gen from this answer.",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": run_id_req(), "gen": gen_prop() },
                "additionalProperties": false
            }
        }),
        json!({
            "name": "create_task",
            "description": "Adds a todo task: title, goal, optional scope, doneWhen, dependsOn. On run-paused, wait_run then retry with the same requestId.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runId": run_id_req(),
                    "gen": gen_prop(),
                    "requestId": request_id_prop(),
                    "title": s(),
                    "goal": s(),
                    "scope": s(),
                    "doneWhen": s(),
                    "dependsOn": ids()
                },
                "required": ["runId", "gen", "requestId", "title", "goal"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "update_task",
            "description": "Edits a todo task, or sets state alone: cancelled, accepted or rejected (reported tasks). Pass the version you read. Read get_diff before accepting. Accepting is asynchronous — the app verifies and integrates it; wait_run until=settled: accepted, conflict (needsHuman false: spawn_worker resolves it) or reported again (never cover a failed verification by accepting again). \
Refused: accept-rule-unmet {unmet, hint}, review-pending (wait_run until=reviewed), verify-failed, git-unsupported. A rejection closes the task's open worker; rework = spawn_worker again (rework-limit: tell the person).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runId": run_id_req(),
                    "gen": gen_prop(),
                    "requestId": request_id_prop(),
                    "taskId": s(),
                    "version": gen_prop(),
                    "title": s(),
                    "goal": s(),
                    "scope": s(),
                    "doneWhen": s(),
                    "dependsOn": ids(),
                    "state": { "type": "string", "enum": ["accepted", "rejected", "cancelled"] }
                },
                "required": ["runId", "gen", "requestId", "taskId", "version"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "wait_run",
            "description": "Waits server-side (≤120 s). until: any (an event after afterSeq), ready (an attemptIds worker is idle or past it), reported, settled (no taskIds task integrating or verifying), reviewed (no judge running).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runId": run_id_req(),
                    "gen": gen_prop(),
                    "afterSeq": gen_prop(),
                    "until": { "type": "string", "enum": ["any", "ready", "reported", "settled", "reviewed"] },
                    "attemptIds": ids(),
                    "taskIds": ids(),
                    "timeoutSeconds": gen_prop()
                },
                "required": ["runId", "gen"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "spawn_worker",
            "description": "Starts a role (id from get_run roles) for a task, headless: nobody answers prompts — denied work comes back as blocked. write: a worker in a new worktree from the integration head (reuseWorktreeOf: an earlier clean attempt; on a conflict task, a resolver). judge: reviews the current report read-only, one turn. Then wait_run. \
Refused: repo-changed (tell the person, do not retry), task-busy, rework-limit, worker-limit.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runId": run_id_req(),
                    "gen": gen_prop(),
                    "requestId": request_id_prop(),
                    "taskId": s(),
                    "role": s(),
                    "reuseWorktreeOf": s()
                },
                "required": ["runId", "gen", "requestId", "taskId", "role"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "stop_worker",
            "description": "Stops and closes one attempt; its worktree is kept.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runId": run_id_req(),
                    "gen": gen_prop(),
                    "requestId": request_id_prop(),
                    "attemptId": s()
                },
                "required": ["runId", "gen", "requestId", "attemptId"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "send_prompt",
            "description": "Continues an idle worker with a new turn of its conversation. Returns {state: started} or {state: rejected} (nothing sent); started with launching:true means the turn is still starting — if it fails, wait_run shows the attempt idle again. No queue: busy {attemptIds} while a turn runs — wait_run until=ready attemptIds=<those>, then send again. Refused when reported or closed (start a new attempt).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runId": run_id_req(),
                    "gen": gen_prop(),
                    "requestId": request_id_prop(),
                    "attemptId": s(),
                    "text": s()
                },
                "required": ["runId", "gen", "requestId", "attemptId", "text"],
                "additionalProperties": false
            }
        }),
    ]
    .into_iter()
    .chain(std::iter::once(read_worker_schema()))
    .chain(std::iter::once(get_diff_schema()))
    .chain(std::iter::once(super::start::complete_run_schema()))
    .collect()
}

fn get_diff_schema() -> Value {
    json!({
        "name": "get_diff",
        "description": "Reads a report's change at fixed commits: no path = changed files (≤500), path = that file's patch by page. truncated: true — never claim you read it all.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "runId": run_id_req(),
                "gen": gen_prop(),
                "taskId": s(),
                "reportId": s(),
                "path": s(),
                "page": gen_prop()
            },
            "required": ["runId", "gen", "taskId"],
            "additionalProperties": false
        }
    })
}

fn read_worker_schema() -> Value {
    json!({
        "name": "read_worker",
        "description": "Reads a worker's pinned conversation forward from cursor (omit it first, then pass the returned one), its changed files and state.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "runId": run_id_req(),
                "gen": gen_prop(),
                "attemptId": s(),
                "cursor": s()
            },
            "required": ["runId", "gen", "attemptId"],
            "additionalProperties": false
        }
    })
}

pub(crate) fn worker_tool_schemas() -> Vec<Value> {
    vec![
        json!({
            "name": "get_task",
            "description": "Reads the task you were started for: title, goal, scope, doneWhen and its state. Read-only — only your own task is visible. If you were started to resolve an integration conflict it also returns conflictResolution: the conflicting files (path, kind, base/ours/theirs blob ids — read them with git show <blob>), the integration head and the rules.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }),
        json!({
            "name": "report_done",
            "description": "Reports how your task went — call it before you end your turn. outcome success or failure is your final report (once — the app records the worktree's HEAD commit, whether it has uncommitted changes and the changed files itself; commit with commit_changes first). \
    outcome **blocked** is not final: use it when something you need was denied (a command, network access, a folder) — say exactly what in summary/notes and do not revert your changes. Your attempt stays open with your work in the worktree; the coordinator tells a person and resumes you in this same conversation once it is allowed (you may commit and report again then). \
    A success report with uncommitted changes cannot be accepted, nor one whose worktree left its branch or whose HEAD does not descend from the task's base (mismatch). noChanges: true means your branch has no new commit and nothing changed. A report is not an acceptance — the coordinator or a person reviews it. \
    If you resolve an integration conflict, a success report must list every conflicting file in resolved [{path, how}] (unresolved-conflicts otherwise) and the reported commit must have no conflict markers left in them (conflict-markers-left) — both refusals record nothing: fix it and call report_done again. \
    Refused with already-reported (you already reported success or failure — retry with the same requestId to read the first result) or stale-attempt (a newer worker owns the task). After report_done, end your turn. \
    Returns: {reportId, commitOid, dirty, changedFiles, late, taskState, warning?} — for blocked {blocked: true, note}.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "requestId": worker_request_id_prop(),
                    "outcome":{ "type": "string", "enum": ["success", "failure", "blocked"] },
                    "summary": { "type": "string", "description": "what you did and the result, for the reviewer (≤8 KiB)" },
                    "notes": { "type": "string", "description": "optional: anything the reviewer should know — open problems, why you are blocked (≤16 KiB)" },
                    "resolved": {
                        "type": "array",
                        "description": "conflict resolvers only: one item per conflicting file — how you resolved it (≤500 characters)",
                        "items": {
                            "type": "object",
                            "properties": { "path": { "type": "string" }, "how": { "type": "string" } },
                            "required": ["path", "how"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["requestId", "outcome", "summary"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "commit_changes",
            "description": "Commits changes in your own worktree — **the app runs git for you** (you do not need write access to .git). You decide what to commit: selection \"all\" (every change in your worktree: added, modified, deleted and new files that are not ignored) or {paths: [files relative to your worktree]} (only those files — the rest stays uncommitted and is listed in remaining). \
    The commit goes to your attempt's branch only, with the repository's git identity and trailers naming your task and attempt; hooks do not run. You cannot choose the folder, branch, author or git options. \
    Pass expectedHead (the commit you think your branch is at) to make sure nothing moved meanwhile. You may commit several times; call report_done once at the end. \
    Refused with head-moved (your branch moved — read it and retry with a new requestId), branch-mismatch (switch back to your branch), nothing-to-commit, path-outside (a path outside your worktree or under .git), filters-configured (a file uses a git clean/process filter such as Git LFS — tell the person, they must commit it), conflict-markers-left (you resolve a conflict and a conflicting file still has conflict markers), no-git-identity (a person must set user.name / user.email), already-reported, stale-attempt. \
    Retrying with the same requestId returns the first result. Returns: {commitSha, parent, branch, files, remaining, remainingTruncated, latestSeq, warning?}.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "requestId": worker_request_id_prop(),
                    "message":{ "type": "string", "description": "the commit message (≤8 KiB) — the first line is the subject" },
                    "selection": {
                        "description": "\"all\", or {\"paths\": [\"src/a.rs\", …]} (files relative to your worktree, at most 500)",
                        "oneOf": [
                            { "type": "string", "enum": ["all"] },
                            {
                                "type": "object",
                                "properties": { "paths": { "type": "array", "items": { "type": "string" } } },
                                "required": ["paths"],
                                "additionalProperties": false
                            }
                        ]
                    },
                    "expectedHead": { "type": "string", "description": "optional: the commit id your branch should be at now (7..40 hex)" }
                },
                "required": ["requestId", "message", "selection"],
                "additionalProperties": false
            }
        }),
    ]
}

pub(crate) fn reviewer_tool_schemas() -> Vec<Value> {
    vec![
        json!({
            "name": "get_task",
            "description": "Reads your review assignment: the task (title, goal, scope, doneWhen), the worker's report you review (outcome, summary, notes, changed files), the fixed commits (base … commit) and the read-only folder where that commit is checked out. Read-only — only your own task and report.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }),
        json!({
            "name": "get_diff",
            "description": "Reads the change you review, at its fixed commits (base … the reported commit — the task's own change, not the integration result). Read-only.     Without path it lists the changed files: {path, status, adds, dels, binary, oldPath?} — at most 500; fileCount is the full count.     With path (one of the listed paths) it returns that file's patch one page at a time (32 KiB pages): pass page 1, 2 … up to pages.     truncated: true means you did not get everything — never claim you read a truncated diff in full.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "optional: one listed file path — returns its patch instead of the list" },
                    "page": { "type": "number", "description": "optional with path: the patch page, from 1 (default 1)" }
                },
                "additionalProperties": false
            }
        }),
        json!({
            "name": "report_review",
            "description": "Reports your review verdict — call it exactly once. verdict pass (the change does what the task asks and you found nothing that must change) or changes-requested (something must change — say what in findings).     summary: a short overall judgement (≤4 KiB). findings: at most 20 short items (each ≤500 characters) — concrete problems with file and line where you can.     Your review is a role-based supplementary review: the coordinator and a person read it next to the diff; it does not accept or reject the task.     If the report you review was replaced, rejected, cancelled or accepted meanwhile, your verdict is recorded as stale and does not count; after the run or your session was stopped it is late.     Refused with already-reported (retry with the same requestId to read the first result). After report_review, end your turn: the app closes your CLI shortly afterwards.     Returns: {reviewId, verdict, state (current, stale or late), latestSeq}.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "requestId": worker_request_id_prop(),
                    "verdict":{ "type": "string", "enum": ["pass", "changes-requested"] },
                    "summary": { "type": "string", "description": "your overall judgement (≤4 KiB)" },
                    "findings": { "type": "array", "items": { "type": "string" }, "description": "optional: at most 20 short findings (each ≤500 characters)" }
                },
                "required": ["requestId", "verdict", "summary"],
                "additionalProperties": false
            }
        }),
    ]
}

// ── 인자 ──

/// 다시 `idle` 로 지시를 받을 일이 없다.
pub(super) fn ready_passed(a: &Attempt) -> bool {
    matches!(
        a.state,
        AttemptState::Reported
            | AttemptState::Exited
            | AttemptState::ExitUnconfirmed
            | AttemptState::Stopping
            | AttemptState::Stopped
            | AttemptState::StopUnconfirmed
    ) || (a.state == AttemptState::Idle && a.conversation_broken)
}

pub(super) fn bad(msg: impl Into<String>) -> OrchError {
    OrchError::new(reason::INVALID_ARGUMENT, msg)
}

pub(super) fn arg<'a>(args: Option<&'a Value>, key: &str) -> Option<&'a Value> {
    args.and_then(|a| a.get(key)).filter(|v| !v.is_null())
}

pub(super) fn opt_text(args: Option<&Value>, key: &str, max: usize) -> Result<Option<String>, OrchError> {
    match arg(args, key) {
        None => Ok(None),
        Some(Value::String(s)) if s.len() <= max => Ok(Some(s.clone())),
        Some(Value::String(_)) => Err(bad(format!("{key} is longer than {max} bytes"))),
        Some(_) => Err(bad(format!("{key} must be a string"))),
    }
}

pub(super) fn req_text(args: Option<&Value>, key: &str, max: usize) -> Result<String, OrchError> {
    let s = opt_text(args, key, max)?.ok_or_else(|| bad(format!("{key} is required")))?;
    if s.trim().is_empty() {
        return Err(bad(format!("{key} must not be empty")));
    }
    Ok(s)
}

pub(super) fn request_id(args: Option<&Value>) -> Result<String, OrchError> {
    let r = req_text(args, "requestId", REQUEST_ID_MAX)?;
    if r.chars().any(char::is_control) {
        return Err(bad("requestId must not contain control characters"));
    }
    Ok(r)
}

fn deps_arg(args: Option<&Value>) -> Result<Option<Vec<String>>, OrchError> {
    match arg(args, "dependsOn") {
        None => Ok(None),
        Some(Value::Array(items)) => {
            let mut out: Vec<String> = Vec::new();
            for v in items {
                let s = v.as_str().ok_or_else(|| bad("dependsOn must be an array of task ids"))?;
                if !out.iter().any(|x| x == s) {
                    out.push(s.to_string());
                }
            }
            if out.len() > Limits::default().max_tasks as usize {
                return Err(bad("dependsOn is too long"));
            }
            Ok(Some(out))
        }
        Some(_) => Err(bad("dependsOn must be an array of task ids")),
    }
}

pub(super) fn coordinator_slot<'g>(
    g: &'g mut Inner,
    run_id: &str,
    gen: u32,
    args: Option<&Value>,
    now: u64,
) -> Result<&'g mut Slot, OrchError> {
    let slot = coordinator_gate(g, run_id, gen, args)?;
    admit_call(slot, now)?;
    Ok(slot)
}

/// 분당 한도를 세지 않는다 — 한 호출 안에서 잠금을 두 번 잡을 때의 두 번째용.
pub(super) fn coordinator_gate<'g>(
    g: &'g mut Inner,
    run_id: &str,
    gen: u32,
    args: Option<&Value>,
) -> Result<&'g mut Slot, OrchError> {
    if let Some(asked) = arg(args, "runId") {
        if asked.as_str() != Some(run_id) {
            return Err(not_found_run());
        }
    }
    let slot = g.runs.get_mut(run_id).ok_or_else(not_found_run)?;
    if slot.run.state == RunState::Orphaned {
        return Err(not_found_run());
    }
    if slot.run.gen != gen {
        return Err(OrchError::new(
            reason::STALE_GENERATION,
            "this coordinator token belongs to an older generation of the run",
        ));
    }
    Ok(slot)
}

fn coordinator_audit(gen: u32, task: &Task) -> OrchestrationAudit {
    OrchestrationAudit {
        gen,
        actor: Actor::Coordinator.as_str().into(),
        task_id: Some(task.id.clone()),
        task_version: Some(task.version),
        task_state: Some(task.state.as_str().into()),
        title_len: Some(task.title.chars().count() as u32),
        ..Default::default()
    }
}

impl Orchestration {
    /// 오류는 `code: message` 글자.
    pub(crate) fn call_tool(&self, caller: &Caller, name: &str, args: Option<&Value>) -> Result<Value, String> {
        // 인증 때 확정한 `(chat, proc)` 그대로 — 지금 세대로 바꾸지 않는다.
        if let Caller::Producer { chat, proc } = caller {
            if !super::start::TILE_TOOLS.contains(&name) && !COORDINATOR_TOOLS.contains(&name) {
                return Err(format!("Unknown tool: {name}"));
            }
            return self.producer_tool(chat, *proc, name, args);
        }
        let out = match (caller, name) {
            (Caller::Coordinator { run_id, gen }, "get_run") => self.get_run(run_id, *gen, args),
            (Caller::Coordinator { run_id, gen }, "create_task") => self.create_task(run_id, *gen, args),
            (Caller::Coordinator { run_id, gen }, "update_task") => self.update_task(run_id, *gen, args),
            (Caller::Coordinator { run_id, gen }, "wait_run") => self.wait_run(run_id, *gen, args),
            (Caller::Coordinator { run_id, gen }, "spawn_worker") => self.spawn_worker(run_id, *gen, args),
            (Caller::Coordinator { run_id, gen }, "stop_worker") => self.stop_worker(run_id, *gen, args),
            (Caller::Coordinator { run_id, gen }, "send_prompt") => self.send_prompt(run_id, *gen, args),
            (Caller::Coordinator { run_id, gen }, "read_worker") => self.read_worker(run_id, *gen, args),
            (Caller::Coordinator { run_id, gen }, "get_diff") => self.get_diff(run_id, *gen, args),
            (Caller::Coordinator { run_id, gen }, "complete_run") => self.coordinator_complete(run_id, *gen, args),
            (Caller::Worker { run_id, attempt_id, .. }, "get_task") => self.get_task(run_id, attempt_id),
            (Caller::Worker { run_id, attempt_id, .. }, "report_done") => self.report_done(run_id, attempt_id, args),
            (Caller::Worker { run_id, attempt_id, .. }, "commit_changes") => self.commit_changes(run_id, attempt_id, args),
            (Caller::Reviewer { run_id, attempt_id, .. }, "get_task") => self.reviewer_task(run_id, attempt_id),
            (Caller::Reviewer { run_id, attempt_id, .. }, "get_diff") => self.reviewer_diff(run_id, attempt_id, args),
            (Caller::Reviewer { run_id, attempt_id, .. }, "report_review") => self.report_review(run_id, attempt_id, args),
            _ => return Err(format!("Unknown tool: {name}")),
        };
        out.map_err(|e| e.to_string())
    }

    fn get_run(&self, run_id: &str, gen: u32, args: Option<&Value>) -> Result<Value, OrchError> {
        // 잠금 밖에서 읽는다(파일 · git).
        let lookup = self.run_inputs(run_id);
        let now = self.now();
        let mut g = self.lock();
        let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
        lookup.remember(slot);
        Ok(view(slot, now, false))
    }

    fn create_task(&self, run_id: &str, gen: u32, args: Option<&Value>) -> Result<Value, OrchError> {
        let request_id = request_id(args)?;
        let title = req_text(args, "title", TITLE_MAX)?;
        let goal = req_text(args, "goal", GOAL_MAX)?;
        let scope = opt_text(args, "scope", TEXT_MAX)?.unwrap_or_default();
        let done_when = opt_text(args, "doneWhen", TEXT_MAX)?.unwrap_or_default();
        let depends_on = deps_arg(args)?.unwrap_or_default();
        let id = new_id("task").ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
        let now = self.now();
        let (result, detail) = {
            let mut g = self.lock();
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            if let Some(first) = super::store::request_seen(slot, &request_id, "create_task", &super::store::request_sha(args))? {
                return Ok(first);
            }
            writable(&slot.run)?;
            let max = slot.run.limits.max_tasks as usize;
            if slot.run.tasks.len() >= max {
                return Err(OrchError::new(reason::TOO_MANY_TASKS, format!("this run holds at most {max} tasks")));
            }
            check_dependencies(&slot.run, &id, &depends_on)?;
            let task = Task {
                id: id.clone(),
                title: title.trim().to_string(),
                goal,
                scope,
                done_when,
                depends_on,
                version: 1,
                state: TaskState::Todo,
                current_attempt: None,
                created_at: now,
                updated_at: now,
                conflict: None,
                review: Default::default(),
                rework_count: 0,
            };
            slot.run.tasks.push(task.clone());
            let seq = slot.run.bump(now, Actor::Coordinator, "task_created", Some(&id), TaskState::Todo.as_str());
            let result = json!({ "task": task, "latestSeq": seq });
            slot.run.remember(&request_id, "create_task", &super::store::request_sha(args), result.clone());
            let detail = coordinator_audit(slot.run.gen, &task);
            self.after_change(&g, run_id);
            (result, detail)
        };
        self.audit("task_created", run_id, detail);
        Ok(result)
    }

    fn update_task(&self, run_id: &str, gen: u32, args: Option<&Value>) -> Result<Value, OrchError> {
        let request_id = request_id(args)?;
        let task_id = req_text(args, "taskId", 64)?;
        let version = arg(args, "version")
            .and_then(Value::as_u64)
            .ok_or_else(|| bad("version is required (a whole number — the task version you last read)"))?;
        let title = opt_text(args, "title", TITLE_MAX)?;
        if title.as_deref().is_some_and(|t| t.trim().is_empty()) {
            return Err(bad("title must not be empty"));
        }
        let goal = opt_text(args, "goal", GOAL_MAX)?;
        if goal.as_deref().is_some_and(|t| t.trim().is_empty()) {
            return Err(bad("goal must not be empty"));
        }
        let scope = opt_text(args, "scope", TEXT_MAX)?;
        let done_when = opt_text(args, "doneWhen", TEXT_MAX)?;
        let depends_on = deps_arg(args)?;
        let state = match opt_text(args, "state", 32)?.as_deref() {
            None => None,
            Some("accepted") => Some(TaskState::Accepted),
            Some("rejected") => Some(TaskState::Rejected),
            Some("cancelled") => Some(TaskState::Cancelled),
            Some(other) => {
                return Err(OrchError::new(
                    reason::INVALID_STATE,
                    format!("state {other:?} cannot be set with update_task (accepted, rejected or cancelled)"),
                ))
            }
        };
        let edits_spec = title.is_some() || goal.is_some() || scope.is_some() || done_when.is_some() || depends_on.is_some();
        if !edits_spec && state.is_none() {
            return Err(bad("nothing to update"));
        }
        // 수락 · 반려는 명세 고치기와 섞지 않는다.
        let decision = match state {
            Some(TaskState::Accepted) => Some(Decision::Accepted),
            Some(TaskState::Rejected) => Some(Decision::Rejected),
            _ => None,
        };
        if let Some(d) = decision {
            if edits_spec {
                return Err(bad("set state to accepted or rejected alone, without other changes"));
            }
            return self.coordinator_review(run_id, gen, args, &task_id, version, d);
        }
        let now = self.now();
        let (result, detail) = {
            let mut g = self.lock();
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            if let Some(first) = super::store::request_seen(slot, &request_id, "update_task", &super::store::request_sha(args))? {
                return Ok(first);
            }
            writable(&slot.run)?;
            let Some(current) = slot.run.task(&task_id).cloned() else {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")));
            };
            if current.version != version {
                return Err(conflict(&current));
            }
            if edits_spec && current.state != TaskState::Todo {
                return Err(OrchError::new(
                    reason::TASK_NOT_EDITABLE,
                    format!("task {task_id} is {} — only a todo task can be edited", current.state.as_str()),
                ));
            }
            if let Some(s) = state {
                match s {
                    // 통합 중인 Task 는 조정자가 취소하지 못한다 — 사람의 [취소]만 Job 을 거둔다.
                    TaskState::Cancelled if current.state == TaskState::Integrating => {
                        return Err(OrchError::new(
                            reason::TASK_BUSY,
                            format!("task {task_id} is being integrated — wait for it with wait_run"),
                        ))
                    }
                    TaskState::Cancelled if matches!(current.state, TaskState::Accepted | TaskState::Cancelled) => {
                        return Err(OrchError::new(
                            reason::INVALID_STATE,
                            format!("task {task_id} is {} and cannot be cancelled", current.state.as_str()),
                        ))
                    }
                    TaskState::Accepted | TaskState::Rejected if current.state != TaskState::Reported => {
                        return Err(OrchError::new(
                            reason::NOT_REPORTED,
                            format!("task {task_id} is {} — only a reported task can be accepted or rejected", current.state.as_str()),
                        ))
                    }
                    _ => {}
                }
            }
            if let Some(deps) = &depends_on {
                check_dependencies(&slot.run, &task_id, deps)?;
            }
            let Some(task) = slot.run.tasks.iter_mut().find(|t| t.id == task_id) else {
                return Err(OrchError::new(reason::NOT_FOUND, format!("no task {task_id} in this run")));
            };
            if let Some(t) = title {
                task.title = t.trim().to_string();
            }
            if let Some(v) = goal {
                task.goal = v;
            }
            if let Some(v) = scope {
                task.scope = v;
            }
            if let Some(v) = done_when {
                task.done_when = v;
            }
            if let Some(v) = depends_on {
                task.depends_on = v;
            }
            if let Some(s) = state {
                task.state = s;
                if s == TaskState::Cancelled {
                    task.conflict = None;
                }
            }
            task.version += 1;
            task.updated_at = now;
            let task = task.clone();
            if state == Some(TaskState::Cancelled) {
                super::review::invalidate(slot, &task_id, now, Actor::Coordinator, "cancelled");
                super::attempts::close_task_workers(slot, &task_id, now, Actor::Coordinator);
            }
            let seq = slot.run.bump(now, Actor::Coordinator, "task_updated", Some(&task_id), task.state.as_str());
            let result = json!({ "task": task, "latestSeq": seq });
            slot.run.remember(&request_id, "update_task", &super::store::request_sha(args), result.clone());
            let detail = coordinator_audit(slot.run.gen, &task);
            self.after_change(&g, run_id);
            (result, detail)
        };
        self.audit("task_updated", run_id, detail);
        self.drain_stops(run_id);
        Ok(result)
    }

    fn wait_run(&self, run_id: &str, gen: u32, args: Option<&Value>) -> Result<Value, OrchError> {
        let after = match arg(args, "afterSeq") {
            None => None,
            Some(v) => Some(v.as_u64().ok_or_else(|| bad("afterSeq must be a whole number"))?),
        };
        let until = opt_text(args, "until", 16)?.unwrap_or_else(|| "any".into());
        if !matches!(until.as_str(), "any" | "ready" | "reported" | "settled" | "reviewed") {
            return Err(bad("until must be any, ready, reported, settled or reviewed"));
        }
        let task_ids: Option<Vec<String>> = match arg(args, "taskIds") {
            None => None,
            Some(Value::Array(items)) => Some(
                items
                    .iter()
                    .map(|v| v.as_str().map(str::to_string).ok_or_else(|| bad("taskIds must be an array of ids")))
                    .collect::<Result<_, _>>()?,
            ),
            Some(_) => return Err(bad("taskIds must be an array of ids")),
        };
        let attempt_ids: Option<Vec<String>> = match arg(args, "attemptIds") {
            None => None,
            Some(Value::Array(items)) => Some(
                items
                    .iter()
                    .map(|v| v.as_str().map(str::to_string).ok_or_else(|| bad("attemptIds must be an array of ids")))
                    .collect::<Result<_, _>>()?,
            ),
            Some(_) => return Err(bad("attemptIds must be an array of ids")),
        };
        let timeout = match arg(args, "timeoutSeconds") {
            None => WAIT_DEFAULT_SECONDS,
            Some(v) => {
                let n = v.as_f64().ok_or_else(|| bad("timeoutSeconds must be a number"))?;
                (n.max(1.0) as u64).clamp(1, WAIT_MAX_SECONDS)
            }
        };
        let deadline = Duration::from_secs(timeout);
        let started = Instant::now();
        let now = self.now();

        let mut g = self.lock();
        let (after, start_state, cancel_gen) = {
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            if slot.waiters >= slot.run.limits.max_waiters {
                return Err(OrchError::new(
                    reason::TOO_MANY_WAITERS,
                    format!("at most {} wait_run calls can wait at once for a run", slot.run.limits.max_waiters),
                ));
            }
            slot.waiters += 1;
            // 취소된 대기의 늦은 응답은 오류여야 한다 — 그래야 잠정 커서를 올리지 못한다.
            (after.unwrap_or(slot.run.seq), slot.run.state, slot.cursor.cancel_gen)
        };
        let result = loop {
            let Some(slot) = g.runs.get(run_id) else {
                break Err(not_found_run());
            };
            if slot.run.gen != gen {
                break Err(OrchError::new(
                    reason::STALE_GENERATION,
                    "the run moved to a new coordinator generation while waiting",
                ));
            }
            let r = &slot.run;
            // 검토자는 attemptIds 로 이름을 댈 때만 ready · reported 에 든다(작업자를 기다리는 조정자가 검토자 판정에 깨지 않게).
            let picked = |a: &&Attempt| match attempt_ids.as_ref() {
                Some(ids) => ids.contains(&a.id),
                None => !a.is_reviewer(),
            };
            let satisfied = match until.as_str() {
                // 이름을 댄 Attempt 는 이미 그 단계를 지난 것도 선다 — 시한까지 헛되이 기다리지 않게. 이름 없이는 옛 끝난 작업자가 늘 세우지 않게 `ready` 만.
                "ready" => r.attempts.iter().filter(picked).any(|a| {
                    (a.resumable() && r.state == RunState::Running) || (attempt_ids.is_some() && ready_passed(a))
                }),
                // 보고한 Attempt 는 CLI 가 끝나면 `exited` 로 넘어가므로 보고 기록으로도 본다(이미 수락 · 반려된 옛 보고는 빼고).
                "reported" => r.attempts.iter().filter(picked).any(|a| {
                    a.state == AttemptState::Reported
                        || (r.report_of(&a.id).is_some_and(|rep| !rep.late)
                            && r.task(&a.task_id).is_some_and(|t| {
                                t.state == TaskState::Reported && t.current_attempt.as_deref() == Some(a.id.as_str())
                            }))
                }),
                // 검증 확인 대기도 통합 중이다.
                "settled" => !r.tasks.iter().any(|t| {
                    t.state == TaskState::Integrating && task_ids.as_ref().is_none_or(|ids| ids.contains(&t.id))
                }),
                "reviewed" => !r.tasks.iter().any(|t| {
                    t.review.active.is_some() && task_ids.as_ref().is_none_or(|ids| ids.contains(&t.id))
                }),
                _ => r.seq > after,
            };
            let state_changed = r.state != start_state || !matches!(r.state, RunState::Running | RunState::Paused);
            let waited = started.elapsed();
            // 조건 · 상태 변화가 취소보다 먼저다.
            if !satisfied && !state_changed && slot.cursor.cancel_gen != cancel_gen {
                break Err(OrchError::new(
                    reason::WAIT_CANCELLED,
                    "this wait was cancelled (the person interrupted, the coordinator was released or its process ended) — do not wait again in this turn",
                ));
            }
            if satisfied || state_changed || waited >= deadline {
                break Ok(json!({
                    "run": view(slot, self.now(), false),
                    "latestSeq": r.seq,
                    "satisfied": satisfied,
                    "stateChanged": state_changed,
                    "timedOut": !satisfied && !state_changed,
                    "waitedSeconds": waited.as_secs(),
                }));
            }
            g = self
                .changed
                .wait_timeout(g, deadline - waited)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        };
        if let Some(slot) = g.runs.get_mut(run_id) {
            slot.waiters = slot.waiters.saturating_sub(1);
        }
        result
    }

    /// 자기 Attempt 의 Task 만.
    fn get_task(&self, run_id: &str, attempt_id: &str) -> Result<Value, OrchError> {
        let g = self.lock();
        let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
        if !slot.run.state.active() {
            return Err(state_error(slot.run.state));
        }
        let attempt = slot
            .run
            .attempts
            .iter()
            .find(|a| a.id == attempt_id)
            .ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such attempt"))?;
        let task = slot
            .run
            .task(&attempt.task_id)
            .ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such task"))?;
        let mut out = json!({
            "runId": slot.run.id,
            "runState": slot.run.state,
            "attemptId": attempt.id,
            "task": task,
        });
        if let (Some(info), Some(o)) = (super::resolve::resolve_info(&slot.run, attempt), out.as_object_mut()) {
            o.insert("conflictResolution".into(), super::resolve::guide(info));
        }
        Ok(out)
    }
}

//! 앱이 깨움 — 프로듀서가 쉬는 동안 앨범 장부에 일이 생기면 서버가 고정 문장을 프로듀서 채팅의 새 사용자 턴으로 넣는다. 이 파일은 그 문장의
//! 재료 · 판정 · 장부다(오케스트레이션 잠금 L1 안) — stdin 에 쓰는 일은 레지스트리(`server::producer`) 몫.
//! 설계: docs/log/2026-10-30-orchestration-structured-producer.md
//!
//! - `WakeNote` · `WakeItem` 에는 **문자열 칸이 없다** — 열거 · 그 Run 의 id · 세대 · seq · 수만. 제목 · 설명 · 보고 · 판정 · 대화 · 명령 ·
//!   경로 · 오류 상세는 싣지 않는다(→ docs/invariants.md 전문 4).
//! - 열거 값(보고 결과 · 판정)은 AI 가 고를 수 있다 — 사람의 지시 · 승인으로 치지 않는다(깨움을 일으키는 힘은 상한의 대상).

use serde_json::{json, Value};

use super::model::{is_id, new_id, Actor, LogEntry, Run, RunState, WakeRecord, WakeRecordItem};
use super::store::{coordinates, Orchestration, Seat, Slot};
use crate::audit::OrchestrationAudit;

/// 문장의 머리 — 지침(`server::producer::launch`)이 이 글자를 알리고 `parse_wake_note` 가 읽는다.
pub(crate) const PREFIX: &str = "[Aynx app notice — not from the person]";
/// 재시도 포함 · 고정 — 설정 칸 · 초기화 없음.
pub(crate) const RUN_MAX: u32 = 200;
/// `Run.album.wake_max` 의 기본값.
pub(crate) const SEGMENT_DEFAULT: u32 = 30;
/// 그 칸의 상한(0 = 끔).
pub(crate) const SEGMENT_MAX: u32 = 200;
pub(crate) const GAP_MS: u64 = 20_000;
pub(crate) const BATCH_MS: u64 = 3_000;
pub(crate) const REST_MS: u64 = 2_000;
pub(crate) const UNRESPONSIVE_MAX: u32 = 3;
pub(crate) const TURN_MS: u64 = 30 * 60_000;
pub(crate) const ITEMS_MAX: usize = 12;

// ---------------------------------------------------------------------------
// 새 타입 id — 생성자는 `of(&Run, …)` 하나(문자열에서 바로 만드는 길 없음)
// ---------------------------------------------------------------------------

/// 앨범 id(`run-` + 32 hex · 그 Run 자신).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RunId(String);
/// 트랙 id(`task-` + 32 hex · 그 Run 의 Task).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TaskId(String);
/// 아티스트 id(`att-` + 32 hex · 그 Run 의 Attempt).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AttemptId(String);

impl RunId {
    pub(crate) fn of(run: &Run) -> Option<RunId> {
        is_id("run", &run.id).then(|| RunId(run.id.clone()))
    }
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl TaskId {
    pub(crate) fn of(run: &Run, id: &str) -> Option<TaskId> {
        (is_id("task", id) && run.task(id).is_some()).then(|| TaskId(id.to_string()))
    }
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl AttemptId {
    pub(crate) fn of(run: &Run, id: &str) -> Option<AttemptId> {
        (is_id("att", id) && run.attempts.iter().any(|a| a.id == id)).then(|| AttemptId(id.to_string()))
    }
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

// ---------------------------------------------------------------------------
// 문장의 재료
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WakeKind {
    ReportedSuccess,
    ReportedFailure,
    Blocked,
    IdleNoReport,
    SpawnFailed,
    TurnTimeout,
    ReviewPass,
    ReviewChanges,
    ReviewEnded,
    Integrated,
    Conflict,
    VerifyFailed,
    PersonAccepted,
    PersonRejected,
    PersonUpdatedTask,
    PersonOverrodeVerify,
    PersonResumed,
    PersonReleasedHold,
    PersonReconciled,
    AlbumChanged,
}

impl WakeKind {
    /// 사건 · 감사 · 화면 · `Run.wakes` 기록의 낱말 — 고정.
    pub(crate) fn word(self) -> &'static str {
        match self {
            WakeKind::ReportedSuccess => "reported-success",
            WakeKind::ReportedFailure => "reported-failure",
            WakeKind::Blocked => "blocked",
            WakeKind::IdleNoReport => "idle-no-report",
            WakeKind::SpawnFailed => "spawn-failed",
            WakeKind::TurnTimeout => "turn-timeout",
            WakeKind::ReviewPass => "review-pass",
            WakeKind::ReviewChanges => "review-changes",
            WakeKind::ReviewEnded => "review-ended",
            WakeKind::Integrated => "integrated",
            WakeKind::Conflict => "conflict",
            WakeKind::VerifyFailed => "verify-failed",
            WakeKind::PersonAccepted => "person-accepted",
            WakeKind::PersonRejected => "person-rejected",
            WakeKind::PersonUpdatedTask => "person-updated-task",
            WakeKind::PersonOverrodeVerify => "person-overrode-verify",
            WakeKind::PersonResumed => "person-resumed",
            WakeKind::PersonReleasedHold => "person-released-hold",
            WakeKind::PersonReconciled => "person-reconciled",
            WakeKind::AlbumChanged => "album-changed",
        }
    }

    fn phrase(self, task: Option<&TaskId>, attempt: Option<&AttemptId>) -> String {
        let t = task.map_or("", TaskId::as_str);
        let a = attempt.map_or("", AttemptId::as_str);
        match self {
            WakeKind::ReportedSuccess => format!("task {t} reported success"),
            WakeKind::ReportedFailure => format!("task {t} reported failure"),
            WakeKind::Blocked => format!("attempt {a} blocked"),
            WakeKind::IdleNoReport => format!("attempt {a} went idle without a report"),
            WakeKind::SpawnFailed => format!("attempt {a} failed to start"),
            WakeKind::TurnTimeout => format!("attempt {a} turn timed out"),
            WakeKind::ReviewPass => format!("task {t} review passed"),
            WakeKind::ReviewChanges => format!("task {t} review requested changes"),
            WakeKind::ReviewEnded => format!("attempt {a} review ended without a verdict"),
            WakeKind::Integrated => format!("task {t} integrated"),
            WakeKind::Conflict => format!("task {t} hit an integration conflict"),
            WakeKind::VerifyFailed => format!("task {t} verification did not pass"),
            WakeKind::PersonAccepted => format!("the person accepted task {t}"),
            WakeKind::PersonRejected => format!("the person rejected task {t}"),
            WakeKind::PersonUpdatedTask => format!("the person changed task {t}"),
            WakeKind::PersonOverrodeVerify => format!("the person overrode the verification of task {t}"),
            WakeKind::PersonResumed => "the person resumed the album".to_string(),
            WakeKind::PersonReleasedHold => "the person released the hold".to_string(),
            WakeKind::PersonReconciled => "the person reconciled the integration".to_string(),
            WakeKind::AlbumChanged => "album-changed".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WakeItem {
    pub what: WakeKind,
    pub task: Option<TaskId>,
    pub attempt: Option<AttemptId>,
    pub seq: u64,
    pub at: u64,
}

/// 문자열 칸을 두지 않는다 — 자유 글이 깨움에 실리지 않게(시험 `wake_text_takes_no_free_text`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WakeNote {
    pub run: RunId,
    pub gen: u32,
    pub from_seq: u64,
    pub to_seq: u64,
    pub items: Vec<WakeItem>,
    pub more: u32,
    pub resync: bool,
}

/// 장부 줄의 허용 목록 — 맞지 않는 줄은 버린다(세지도 않는다 · 시험 `wake_only_from_ledger`).
pub(crate) fn classify(run: &Run, e: &LogEntry) -> Option<WakeItem> {
    let target = e.target.as_deref();
    let att = || target.and_then(|t| AttemptId::of(run, t));
    let task_of_att = |a: &AttemptId| {
        run.attempts.iter().find(|x| x.id == a.as_str()).and_then(|x| TaskId::of(run, &x.task_id))
    };
    let task = || target.and_then(|t| TaskId::of(run, t));
    let o = e.outcome.as_str();
    let (what, task, attempt) = match (e.actor, e.action.as_str()) {
        (Actor::Worker, "worker_reported") => {
            let k = match o {
                "success" => WakeKind::ReportedSuccess,
                "failure" => WakeKind::ReportedFailure,
                _ => return None,
            };
            let a = att()?;
            (k, Some(task_of_att(&a)?), Some(a))
        }
        (Actor::Worker, "worker_blocked") if o == "blocked" => {
            let a = att()?;
            (WakeKind::Blocked, task_of_att(&a), Some(a))
        }
        (Actor::Server, "worker_idle") if o == "idle" => {
            let a = att()?;
            // 막힌 작업자는 `worker_blocked` 줄이 따로 깨운다(같은 일을 두 번 싣지 않는다).
            if run.attempts.iter().any(|x| x.id == a.as_str() && x.blocked.is_some()) {
                return None;
            }
            (WakeKind::IdleNoReport, task_of_att(&a), Some(a))
        }
        (Actor::Server, "spawn_failed") => {
            let a = att()?;
            (WakeKind::SpawnFailed, task_of_att(&a), Some(a))
        }
        (Actor::Server, "turn_ended") if o == "timeout" => {
            let a = att()?;
            (WakeKind::TurnTimeout, task_of_att(&a), Some(a))
        }
        (Actor::Reviewer, "reviewer_reported") => {
            let k = match o {
                "pass" => WakeKind::ReviewPass,
                "changes-requested" => WakeKind::ReviewChanges,
                _ => return None,
            };
            let a = att()?;
            (k, Some(task_of_att(&a)?), Some(a))
        }
        (Actor::Server, "review_ended") if o == "no-verdict" => {
            let a = att()?;
            (WakeKind::ReviewEnded, task_of_att(&a), Some(a))
        }
        (Actor::Server, "task_integrated" | "recovered_integrated") => (WakeKind::Integrated, Some(task()?), None),
        (Actor::Server, "integration_conflict") => (WakeKind::Conflict, Some(task()?), None),
        (Actor::Server, "verify_finished") if o != "pass" => (WakeKind::VerifyFailed, Some(task()?), None),
        (Actor::Human, "task_accepted") => (WakeKind::PersonAccepted, Some(task()?), None),
        (Actor::Human, "task_rejected") => (WakeKind::PersonRejected, Some(task()?), None),
        (Actor::Human, "task_updated") => (WakeKind::PersonUpdatedTask, Some(task()?), None),
        (Actor::Human, "human_override_verify") => (WakeKind::PersonOverrodeVerify, Some(task()?), None),
        (Actor::Human, "human_resumed") if target.is_none() => (WakeKind::PersonResumed, None, None),
        (Actor::Human, "hold_released") if target.is_none() => (WakeKind::PersonReleasedHold, None, None),
        (Actor::Human, "human_reconciled") if target.is_none() => (WakeKind::PersonReconciled, None, None),
        (Actor::Human, "album_changed") if target.is_none() => (WakeKind::AlbumChanged, None, None),
        _ => return None,
    };
    Some(WakeItem { what, task, attempt, seq: e.seq, at: e.at })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WakeScan {
    pub items: Vec<WakeItem>,
    pub resync: bool,
    pub first_at: Option<u64>,
}

/// 잘린 줄(`LOG_KEEP`)이 범위에 걸리면 `resync`.
pub(crate) fn wake_items(run: &Run, after: u64, upto: u64) -> WakeScan {
    let mut items: Vec<WakeItem> = Vec::new();
    for e in run.log.iter().filter(|e| e.seq > after && e.seq <= upto) {
        if let Some(i) = classify(run, e) {
            if !items.iter().any(|x| x.what == i.what && x.task == i.task && x.attempt == i.attempt) {
                items.push(i);
            }
        }
    }
    let first_kept = run.log.first().map_or(run.seq + 1, |e| e.seq);
    let resync = upto > after && first_kept > after + 1 && run.seq > after && first_kept > 1;
    let first_at = if resync { run.log.first().map(|e| e.at) } else { items.first().map(|i| i.at) };
    WakeScan { items, resync, first_at }
}

impl WakeNote {
    pub(crate) fn build(run: &Run, from: u64, to: u64) -> Option<WakeNote> {
        let scan = wake_items(run, from, to);
        if scan.items.is_empty() && !scan.resync {
            return None;
        }
        let mut items = if scan.resync { Vec::new() } else { scan.items };
        let more = items.len().saturating_sub(ITEMS_MAX) as u32;
        items.truncate(ITEMS_MAX);
        Some(WakeNote { run: RunId::of(run)?, gen: run.gen, from_seq: from, to_seq: to, items, more, resync: scan.resync })
    }

    /// 사건 `woken` 의 몸 — 문장과 같은 재료(id · 낱말 · 수)만.
    pub(crate) fn view(&self) -> Value {
        let items: Vec<Value> = self
            .items
            .iter()
            .map(|i| json!({ "what": i.what.word(), "taskId": i.task.as_ref().map(TaskId::as_str), "attemptId": i.attempt.as_ref().map(AttemptId::as_str) }))
            .collect();
        json!({ "runId": self.run.as_str(), "gen": self.gen, "fromSeq": self.from_seq, "toSeq": self.to_seq, "items": items, "more": self.more, "resync": self.resync })
    }

    fn record_items(&self) -> Vec<WakeRecordItem> {
        self.items
            .iter()
            .map(|i| WakeRecordItem {
                what: i.what.word().to_string(),
                task_id: i.task.as_ref().map(|t| t.as_str().to_string()),
                attempt_id: i.attempt.as_ref().map(|a| a.as_str().to_string()),
            })
            .collect()
    }

    fn kinds(&self) -> Vec<String> {
        self.items.iter().map(|i| i.what.word().to_string()).collect()
    }
}

/// 깨움 문장을 짓는 유일한 곳. 글 꼴을 바꾸면 `parse_wake_note` 도 맞춘다.
pub(crate) fn wake_text(n: &WakeNote) -> String {
    let head = format!("{PREFIX} Album {} (gen {})", n.run.as_str(), n.gen);
    let tail = "If nothing needs you now, end your turn with a one-line note.";
    if n.resync {
        return format!(
            "{head} changed a lot after seq {} — read get_run from scratch, then keep coordinating. {tail}",
            n.from_seq
        );
    }
    let mut parts: Vec<String> = n.items.iter().map(|i| i.what.phrase(i.task.as_ref(), i.attempt.as_ref())).collect();
    if n.more > 0 {
        parts.push(format!("+{} more", n.more));
    }
    format!(
        "{head} changed after seq {}: {}. Read get_run (or wait_run with afterSeq={}) for details, then keep coordinating. {tail}",
        n.from_seq,
        parts.join("; "),
        n.from_seq
    )
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WakeTag {
    pub run_id: String,
    pub gen: u32,
    pub from_seq: u64,
    pub sha: String,
}

/// 판별은 표시용 — 권한 · 커서 · 셈의 근거가 아니다(사람이 같은 글을 쳐도 맞는다 — 화면이 `Run.wakes` 의 SHA 로 기록 한 줄에 한 번만 맞춘다).
pub(crate) fn parse_wake_note(text: &str) -> Option<WakeTag> {
    let rest = text.strip_prefix(PREFIX)?.strip_prefix(" Album ")?;
    let (run, rest) = rest.split_once(' ')?;
    if !is_id("run", run) {
        return None;
    }
    let rest = rest.strip_prefix("(gen ")?;
    let (gen, rest) = rest.split_once(") changed ")?;
    let gen: u32 = gen.parse().ok().filter(|_| gen.bytes().all(|b| b.is_ascii_digit()))?;
    let rest = rest.strip_prefix("after seq ").or_else(|| rest.strip_prefix("a lot after seq "))?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let from: u64 = digits.parse().ok()?;
    let after = &rest[digits.len()..];
    if !(after.starts_with(": ") || after.starts_with(" — ")) {
        return None;
    }
    Some(WakeTag { run_id: run.to_string(), gen, from_seq: from, sha: super::verify::sha256_hex(text.as_bytes()) })
}

// ---------------------------------------------------------------------------
// 판정
// ---------------------------------------------------------------------------

/// 시각은 오케스트레이션 시계 ms.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct DueIn {
    pub now: u64,
    pub running: bool,
    pub bound: bool,
    pub idle: bool,
    pub rest_from: Option<u64>,
    pub first_at: Option<u64>,
    pub retry: bool,
    pub live: bool,
    pub last_at: Option<u64>,
    pub total: u32,
    pub segment: u32,
    /// 0 = 끔.
    pub cap: u32,
    pub streak: u32,
    pub failed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Due {
    Now,
    At(u64),
    Off(&'static str),
    Idle,
}

pub(crate) fn off_reason(total: u32, segment: u32, cap: u32, streak: u32, failed: bool) -> Option<&'static str> {
    if total >= RUN_MAX {
        Some("run-max")
    } else if cap == 0 {
        Some("off")
    } else if segment >= cap {
        Some("segment-max")
    } else if streak >= UNRESPONSIVE_MAX {
        Some("unresponsive")
    } else if failed {
        Some("failed")
    } else {
        None
    }
}

pub(crate) fn wake_due(i: &DueIn) -> Due {
    if !i.running || !i.bound || i.live || (i.first_at.is_none() && !i.retry) {
        return Due::Idle;
    }
    if let Some(w) = off_reason(i.total, i.segment, i.cap, i.streak, i.failed) {
        return Due::Off(w);
    }
    if !i.idle {
        return Due::Idle;
    }
    let mut at = 0;
    if let Some(t) = i.rest_from {
        at = at.max(t + REST_MS);
    }
    if !i.retry {
        if let Some(f) = i.first_at {
            at = at.max(f + BATCH_MS);
        }
    }
    if let Some(l) = i.last_at {
        at = at.max(l + GAP_MS);
    }
    if at > i.now {
        Due::At(at)
    } else {
        Due::Now
    }
}

// ---------------------------------------------------------------------------
// Run 의 산 칸
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LiveWake {
    pub wake_id: String,
    pub seat: Seat,
    pub from: u64,
    pub to: u64,
    pub at: u64,
    pub retry: bool,
    pub accepted: bool,
    pub timed_out: bool,
}

/// 메모리만(`Slot.wake`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WakeMem {
    pub last_at: Option<u64>,
    pub segment: u32,
    pub streak: u32,
    pub failed: bool,
    pub live: Option<LiveWake>,
    pub retry: Option<(u64, u64)>,
    pub cap: Option<u32>,
    pub noticed: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WakeEnd {
    Natural,
    /// 끊기 의도가 붙은 턴의 끝 — 결과 무관.
    Interrupted,
    Error,
    Unacked,
    Exited,
}

#[derive(Debug, Clone)]
pub(crate) struct Reserved {
    pub wake_id: String,
    /// [`wake_text`] 가 지은 문장뿐이다.
    pub text: String,
    pub event: Value,
}

fn cursor_after(slot: &Slot) -> u64 {
    slot.run.wake_handled_to.max(slot.cursor.committed)
}

/// 무반응 재시도가 기다리는 사이 사람 턴의 성공한 `get_run` 이 범위를 다 덮었으면 재시도를 버린다 — 같은 범위로 `retry` 깨움이 나가지 않게.
/// 판정 · 예약 전에 늘 부른다.
fn settle_retry(slot: &mut Slot) {
    let Some((_, to)) = slot.wake.retry else { return };
    if cursor_after(slot) >= to {
        slot.wake.retry = None;
        slot.run.wake_handled_to = slot.run.wake_handled_to.max(to);
    }
}

fn due_in(slot: &Slot, seat: &Seat, now: u64, idle: bool, rest_from: Option<u64>, cap: u32) -> (DueIn, u64, u64) {
    let w = &slot.wake;
    let (from, to) = match w.retry {
        Some(r) => r,
        None => (cursor_after(slot), slot.run.seq),
    };
    let first_at = if w.retry.is_some() { None } else { wake_items(&slot.run, from, to).first_at };
    let i = DueIn {
        now,
        running: slot.run.state == RunState::Running && slot.run.hold.is_none(),
        bound: coordinates(slot, seat),
        idle,
        rest_from,
        first_at,
        retry: w.retry.is_some(),
        live: w.live.is_some(),
        last_at: w.last_at,
        total: slot.run.wakes.len() as u32,
        segment: w.segment,
        cap,
        streak: w.streak,
        failed: w.failed,
    };
    (i, from, to)
}

pub(super) fn wake_view(slot: &Slot) -> Value {
    let w = &slot.wake;
    let cap = w.cap.unwrap_or(SEGMENT_DEFAULT);
    let total = slot.run.wakes.len() as u32;
    json!({
        "off": off_reason(total, w.segment, cap, w.streak, w.failed),
        "segment": w.segment,
        "cap": cap,
        "total": total,
        "max": RUN_MAX,
        "live": w.live.as_ref().map(|l| l.wake_id.clone()),
    })
}

impl Orchestration {
    /// 바뀌면 변화 이벤트만 낸다 — **seq 는 올리지 않는다**(장부 사건이 아니다) · 영속 쓰기 없음(산 칸).
    fn wake_cap(&self, run_id: &str, slot: &mut Slot, cap: Option<u32>) {
        if cap.is_some() && slot.wake.cap != cap {
            slot.wake.cap = cap;
            (self.emit)(super::EVT_CHANGED, json!({ "runId": run_id, "seq": slot.run.seq }));
        }
    }

    fn wake_slot_mut<'a>(g: &'a mut super::store::Inner, seat: &Seat) -> Option<(&'a String, &'a mut Slot)> {
        g.runs.iter_mut().find(|(_, s)| coordinates(s, seat))
    }

    /// 판정만 한다(예약하지 않는다). `off` · `failed` 는 따로 알렸거나 사람이 고른 것이라 `wake-limit` 를 알리지 않는다.
    pub(crate) fn wake_check(&self, seat: &Seat, idle: bool, rest_from: Option<u64>, cap: Option<u32>) -> Due {
        let cap = match self.album_producer_policy(&seat.chat) {
            Some(policy) => Some(policy.map_or(0, |(_, _, max)| max)),
            None => cap,
        };
        let now = self.now();
        let mut g = self.lock();
        let Some((run_id, slot)) = Self::wake_slot_mut(&mut g, seat) else { return Due::Idle };
        self.wake_cap(run_id, slot, cap);
        settle_retry(slot);
        let cap = slot.wake.cap.unwrap_or(SEGMENT_DEFAULT);
        let (i, _, _) = due_in(slot, seat, now, idle, rest_from, cap);
        let d = wake_due(&i);
        if let Due::Off(w) = d {
            if slot.wake.noticed != Some(w) && matches!(w, "run-max" | "segment-max" | "unresponsive") {
                slot.wake.noticed = Some(w);
                self.raise(slot, "wake-limit", None, Some(w));
            }
        }
        d
    }

    /// 조건을 다시 판정하고 지금 깨울 때만 예약한다. 아니면 `None`(레지스트리가 전송기를 돌려놓는다).
    pub(crate) fn wake_reserve(&self, seat: &Seat, rest_from: Option<u64>, cap: Option<u32>) -> Option<Reserved> {
        let cap = match self.album_producer_policy(&seat.chat) {
            Some(policy) => Some(policy.map_or(0, |(_, _, max)| max)),
            None => cap,
        };
        let now = self.now();
        let wake_id = new_id("wake")?;
        let chat = seat.chat.clone();
        let mut g = self.lock();
        let (run_id, slot) = Self::wake_slot_mut(&mut g, seat).map(|(id, s)| (id.clone(), s))?;
        self.wake_cap(&run_id, slot, cap);
        settle_retry(slot);
        let cap = slot.wake.cap.unwrap_or(SEGMENT_DEFAULT);
        let (i, from, to) = due_in(slot, seat, now, true, rest_from, cap);
        if wake_due(&i) != Due::Now {
            return None;
        }
        let retry = slot.wake.retry.take().is_some();
        let Some(note) = WakeNote::build(&slot.run, from, to) else {
            // 재시도 범위의 줄이 사라졌다 — 그 범위는 처리된 것으로(다음 판정이 새 후보를 본다).
            slot.run.wake_handled_to = slot.run.wake_handled_to.max(to);
            return None;
        };
        let text = wake_text(&note);
        let sha = super::verify::sha256_hex(text.as_bytes());
        slot.run.wakes.push(WakeRecord {
            wake_id: wake_id.clone(),
            chat: chat.clone(),
            sha,
            from_seq: from,
            to_seq: to,
            at: now,
            retry,
            items: note.record_items(),
            more: note.more,
            resync: note.resync,
        });
        slot.wake.last_at = Some(now);
        slot.wake.segment += 1;
        slot.wake.live = Some(LiveWake { wake_id: wake_id.clone(), seat: seat.clone(), from, to, at: now, retry, accepted: false, timed_out: false });
        let n = slot.run.wakes.len();
        slot.run.bump(now, Actor::Server, "producer_woken", None, &n.to_string());
        let detail = OrchestrationAudit {
            gen: slot.run.gen,
            actor: Actor::Server.as_str().into(),
            wake_id: Some(wake_id.clone()),
            chat: Some(chat),
            from_seq: Some(from),
            to_seq: Some(to),
            kinds: Some(note.kinds()),
            retry: Some(retry),
            ..Default::default()
        };
        let mut event = note.view();
        if let Some(o) = event.as_object_mut() {
            o.insert("wakeId".into(), json!(wake_id));
            // 같은 범위의 재시도 — 화면 알약이 "다시 알림" 표지를 단다(글이 원래 알약과 같아 중복처럼 보이지 않게).
            o.insert("retry".into(), json!(retry));
        }
        self.after_change(&g, &run_id);
        drop(g);
        self.audit("producer_woken", &run_id, detail);
        Some(Reserved { wake_id, text, event })
    }

    pub(crate) fn wake_started(&self, seat: &Seat, wake_id: &str) {
        let mut g = self.lock();
        if let Some((_, slot)) = Self::wake_slot_mut(&mut g, seat) {
            if let Some(l) = slot.wake.live.as_mut().filter(|l| l.wake_id == wake_id) {
                l.accepted = true;
            }
        }
    }

    /// 한 번만 — 돌려준 id 의 턴을 레지스트리가 끊는다.
    pub(crate) fn wake_overdue(&self, seat: &Seat) -> Option<String> {
        let now = self.now();
        let mut g = self.lock();
        let (_, slot) = Self::wake_slot_mut(&mut g, seat)?;
        let l = slot.wake.live.as_mut().filter(|l| l.accepted && !l.timed_out && now.saturating_sub(l.at) >= TURN_MS)?;
        l.timed_out = true;
        Some(l.wake_id.clone())
    }

    /// 확정 커서는 레지스트리가 바로 앞에서 `seat_turn_ended` 로 올렸다. 묶인 Run 이 없으면 해제가 이미 나가 있는 깨움을 걷었다.
    pub(crate) fn wake_ended(&self, seat: &Seat, wake_id: &str, end: WakeEnd) {
        let mut g = self.lock();
        let Some((run_id, slot)) = Self::wake_slot_mut(&mut g, seat).map(|(id, s)| (id.clone(), s)) else { return };
        let Some(l) = slot.wake.live.take_if(|l| l.wake_id == wake_id) else { return };
        let outcome = judge_end(slot, &l, end);
        if let Some(kind) = outcome.notice {
            self.raise(slot, kind, None, None);
        }
        let detail = OrchestrationAudit {
            gen: slot.run.gen,
            actor: Actor::Server.as_str().into(),
            wake_id: Some(l.wake_id.clone()),
            from_seq: Some(l.from),
            to_seq: Some(l.to),
            outcome: Some(outcome.word.into()),
            retry: Some(l.retry),
            ..Default::default()
        };
        self.after_change(&g, &run_id);
        drop(g);
        self.audit("producer_wake_ended", &run_id, detail);
    }

    pub(crate) fn wake_human_spoke(&self, chat: &str) {
        let mut g = self.lock();
        let Some(run) = g.producer_ever.get(chat).cloned() else { return };
        if let Some(slot) = g.runs.get_mut(&run) {
            let w = &mut slot.wake;
            w.segment = 0;
            w.streak = 0;
            w.failed = false;
            w.noticed = None;
        }
    }
}

struct EndOutcome {
    word: &'static str,
    notice: Option<&'static str>,
}

fn judge_end(slot: &mut Slot, l: &LiveWake, end: WakeEnd) -> EndOutcome {
    let handled = |slot: &mut Slot| slot.run.wake_handled_to = slot.run.wake_handled_to.max(l.to);
    let give_up = |slot: &mut Slot, notice: &'static str, word: &'static str| {
        slot.run.wake_handled_to = slot.run.wake_handled_to.max(l.to);
        slot.wake.streak += 1;
        slot.wake.retry = None;
        EndOutcome { word, notice: Some(notice) }
    };
    if l.timed_out {
        return give_up(slot, "wake-turn-timeout", "timeout");
    }
    match end {
        WakeEnd::Natural => {
            if slot.cursor.committed >= l.to {
                handled(slot);
                slot.wake.streak = 0;
                slot.wake.retry = None;
                EndOutcome { word: "handled", notice: None }
            } else if !l.retry {
                slot.wake.retry = Some((l.from, l.to));
                EndOutcome { word: "unresponsive", notice: None }
            } else {
                give_up(slot, "wake-ignored", "unresponsive")
            }
        }
        WakeEnd::Interrupted => {
            handled(slot);
            slot.wake.segment = 0;
            slot.wake.streak = 0;
            slot.wake.retry = None;
            slot.wake.noticed = None;
            EndOutcome { word: "interrupted", notice: None }
        }
        WakeEnd::Unacked | WakeEnd::Error => {
            if !l.retry {
                slot.wake.retry = Some((l.from, l.to));
                EndOutcome { word: "unacked", notice: None }
            } else {
                slot.wake.failed = true;
                slot.wake.retry = None;
                EndOutcome { word: "failed", notice: Some("wake-failed") }
            }
        }
        WakeEnd::Exited => EndOutcome { word: "exited", notice: None },
    }
}

// ---------------------------------------------------------------------------
// 시험 손
// ---------------------------------------------------------------------------

#[cfg(test)]
impl Orchestration {
    /// 이미 사람이 연 앨범에 시험 프로듀서를 묶는다. 새 Run은 만들지 않는다.
    pub(crate) fn wake_test_album(&self, chat: &str, proc: crate::server::chat_proc::ProcId) -> String {
        let run=self.producer_run(chat).unwrap();
        let gen=self.lock().runs[&run].run.gen;
        self.bind_seat_for_test(&run,gen,&Seat {chat:chat.into(),proc}).unwrap();
        self.resume(&run).unwrap();
        run
    }
    pub(crate) fn wake_test_ledger(&self, run: &str, ago: u64) {
        let now = self.now().saturating_sub(ago);
        let mut g = self.lock();
        g.runs.get_mut(run).unwrap().run.bump(now, Actor::Human, "human_resumed", None, "running");
    }

    pub(crate) fn wake_test_records(&self, run: &str) -> Vec<WakeRecord> {
        self.lock().runs.get(run).map(|s| s.run.wakes.clone()).unwrap_or_default()
    }
}

//! **진행 기록** — 작업자 대화의 고정 · 전방 증분 판독(`read_worker`) · `wait_run` 깨우기 · 보드 최근 활동.
//!
//! 불변식:
//! - **대화 고정** — Attempt 의 대화는 처음 받은 id 이고, 그 id 의 파일은 **그 CLI 의 대화 폴더 안**(정규화 뒤) · 기록된 **cwd 가 그 Attempt 의
//!   worktree** 일 때만 받는다. 다른 대화는 훑지 않고, 뒤에 다른 id 가 와도 고정은 그대로(`conversationChanged` 경고만) → docs/invariants.md 전문 10.
//! - 대화 본문은 화면과 **자기 Run 작업자를 읽는 조정자에게만** 나간다(시험 `transcript_mcp_only_own_run_workers`). 이 파일은 로그 줄 · 감사 줄을
//!   쓰지 않는다(시험 `transcript_never_in_audit_or_logs`).
//! - 파일 경로는 메모리(`Slot.transcripts`)에만 — 화면 · 조정자에게는 상태 낱말만.
//! - 시계의 크기 증가는 `seq` · 이벤트만 — 타임라인 줄 · 영속 쓰기는 없다(2초마다 파일을 다시 쓰지 않게).
//! - 파일 · git 입출력은 오케스트레이션 잠금 **밖**에서.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};

use super::model::*;
use super::store::{not_found_run, reason, OrchError, Orchestration, Slot};
use super::tools::{coordinator_slot, opt_text, req_text};
use crate::agent_transcript::forward::{self, Budget, Cursor};

pub(crate) const GROWTH_EVERY_MS: u64 = 2_000;
const RESOLVE_EVERY_MS: u64 = 10_000;
pub(crate) const LAG_MS: u64 = 60_000;
pub(crate) const RESPONSE_MAX: usize = 64 * 1024;
const FILES_MAX_BYTES: usize = 16 * 1024;
const HEAD_BYTES: u64 = 256 * 1024;
const ACTIVITY_MAX: usize = 12;

/// 시험이 갈아 끼운다.
pub(crate) type RootsFn = Arc<dyn Fn(WorkerCli) -> Vec<PathBuf> + Send + Sync>;

/// 메모리만 — 경로를 영속 · 화면에 싣지 않는다.
#[derive(Clone, Default)]
pub(crate) struct Watch {
    pub path: Option<PathBuf>,
    /// Codex 는 첫 턴 도중 `thread.started` 에 선다.
    pub for_id: Option<String>,
    /// `ok` · `pending`(아직 파일 없음) · `cwd-mismatch` · `outside-cli-dir` · `no-conversation` · `unreadable`.
    pub status: &'static str,
    pub size: u64,
    pub grew_at: Option<u64>,
    pub tried_at: Option<u64>,
    /// 검증한 파일의 세대 — 지금 그 경로의 파일이 이것과 다르면 다시 검증한다.
    pub ident: String,
}

// ---------------------------------------------------------------------------
// 루트 · 고정 파일 찾기 · 검증
// ---------------------------------------------------------------------------

/// **개발 빌드 전용** — 가짜 작업자가 진짜 `~/.claude` 를 밟지 않게 대화 루트를 바꾼다. 릴리스 빌드에는 이 길이 없다(시험
/// `dev_transcript_root_is_debug_only`).
#[cfg(debug_assertions)]
fn dev_transcript_root() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os("AYNX_DEV_TRANSCRIPT_ROOT")?);
    (p.is_absolute() && p.is_dir()).then_some(p)
}

#[cfg(not(debug_assertions))]
fn dev_transcript_root() -> Option<PathBuf> {
    None
}

pub(crate) fn cli_roots(cli: WorkerCli) -> Vec<PathBuf> {
    if let Some(r) = dev_transcript_root() {
        return vec![r.join(match cli {
            WorkerCli::Claude => "projects",
            WorkerCli::Codex => "sessions",
        })];
    }
    crate::agent_sessions::target(cli.as_str()).map(|t| (t.roots)()).unwrap_or_default()
}

fn parser(cli: WorkerCli) -> Option<crate::agent_transcript::LineEvents> {
    crate::agent_sessions::target(cli.as_str()).ok().map(|t| t.transcript)
}

pub(crate) fn same_dir(recorded: &str, worktree: &Path) -> bool {
    if let (Ok(a), Ok(b)) = (Path::new(recorded).canonicalize(), worktree.canonicalize()) {
        return a == b;
    }
    let norm = |s: &str| {
        let s = s.strip_prefix(r"\\?\").unwrap_or(s).replace('\\', "/");
        let s = s.trim_end_matches('/').to_string();
        if cfg!(windows) {
            s.to_lowercase()
        } else {
            s
        }
    };
    let a = norm(recorded);
    !a.is_empty() && a == norm(&worktree.to_string_lossy())
}

/// 다른 대화 파일은 열지 않는다(Claude 서브에이전트 파일은 한 단 아래라 안 걸린다).
fn candidates_in(cli: WorkerCli, root: &Path, id: &str) -> Vec<PathBuf> {
    use crate::agent_sessions::{candidates, entries_desc, Layout};
    match cli {
        WorkerCli::Claude => entries_desc(root)
            .into_iter()
            .filter(|d| d.is_dir())
            .map(|d| d.join(format!("{id}.jsonl")))
            .filter(|p| p.is_file())
            .collect(),
        WorkerCli::Codex => candidates(&Layout::DateTree, root)
            .into_iter()
            .map(|s| s.path)
            .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().to_ascii_lowercase().contains(id)))
            .collect(),
    }
}

/// (대화 id, 기록된 cwd). 읽은 뒤 손잡이를 처음으로 되돌린다.
fn recorded(cli: WorkerCli, path: &Path, f: &mut File) -> Option<(String, String)> {
    let mut buf = Vec::new();
    f.seek(SeekFrom::Start(0)).ok()?;
    (&mut *f).take(HEAD_BYTES).read_to_end(&mut buf).ok()?;
    f.seek(SeekFrom::Start(0)).ok()?;
    let lines = crate::agent_sessions::json_lines(&buf);
    match cli {
        WorkerCli::Claude => {
            let id = path.file_stem()?.to_string_lossy().to_ascii_lowercase();
            let cwd = lines
                .iter()
                .filter(|v| v["isSidechain"] != true)
                .find_map(|v| v["cwd"].as_str().filter(|s| !s.is_empty()))?;
            Some((id, cwd.to_owned()))
        }
        WorkerCli::Codex => {
            let first = lines.first().filter(|v| v["type"] == "session_meta")?;
            let id = first["payload"]["id"].as_str()?.to_ascii_lowercase();
            let cwd = first["payload"]["cwd"].as_str()?;
            Some((id, cwd.to_owned()))
        }
    }
}

/// 검증한 **그 손잡이**째 돌려준다(경로로 다시 열지 않는다). 이 파일이 아니면 `Err(None)`.
fn open_verified(
    cli: WorkerCli,
    id: &str,
    worktree: &Path,
    croots: &[PathBuf],
    p: &Path,
) -> Result<(PathBuf, File), Option<&'static str>> {
    let cp = p.canonicalize().map_err(|_| None)?;
    if !croots.iter().any(|r| cp.starts_with(r)) {
        return Err(Some("outside-cli-dir"));
    }
    let mut f = File::open(&cp).map_err(|_| Some("unreadable"))?;
    match recorded(cli, &cp, &mut f) {
        Some((fid, cwd)) if fid == id => {
            if same_dir(&cwd, worktree) {
                Ok((cp, f))
            } else {
                Err(Some("cwd-mismatch"))
            }
        }
        // id 가 다르거나(포크 파일 — 부모 id 를 이름에 품는다) 아직 cwd 가 없다 — 이 파일은 아니다.
        _ => Err(None),
    }
}

/// 블로킹 — 잠금 밖에서 부른다.
pub(crate) fn pin_file_open(cli: WorkerCli, id: &str, worktree: &Path, roots: &[PathBuf]) -> Result<(PathBuf, File), &'static str> {
    if !crate::agent_sessions::uuid_shape(id) {
        return Err("no-conversation");
    }
    let id = id.to_ascii_lowercase();
    let mut why: Option<&'static str> = None;
    for root in roots {
        let Ok(croot) = root.canonicalize() else { continue };
        for p in candidates_in(cli, root, &id) {
            match open_verified(cli, &id, worktree, std::slice::from_ref(&croot), &p) {
                Ok(found) => return Ok(found),
                Err(Some(w)) => why = Some(w),
                Err(None) => {}
            }
        }
    }
    Err(why.unwrap_or("pending"))
}

#[cfg(test)]
pub(crate) fn pin_file(cli: WorkerCli, id: &str, worktree: &Path, roots: &[PathBuf]) -> Result<PathBuf, &'static str> {
    pin_file_open(cli, id, worktree, roots).map(|(p, _)| p)
}

/// 못 읽으면 빈 글자 — 그때는 늘 다시 검증한다.
fn ident_of(f: &File) -> String {
    forward::file_gen(f).map(|g| g.id).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// 보기 칸(본문 없음)
// ---------------------------------------------------------------------------

/// 보드 표시만.
fn lagging(a: &Attempt, w: Option<&Watch>, now: u64) -> bool {
    if !matches!(a.state, AttemptState::Running | AttemptState::Working) {
        return false;
    }
    let since = w.and_then(|w| w.grew_at).unwrap_or(a.started_at);
    now.saturating_sub(since) >= LAG_MS
}

/// 경로 · 본문을 싣지 않는다.
pub(super) fn transcripts_view(slot: &Slot, now: u64) -> Value {
    let mut out = serde_json::Map::new();
    for a in slot.run.attempts.iter().filter(|a| a.turn_may_live()) {
        let w = slot.transcripts.get(&a.id);
        let status = match (w, &a.conversation_id) {
            (_, None) => "no-conversation",
            (Some(w), Some(_)) if !w.status.is_empty() => w.status,
            _ => "pending",
        };
        out.insert(
            a.id.clone(),
            json!({
                "status": status,
                "lastGrowthAt": w.and_then(|w| w.grew_at),
                "lagging": lagging(a, w, now),
            }),
        );
    }
    Value::Object(out)
}

fn attempt_summary(_slot: &Slot, a: &Attempt, _now: u64) -> Value {
    json!({
        "attemptId": a.id,
        "taskId": a.task_id,
        "cli": a.cli,
        "state": a.state,
        "attention": a.attention,
        "conversationChanged": a.conversation_changed,
        "conversationBroken": a.conversation_broken,
        "blocked": a.blocked,
        "turn": a.turn_no(),
        "lastTurn": a.turns.last().map(|t| json!({
            "n": t.n,
            "outcome": t.outcome,
            "reason": t.reason,
            "denials": t.denials,
            "denialKinds": t.denial_kinds,
            "tools": t.tools,
            "lastTool": t.last_tool,
        })),
        "lastCommitRejection": a.last_commit_rejection,
    })
}

/// git 은 잠금 밖.
fn changed_files(probe: &super::report::Probe, worktree: Option<&str>, base: Option<&str>) -> Value {
    let Some(w) = worktree else {
        return json!({ "files": [], "count": 0, "truncated": false, "dirty": false });
    };
    match probe(Path::new(w), base) {
        Ok(s) => {
            let mut files: Vec<String> = Vec::new();
            let mut bytes = 0usize;
            let mut truncated = s.truncated;
            for f in s.changed.iter().chain(s.uncommitted.iter()) {
                if files.iter().any(|x| x == f) {
                    continue;
                }
                if files.len() >= CHANGED_FILES_MAX || bytes + f.len() > FILES_MAX_BYTES {
                    truncated = true;
                    break;
                }
                bytes += f.len();
                files.push(f.clone());
            }
            json!({ "files": files, "count": files.len(), "truncated": truncated, "dirty": s.dirty, "head": s.head })
        }
        Err(e) => json!({ "files": [], "count": 0, "truncated": false, "error": e.chars().filter(|c| !c.is_control()).take(240).collect::<String>() }),
    }
}

/// (attemptId, CLI, worktree, 기준 커밋, 대화 바뀜).
type ActivityRow = (String, WorkerCli, Option<String>, Option<String>, bool);

impl Orchestration {
    #[cfg(test)]
    pub(crate) fn set_transcript_roots(&self, f: RootsFn) {
        *self.transcript_roots.write().unwrap_or_else(|e| e.into_inner()) = Some(f);
    }

    fn roots_for(&self, cli: WorkerCli) -> Vec<PathBuf> {
        let f = self.transcript_roots.read().unwrap_or_else(|e| e.into_inner()).clone();
        match f {
            Some(f) => f(cli),
            None => cli_roots(cli),
        }
    }

    /// 캐시한 경로의 파일이 검증 때와 세대가 다르면(교체) 경로 · cwd · id 를 **다시 검증**한다 — 교체된 파일을 믿지 않는다. 입출력은 잠금 밖.
    fn pinned(&self, run_id: &str, attempt_id: &str, force: bool) -> (Option<(PathBuf, File)>, &'static str) {
        let now = self.now();
        let (cli, id, worktree, cached) = {
            let g = self.lock();
            let Some(slot) = g.runs.get(run_id) else { return (None, "pending") };
            let Some(a) = slot.run.attempts.iter().find(|a| a.id == attempt_id) else { return (None, "pending") };
            let Some(id) = a.conversation_id.clone() else { return (None, "no-conversation") };
            let w = slot.transcripts.get(attempt_id).filter(|w| w.for_id.as_deref() == Some(id.as_str()));
            let cached = w.and_then(|w| w.path.clone().map(|p| (p, w.ident.clone())));
            if cached.is_none() {
                if let Some(w) = w {
                    if !force && w.tried_at.is_some_and(|t| now.saturating_sub(t) < RESOLVE_EVERY_MS) {
                        return (None, w.status);
                    }
                }
            }
            // 검토자는 worktree 가 없다 — 그 CLI 의 작업 폴더는 서버 빈 cwd 다.
            let Some(wt) = a.worktree.clone().or_else(|| a.review_of.as_ref().and_then(|r| r.cwd.clone())) else {
                return (None, "pending");
            };
            (a.cli, id, wt, cached)
        };
        if let Some((p, ident)) = cached {
            if let Ok(f) = File::open(&p) {
                if !ident.is_empty() && ident_of(&f) == ident {
                    return (Some((p, f)), "ok");
                }
            }
        }
        let found = pin_file_open(cli, &id, Path::new(&worktree), &self.roots_for(cli));
        let mut g = self.lock();
        let Some(slot) = g.runs.get_mut(run_id) else { return (None, "pending") };
        let w = slot.transcripts.entry(attempt_id.to_string()).or_default();
        if w.for_id.as_deref() != Some(id.as_str()) {
            *w = Watch {
                for_id: Some(id),
                ..Default::default()
            };
        }
        w.tried_at = Some(now);
        match found {
            Ok((p, f)) => {
                let ident = ident_of(&f);
                w.status = "ok";
                if w.path.is_none() || w.ident != ident {
                    // 크기 0 에서 — 이미 쓴 것도 다음 시계가 증가로 보고 `wait_run` 을 깨운다.
                    w.size = 0;
                    w.grew_at = Some(now);
                }
                w.path = Some(p.clone());
                w.ident = ident;
                (Some((p, f)), "ok")
            }
            Err(why) => {
                w.path = None;
                w.ident.clear();
                w.status = why;
                (None, why)
            }
        }
    }
    pub(super) fn read_worker(&self, run_id: &str, gen: u32, args: Option<&Value>) -> Result<Value, OrchError> {
        let attempt_id = req_text(args, "attemptId", 64)?;
        let cursor = match opt_text(args, "cursor", 256)? {
            None => None,
            Some(s) => Some(Cursor::decode(&s).ok_or_else(|| {
                super::tools::bad("cursor must be a cursor that read_worker returned (or omitted to read from the start)")
            })?),
        };
        let now = self.now();
        let (cli, summary, worktree, base) = {
            let mut g = self.lock();
            let slot = coordinator_slot(&mut g, run_id, gen, args, now)?;
            let a = slot
                .run
                .attempts
                .iter()
                .find(|a| a.id == attempt_id)
                .ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such attempt in your run"))?;
            (a.cli, attempt_summary(slot, a, now), a.worktree.clone(), a.base_commit.clone())
        };
        let (path, status) = self.pinned(run_id, &attempt_id, true);
        let changed = changed_files(&self.probe(), worktree.as_deref(), base.as_deref());
        let mut out = json!({
            "attemptId": attempt_id,
            "attempt": summary,
            "transcript": { "status": status },
            "changedFiles": changed,
            "items": [],
            "cursor": cursor.as_ref().map(Cursor::encode),
            "more": false,
        });
        let (Some((_, file)), Some(parse)) = (path, parser(cli)) else {
            return Ok(out);
        };
        let fixed = serde_json::to_vec(&out).map_or(RESPONSE_MAX, |v| v.len());
        let mut bytes = RESPONSE_MAX.saturating_sub(fixed + 2048).max(4096);
        // 가장 작은 예산에서는 넘어도 그대로 낸다 — 쪽은 늘 하나 이상 싣고 커서가 앞으로 가야 한다(빈 결과 · 옛 커서로 멈추지 않게).
        loop {
            let budget = Budget {
                items: forward::ITEMS_MAX,
                bytes,
            };
            let read = file.try_clone().and_then(|f| forward::read_forward_file(f, cursor.as_ref(), parse, budget));
            let (page, next, reset) = match read {
                Ok(r) => r,
                Err(_) => {
                    out["transcript"]["status"] = json!("unreadable");
                    return Ok(out);
                }
            };
            let mut v = out.clone();
            v["items"] = serde_json::to_value(&page.items).unwrap_or_else(|_| json!([]));
            v["cursor"] = json!(next.encode());
            v["more"] = json!(page.more);
            if reset {
                v["reset"] = json!(true);
            }
            if page.partial {
                v["partialLineDeferred"] = json!(true);
            }
            let size = serde_json::to_vec(&v).map_or(usize::MAX, |b| b.len());
            if size <= RESPONSE_MAX || bytes <= 4096 {
                return Ok(v);
            }
            bytes = (bytes / 2).max(4096);
        }
    }

    /// 바뀐 Run 수.
    pub(crate) fn transcript_tick(&self) -> usize {
        let targets: Vec<(String, String)> = {
            let g = self.lock();
            g.runs
                .iter()
                .filter(|(_, s)| s.run.state.active())
                .flat_map(|(rid, s)| {
                    s.run
                        .attempts
                        .iter()
                        .filter(|a| a.turn_may_live() && a.conversation_id.is_some())
                        .map(move |a| (rid.clone(), a.id.clone()))
                })
                .collect()
        };
        let mut grown: Vec<(String, String, u64)> = Vec::new();
        for (run, att) in &targets {
            if let (Some((_, f)), _) = self.pinned(run, att, false) {
                if let Ok(m) = f.metadata() {
                    grown.push((run.clone(), att.clone(), m.len()));
                }
            }
        }
        if grown.is_empty() {
            return 0;
        }
        let now = self.now();
        let mut g = self.lock();
        let mut changed: Vec<String> = Vec::new();
        for (run, att, size) in grown {
            let Some(slot) = g.runs.get_mut(&run) else { continue };
            let Some(w) = slot.transcripts.get_mut(&att) else { continue };
            let grew = size > w.size;
            w.size = size;
            if grew {
                w.grew_at = Some(now);
                if !changed.contains(&run) {
                    slot.run.seq += 1;
                    changed.push(run);
                }
            }
        }
        for run in &changed {
            if let Some(slot) = g.runs.get(run) {
                (self.emit)(super::store::EVT_CHANGED, json!({ "runId": run, "seq": slot.run.seq }));
            }
        }
        if !changed.is_empty() {
            self.changed.notify_all();
        }
        changed.len()
    }

    /// **블로킹**(파일 · git) — 보드가 보일 때만 부른다. worktree 경로는 Attempt 기록에서만 꺼낸다 — 화면은 attemptId 만 준다.
    pub(crate) fn worker_activity(&self, run_id: &str, detail: Option<&str>) -> Result<Value, OrchError> {
        let now = self.now();
        let list: Vec<ActivityRow> = {
            let g = self.lock();
            let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
            let row = |a: &Attempt| (a.id.clone(), a.cli, a.worktree.clone(), a.base_commit.clone(), a.conversation_changed);
            let mut list: Vec<ActivityRow> = slot
                .run
                .attempts
                .iter()
                .rev()
                .filter(|a| a.turn_may_live())
                .take(ACTIVITY_MAX)
                .map(row)
                .collect();
            if let Some(d) = detail.filter(|d| !list.iter().any(|r| r.0 == *d)) {
                if let Some(a) = slot.run.attempts.iter().find(|a| a.id == d && a.worktree.is_some()) {
                    list.push(row(a));
                }
            }
            list
        };
        let probe = self.probe();
        let mut out = serde_json::Map::new();
        for (att, cli, wt, base, changed_conv) in list {
            let (path, status) = self.pinned(run_id, &att, false);
            let recent = match (path, parser(cli)) {
                (Some((_, f)), Some(parse)) => forward::recent(f, parse).ok(),
                _ => None,
            };
            let files = changed_files(&probe, wt.as_deref(), base.as_deref());
            let wip = (detail == Some(att.as_str())).then(|| super::diff::wip_value(wt.as_deref(), base.as_deref()));
            let (lag, grew_at) = {
                let g = self.lock();
                let slot = g.runs.get(run_id);
                let w = slot.and_then(|s| s.transcripts.get(&att));
                let a = slot.and_then(|s| s.run.attempts.iter().find(|a| a.id == att));
                (a.is_some_and(|a| lagging(a, w, now)), w.and_then(|w| w.grew_at))
            };
            let mut v = json!({
                "status": if recent.is_none() && status == "ok" { "unreadable" } else { status },
                "recent": recent,
                "changedCount": files["count"],
                "changedTruncated": files["truncated"],
                "dirty": files["dirty"],
                "conversationChanged": changed_conv,
                "lagging": lag,
                "lastGrowthAt": grew_at,
            });
            if let (Some(w), Some(m)) = (wip, v.as_object_mut()) {
                m.insert("wip".into(), w);
            }
            out.insert(att, v);
        }
        Ok(Value::Object(out))
    }

    /// 사람의 [기록 보기] — 그 Attempt 의 고정 파일만. 다른 대화는 이 길로 읽을 수 없다.
    pub(crate) fn worker_transcript_page(
        &self,
        run_id: &str,
        attempt_id: &str,
        before: Option<u64>,
        limit: Option<usize>,
    ) -> Result<Value, OrchError> {
        let cli = {
            let g = self.lock();
            let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
            slot.run
                .attempts
                .iter()
                .find(|a| a.id == attempt_id)
                .map(|a| a.cli)
                .ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such attempt"))?
        };
        let (path, status) = self.pinned(run_id, attempt_id, true);
        let (_, file) = path.ok_or_else(|| OrchError::new(reason::TRANSCRIPT_UNAVAILABLE, status))?;
        let parse = parser(cli).ok_or_else(|| OrchError::new(reason::INTERNAL, "unknown cli"))?;
        let page = crate::agent_transcript::page_of_file(file, before, limit, parse)
            .map_err(|e| OrchError::new(reason::TRANSCRIPT_UNAVAILABLE, e))?;
        serde_json::to_value(page).map_err(|e| OrchError::new(reason::INTERNAL, e.to_string()))
    }
}

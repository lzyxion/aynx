//! **진행 기록**(설계 C-6 · C-2 `read_worker` · E-1 — G 6단계): 작업자 대화의 **고정** · 전방 증분 판독 · `wait_run` 깨우기 · 보드 최근 활동.
//!
//! - **대화 고정** — Attempt 의 대화는 처음 받은 id 다(Claude = 서버가 정한 `--session-id` — 띄울 때부터, Codex = 서버가 띄운 첫 턴
//!   프로세스 stdout 의 `thread.started` 가 알린 id — init 확인을 지난 **그 순간** 턴 고리가 고정한다(F4 — `turn::TurnLog::early_conversation` ·
//!   `server::workers` 의 `Pulse` → `Orchestration::attempt_conversation`), 턴 끝에는 같은 값 확인만). 고정은 id 만이고 파일은 아직 없을 수
//!   있다(`pending` — 아래 시계 · 판독이 찾는다). 그 id 의 파일을 받는 조건은 둘: **그 CLI 의 대화 폴더 안**(Claude `$CLAUDE_CONFIG_DIR|~/.claude/projects` ·
//!   Codex `$CODEX_HOME|~/.codex/sessions` — 정규화한 경로가 정규화한 루트 아래)이고, 파일이 기록한 **cwd 가 그 Attempt 의 worktree**.
//!   찾는 것은 그 id 의 파일 하나뿐이다(목록 색인 · 다른 대화를 훑지 않는다). 뒤에 다른 id 가 와도 고정은 그대로(`conversationChanged` 경고만).
//! - **전방 증분**(`crate::agent_transcript::forward`) — 커서 = 파일 세대 + 바이트 위치, 미완성 줄은 미루고, 늦은 결과는 갱신 항목,
//!   파일이 줄거나 바뀌면 처음부터 + `reset`.
//! - **`wait_run` 깨우기** — 서버 시계가 [`GROWTH_EVERY_MS`] 마다 살아 있는 Attempt 의 고정 파일 **크기만** 본다. 커지면 Run `seq` 를 올리고
//!   (타임라인 줄 · 영속 쓰기 없이 — 2초마다 파일을 다시 쓰지 않게) 이벤트 `orchestration-changed` 를 그대로 낸다.
//! - **보드 최근 활동** — 같은 고정 파일의 끝에서 거꾸로 한 쪽(기록 보기와 같은 리더)과 worktree 변경 수. 보드가 보일 때만 묻는다.
//!
//! 불변식:
//! - 대화 본문은 **화면과 조정자에게만** 나간다(`agent_transcript.rs` 머리말 — 6단계 불변 변경). 조정자에게는 **자기 Run 작업자의 고정
//!   대화만**(`transcript_mcp_only_own_run_workers` — 다른 Run · 작업자 토큰 · 전역 토큰은 이 도구가 없다). 로그 · 감사 · 영속 파일 ·
//!   이벤트에는 본문이 없다 — 이 파일은 로그 줄 · 감사 줄을 쓰지 않는다(시험 `transcript_never_in_audit_or_logs`).
//! - 파일 경로는 메모리(`Slot.transcripts`)에만 · 화면 · 조정자에게 경로를 주지 않는다(상태 낱말만).
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

/// 고정 파일 크기를 보는 간격(서버 시계 — `server::ai`).
pub(crate) const GROWTH_EVERY_MS: u64 = 2_000;
/// 아직 못 찾은 고정 파일을 다시 찾는 간격(시계 · 보드 — `read_worker` 는 늘 다시 찾는다).
const RESOLVE_EVERY_MS: u64 = 10_000;
/// "기록 지연" — 일하는 중인데 이만큼 기록이 자라지 않았다(보드 표시만).
pub(crate) const LAG_MS: u64 = 60_000;
/// `read_worker` 응답 상한(설계 C-6).
pub(crate) const RESPONSE_MAX: usize = 64 * 1024;
/// 변경 파일 이름 합의 상한(바이트) — 넘으면 `truncated`.
const FILES_MAX_BYTES: usize = 16 * 1024;
/// 대화 파일 앞에서 cwd · id 를 찾는 양.
const HEAD_BYTES: u64 = 256 * 1024;
/// 보드가 한 번에 묻는 작업자 수 상한(최근 것부터).
const ACTIVITY_MAX: usize = 12;

/// CLI 대화 루트를 정하는 손(시험이 갈아 끼운다).
pub(crate) type RootsFn = Arc<dyn Fn(WorkerCli) -> Vec<PathBuf> + Send + Sync>;

/// Attempt 하나의 고정 파일 지켜보기 — **메모리만**(경로를 영속 · 화면에 싣지 않는다).
#[derive(Clone, Default)]
pub(crate) struct Watch {
    /// 검증을 지난 고정 파일(정규화한 경로).
    pub path: Option<PathBuf>,
    /// 그 경로를 찾은 대화 id(고정은 바뀌지 않지만 Codex 는 첫 턴 도중 `thread.started` 에 선다).
    pub for_id: Option<String>,
    /// `ok` · `pending`(아직 파일 없음) · `cwd-mismatch` · `outside-cli-dir` · `no-conversation` · `unreadable`.
    pub status: &'static str,
    /// 마지막으로 본 크기.
    pub size: u64,
    /// 마지막으로 자란 시각(처음 찾은 때 포함).
    pub grew_at: Option<u64>,
    /// 마지막으로 찾아본 시각.
    pub tried_at: Option<u64>,
    /// 검증한 파일의 식별(세대 — 리뷰 F7). 지금 그 경로의 파일이 이것과 다르면 다시 검증한다.
    pub ident: String,
}

// ---------------------------------------------------------------------------
// 루트 · 고정 파일 찾기 · 검증
// ---------------------------------------------------------------------------

/// **개발 빌드 전용** — `AYNX_DEV_TRANSCRIPT_ROOT=<절대 폴더>` 면 CLI 대화 루트를 그 아래(`projects` · `sessions`)로 바꾼다(6단계 실기 —
/// 가짜 작업자가 진짜 `~/.claude` 를 밟지 않고 Claude 식 대화 파일을 쓴다). **릴리스 빌드에는 이 길이 없다**(아래 스텁 · 시험
/// `dev_transcript_root_is_debug_only`).
#[cfg(debug_assertions)]
fn dev_transcript_root() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os("AYNX_DEV_TRANSCRIPT_ROOT")?);
    (p.is_absolute() && p.is_dir()).then_some(p)
}

/// 릴리스 빌드 — 대화 루트를 바꾸는 길은 없다.
#[cfg(not(debug_assertions))]
fn dev_transcript_root() -> Option<PathBuf> {
    None
}

/// 그 CLI 의 대화 루트(이 서버 프로세스의 환경 — `CLAUDE_CONFIG_DIR` · `CODEX_HOME` 존중, 목록 · 기록 보기와 같은 표 `agent_sessions::TARGETS`).
pub(crate) fn cli_roots(cli: WorkerCli) -> Vec<PathBuf> {
    if let Some(r) = dev_transcript_root() {
        return vec![r.join(match cli {
            WorkerCli::Claude => "projects",
            WorkerCli::Codex => "sessions",
        })];
    }
    crate::agent_sessions::target(cli.as_str()).map(|t| (t.roots)()).unwrap_or_default()
}

/// 줄 파서(기록 보기와 같은 것 — 생각 · sidechain 제외).
fn parser(cli: WorkerCli) -> Option<crate::agent_transcript::LineEvents> {
    crate::agent_sessions::target(cli.as_str()).ok().map(|t| t.transcript)
}

/// 두 폴더가 같은가 — 둘 다 정규화되면 그것으로, 아니면 글자로(구분자 · 끝 구분자 · Windows 는 대소문자 무시).
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

/// 그 id 의 후보 파일 — Claude 는 `<루트>/<프로젝트 폴더>/<id>.jsonl`(맨 윗단만 — 서브에이전트 파일은 한 단 아래), Codex 는 날짜 트리에서
/// 이름에 id 가 든 롤아웃. 다른 대화 파일은 열지 않는다.
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

/// 열린 손잡이의 앞에서 (대화 id, 기록된 cwd) — Claude 는 파일 이름이 id 이고 첫 `cwd` 칸, Codex 는 첫 줄 `session_meta` 의 `id` · `cwd`.
/// 읽은 뒤 손잡이를 처음으로 되돌린다.
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

/// 후보 하나를 열어 **그 손잡이로** 검증한다(리뷰 F7) — 정규화한 경로가 정규화한 루트 아래(링크로 밖을 가리키면 `outside-cli-dir`) ·
/// 그 손잡이의 내용이 그 id · 기록된 cwd 가 worktree. `Ok((정규화한 경로, 처음으로 되돌린 손잡이))`, 이 파일이 아니면 `Err(None)`.
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

/// **고정 파일 하나를 찾고 검증한다**(블로킹 — 잠금 밖) — 검증한 손잡이째 돌려준다. 그 CLI 의 루트 아래(정규화 뒤에도)에 있고 그 id 로
/// 확인되고 기록된 cwd 가 worktree 일 때만 `Ok`. 아직 파일이 없으면(CLI 가 첫 줄을 쓰기 전) `pending`.
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

/// [`pin_file_open`] 의 경로만(시험).
#[cfg(test)]
pub(crate) fn pin_file(cli: WorkerCli, id: &str, worktree: &Path, roots: &[PathBuf]) -> Result<PathBuf, &'static str> {
    pin_file_open(cli, id, worktree, roots).map(|(p, _)| p)
}

/// 이 손잡이의 파일 식별(세대 — `forward::file_gen` 의 식별). 못 읽으면 빈 글자(그때는 늘 다시 검증한다).
fn ident_of(f: &File) -> String {
    forward::file_gen(f).map(|g| g.id).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// 보기 칸(본문 없음)
// ---------------------------------------------------------------------------

/// 기록 지연인가 — 턴이 도는 중(`running` · 옛 `working`)인데 마지막 증가(없으면 Attempt 시작)에서 [`LAG_MS`] 가 지났다. 표시만.
fn lagging(a: &Attempt, w: Option<&Watch>, now: u64) -> bool {
    if !matches!(a.state, AttemptState::Running | AttemptState::Working) {
        return false;
    }
    let since = w.and_then(|w| w.grew_at).unwrap_or(a.started_at);
    now.saturating_sub(since) >= LAG_MS
}

/// Run 보기의 `transcripts` 칸 — Attempt 마다 `{status, lastGrowthAt, lagging}`(경로 · 본문 없음). 산 Attempt 만.
pub(super) fn transcripts_view(slot: &Slot, now: u64) -> Value {
    let mut out = serde_json::Map::new();
    // 술어 `turn_may_live` — 대화 파일이 자라는 것은 산 프로세스뿐이다(지금 보기 그대로 — 3차 `idle` 의 대화 읽기는 `read_worker` 몫).
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

/// 조정자에게 주는 Attempt 상태 요약(3a — 턴 · `blocked` · 대화 끊김 · 마지막 턴의 낱말 · 수).
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
        // 마지막 commit_changes 거절(10-15 — 사유 · needsHuman · 요청 id · 파일 수만) — 조정자가 사람에게 넘길 수 있게.
        "lastCommitRejection": a.last_commit_rejection,
    })
}

/// worktree 의 바뀐 파일 — base 이후 커밋된 것 + 미커밋(합쳐 상한 [`CHANGED_FILES_MAX`] · 이름 합 [`FILES_MAX_BYTES`]). git 은 잠금 밖.
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

/// 최근 활동을 물을 Attempt 한 줄 — (attemptId, CLI, worktree, 기준 커밋, 대화 바뀜).
type ActivityRow = (String, WorkerCli, Option<String>, Option<String>, bool);

impl Orchestration {
    /// CLI 대화 루트 손을 갈아 끼운다(시험).
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

    /// Attempt 의 고정 파일 — **검증한 손잡이째**(리뷰 F7). 캐시에 있고 지금 그 경로의 파일이 검증 때와 **같은 파일**(식별 — 세대)이면 그 손잡이,
    /// 아니면(교체 · 다른 파일로 바뀜 · 식별을 못 읽음) 경로 · cwd · id 를 **다시 검증**한다(캐시는 버린다). 캐시가 없으면 찾는다(`force` 가
    /// 아니면 [`RESOLVE_EVERY_MS`] 에 한 번). 입출력은 잠금 밖. `(경로 · 손잡이, 상태 낱말)`.
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
            // 검토자(5단계)는 worktree 가 없다 — 그 CLI 의 작업 폴더는 서버 빈 cwd 다.
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
                    // 처음 찾았거나 다른 파일(세대)이 됐다 — 이미 쓴 것도 새 기록이다(크기 0 에서 — 다음 시계가 증가로 보고 `wait_run` 을 깨운다).
                    w.size = 0;
                    w.grew_at = Some(now);
                }
                w.path = Some(p.clone());
                w.ident = ident;
                (Some((p, f)), "ok")
            }
            Err(why) => {
                // 다시 검증하지 못한 파일은 믿지 않는다 — 캐시를 버린다.
                w.path = None;
                w.ident.clear();
                w.status = why;
                (None, why)
            }
        }
    }
    /// 조정자 `read_worker` — 자기 Run 의 Attempt 하나의 고정 대화를 커서부터 앞으로(항목 · 다음 커서 · `reset`) + worktree 변경 파일 +
    /// Attempt 상태 요약. 응답은 [`RESPONSE_MAX`] 안(넘으면 예산을 줄여 다시 읽는다 — 커서가 늘 맞게).
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
        // 예산을 반씩 줄여 다시 읽는다 — 가장 작은 예산(4 KiB)에서는 그대로 낸다. 쪽은 사건 단위라 늘 하나 이상 싣고 커서가 앞으로 간다
        // (리뷰 F8 — 예전에는 네 번 실패하면 빈 결과 · 옛 커서로 멈췄다).
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

    /// 서버 시계([`GROWTH_EVERY_MS`] — `server::ai`) — 산 Attempt 의 고정 파일 크기를 보고, 커졌으면 그 Run 의 `seq` 를 올리고 이벤트를 낸다
    /// (`wait_run` 이 깬다). 타임라인 줄 · 영속 쓰기는 없다. 바뀐 Run 수.
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
                        // 술어 `turn_may_live` — 자라는 대화 파일을 지켜볼 것은 산 프로세스뿐이다.
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
            // 줄었으면(교체 · 잘림) 그 크기부터 다시 지켜본다 — 판독 쪽은 커서가 `reset` 으로 안다.
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

    /// 보드의 최근 활동(사람 — op `orchestration_worker_activity`) — 산 Attempt(최근 [`ACTIVITY_MAX`])마다 고정 대화의 마지막 에이전트 말 한 줄 ·
    /// 최근 도구 호출 셋 · 변경 파일 수 · 경고. **블로킹**(파일 · git) — 보드가 보일 때만 부른다.
    ///
    /// `detail`(오케스트레이션 탭 ③ — 작업자 상세가 열려 있는 Attempt 하나): 그 칸에 **작업 중 파일 목록**(`wip` — 파일별 상태 · +/− ·
    /// 미커밋 · 새 파일, `diff::wip_blocking`)을 더 싣는다. 도는 Attempt 가 아니어도(쉬는 중 · 보고됨 · 중단됨) worktree 가 있으면 그 칸
    /// 하나를 더한다. worktree 경로는 Attempt 기록에서만 꺼낸다 — 화면은 attemptId 만 준다.
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
                // 술어 `turn_may_live` — 지금 활동(worktree 변경 · 대화)을 보는 대상은 도는 Attempt 다(지금 보기 그대로).
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

    /// [기록 보기] 의 한 쪽(사람 — op `orchestration_worker_transcript`) — 기존 대화 기록 화면이 **그 Attempt 의 고정 파일**을 끝에서 거꾸로 읽는다
    /// (기록 보기와 같은 리더 · 같은 커서 `before`). 다른 대화는 이 길로 읽을 수 없다.
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

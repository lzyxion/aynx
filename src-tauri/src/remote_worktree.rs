//! 원격 새 워크트리 — 접속한 뒤 · 셸 채널을 열기 전에 그 타일의 전송로 exec 로 만든다(docs/log/2026-09-29-remote-worktree-after-connect.md).
//! 실패하면 평범한 셸로 이어 간다 — 첫 입력으로 만드는 폴백은 없고, 첫 입력은 만든 폴더에서 시작만 한다(git 명령이 없다).
//! 표(`ticket`)는 세션 번호가 아직 없는 순간이라 타일이 뽑는 난수다 — [`PENDING`] 에 그 준비가 도는 동안만 산다.
//!
//! 보안: [`ssh_worktree_answer`] 는 Tauri 명령 하나뿐이고 MCP 에는 없다. 답은 기다리는 질문 하나의 예/아니요/멈춤뿐이고(명령 글자를 받지 않는다),
//! 부른 창이 그 타일의 창이 아니면 멈춤만 받는다.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tokio::sync::mpsc;

use crate::git_repo::RepoStatus;
use crate::i18n::tr;
use crate::ssh::{SessionHandle, SshWorktree};
use crate::ssh_pool::TransportSignal;

pub(crate) const PREP_EVENT: &str = "ssh-worktree-prep";

/// `git_repo` 의 원격 왕복과 같은 폭.
const STATUS_TIMEOUT: Duration = Duration::from_secs(15);
const COMMIT_TIMEOUT: Duration = Duration::from_secs(15);
/// 체크아웃이 파일을 쓰므로 큰 저장소는 판정보다 오래 걸린다.
const ADD_TIMEOUT: Duration = Duration::from_secs(60);
/// 메모리 깃발 둘을 보는 간격 — 왕복이 아니다.
const WATCH_EVERY: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Answer {
    /// [첫 커밋 만들고 계속]
    Commit,
    /// [셸로 열기]
    Shell,
    /// 타일이 닫혔다 · 창이 사라졌다
    Cancel,
}

impl Answer {
    pub(crate) fn parse(s: &str) -> Option<Self> {
        match s {
            "commit" => Some(Answer::Commit),
            "shell" => Some(Answer::Shell),
            "cancel" => Some(Answer::Cancel),
            _ => None,
        }
    }
}

struct Pending {
    /// 이 표를 등록한 차례 — 같은 표가 다시 등록된 뒤 옛 등록의 `Drop` 이 새 줄을 지우지 않게.
    serial: u64,
    owner: String,
    /// 창 정리의 기준선(`cutoff`)과 견준다
    session: u32,
    tx: mpsc::UnboundedSender<Answer>,
    /// 도는 exec 도 이 깃발로 멈춘다
    cancel: Arc<AtomicBool>,
}

static PENDING: Mutex<BTreeMap<String, Pending>> = Mutex::new(BTreeMap::new());
static SERIAL: AtomicU64 = AtomicU64::new(1);

fn pending() -> MutexGuard<'static, BTreeMap<String, Pending>> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner())
}

/// `?` · `return` 마다 베껴 적지 않으려고 `Drop` 에 둔다.
struct Registration {
    ticket: String,
    serial: u64,
}

impl Drop for Registration {
    fn drop(&mut self) {
        let mut map = pending();
        if map
            .get(&self.ticket)
            .is_some_and(|p| p.serial == self.serial)
        {
            map.remove(&self.ticket);
        }
    }
}

/// 1~64자의 ASCII 영숫자 · `-` · `_`.
pub(crate) fn valid_ticket(t: &str) -> bool {
    !t.is_empty()
        && t.len() <= 64
        && t.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// `from` 이 있으면 그 창의 표만 예/아니요를 받는다 — 멈춤은 어느 창에서 와도 받는다(타일이 창을 옮기다 닫힌 경우).
pub(crate) fn answer_ticket(ticket: &str, answer: Answer, from: Option<&str>) -> bool {
    let map = pending();
    let Some(p) = map.get(ticket) else {
        return false;
    };
    if answer != Answer::Cancel && from.is_some_and(|w| w != p.owner) {
        return false;
    }
    if answer == Answer::Cancel {
        p.cancel.store(true, Ordering::SeqCst);
    }
    p.tx.send(answer).is_ok()
}

/// `cutoff` 는 세션 정리와 같은 기준선이다 — 사건 뒤에 새 페이지가 연 접속은 건드리지 않는다.
pub(crate) fn cancel_for_window(label: &str, cutoff: u32) -> usize {
    let map = pending();
    let mut n = 0;
    for p in map.values() {
        if p.owner == label && p.session < cutoff {
            p.cancel.store(true, Ordering::SeqCst);
            let _ = p.tx.send(Answer::Cancel);
            n += 1;
        }
    }
    n
}

/// 이유 코드 `[cancelled]`(타일은 이미 없다).
pub(crate) fn cancelled_message() -> String {
    crate::errors::with_reason(
        crate::errors::CANCELLED,
        tr!(ko: "워크트리 준비를 멈췄습니다", en: "Stopped preparing the worktree"),
    )
}

// ── 명령 글자 · 답 해석 ──

/// `sh -c '<…>'` 로 싼다 — 로그인 셸이 fish 여도 돈다. 브랜치 판정은 Rust 가 미리 한다([`crate::worktree_branch::plan_add`]).
/// HEAD 가 없으면 만들지 않는다 — 커밋 없는 저장소의 `-b` 는 고아 브랜치를 만든다. `root` · `path` 는 곁 파일의 원격 열쇠가 되는 글자다.
pub(crate) fn remote_add_command(
    repo: &str,
    name: &str,
    dir: &str,
    plan: &crate::worktree_branch::AddPlan,
) -> Option<String> {
    let repo = repo.trim();
    let dir = dir.trim();
    if repo.is_empty() || repo.chars().any(char::is_control) {
        return None;
    }
    if dir.chars().any(char::is_control) || !crate::worktree::is_absolute_dir(dir, true) {
        return None;
    }
    let name = crate::worktree::valid_name(name).ok()?;
    let r = crate::ssh::sh_path(repo);
    let d = crate::ssh::sh_path(dir);
    let tail = crate::worktree_branch::remote_add_tail(&d, name, plan)?;
    let created = u8::from(plan.creates_branch());
    let script = format!(
        r#"command -v git >/dev/null 2>&1 || {{ echo aynx-fail=nogit; exit 1; }}
git -C {r} rev-parse --verify --quiet HEAD >/dev/null || {{ echo aynx-fail=nocommit; exit 1; }}
root=$(git -C {r} rev-parse --show-toplevel) || {{ echo aynx-fail=repo; exit 1; }}
git -C {r} {tail} >/dev/null || {{ echo aynx-fail=add; exit 1; }}
printf 'created=%s\nroot=%s\npath=%s\n' "{created}" "$root" "$(git -C {d} rev-parse --show-toplevel 2>/dev/null)"
"#
    );
    Some(format!("sh -c {}", crate::ssh::sh_quote(&script)))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteAdded {
    pub created: bool,
    pub root: Option<String>,
    pub path: Option<String>,
}

fn kv<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pairs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

/// `worktree add` 는 실패해도 먼저 `Preparing worktree (…)` 를 찍으므로 `fatal:` · `error:` 줄을 먼저 고른다.
pub(crate) fn git_error_line(stderr: &str) -> String {
    stderr
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("fatal:") || l.starts_with("error:"))
        .map(str::to_string)
        .unwrap_or_else(|| crate::worktree::remote_failure_line(stderr))
}

/// 로그인 스크립트의 잡음 줄은 모르는 키로 버린다.
pub(crate) fn parse_remote_add(
    stdout: &str,
    stderr: &str,
    exit_ok: bool,
) -> Result<RemoteAdded, String> {
    let pairs = crate::git_repo::parse_kv(stdout);
    match kv(&pairs, "aynx-fail") {
        Some("nogit") => {
            return Err(
                tr!(ko: "원격에 git 이 없습니다", en: "git is not installed on the remote"),
            );
        }
        Some("nocommit") => {
            return Err(tr!(
                ko: "저장소에 첫 커밋이 없습니다",
                en: "The repository has no first commit"
            ));
        }
        Some(_) => return Err(git_error_line(stderr)),
        None if !exit_ok => return Err(git_error_line(stderr)),
        None => {}
    }
    let abs = |k: &str| {
        kv(&pairs, k)
            .map(str::trim)
            .filter(|v| v.starts_with('/'))
            .map(str::to_string)
    };
    Ok(RemoteAdded {
        created: kv(&pairs, "created") == Some("1"),
        root: abs("root"),
        path: abs("path"),
    })
}

// ── 준비 ──

/// 프런트 `Terminal.svelte` 가 `ticket` 으로 제 것만 고른다. `phase` 글자(`preparing` · `ask` · `committing` · `ready` · `shell` ·
/// `failed` · `identity`)는 프런트와 맞춘 값이다.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrepEvent {
    pub ticket: String,
    pub phase: &'static str,
    /// 사람이 적은 꼴(`~/api`)
    pub repo: String,
    /// 사람이 적은 꼴
    pub path: String,
    /// `ask` — HEAD 가 가리키는 브랜치(보통 `main`)
    pub branch: Option<String>,
    /// `failed` — 사유 한 줄
    pub message: Option<String>,
    /// `ready` — 브랜치를 새로 만들었나
    pub branch_created: Option<bool>,
}

pub(crate) struct PrepTarget<'a> {
    pub handle: SessionHandle,
    pub signal: Arc<TransportSignal>,
    pub alias: &'a str,
    pub owner: &'a str,
    /// 창 정리의 기준선과 견준다
    pub session: u32,
    pub worktree: &'a SshWorktree,
    pub cwd: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Prepared {
    Ready,
    /// 막대는 이미 섰다
    PlainShell,
    /// 접속을 거두고 아무것도 하지 않는다
    Cancelled,
}

enum Halt {
    Cancelled,
    Failed(String),
}

async fn exec(
    t: &PrepTarget<'_>,
    cancel: &Arc<AtomicBool>,
    command: String,
    timeout: Duration,
) -> Result<crate::ssh::ExecOutcome, Halt> {
    if cancel.load(Ordering::SeqCst) {
        return Err(Halt::Cancelled);
    }
    let o = crate::ssh::run_exec(Arc::clone(&t.handle), command, timeout, Arc::clone(cancel)).await;
    if o.cancelled || cancel.load(Ordering::SeqCst) {
        return Err(Halt::Cancelled);
    }
    if let Some(e) = o.error {
        return Err(Halt::Failed(e));
    }
    if o.timed_out {
        return Err(Halt::Failed(tr!(
            ko: "원격 git 이 {secs}초 안에 답하지 않았습니다",
            en: "The remote git did not answer within {secs} seconds",
            secs = timeout.as_secs()
        )));
    }
    Ok(o)
}

/// 스크립트 글자 · 명령 글자는 로그에 남기지 않는다(`eprintln` 에는 별칭 · 단계만).
pub(crate) async fn prepare(t: PrepTarget<'_>) -> Prepared {
    let wt = t.worktree;
    let ticket = wt.ticket.trim().to_string();
    if !valid_ticket(&ticket) {
        eprintln!(
            "원격 워크트리: {} — 표가 없어 준비하지 않고 평범한 셸로 엽니다",
            t.alias
        );
        return Prepared::PlainShell;
    }
    let base = PrepEvent {
        ticket: ticket.clone(),
        repo: wt.repo.trim().to_string(),
        path: t.cwd.trim().to_string(),
        ..PrepEvent::default()
    };
    let emit = |phase: &'static str, extra: &dyn Fn(&mut PrepEvent)| {
        let mut ev = base.clone();
        ev.phase = phase;
        extra(&mut ev);
        crate::server::hub::emit(PREP_EVENT, serde_json::to_value(ev).unwrap_or_default());
    };
    let fail = |message: String| {
        emit("failed", &|ev| ev.message = Some(message.clone()));
        Prepared::PlainShell
    };

    // 이름 · 자리 · 저장소 글자를 먼저 본다 — 브랜치 계획은 저장소를 읽은 뒤에 정한다.
    let probe = crate::worktree_branch::AddPlan::New(None);
    if remote_add_command(&wt.repo, &wt.name, t.cwd, &probe).is_none() {
        return fail(tr!(
            ko: "워크트리 이름이나 자리가 올바르지 않습니다",
            en: "The worktree name or folder is not valid"
        ));
    }
    let Some(status_cmd) = crate::git_repo::remote_status_command(&wt.repo) else {
        return fail(
            tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid"),
        );
    };

    let (tx, mut rx) = mpsc::unbounded_channel::<Answer>();
    let cancel = Arc::new(AtomicBool::new(false));
    let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
    pending().insert(
        ticket.clone(),
        Pending {
            serial,
            owner: t.owner.to_string(),
            session: t.session,
            tx,
            cancel: Arc::clone(&cancel),
        },
    );
    let _registration = Registration { ticket, serial };

    emit("preparing", &|_| {});

    let status = match exec(&t, &cancel, status_cmd, STATUS_TIMEOUT).await {
        Err(Halt::Cancelled) => return Prepared::Cancelled,
        Err(Halt::Failed(m)) => return fail(m),
        Ok(o) => crate::git_repo::parse_remote_status(&o.stdout, &o.stderr),
    };
    match status {
        RepoStatus::Ok { .. } | RepoStatus::Subfolder { .. } => {}
        RepoStatus::NotRepo => {
            return fail(tr!(
                ko: "git 저장소가 아닙니다: {repo}",
                en: "Not a git repository: {repo}",
                repo = wt.repo.trim()
            ))
        }
        RepoStatus::Missing => {
            return fail(tr!(
                ko: "폴더가 없습니다: {repo}",
                en: "The folder does not exist: {repo}",
                repo = wt.repo.trim()
            ))
        }
        RepoStatus::Error { message } => return fail(message),
        // 첫 커밋이 없다 — 묻고 기다린다(시한 없음)
        RepoStatus::NoCommit { branch } => {
            emit("ask", &|ev| ev.branch = branch.clone());
            eprintln!(
                "원격 워크트리: {} — 저장소에 첫 커밋이 없어 타일에 묻습니다",
                t.alias
            );
            let answer = loop {
                tokio::select! {
                    a = rx.recv() => break a.unwrap_or(Answer::Cancel),
                    _ = tokio::time::sleep(WATCH_EVERY) => {
                        if cancel.load(Ordering::SeqCst) {
                            break Answer::Cancel;
                        }
                        // 연결이 죽었다 — 셸 채널을 여는 자리가 끊김을 그대로 알린다.
                        if t.signal.has_fired() || t.handle.is_closed() {
                            return Prepared::PlainShell;
                        }
                    }
                }
            };
            match answer {
                Answer::Cancel => return Prepared::Cancelled,
                Answer::Shell => {
                    emit("shell", &|_| {});
                    return Prepared::PlainShell;
                }
                Answer::Commit => {}
            }
            emit("committing", &|_| {});
            let Some(ensure) = crate::git_repo::remote_ensure_command(&wt.repo) else {
                return fail(
                    tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid"),
                );
            };
            match exec(&t, &cancel, ensure, COMMIT_TIMEOUT).await {
                Err(Halt::Cancelled) => return Prepared::Cancelled,
                Err(Halt::Failed(m)) => return fail(m),
                Ok(o) => {
                    if let Err(m) = crate::git_repo::parse_remote_ensure(
                        &o.stdout,
                        &o.stderr,
                        o.exit_code == Some(0),
                        wt.repo.trim(),
                    ) {
                        if crate::errors::has_reason(&m, crate::errors::GIT_IDENTITY) {
                            emit("identity", &|_| {});
                            return Prepared::PlainShell;
                        }
                        return fail(m);
                    }
                }
            }
        }
    }

    // 만들기 — fetch 없음.
    let (Some(list_cmd), Some(refs_cmd)) = (
        crate::worktree::remote_list_command(&wt.repo),
        crate::worktree_branch::remote_refs_command(&wt.repo),
    ) else {
        return fail(
            tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid"),
        );
    };
    let mut outs = Vec::with_capacity(2);
    for cmd in [list_cmd, refs_cmd] {
        match exec(&t, &cancel, cmd, STATUS_TIMEOUT).await {
            Err(Halt::Cancelled) => return Prepared::Cancelled,
            Err(Halt::Failed(m)) => return fail(m),
            Ok(o) if o.exit_code != Some(0) => {
                return fail(crate::worktree::remote_failure_line(&o.stderr))
            }
            Ok(o) => outs.push(o.stdout),
        }
    }
    let facts = crate::worktree_branch::facts_of(&outs[0], &outs[1]);
    let name = wt.name.trim();
    let plan = match crate::worktree_branch::plan_add(name, &facts) {
        Ok(p) => p,
        Err(m) => return fail(m),
    };
    let Some(add) = remote_add_command(&wt.repo, name, t.cwd, &plan) else {
        return fail(tr!(
            ko: "워크트리 이름이나 자리가 올바르지 않습니다",
            en: "The worktree name or folder is not valid"
        ));
    };
    let added = match exec(&t, &cancel, add, ADD_TIMEOUT).await {
        Err(Halt::Cancelled) => return Prepared::Cancelled,
        Err(Halt::Failed(m)) => return fail(m),
        Ok(o) => match parse_remote_add(&o.stdout, &o.stderr, o.exit_code == Some(0)) {
            Err(m) => return fail(m),
            Ok(a) => a,
        },
    };
    if let (Some(root), Some(path)) = (added.root.clone(), added.path.clone()) {
        let alias = t.alias.to_string();
        let branch = wt.name.trim().to_string();
        let created = added.created;
        let _ = tokio::task::spawn_blocking(move || {
            crate::worktree::record_remote_added(&alias, &root, &path, &branch, created)
        })
        .await;
    }
    // add 성공 뒤 · 에이전트 첫 입력 전에 그 워크트리 하나만 쓴다. 실패해도 준비는 계속한다.
    if let Some(path) = added.path.as_deref() {
        if let Err(reason) = crate::agent_instructions::remote::apply_worktree(
            &t.handle, t.session, t.alias, &wt.repo, path,
        ).await {
            eprintln!("원격 워크트리 지침: {} — {}", t.alias, reason.replace(['\r', '\n'], " "));
        }
    }
    emit("ready", &|ev| ev.branch_created = Some(added.created));
    Prepared::Ready
}

/// 막대의 답 — `commit` · `shell` · `cancel`. 사람의 UI 동작에서만 불린다(MCP 에 없다). 준비는 세션 서버에서 돈다.
#[tauri::command]
pub async fn ssh_worktree_answer(
    webview: tauri::Webview,
    ticket: String,
    answer: String,
) -> Result<bool, String> {
    if Answer::parse(answer.trim()).is_none() {
        return Err(tr!(ko: "알 수 없는 답입니다: {answer}", en: "Unknown answer: {answer}"));
    }
    let label = webview.window().label().to_string();
    let v = crate::server::proxy::call(
        crate::server::ipc::Grade::Write,
        "worktree_answer",
        serde_json::json!({ "ticket": ticket.trim(), "answer": answer.trim(), "window": label }),
    )
    .await?;
    Ok(v.as_bool().unwrap_or(false))
}

pub(crate) fn answer_op(ticket: &str, answer: &str, window: &str) -> Result<bool, String> {
    let Some(a) = Answer::parse(answer.trim()) else {
        return Err(tr!(ko: "알 수 없는 답입니다: {answer}", en: "Unknown answer: {answer}"));
    };
    Ok(answer_ticket(ticket.trim(), a, Some(window)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_and_tickets_have_a_fixed_shape() {
        assert_eq!(Answer::parse("commit"), Some(Answer::Commit));
        assert_eq!(Answer::parse("shell"), Some(Answer::Shell));
        assert_eq!(Answer::parse("cancel"), Some(Answer::Cancel));
        assert_eq!(Answer::parse("yes"), None);
        assert!(valid_ticket("a1b2-c3_d4"));
        for bad in ["", "a b", "x;rm", "가", &"x".repeat(65)] {
            assert!(!valid_ticket(bad), "{bad:?}");
        }
    }

    #[test]
    fn add_command_quotes_and_follows_the_plan() {
        use crate::worktree_branch::AddPlan;
        let new = AddPlan::New(Some("main".into()));
        let c = remote_add_command(" ~/api ", "feat-x", "~/api-wt/feat-x", &new).unwrap();
        assert!(c.starts_with("sh -c 'command -v git"), "{c}");
        assert!(c.ends_with("'"), "{c}");
        // `~` 는 따옴표 밖 `$HOME` 으로.
        assert!(
            c.contains(r#"git -C "$HOME"/'\''api'\'' rev-parse --verify --quiet HEAD"#),
            "{c}"
        );
        // 브랜치 판정은 Rust 가 미리 했다(셸 안에 if 가 없다).
        assert!(
            c.contains(
                r#"worktree add -b '\''feat-x'\'' "$HOME"/'\''api-wt/feat-x'\'' '\''main'\'' >/dev/null"#
            ),
            "{c}"
        );
        assert!(c.contains(r#"printf '\''created=%s\nroot=%s\npath=%s\n'\'' "1""#), "{c}");
        assert!(!c.contains("; then"), "{c}");
        let ex = remote_add_command("~/api", "feat-x", "~/api-wt/feat-x", &AddPlan::Existing).unwrap();
        assert!(
            ex.contains(r#"worktree add "$HOME"/'\''api-wt/feat-x'\'' '\''feat-x'\'' >/dev/null"#),
            "{ex}"
        );
        assert!(ex.contains(r#"' "0" "$root""#) || ex.contains(r#""0" "$root""#), "{ex}");
        let tr = remote_add_command(
            "~/api",
            "feat-x",
            "~/api-wt/feat-x",
            &AddPlan::Track("origin/feat-x".into()),
        )
        .unwrap();
        assert!(
            tr.contains(r#"worktree add --track -b '\''feat-x'\'' "$HOME"/'\''api-wt/feat-x'\'' '\''origin/feat-x'\''"#),
            "{tr}"
        );
        let head = c.find("rev-parse --verify --quiet HEAD").unwrap();
        assert!(head < c.find("worktree add").unwrap());
        assert!(!c.contains("--force") && !c.contains("--orphan"));
        for (r, n, d) in [
            ("~/api", "-x", "~/w/x"),
            ("~/api", "a..b", "~/w/x"),
            ("~/api", "a b", "~/w/x"),
            ("", "ok", "~/w/ok"),
            ("~/api", "ok", "w/ok"),
            ("~/api", "ok", "~/w/o\nk"),
        ] {
            assert_eq!(remote_add_command(r, n, d, &new), None, "{r:?} {n:?} {d:?}");
        }
    }

    #[test]
    fn add_answer_reads_success_and_failure_lines() {
        let ok = parse_remote_add(
            "motd noise\ncreated=1\nroot=/home/me/api\npath=/home/me/api-wt/feat-x\nbase=0123456789abcdef0123456789abcdef01234567\n",
            "Preparing worktree (new branch 'feat-x')\n",
            true,
        )
        .unwrap();
        assert_eq!(
            ok,
            RemoteAdded {
                created: true,
                root: Some("/home/me/api".into()),
                path: Some("/home/me/api-wt/feat-x".into()),
            }
        );
        let old = parse_remote_add("created=0\nroot=/r\npath=\n", "", true).unwrap();
        assert!(!old.created);
        assert_eq!(old.path, None);
        let e = parse_remote_add(
            "aynx-fail=add\n",
            "Preparing worktree (checking out 'x')\nfatal: 'x' is already checked out at '/r'\n",
            false,
        )
        .unwrap_err();
        assert_eq!(e, "fatal: 'x' is already checked out at '/r'");
        assert_eq!(
            parse_remote_add("aynx-fail=nogit\n", "", false).unwrap_err(),
            "원격에 git 이 없습니다"
        );
        assert_eq!(
            parse_remote_add("aynx-fail=nocommit\n", "", false).unwrap_err(),
            "저장소에 첫 커밋이 없습니다"
        );
        assert_eq!(
            parse_remote_add("", "sh: 1: git: Permission denied\n", false).unwrap_err(),
            "sh: 1: git: Permission denied"
        );
        assert_eq!(
            parse_remote_add("", "", false).unwrap_err(),
            "원격 git 이 실패했습니다"
        );
    }

    #[test]
    fn answers_reach_only_a_waiting_ticket_of_that_window() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let cancel = Arc::new(AtomicBool::new(false));
        pending().insert(
            "t-answer".into(),
            Pending {
                serial: 999_001,
                owner: "main".into(),
                session: 7,
                tx,
                cancel: Arc::clone(&cancel),
            },
        );
        assert!(!answer_ticket("t-answer", Answer::Commit, Some("tear-1")));
        assert!(!answer_ticket("t-none", Answer::Commit, Some("main")));
        assert!(answer_ticket("t-answer", Answer::Commit, Some("main")));
        assert_eq!(rx.try_recv().ok(), Some(Answer::Commit));
        assert!(!cancel.load(Ordering::SeqCst));
        assert_eq!(cancel_for_window("main", 7), 0);
        assert_eq!(cancel_for_window("main", 8), 1);
        assert!(cancel.load(Ordering::SeqCst));
        assert_eq!(rx.try_recv().ok(), Some(Answer::Cancel));
        drop(Registration {
            ticket: "t-answer".into(),
            serial: 1,
        });
        assert!(pending().contains_key("t-answer"));
        drop(Registration {
            ticket: "t-answer".into(),
            serial: 999_001,
        });
        assert!(!pending().contains_key("t-answer"));
    }
}

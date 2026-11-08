//! SSH 프로젝트 지침 — 열린 타일의 연결만 빌린다. 전역·볼트·새 접속·MCP 없음.
//! 호스트마다 한 번 연결을 빌리고 경로별 지침 합집합을 SFTP 스냅숏으로 판정한다. 원격끼리는 async 직렬화.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags, StatusCode};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::*;
use crate::sftp_browser::common::{fail, home_of};
use crate::sftp_browser::pure::under_home;
use crate::sftp_browser::text::overwrite_remote;

const PROJECT_TIMEOUT: Duration = Duration::from_secs(20);
const LIST_TIMEOUT: Duration = Duration::from_secs(5);
static REMOTE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// 접속 표에서 가장 작은 대화형 id를 고른다. 핸들 없이도 시험할 수 있다(세션 서버의 op `ssh_find` 가 같은 판정을 쓴다).
pub(crate) fn tile_id<'a>(host: &str, sessions: impl Iterator<Item = (u32, &'a str, bool)>) -> Option<u32> {
    sessions.filter(|(_, alias, shell)| *shell && alias.eq_ignore_ascii_case(host))
        .map(|(id, _, _)| id).min()
}

/// 그 호스트의 열린 타일 연결 하나를 빌린다 — SSH 표는 세션 서버에 산다(③-3b2 · op `ssh_find`). exec 는 서버 op `ssh_exec`,
/// SFTP 는 채널 터널로 간다.
async fn borrowed(host: &str) -> Option<(u32, crate::ssh::ExecHandle)> {
    let id = crate::server::ssh_ops::find_tile(host).await?;
    Some((id, crate::ssh::ExecHandle::server(id)))
}

fn remote_row(path: &str, home: Option<&str>, project: &Project, agent: Option<&str>) -> FileChange {
    let mut row = change(Path::new(path), Scope::Project, Some(&project.id), agent, None);
    row.path = crate::git_repo::tilde_form(path, home);
    row.host = project.host.clone();
    row
}

pub(super) fn no_connection(project: &Project) -> FileChange {
    let mut row = remote_row(&project.path, None, project, None);
    row.action = Action::Skipped;
    row.reason = Some(tr!(ko: "이 호스트에 열린 SSH 연결이 없습니다 — 그 호스트의 타일을 열고 다시 미리 보기 하세요", en: "There is no open SSH connection to this host — open a tile for that host and preview again"));
    row
}

fn folder_missing() -> String {
    tr!(ko: "프로젝트 또는 워크트리 폴더가 디렉터리로 존재하지 않아 건너뜁니다", en: "The project or worktree folder is not an existing directory and is skipped")
}

fn timed_out() -> String {
    tr!(ko: "원격 프로젝트 지침 작업이 20초 안에 끝나지 않았습니다 — 연결 상태를 확인하고 다시 미리 보기 하세요", en: "The remote project instruction task did not finish within 20 seconds — check the connection and preview again")
}

/// 파일 글자는 Debug에 싣지 않는다. 가짜 파일 시스템도 이 모양으로 계획을 시험한다.
type Snapshot = ProjectSnapshot;

fn plan_subpath_snapshot(projects: &[&Project], path: &str, home: &str, subpath: Option<&str>, body: Option<&str>, snapshot: Snapshot, dev: bool) -> Vec<FileChange> {
    let path = subpath.map_or_else(|| path.to_owned(), |subpath| crate::sftp::join_remote(path, subpath));
    let row = tracked(remote_row(&path, Some(home), projects[0], None), projects, subpath);
    project_snapshot(row, body, snapshot, dev)
}

fn plan_snapshot(project: &Project, path: &str, home: &str, body: Option<&str>, snapshot: Snapshot, dev: bool) -> Vec<FileChange> {
    plan_subpath_snapshot(&[project], path, home, None, body, snapshot, dev)
}

fn absent(error: &SftpError) -> bool {
    matches!(error, SftpError::Status(status) if status.status_code == StatusCode::NoSuchFile)
}

async fn metadata(session: u32, sftp: &SftpSession, path: &str) -> Result<Option<FileAttributes>, String> {
    match sftp.metadata(path.to_owned()).await {
        Ok(meta) => Ok(Some(meta)),
        Err(e) if absent(&e) => Ok(None),
        Err(e) => Err(fail(session, e, &tr!(ko: "{path} 을(를) 확인하지 못했습니다", en: "Could not inspect {path}")).await),
    }
}

async fn text(session: u32, sftp: &SftpSession, path: &str) -> Result<Option<String>, String> {
    let mut file = match sftp.open(path.to_owned()).await {
        Ok(file) => file,
        Err(e) if absent(&e) => return Ok(None),
        Err(e) => return Err(fail(session, e, &tr!(ko: "{path} 을(를) 읽지 못했습니다", en: "Could not read {path}")).await),
    };
    let mut bytes = Vec::new();
    let read = file.read_to_end(&mut bytes).await;
    let _ = file.close().await;
    read.map_err(io_error)?;
    String::from_utf8(bytes).map(Some).map_err(|_| tr!(ko: "{path} 파일이 UTF-8 이 아닙니다", en: "The file {path} is not UTF-8"))
}

async fn snapshot(session: u32, sftp: &SftpSession, wt: &str, subpath: Option<&str>, has_body: bool) -> Snapshot {
    let path = subpath.map_or_else(|| wt.to_owned(), |subpath| crate::sftp::join_remote(wt, subpath));
    let path = path.as_str();
    let directory = metadata(session, sftp, path).await.map(|meta| meta.is_some_and(|m| m.file_type().is_dir()));
    if !matches!(directory, Ok(true)) {
        return Snapshot { directory, agents: Ok(None), claude: Ok(None), other_claude: Ok(false) };
    }
    let agents = text(session, sftp, &crate::sftp::join_remote(path, "AGENTS.md")).await;
    let claude = text(session, sftp, &crate::sftp::join_remote(path, "CLAUDE.md")).await;
    let other_claude = if has_body {
        async {
            let mut any = false;
            for directory in claude_directories(subpath) {
                let directory = if directory.is_empty() { wt.to_owned() } else { crate::sftp::join_remote(wt, &directory) };
                for name in ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"] {
                    if directory == path && name == "CLAUDE.md" { continue; }
                    any |= metadata(session, sftp, &crate::sftp::join_remote(&directory, name)).await?.is_some();
                }
            }
            Ok(any)
        }.await
    } else { Ok(false) };
    Snapshot { directory, agents, claude, other_claude }
}

/// 새 파일은 서버 기본 권한으로 CREATE|EXCLUDE 임시 파일을 만들고 rename한다. 폴더 생성 없음.
async fn create(session: u32, sftp: &SftpSession, target: &str, contents: &[u8]) -> Result<(), String> {
    let (dir, name) = target.rsplit_once('/').ok_or_else(folder_missing)?;
    let tmp = crate::sftp::join_remote(if dir.is_empty() { "/" } else { dir }, &crate::text_file::save_temp_name(name));
    let what = tr!(ko: "{target} 을(를) 저장하지 못했습니다", en: "Could not save {target}");
    let mut file = match sftp.open_with_flags(
        tmp.clone(), OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
    ).await {
        Ok(file) => file,
        Err(e) => return Err(fail(session, e, &what).await),
    };
    let written = async {
        file.write_all(contents).await?;
        file.flush().await?;
        file.shutdown().await
    }.await;
    drop(file);
    if let Err(e) = written {
        let _ = sftp.remove_file(tmp).await;
        return Err(format!("{what}: {e}"));
    }
    if let Err(e) = sftp.rename(tmp.clone(), target.to_owned()).await {
        let _ = sftp.remove_file(tmp).await;
        return Err(fail(session, e, &what).await);
    }
    Ok(())
}

async fn apply_rows(session: u32, sftp: &SftpSession, rows: &mut [FileChange]) {
    for row in rows {
        row.attempted_write = matches!(row.edit, Edit::Write(_));
        let target = row.file_path.to_string_lossy();
        let saved = async {
            match &row.edit {
                Edit::Write(contents) => match metadata(session, sftp, &target).await? {
                    Some(meta) => overwrite_remote(Some(session), sftp, &target, &meta, contents.as_bytes(), &row.path).await,
                    None => create(session, sftp, &target, contents.as_bytes()).await,
                },
                Edit::Delete => match sftp.remove_file(target.to_string()).await {
                    Ok(()) => Ok(()),
                    Err(e) if absent(&e) => Ok(()),
                    Err(e) => Err(fail(session, e, &tr!(ko: "{path} 을(를) 지우지 못했습니다", en: "Could not delete {path}", path = row.path)).await),
                },
                Edit::Unchanged => Ok(()),
            }
        }.await;
        if let Err(reason) = saved {
            row.action = Action::Error;
            row.reason = Some(reason);
            row.edit = Edit::Unchanged;
        }
    }
}

/// 목록은 기존 git 명령·파싱을 빌린다. git 실패 시 프로젝트 하나, bare는 제외한다.
fn worktree_paths(outcome: &crate::ssh::ExecOutcome, root: &str) -> Vec<String> {
    if outcome.exit_code != Some(0) || outcome.error.is_some() || outcome.timed_out || outcome.cancelled {
        return vec![root.to_owned()];
    }
    crate::worktree::parse_porcelain(&outcome.stdout).into_iter().filter(|wt| !wt.bare).map(|wt| wt.path).collect()
}

/// 시간 초과 때 이미 시도한 쓰기의 기록을 보존한다.
fn mark_timeout(rows: &mut [FileChange]) {
    for row in rows {
        if matches!(row.edit, Edit::Write(_) | Edit::Delete) {
            row.action = Action::Error;
            row.reason = Some(timed_out());
        }
    }
}

async fn persist_rows(rows: &[FileChange]) -> Result<(), String> {
    let rows = rows.to_vec();
    blocking(move || written::persist(&rows, false)).await
}

/// 같은 별칭의 프로젝트는 한 연결 대여 안에서 처리한다. 첫 등록 순서를 보존한다.
pub(super) fn host_groups(projects: &[Project]) -> Vec<Vec<&Project>> {
    let mut groups: Vec<Vec<&Project>> = Vec::new();
    let mut indices = HashMap::new();
    for project in projects {
        let Some(host) = &project.host else { continue; };
        let index = *indices.entry(host.to_ascii_lowercase()).or_insert_with(|| {
            groups.push(Vec::new());
            groups.len() - 1
        });
        groups[index].push(project);
    }
    groups
}

/// 한 호스트의 목록들을 정규화된 절대 경로별로 모은다. 경로 대소문자는 보존한다.
fn group_worktrees<'a>(groups: &mut Vec<(String, Vec<&'a Project>)>, indices: &mut HashMap<String, usize>,
    project: &'a Project, home: &str, paths: Vec<String>) -> Result<(), String> {
    let paths = paths.into_iter().map(|path| under_home(home, &path)).collect::<Result<Vec<_>, _>>()?;
    let mut seen = HashSet::new();
    for path in paths {
        if !seen.insert(path.clone()) { continue; }
        let index = *indices.entry(path.clone()).or_insert_with(|| {
            groups.push((path, Vec::new()));
            groups.len() - 1
        });
        groups[index].1.push(project);
    }
    Ok(())
}

pub(super) async fn host(app: &tauri::AppHandle, library: &[Instruction], projects: &[&Project], written: &written::Written, apply: bool) -> Vec<FileChange> {
    let Some(project) = projects.first().copied() else { return Vec::new(); };
    let Some((session, handle)) = borrowed(project.host.as_deref().unwrap_or_default()).await else {
        return projects.iter().map(|project| no_connection(project)).collect();
    };
    let setup = async {
        let guard = REMOTE_LOCK.lock().await;
        let sftp = crate::sftp::sftp_of(app, session).await?;
        let home = home_of(session, &sftp).await?;
        Ok::<_, String>((guard, sftp, home))
    };
    let setup = tokio::time::timeout(PROJECT_TIMEOUT, setup).await
        .map_err(|_| timed_out()).and_then(|result| result);
    let (_guard, sftp, home) = match setup {
        Ok(setup) => setup,
        Err(reason) => return projects.iter()
            .map(|project| failed(remote_row(&project.path, None, project, None), reason.clone())).collect(),
    };
    let mut rows = Vec::new();
    let mut groups = Vec::new();
    let mut group_indices = HashMap::new();
    // 목록을 모두 모은 뒤 합성한다. 한 프로젝트의 실패가 다른 프로젝트 계획을 가리지 않는다.
    for project in projects {
        let root = match under_home(&home, &project.path) {
            Ok(root) => root,
            Err(reason) => {
                rows.push(failed(remote_row(&project.path, None, project, None), reason));
                continue;
            }
        };
        let error_row = remote_row(&root, Some(&home), project, None);
        let listing = async {
            // 없는 프로젝트도 목록을 실행하거나 파일을 만들지 않는다.
            if !metadata(session, &sftp, &root).await?.is_some_and(|m| m.file_type().is_dir()) {
                return Ok(None);
            }
            let command = crate::worktree::remote_list_command(&root)
                .ok_or_else(|| tr!(ko: "프로젝트 경로가 올바르지 않습니다", en: "The project path is not valid"))?;
            let outcome = crate::ssh::run_exec(handle.clone(), command, LIST_TIMEOUT, Arc::new(AtomicBool::new(false))).await;
            Ok::<_, String>(Some(worktree_paths(&outcome, &root)))
        };
        match tokio::time::timeout(PROJECT_TIMEOUT, listing).await {
            Ok(Ok(Some(paths))) => {
                if let Err(reason) = group_worktrees(&mut groups, &mut group_indices, project, &home, paths) {
                    rows.push(failed(error_row, reason));
                }
            }
            Ok(Ok(None)) => rows.extend(plan_snapshot(project, &root, &home, None, Snapshot {
                directory: Ok(false), agents: Ok(None), claude: Ok(None), other_claude: Ok(false),
            }, crate::instance::DEV)),
            Ok(Err(reason)) => rows.push(failed(error_row, reason)),
            Err(_) => rows.push(failed(error_row, timed_out())),
        }
    }
    for (path, projects) in groups {
        let deadline = tokio::time::Instant::now() + PROJECT_TIMEOUT;
        for subpath in project_subpaths(library, &projects, written) {
            let body = projects_subpath_body(library, &projects, subpath.as_deref());
            let snapshot = tokio::time::timeout_at(deadline,
                snapshot(session, &sftp, &path, subpath.as_deref(), body.is_some())).await;
            let snapshot = match snapshot {
                Ok(snapshot) => snapshot,
                Err(_) => Snapshot { directory: Err(timed_out()), agents: Ok(None), claude: Ok(None), other_claude: Ok(false) },
            };
            let mut planned = plan_subpath_snapshot(&projects, &path, &home, subpath.as_deref(), body.as_deref(), snapshot, crate::instance::DEV);
            if apply {
                if tokio::time::timeout_at(deadline, apply_rows(session, &sftp, &mut planned)).await.is_err() {
                    mark_timeout(&mut planned);
                }
                if let Err(reason) = persist_rows(&planned).await {
                    rows.push(failed(tracked(remote_row(&path, Some(&home), projects[0], None), &projects, subpath.as_deref()), reason));
                }
            }
            rows.extend(planned);
        }
    }
    rows
}

/// 별칭 대소문자만 무시한다. 저장소 경로는 SFTP 홈 기준으로 비교한다(서버 경로 대소문자는 보존).
fn find_project<'a>(projects: &'a [Project], host: &str, repo: &str, home: &str) -> Option<&'a Project> {
    let repo = under_home(home, repo).ok()?;
    projects.iter().find(|project| {
        project.host.as_deref().is_some_and(|alias| alias.eq_ignore_ascii_case(host))
            && under_home(home, &project.path).is_ok_and(|path| path == repo)
    })
}

/// 새 워크트리 단일 반영은 찾은 프로젝트 하나의 지침만 쓴다. 받은 핸들로 SFTP를 열고 반드시 닫는다.
pub(crate) async fn apply_worktree(handle: &crate::ssh::SessionHandle, session: u32, host: &str, repo: &str, path: &str) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + PROJECT_TIMEOUT;
    let setup = async {
        let plan_guard = PLAN_LOCK.lock().await;
        let guard = REMOTE_LOCK.lock().await;
        let (projects, library, written) = blocking(|| {
            let projects_path = crate::projects::projects_path()
                .ok_or_else(|| tr!(ko: "프로젝트 설정 폴더를 찾을 수 없습니다", en: "Could not locate the project settings folder"))?;
            Ok((crate::projects::load_file(&projects_path).projects, list_at(&library_root()?)?.items, written::load(&written::path()?)?))
        }).await?;
        let sftp = crate::sftp::open_sftp_on(handle).await?;
        Ok::<_, String>((plan_guard, guard, projects, library, written, sftp))
    };
    let (_plan_guard, _guard, projects, library, written, sftp) = tokio::time::timeout_at(deadline, setup).await.map_err(|_| timed_out())??;
    let mut rows = Vec::new();
    let applied = tokio::time::timeout_at(deadline, async {
        let home = home_of(session, &sftp).await?;
        let Some(project) = find_project(&projects, host, repo, &home) else { return Ok(()); };
        let path = under_home(&home, path)?;
        let has_items = library.iter().any(|item| item.enabled && item.scope == Scope::Project && item.projects.contains(&project.id));
        for subpath in project_subpaths(&library, &[project], &written) {
            if subpath.is_none() && !has_items { continue; }
            let body = projects_subpath_body(&library, &[project], subpath.as_deref());
            let snapshot = snapshot(session, &sftp, &path, subpath.as_deref(), body.is_some()).await;
            let planned = plan_subpath_snapshot(&[project], &path, &home, subpath.as_deref(), body.as_deref(), snapshot, crate::instance::DEV);
            let offset = rows.len();
            rows.extend(planned);
            apply_rows(session, &sftp, &mut rows[offset..]).await;
        }
        match rows.iter().find(|row| row.action == Action::Error || (row.action == Action::Skipped && !row.missing_subfolder)) {
            Some(row) => Err(row.reason.clone().unwrap_or_else(folder_missing)),
            None => Ok(()),
        }
    }).await;
    let applied = match applied {
        Ok(result) => result,
        Err(_) => { mark_timeout(&mut rows); Err(timed_out()) }
    };
    let recorded = persist_rows(&rows).await;
    // 전송로는 소유하지 않는다 — 닫는 것은 이 준비가 연 SFTP 채널뿐이다.
    let _ = tokio::time::timeout(Duration::from_secs(1), sftp.close()).await;
    applied.and(recorded)
}

#[cfg(test)]
mod tests;

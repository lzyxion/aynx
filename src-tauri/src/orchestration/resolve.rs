//! **충돌 해결 Attempt** — 표식 세기 · 해결 자리 깔기 · 표식 남김 검사 · 해결자 관문의 재료.
//!
//! 불변식:
//! - **표식 판정은 git 의 `is_conflict_marker` 규칙** — 크기는 `conflict-marker-size` 속성을 `merge-tree` 의 `--attr-source` 와 같은 출처(old)에서.
//! - **"남았다" = 표식 줄 수가 양쪽 원본 중 많은 쪽보다 많다**(종류마다) — Markdown 제목 밑줄 같은 원래 줄을 거짓으로 거절하지 않는다.
//! - **restore 경로는 `diff --name-status --no-renames <old> <충돌 커밋>` 에서만**(두 쪽 어디에도 없는 경로는 git 이 실패한다) · `:(literal)` ·
//!   index · HEAD 는 건드리지 않는다(`--worktree` 만).
//! - git 은 공용 실행기(`git.rs` — 셸 없음 · `GIT_*` 걷기 · 훅 끔)로만 · 오케스트레이션 잠금 **밖**에서.

use std::path::Path;

use serde_json::{json, Value};

use super::git::{child_env, hex40, Git};
use super::model::{Attempt, ConflictInfo, Run};
use super::store::{reason, OrchError};

/// git 의 기본 표식 크기.
pub(crate) const DEFAULT_MARKER_SIZE: usize = 7;
const MARKER_SIZE_MAX: usize = 1024;
pub(crate) const LISTED_PATHS_MAX: usize = 50;
pub(crate) const HOW_MAX: usize = 500;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Markers {
    /// `<<<<<<<`
    pub open: u32,
    /// `=======`
    pub sep: u32,
    /// `>>>>>>>`
    pub close: u32,
    /// `|||||||`(diff3 꼴)
    pub base: u32,
}

impl Markers {
    fn any_above(&self, base: &Markers) -> bool {
        self.open > base.open || self.sep > base.sep || self.close > base.close || self.base > base.base
    }

    fn max(a: &Markers, b: &Markers) -> Markers {
        Markers {
            open: a.open.max(b.open),
            sep: a.sep.max(b.sep),
            close: a.close.max(b.close),
            base: a.base.max(b.base),
        }
    }
}

pub(crate) fn count_markers(content: &[u8], size: usize) -> Markers {
    let size = size.clamp(1, MARKER_SIZE_MAX);
    let mut m = Markers::default();
    for line in content.split(|&b| b == b'\n') {
        let Some(&first) = line.first() else { continue };
        if !matches!(first, b'<' | b'=' | b'>' | b'|') || line.len() < size {
            continue;
        }
        if !line[..size].iter().all(|&b| b == first) {
            continue;
        }
        // CRLF 파일의 `\r` 도 공백류다. 개행 없는 파일 끝 줄도 표식으로 센다(보수적).
        if line.len() > size && !matches!(line[size], b' ' | b'\t' | b'\r') {
            continue;
        }
        match first {
            b'<' => m.open += 1,
            b'=' => m.sep += 1,
            b'>' => m.close += 1,
            _ => m.base += 1,
        }
    }
    m
}

pub(crate) fn markers_left(now: &Markers, ours: &Markers, theirs: &Markers) -> bool {
    now.any_above(&Markers::max(ours, theirs))
}

/// 충돌 트리의 blob 에 git 이 표식을 실제로 박았나(바이너리 · symlink 충돌에는 표식이 없다).
pub(crate) fn markers_inserted_in(now: &Markers, ours: &Markers, theirs: &Markers) -> bool {
    let b = Markers::max(ours, theirs);
    now.open > b.open && now.close > b.close
}

pub(crate) fn parse_marker_size(value: &str) -> usize {
    match value.trim().parse::<usize>() {
        Ok(n) if n > 0 => n.min(MARKER_SIZE_MAX),
        _ => DEFAULT_MARKER_SIZE,
    }
}

/// `ours` = stage 2(통합 머리) · `theirs` = stage 3(보고 커밋) blob.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MarkerItem {
    pub path: String,
    pub ours: Option<String>,
    pub theirs: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MarkerCheck {
    /// 통합 때의 `--attr-source` 와 같은 트리여야 한다.
    pub attr_source: String,
    pub items: Vec<MarkerItem>,
}

pub(crate) fn marker_check(info: &ConflictInfo) -> MarkerCheck {
    let items = info
        .entries
        .iter()
        .flat_map(|e| {
            e.paths.iter().map(move |p| {
                let blob = |n: u8| e.stages.iter().find(|s| s.stage == n && &s.path == p).map(|s| s.blob.clone());
                MarkerItem {
                    path: p.clone(),
                    ours: blob(2),
                    theirs: blob(3),
                }
            })
        })
        .collect();
    MarkerCheck {
        attr_source: info.old.clone(),
        items,
    }
}

pub(crate) fn conflict_paths(info: &ConflictInfo) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in info.entries.iter().flat_map(|e| e.paths.iter()) {
        if !out.contains(p) {
            out.push(p.clone());
        }
    }
    out
}

/// Task 의 `conflict` 가 Attempt 가 받은 충돌(Job id)과 같을 때만.
pub(crate) fn resolve_info<'a>(run: &'a Run, a: &Attempt) -> Option<&'a ConflictInfo> {
    let job = a.resolves.as_deref()?;
    run.task(&a.task_id)?.conflict.as_ref().filter(|c| c.job_id == job)
}

pub(crate) fn resolvable(info: &ConflictInfo) -> bool {
    !info.needs_human && info.more == 0 && info.conflict_commit.is_some() && !info.entries.is_empty()
}

pub(crate) fn guide(info: &ConflictInfo) -> Value {
    let conflicts: Vec<Value> = info
        .entries
        .iter()
        .flat_map(|e| {
            e.paths.iter().map(move |p| {
                let blob = |n: u8| e.stages.iter().find(|s| s.stage == n && &s.path == p).map(|s| s.blob.clone());
                json!({ "path": p, "kind": e.kinds.join("+"), "base": blob(1), "ours": blob(2), "theirs": blob(3) })
            })
        })
        .collect();
    json!({
        "integrationHead": info.old,
        "reportCommit": info.report_commit,
        "mergeBase": info.merge_base,
        "conflictCommit": info.conflict_commit,
        "conflicts": conflicts,
        "rules": RULES,
    })
}

/// 영어 고정 — MCP 표면은 표시 언어를 타지 않는다.
pub(crate) const RULES: &str = "Your worktree starts at the run's integration head (HEAD) with the merged result laid out as uncommitted changes: \
the conflicting files contain git conflict markers (<<<<<<< · ======= · >>>>>>>). ours = the integration head, theirs = the task's reported commit, \
base = their common base — read each side with `git show <blob>`. In every conflicting file keep what both sides meant and remove every marker line. \
Commit everything with commit_changes (selection \"all\" — the other merged files belong to the result too); a commit that still has markers in a \
conflicting file is refused (conflict-markers-left). Then call report_done with outcome success and resolved: [{path, how}] naming every conflicting \
file and how you resolved it (unresolved-conflicts otherwise). If you cannot resolve it, report blocked or failure instead.";

/// 머리줄 없이 — 첫 지시의 본문에 덧붙인다.
pub(crate) fn prompt_section(info: &ConflictInfo) -> String {
    let paths = conflict_paths(info);
    let mut s = String::from("\n## Conflict resolution\nThis attempt resolves an integration conflict of the task above. ");
    s.push_str(RULES);
    s.push_str("\nConflicting files:\n");
    for p in paths.iter().take(LISTED_PATHS_MAX) {
        s.push_str("- ");
        s.push_str(&super::spawn::sanitize_text(p).replace('\n', " "));
        s.push('\n');
    }
    if paths.len() > LISTED_PATHS_MAX {
        s.push_str(&format!("- … and {} more (get_task lists them all)\n", paths.len() - LISTED_PATHS_MAX));
    }
    s
}

// ---------------------------------------------------------------------------
// git — 잠금 밖 · 블로킹
// ---------------------------------------------------------------------------

fn git_in<'a>(dir: &'a Path, env: &'a [(std::ffi::OsString, std::ffi::OsString)], hooks: &Path, code: &'static str) -> Result<Git<'a>, OrchError> {
    Git::new(dir, hooks, env, code)
}

/// `--no-renames` 출력만 — 항목마다 경로가 하나다.
pub(crate) fn parse_name_status_z(out: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut it = out.split('\0');
    while let Some(status) = it.next() {
        if status.is_empty() {
            continue;
        }
        if let Some(p) = it.next().filter(|p| !p.is_empty()) {
            paths.push(p.to_string());
        }
    }
    paths
}

/// **해결 자리 깔기** — `old` 에서 막 만든 worktree 에 충돌 트리 커밋 `cc` 의 차이를 작업 파일로만 되살린다(index · HEAD 는 `old` 그대로).
pub(crate) fn seed_blocking(worktree: &Path, old: &str, cc: &str) -> Result<usize, OrchError> {
    if !hex40(old) || !hex40(cc) {
        return Err(OrchError::new(reason::WORKTREE_FAILED, "the conflict seed needs full commit ids"));
    }
    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let g = git_in(worktree, &env, &hooks, reason::WORKTREE_FAILED)?;
    let d = g.ok(&["diff", "--name-status", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", old, cc, "--"], &[], None)?;
    let paths = parse_name_status_z(&d);
    if paths.is_empty() {
        return Ok(0);
    }
    let mut spec: Vec<u8> = Vec::new();
    for p in &paths {
        spec.extend_from_slice(b":(literal)");
        spec.extend_from_slice(p.as_bytes());
        spec.push(0);
    }
    // restore 가 smudge · process 필터를 돌리지 않게 — 속성은 old · cc 어느 쪽에서도 올 수 있어 두 출처 모두로 본다.
    if super::git::tree_has_filters(&g, cc, &[cc, old])? {
        return Err(OrchError::new(
            reason::FILTERS_CONFIGURED,
            "the conflict has files with a filter attribute (clean/smudge/process · LFS) — the resolver was not started; a person must look at it",
        ));
    }
    let src = format!("--source={cc}");
    g.ok(&["restore", &src, "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"], &[], Some(&spec))?;
    Ok(paths.len())
}

fn marker_sizes(g: &Git<'_>, attr_source: &str, paths: &[String]) -> Result<Vec<usize>, OrchError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let mut input: Vec<u8> = Vec::new();
    for p in paths {
        input.extend_from_slice(p.as_bytes());
        input.push(0);
    }
    let src = format!("--source={attr_source}");
    let out = g.ok(&["check-attr", &src, "-z", "--stdin", "conflict-marker-size"], &[], Some(&input))?;
    let parts: Vec<&str> = out.split('\0').collect();
    let mut by_path: Vec<(String, usize)> = Vec::new();
    for rec in parts.chunks(3) {
        if let [path, _attr, value] = rec {
            by_path.push((path.to_string(), parse_marker_size(value)));
        }
    }
    Ok(paths
        .iter()
        .map(|p| by_path.iter().find(|(q, _)| q == p).map(|(_, n)| *n).unwrap_or(DEFAULT_MARKER_SIZE))
        .collect())
}

fn blob_at(g: &Git<'_>, treeish: &str, path: &str) -> Result<Option<Vec<u8>>, OrchError> {
    let o = g.run(&["ls-tree", "-z", treeish, "--", path], &[("GIT_LITERAL_PATHSPECS", "1")], None)?;
    if !o.ok() {
        return Err(OrchError::new(g.fail_code, o.line()));
    }
    let entry = o.stdout.split('\0').find(|e| e.split_once('\t').is_some_and(|(_, p)| p == path));
    let Some((meta, _)) = entry.and_then(|e| e.split_once('\t')) else { return Ok(None) };
    let mut f = meta.split(' ');
    let (_mode, kind, oid) = (f.next(), f.next(), f.next());
    match (kind, oid) {
        (Some("blob"), Some(oid)) if hex40(oid) => blob(g, oid).map(Some),
        _ => Ok(None),
    }
}

fn blob(g: &Git<'_>, oid: &str) -> Result<Vec<u8>, OrchError> {
    Ok(g.ok(&["cat-file", "blob", oid], &[], None)?.into_bytes())
}

/// `(지금, stage 2 원본, stage 3 원본)`.
type Measured = (Markers, Markers, Markers);

/// `treeish` 에 그 경로가 없으면 `None` — 지움도 해결이다.
fn measure(g: &Git<'_>, treeish: &str, check: &MarkerCheck) -> Result<Vec<Option<Measured>>, OrchError> {
    let paths: Vec<String> = check.items.iter().map(|i| i.path.clone()).collect();
    let sizes = marker_sizes(g, &check.attr_source, &paths)?;
    let mut out = Vec::new();
    for (item, size) in check.items.iter().zip(sizes) {
        let Some(now) = blob_at(g, treeish, &item.path)? else {
            out.push(None);
            continue;
        };
        let side = |b: &Option<String>| -> Result<Markers, OrchError> {
            match b.as_deref().filter(|b| hex40(b)) {
                Some(oid) => Ok(count_markers(&blob(g, oid)?, size)),
                None => Ok(Markers::default()),
            }
        };
        out.push(Some((count_markers(&now, size), side(&item.ours)?, side(&item.theirs)?)));
    }
    Ok(out)
}

pub(crate) fn markers_left_blocking(g: &Git<'_>, treeish: &str, check: &MarkerCheck) -> Result<Vec<String>, OrchError> {
    let measured = measure(g, treeish, check)?;
    Ok(check
        .items
        .iter()
        .zip(measured)
        .filter_map(|(i, m)| m.filter(|(now, o, t)| markers_left(now, o, t)).map(|_| i.path.clone()))
        .collect())
}

pub(crate) fn markers_inserted_blocking(g: &Git<'_>, tree: &str, check: &MarkerCheck) -> Result<Vec<bool>, OrchError> {
    let measured = measure(g, tree, check)?;
    Ok(measured
        .into_iter()
        .map(|m| m.is_some_and(|(now, o, t)| markers_inserted_in(&now, &o, &t)))
        .collect())
}

pub(crate) fn check_resolved(raw: Option<&Value>, paths: &[String]) -> Result<Vec<super::model::ResolvedPath>, OrchError> {
    let bad = |m: String| OrchError::new(reason::INVALID_ARGUMENT, m);
    let items: &[Value] = match raw {
        None | Some(Value::Null) => &[],
        Some(Value::Array(a)) => a,
        Some(_) => return Err(bad("resolved must be an array of {path, how}".into())),
    };
    let mut out: Vec<super::model::ResolvedPath> = Vec::new();
    for v in items {
        let (Some(path), Some(how)) = (v.get("path").and_then(Value::as_str), v.get("how").and_then(Value::as_str)) else {
            return Err(bad("each resolved item needs path and how (strings)".into()));
        };
        let path = path.replace('\\', "/");
        let how: String = how.chars().filter(|c| *c == '\n' || !c.is_control()).take(HOW_MAX).collect();
        if how.trim().is_empty() {
            return Err(bad(format!("resolved {path:?} needs a how (what you did)")));
        }
        if !paths.contains(&path) {
            return Err(bad(format!("{:?} is not one of the conflicting files", path.chars().take(200).collect::<String>())));
        }
        if !out.iter().any(|r| r.path == path) {
            out.push(super::model::ResolvedPath { path, how });
        }
    }
    let missing: Vec<&String> = paths.iter().filter(|p| !out.iter().any(|r| &&r.path == p)).collect();
    if !missing.is_empty() {
        let shown: Vec<String> = missing.iter().take(20).map(|p| p.chars().take(200).collect()).collect();
        return Err(OrchError::new(
            reason::UNRESOLVED_CONFLICTS,
            format!(
                "resolved must name every conflicting file with how you resolved it — missing: {}{}",
                shown.join(", "),
                if missing.len() > 20 { format!(" (and {} more)", missing.len() - 20) } else { String::new() }
            ),
        ));
    }
    Ok(out)
}

pub(crate) fn markers_left_error(paths: &[String]) -> OrchError {
    let shown: Vec<String> = paths.iter().take(20).map(|p| p.chars().filter(|c| !c.is_control()).take(200).collect()).collect();
    let more = if paths.len() > 20 { format!(" (and {} more)", paths.len() - 20) } else { String::new() };
    OrchError::new(
        reason::CONFLICT_MARKERS_LEFT,
        format!(
            "conflict markers are still in {}{more} — remove every <<<<<<< / ======= / >>>>>>> line after resolving, then try again; nothing was taken",
            shown.join(", ")
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers_follow_git_rule() {
        let lf = b"a\n<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\nb\n";
        assert_eq!(count_markers(lf, 7), Markers { open: 1, sep: 1, close: 1, base: 0 });
        // CRLF — 표식 줄이 `\r\n` 으로 끝난다.
        let crlf = b"a\r\n<<<<<<< ours\r\nx\r\n=======\r\ny\r\n>>>>>>> theirs\r\n";
        assert_eq!(count_markers(crlf, 7), Markers { open: 1, sep: 1, close: 1, base: 0 });
        // 크기가 다르면 표식이 아니다(8자 · 6자).
        assert_eq!(count_markers(b"<<<<<<<< x\n======\n", 7), Markers::default());
        // 크기 12.
        let big = b"<<<<<<<<<<<< a\n============\n>>>>>>>>>>>> b\n";
        assert_eq!(count_markers(big, 12), Markers { open: 1, sep: 1, close: 1, base: 0 });
        assert_eq!(count_markers(big, 7), Markers::default());
        // 끝 줄(개행 없음)도 센다 · diff3 의 base 표식.
        assert_eq!(count_markers(b"||||||| base\n=======", 7), Markers { open: 0, sep: 1, close: 0, base: 1 });
        // 표식 같은 글자가 뒤에 바로 붙으면 아니다.
        assert_eq!(count_markers(b"<<<<<<<x\n", 7), Markers::default());
    }

    #[test]
    fn left_is_relative_to_both_sides() {
        let none = Markers::default();
        let one_sep = Markers { sep: 1, ..Markers::default() };
        // Markdown 제목 밑줄 `=======` 이 원본에 있었다 — 그대로면 남은 표식이 아니다.
        assert!(!markers_left(&one_sep, &one_sep, &none));
        assert!(markers_left(&Markers { sep: 2, ..Markers::default() }, &one_sep, &one_sep));
        assert!(markers_left(&Markers { open: 1, ..Markers::default() }, &none, &none));
        // 충돌 때 — 여는 · 닫는 표식이 원본보다 많아야 "git 이 박았다".
        let full = Markers { open: 1, sep: 1, close: 1, base: 0 };
        assert!(markers_inserted_in(&full, &none, &none));
        assert!(!markers_inserted_in(&none, &none, &none), "바이너리 — 표식 없음");
        assert!(!markers_inserted_in(&full, &full, &none), "원본에 이미 같은 수");
        assert_eq!(parse_marker_size("unspecified"), 7);
        assert_eq!(parse_marker_size("12"), 12);
        assert_eq!(parse_marker_size("set"), 7);
        assert_eq!(parse_marker_size("0"), 7);
    }

    #[test]
    fn name_status_parsed() {
        assert_eq!(
            parse_name_status_z("M\0f.txt\0A\0new dir/n.txt\0D\0gone.txt\0"),
            vec!["f.txt".to_string(), "new dir/n.txt".to_string(), "gone.txt".to_string()]
        );
        assert!(parse_name_status_z("").is_empty());
    }
}

//! **통합 git — 후보 계산의 재료**(통합 설계 3단계 — docs/log/2026-10-15-orchestration-integration-design.md 4-2 · 4-3 ②~④ · 4-6 ·
//! 0a 실측): git 판 검사 · 지원 범위 검사 · `merge-tree` 출력 읽기 · 충돌 구조 · squash 메시지 · ref 트랜잭션 줄.
//!
//! 불변식:
//! - **지원 범위 검사가 임의 실행을 막는 관문이다**(0a M1~M4 · F1~F3 — `merge-tree` 는 사용자 병합 드라이버 · `merge.default` 를 실제로
//!   실행하고 `merge.renormalize` 면 clean · smudge · process 필터를 실행한다). 그래서 통합 전에 거절한다: 설정 `merge.default` ·
//!   설정 `merge.<이름>.driver`(이름이 무엇이든 — 내장 이름을 덮어도 사용자 드라이버가 먼저 골라진다 · 리뷰 F1) ·
//!   `merge.renormalize` 참 · 속성 `merge=<내장 아님>`(허용 = 미지정 · set · unset · `text` · `binary` · `union`) · 속성 `filter=<무엇이든>`
//!   (LFS 포함) · 이 통합의 세 트리 사이에서 **바뀐** gitlink(submodule — 그대로인 gitlink 는 통합한다).
//! - **속성 출처 고정**: 검사는 `check-attr --source=<트리>` 로 **old · 보고 커밋 · merge-base 세 트리**(변경 경로 합집합)를 본다 — git 이
//!   실제로 쓰는 것(old 트리 — `--attr-source`)의 상위집합이라 보수적으로 맞다. `merge-tree` 는 늘 `--attr-source=<old>` 로 부른다(주 작업
//!   폴더의 커밋 안 된 `.gitattributes` 에 흔들리지 않게 — 0a A1 · A2). `info/attributes` · `core.attributesFile` 은 git 이 늘 더해 읽으므로
//!   검사(`check-attr`)도 같은 것을 본다.
//! - 상속 환경의 `GIT_*`(`GIT_ATTR_SOURCE` · `GIT_CONFIG_PARAMETERS` · `GIT_DIR` …)는 공용 실행기가 걷는다(`git.rs`). 설정 검사는
//!   `git config --get-regexp`(include 까지 푼 실효 값)로 한다.
//! - 충돌 종류는 **낱말 하나가 아니라 stage 구조**로 가른다(0a — symlink · 모드 · add/add 도 `contents` 로 온다, 바이너리는 `binary` +
//!   `contents`). 메시지 원문은 싣지 않는다(종류 낱말만).
//! - 이 파일의 함수는 순수하다(git 을 부르는 쪽은 `integrate::GitRefs`).

use std::collections::BTreeMap;

use super::model::{ConflictEntry, ConflictStage, CONFLICT_ENTRIES_MAX};

/// 통합에 필요한 git 최소 판(통합 설계 4-2 — `merge-tree --merge-base` 2.40 · 전역 `--attr-source` 2.42).
pub(crate) const MIN_GIT: (u32, u32) = (2, 42);

/// `git version 2.49.0.windows.1` → `(2, 49)`. 못 읽으면 `None`.
pub(crate) fn parse_git_version(s: &str) -> Option<(u32, u32)> {
    let v = s.trim().strip_prefix("git version ")?;
    let mut it = v.split(|c: char| !c.is_ascii_digit());
    let major = it.next()?.parse().ok()?;
    let minor = it.next()?.parse().ok()?;
    Some((major, minor))
}

/// `merge` 속성 값이 내장 병합인가(통합 설계 4-2 허용 목록 — 정의 안 된 이름도 거절).
pub(crate) fn builtin_merge(value: &str) -> bool {
    matches!(value, "unspecified" | "set" | "unset" | "text" | "binary" | "union")
}

/// `filter` 속성 값이 필터를 거는가(미지정 · 꺼짐만 아니다).
pub(crate) fn filter_set(value: &str) -> bool {
    !matches!(value, "unspecified" | "unset")
}

/// 설정 참 값(git 의 bool 글자).
fn truthy(v: &str) -> bool {
    matches!(v.trim().to_ascii_lowercase().as_str(), "true" | "yes" | "on" | "1" | "")
}

/// `git config --get-regexp '^merge\.'` 출력(줄 = `<키> <값>`) → 거절 사유(`merge-driver` · `renormalize`) 또는 `None`.
/// **`merge.<이름>.driver` 가 하나라도 있으면 거절한다**(리뷰 F1) — git 은 같은 이름의 사용자 드라이버를 내장(`text` · `binary` ·
/// `union`)보다 먼저 고르므로 속성 값이 내장 이름이어도 외부 명령이 돈다. 첫 지원 범위는 사용자 정의 드라이버 설정을 통째로 거절한다.
pub(crate) fn config_refusal(out: &str) -> Option<&'static str> {
    for line in out.lines() {
        let line = line.trim_end_matches('\r');
        if user_driver_line(line) {
            return Some("merge-driver");
        }
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key.to_ascii_lowercase().as_str() {
            "merge.default" => return Some("merge-driver"),
            "merge.renormalize" if truthy(value) => return Some("renormalize"),
            _ => {}
        }
    }
    None
}

/// 줄이 `merge.<무엇>.driver[ <값>]` 인가(대소문자 무시 — subsection 은 빈칸을 품을 수 있어 키를 쪼개지 않고 `.driver` 꼬리로 본다).
fn user_driver_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix("merge.") else { return false };
    rest.match_indices(".driver").any(|(i, m)| {
        let after = &rest[i + m.len()..];
        i > 0 && (after.is_empty() || after.starts_with(' '))
    })
}

/// `check-attr -z` 출력(`<경로>\0<속성>\0<값>\0` 반복) → 거절 사유(`merge-driver` · `filters`) 또는 `None`.
pub(crate) fn attr_refusal(out: &str) -> Option<&'static str> {
    let parts: Vec<&str> = out.split('\0').collect();
    for rec in parts.chunks(3) {
        let [_, attr, value] = rec else { continue };
        match *attr {
            "merge" if !builtin_merge(value) => return Some("merge-driver"),
            "filter" if filter_set(value) => return Some("filters"),
            _ => {}
        }
    }
    None
}

/// `diff --raw -z` 출력(`:<옛 mode> <새 mode> <옛 oid> <새 oid> <상태>\0<경로>\0` 반복) → `(바뀐 경로들, gitlink 가 바뀌었나)`.
/// 옛 · 새 mode 어느 쪽이든 160000(submodule)이면 gitlink 변경이다 — 세 트리 사이에서 gitlink 가 그대로면 이 줄이 없다. 순수.
pub(crate) fn parse_raw_z(out: &str) -> (Vec<String>, bool) {
    let mut paths: Vec<String> = Vec::new();
    let mut gitlink = false;
    let mut it = out.split('\0');
    while let Some(meta) = it.next() {
        let Some(meta) = meta.strip_prefix(':') else { continue };
        let mut f = meta.split(' ');
        let (a, b) = (f.next().unwrap_or_default(), f.next().unwrap_or_default());
        if a == "160000" || b == "160000" {
            gitlink = true;
        }
        if let Some(p) = it.next().filter(|p| !p.is_empty()) {
            paths.push(p.to_string());
        }
    }
    (paths, gitlink)
}

/// `merge-tree --write-tree -z --messages` 의 메시지 하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MergeMessage {
    pub paths: Vec<String>,
    /// `Auto-merging` · `CONFLICT (contents)` …
    pub kind: String,
}

/// `merge-tree` 출력을 읽은 것.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MergeParsed {
    pub tree: String,
    pub stages: Vec<ConflictStage>,
    pub messages: Vec<MergeMessage>,
}

fn hex40(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `merge-tree --write-tree -z --messages` 출력(0a T1~T10): `<트리>\0` · 충돌 파일 정보(`<mode> <oid> <stage>\t<경로>\0` 반복) · 빈 `\0` ·
/// 메시지(`<경로 수>\0<경로>…\0<종류>\0<메시지>\0` 반복 — 메시지 원문은 버린다). 깨끗해도 `Auto-merging` 메시지가 온다.
pub(crate) fn parse_merge_tree(out: &str) -> Result<MergeParsed, String> {
    let toks: Vec<&str> = out.split('\0').collect();
    let tree = toks.first().map(|t| t.trim()).unwrap_or_default();
    if !hex40(tree) {
        return Err("merge-tree did not print a tree".into());
    }
    let mut i = 1;
    let mut stages: Vec<ConflictStage> = Vec::new();
    while i < toks.len() && !toks[i].is_empty() {
        let (head, path) = toks[i].split_once('\t').ok_or("merge-tree printed a bad conflict line")?;
        let mut f = head.split(' ');
        let (Some(mode), Some(blob), Some(stage), None) = (f.next(), f.next(), f.next(), f.next()) else {
            return Err("merge-tree printed a bad conflict line".into());
        };
        let stage: u8 = stage.parse().map_err(|_| "merge-tree printed a bad stage")?;
        if !(1..=3).contains(&stage) || !hex40(blob) {
            return Err("merge-tree printed a bad conflict line".into());
        }
        stages.push(ConflictStage {
            stage,
            mode: mode.to_string(),
            blob: blob.to_string(),
            path: path.to_string(),
        });
        i += 1;
    }
    i += 1; // 두 절 사이의 빈 칸
    let mut messages: Vec<MergeMessage> = Vec::new();
    while i < toks.len() && !toks[i].is_empty() {
        let n: usize = toks[i].parse().map_err(|_| "merge-tree printed a bad message count")?;
        let end = i + 1 + n;
        if end + 1 >= toks.len() {
            return Err("merge-tree messages were cut".into());
        }
        messages.push(MergeMessage {
            paths: toks[i + 1..end].iter().map(|s| s.to_string()).collect(),
            kind: toks[end].to_string(),
        });
        i = end + 2;
    }
    Ok(MergeParsed {
        tree: tree.to_string(),
        stages,
        messages,
    })
}

/// 종류 낱말 — `CONFLICT (contents)` → `contents`. 그 밖은 원래 글자.
fn kind_word(kind: &str) -> String {
    kind.strip_prefix("CONFLICT (")
        .and_then(|k| k.strip_suffix(')'))
        .unwrap_or(kind)
        .to_string()
}

/// 충돌 구조(통합 설계 4-6) — 같은 경로 묶음의 `CONFLICT` 메시지를 한 항목으로 모으고(종류 여럿), 그 경로들의 stage 를 붙인다.
/// 메시지에 없는 충돌 경로는 종류 `unlisted` 항목으로. 상한을 넘은 항목 수와 "사람이 필요한가" 를 함께 돌려준다. 순수.
pub(crate) fn conflict_entries(p: &MergeParsed) -> (Vec<ConflictEntry>, u32, bool) {
    let mut groups: BTreeMap<Vec<String>, Vec<String>> = BTreeMap::new();
    for m in p.messages.iter().filter(|m| m.kind.starts_with("CONFLICT")) {
        let kinds = groups.entry(m.paths.clone()).or_default();
        let k = kind_word(&m.kind);
        if !kinds.contains(&k) {
            kinds.push(k);
        }
    }
    let mut listed: Vec<&str> = Vec::new();
    for paths in groups.keys() {
        listed.extend(paths.iter().map(String::as_str));
    }
    let mut unlisted: Vec<String> = Vec::new();
    for s in &p.stages {
        if !listed.contains(&s.path.as_str()) && !unlisted.contains(&s.path) {
            unlisted.push(s.path.clone());
        }
    }
    for path in unlisted {
        groups.insert(vec![path], vec!["unlisted".into()]);
    }
    let all: Vec<ConflictEntry> = groups
        .into_iter()
        .map(|(paths, kinds)| {
            let stages = p.stages.iter().filter(|s| paths.contains(&s.path)).cloned().collect();
            ConflictEntry { paths, kinds, stages }
        })
        .collect();
    let more = all.len().saturating_sub(CONFLICT_ENTRIES_MAX) as u32;
    // 상한을 넘으면 해결자 관문(경로 전부)을 세울 수 없다 — 사람에게(3b).
    let needs_human = all.is_empty() || more > 0 || !all.iter().all(text_conflict);
    let kept = all.into_iter().take(CONFLICT_ENTRIES_MAX).collect();
    (kept, more, needs_human)
}

/// 일반 텍스트 내용 충돌인가(구조만 — 표식 실측은 `resolve.rs` · 통합 ⑦): 종류가 `contents` 하나 · 경로 하나 · stage 1·2·3 이 다 있고
/// mode 가 같은 일반 파일. 바이너리는 같은 경로에 `binary` 가 함께 와 여기서 걸러진다(0a T6).
pub(crate) fn text_conflict(e: &ConflictEntry) -> bool {
    if e.kinds != ["contents"] || e.paths.len() != 1 {
        return false;
    }
    let mode_of = |n: u8| e.stages.iter().find(|s| s.stage == n).map(|s| s.mode.as_str());
    match (mode_of(1), mode_of(2), mode_of(3)) {
        (Some(a), Some(b), Some(c)) => a == b && b == c && matches!(a, "100644" | "100755") && e.stages.len() == 3,
        _ => false,
    }
}

/// squash 커밋 메시지(통합 설계 4-1) — `<Task 제목>` + 빈 줄 + 보고 요약 첫 줄 + trailer. 제어 문자 · 긴 글은 자른다. 순수.
pub(crate) struct SquashMeta<'a> {
    pub run_id: &'a str,
    pub task_id: &'a str,
    pub attempt_id: &'a str,
    pub report_id: &'a str,
    pub report_commit: &'a str,
    pub base: &'a str,
}

pub(crate) fn squash_message(title: &str, summary: &str, m: &SquashMeta<'_>) -> String {
    let clean = |s: &str, max: usize| -> String {
        s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
    };
    let subject = Some(clean(title, 200)).filter(|s| !s.is_empty()).unwrap_or_else(|| m.task_id.to_string());
    let first = summary.lines().map(str::trim).find(|l| !l.is_empty()).map(|l| clean(l, 300));
    let mut s = subject;
    s.push_str("\n\n");
    if let Some(f) = first.filter(|f| !f.is_empty()) {
        s.push_str(&f);
        s.push_str("\n\n");
    }
    s.push_str(&format!(
        "Aynx-Run: {}\nAynx-Task: {}\nAynx-Attempt: {}\nAynx-Report: {}\nAynx-Report-Commit: {}\nAynx-Base: {}\n",
        m.run_id, m.task_id, m.attempt_id, m.report_id, m.report_commit, m.base
    ));
    s
}

/// ref 트랜잭션 한 줄(`update-ref --stdin`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RefOp {
    /// 없을 때만 만든다.
    Create { name: String, new: String },
    /// `old` 가 있으면 CAS, 없으면 무조건.
    Update { name: String, new: String, old: Option<String> },
    /// `old` 일 때만 지운다.
    Delete { name: String, old: String },
}

fn ref_name_ok(n: &str) -> bool {
    n.starts_with("refs/") && !n.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// `update-ref --stdin` 입력(`start` … `prepare` · `commit`) — OID 는 40 hex · ref 이름은 `refs/` + 공백 · 제어 문자 없음일 때만.
pub(crate) fn ref_script(ops: &[RefOp]) -> Result<String, String> {
    let bad_oid = || "a ref transaction needs full 40-hex object ids".to_string();
    let bad_name = || "a ref transaction got a bad ref name".to_string();
    let mut s = String::from("start\n");
    for op in ops {
        match op {
            RefOp::Create { name, new } => {
                if !ref_name_ok(name) {
                    return Err(bad_name());
                }
                if !hex40(new) {
                    return Err(bad_oid());
                }
                s.push_str(&format!("create {name} {new}\n"));
            }
            RefOp::Update { name, new, old } => {
                if !ref_name_ok(name) {
                    return Err(bad_name());
                }
                if !hex40(new) || old.as_deref().is_some_and(|o| !hex40(o)) {
                    return Err(bad_oid());
                }
                match old {
                    Some(o) => s.push_str(&format!("update {name} {new} {o}\n")),
                    None => s.push_str(&format!("update {name} {new}\n")),
                }
            }
            RefOp::Delete { name, old } => {
                if !ref_name_ok(name) {
                    return Err(bad_name());
                }
                if !hex40(old) {
                    return Err(bad_oid());
                }
                s.push_str(&format!("delete {name} {old}\n"));
            }
        }
    }
    s.push_str("prepare\ncommit\n");
    Ok(s)
}

/// `git worktree list --porcelain` → 체크아웃된 브랜치 ref 들(`refs/heads/…`).
pub(crate) fn checked_out_branches(out: &str) -> Vec<String> {
    out.lines()
        .filter_map(|l| l.trim_end_matches('\r').strip_prefix("branch "))
        .map(str::to_string)
        .collect()
}

/// 사람용 내보내기 브랜치 이름(통합 설계 N1) — `orch-<run 앞 8자>-int`.
pub(crate) fn export_branch_name(run_id: &str) -> String {
    let hex = run_id.strip_prefix("run-").unwrap_or(run_id);
    format!("orch-{}-int", hex.chars().take(8).collect::<String>())
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "1111111111111111111111111111111111111111";
    const B: &str = "2222222222222222222222222222222222222222";
    const C: &str = "3333333333333333333333333333333333333333";

    #[test]
    fn git_version_parsed() {
        assert_eq!(parse_git_version("git version 2.49.0.windows.1\n"), Some((2, 49)));
        assert_eq!(parse_git_version("git version 2.42.0"), Some((2, 42)));
        assert_eq!(parse_git_version("nope"), None);
        assert!(parse_git_version("git version 2.41.1").unwrap() < MIN_GIT);
    }

    #[test]
    fn merge_tree_clean_and_conflict_parsed() {
        let clean = format!("{A}\0\x001\0f.txt\0Auto-merging\0Auto-merging f.txt\n\0");
        let p = parse_merge_tree(&clean).unwrap();
        assert_eq!(p.tree, A);
        assert!(p.stages.is_empty());
        assert_eq!(p.messages.len(), 1);
        let conflict = format!(
            "{A}\x00100644 {B} 1\tf.txt\x00100644 {C} 2\tf.txt\x00100644 {A} 3\tf.txt\0\x001\0f.txt\0Auto-merging\0m\n\x001\0f.txt\0CONFLICT (contents)\0m2\n\0"
        );
        let p = parse_merge_tree(&conflict).unwrap();
        assert_eq!(p.stages.len(), 3);
        let (entries, more, human) = conflict_entries(&p);
        assert_eq!(more, 0);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kinds, vec!["contents".to_string()]);
        assert!(!human, "일반 텍스트 내용 충돌");
    }

    #[test]
    fn non_text_conflict_needs_human() {
        // 바이너리 — binary + contents 둘.
        let bin = format!(
            "{A}\x00100644 {B} 1\tb.bin\x00100644 {C} 2\tb.bin\x00100644 {A} 3\tb.bin\0\x001\0b.bin\0CONFLICT (binary)\0m\n\x001\0b.bin\0CONFLICT (contents)\0m\n\0"
        );
        let (e, _, human) = conflict_entries(&parse_merge_tree(&bin).unwrap());
        assert_eq!(e[0].kinds, vec!["binary".to_string(), "contents".to_string()]);
        assert!(human);
        // 모드 + 내용 — stage 2 만 100755.
        let mode = format!(
            "{A}\x00100644 {B} 1\tm.sh\x00100755 {C} 2\tm.sh\x00100644 {A} 3\tm.sh\0\x001\0m.sh\0CONFLICT (contents)\0m\n\0"
        );
        assert!(conflict_entries(&parse_merge_tree(&mode).unwrap()).2);
        // add/add — stage 1 없음.
        let add = format!("{A}\x00100644 {C} 2\tn.txt\x00100644 {A} 3\tn.txt\0\x001\0n.txt\0CONFLICT (contents)\0m\n\0");
        assert!(conflict_entries(&parse_merge_tree(&add).unwrap()).2);
        // 수정/삭제.
        let md = format!("{A}\x00100644 {B} 1\td.txt\x00100644 {C} 2\td.txt\0\x001\0d.txt\0CONFLICT (modify/delete)\0m\n\0");
        assert!(conflict_entries(&parse_merge_tree(&md).unwrap()).2);
    }

    #[test]
    fn refusals_from_config_and_attrs() {
        assert_eq!(config_refusal("merge.default foo\n"), Some("merge-driver"));
        assert_eq!(config_refusal("merge.renormalize true\n"), Some("renormalize"));
        assert_eq!(config_refusal("merge.renormalize false\nmerge.conflictstyle diff3\n"), None);
        // F1 — 사용자 드라이버 설정은 이름과 상관없이 거절(내장 이름을 덮는 것 · 빈칸 든 subsection 포함).
        for name in ["foo", "text", "binary", "union", "Text", "a b"] {
            assert_eq!(config_refusal(&format!("merge.{name}.driver x %A\n")), Some("merge-driver"), "{name}");
        }
        assert_eq!(config_refusal("merge.text.name plain\n"), None);
        assert_eq!(attr_refusal("a.txt\0merge\0unspecified\0a.txt\0filter\0unspecified\0"), None);
        assert_eq!(attr_refusal("a.txt\0merge\0union\0a.txt\0filter\0unset\0"), None);
        assert_eq!(attr_refusal("a.txt\0merge\0foo\0"), Some("merge-driver"));
        assert_eq!(attr_refusal("a.bin\0filter\0lfs\0"), Some("filters"));
        let (p, g) = parse_raw_z(&format!(":100644 100644 {A} {B} M\0a.txt\0:000000 160000 {C} {B} A\0sub\0"));
        assert_eq!(p, vec!["a.txt".to_string(), "sub".to_string()]);
        assert!(g);
        let (p, g) = parse_raw_z(&format!(":100644 100644 {A} {B} M\0a.txt\0"));
        assert_eq!(p.len(), 1);
        assert!(!g);
    }

    #[test]
    fn ref_script_checks_names_and_oids() {
        let s = ref_script(&[
            RefOp::Create { name: "refs/heads/x".into(), new: A.into() },
            RefOp::Update { name: "refs/a".into(), new: B.into(), old: Some(A.into()) },
            RefOp::Update { name: "refs/b".into(), new: B.into(), old: None },
            RefOp::Delete { name: "refs/c".into(), old: C.into() },
        ])
        .unwrap();
        assert_eq!(
            s,
            format!("start\ncreate refs/heads/x {A}\nupdate refs/a {B} {A}\nupdate refs/b {B}\ndelete refs/c {C}\nprepare\ncommit\n")
        );
        assert!(ref_script(&[RefOp::Create { name: "refs/x y".into(), new: A.into() }]).is_err());
        assert!(ref_script(&[RefOp::Create { name: "HEAD".into(), new: A.into() }]).is_err());
        assert!(ref_script(&[RefOp::Create { name: "refs/x".into(), new: "abc".into() }]).is_err());
    }

    #[test]
    fn squash_message_has_trailers() {
        let m = SquashMeta {
            run_id: "run-1",
            task_id: "task-1",
            attempt_id: "att-1",
            report_id: "rep-1",
            report_commit: A,
            base: B,
        };
        let s = squash_message("Fix\u{7} it", "\n  did the thing\nmore", &m);
        assert!(s.starts_with("Fix it\n\ndid the thing\n\nAynx-Run: run-1\n"));
        assert!(s.contains(&format!("Aynx-Report-Commit: {A}\nAynx-Base: {B}\n")));
        assert_eq!(export_branch_name("run-0123456789abcdef"), "orch-01234567-int");
    }
}

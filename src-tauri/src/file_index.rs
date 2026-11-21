//! 팔레트 "파일 열기…" 의 로컬 목록 — 폴더 아래 파일 이름만 재귀로 모은다.
//!
//! - 텍스트 판정(`isTextLike`)은 프런트 `doc-lang.ts` 한 곳이 정한다 — 여기 사본을 두면 두 표가 갈라진다. 그래서 파일이면 다 싣는다.
//! - 상한 셋은 뿌리가 `C:\` 여도 한 번의 부름이 짧게 끝나게 한다 — [`MAX_VISITED`] 는 폴더만 끝없는 나무도 멈춘다.
//! - 심링크는 따라가지 않는다(고리 · 뿌리 밖으로 새는 길).

use std::collections::VecDeque;
use std::path::PathBuf;

use serde::Serialize;

use crate::i18n::tr;
use crate::local_browser::{real_path, show, strip_verbatim};

/// 뿌리 바로 아래가 1
const MAX_DEPTH: usize = 8;
const MAX_LIMIT: usize = 20_000;
const MAX_VISITED: usize = 200_000;

/// 대소문자 그대로 비교한다
const SKIP_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "target",
    "dist",
    ".svelte-kit",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".tox",
    ".gradle",
    ".idea",
    ".vs",
];

/// `rel` 은 `/` 로 잇는다
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedFile {
    pub(crate) rel: String,
    pub(crate) path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndex {
    pub(crate) root: String,
    pub(crate) files: Vec<IndexedFile>,
    pub(crate) truncated: bool,
}

fn is_skipped(name: &str) -> bool {
    SKIP_DIRS.contains(&name)
}

/// 넓이 우선 — 잘릴 때 얕은 파일이 먼저 남는다.
fn index(root: &str, limit: usize) -> Result<FileIndex, String> {
    let base = real_path(root)?;
    if !base.is_dir() {
        return Err(tr!(
            ko: "{what} 은(는) 폴더가 아닙니다",
            en: "{what} is not a folder",
            what = show(&base)
        ));
    }
    let limit = limit.clamp(1, MAX_LIMIT);
    let mut files: Vec<IndexedFile> = Vec::new();
    let mut truncated = false;
    let mut visited = 0usize;
    let mut queue: VecDeque<(PathBuf, String, usize)> = VecDeque::new();
    queue.push_back((base.clone(), String::new(), 0));

    'walk: while let Some((dir, rel, depth)) = queue.pop_front() {
        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(e) if depth == 0 => {
                return Err(tr!(
                    ko: "{what} 목록을 읽지 못했습니다: {e}",
                    en: "Could not list {what}: {e}",
                    what = show(&dir)
                ))
            }
            Err(_) => continue,
        };
        let mut items: Vec<(String, PathBuf, std::fs::FileType)> = Vec::new();
        for item in read {
            let Ok(item) = item else { continue };
            // `file_type` 은 lstat 의미라 심링크를 따라가지 않는다.
            let Ok(ft) = item.file_type() else { continue };
            items.push((
                item.file_name().to_string_lossy().into_owned(),
                item.path(),
                ft,
            ));
        }
        items.sort_by_key(|(name, _, _)| name.to_lowercase());

        for (name, path, ft) in items {
            visited += 1;
            if visited > MAX_VISITED {
                truncated = true;
                break 'walk;
            }
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            if ft.is_dir() {
                if depth + 1 < MAX_DEPTH && !is_skipped(&name) {
                    queue.push_back((path, child_rel, depth + 1));
                } else if !is_skipped(&name) {
                    truncated = true;
                }
            } else if ft.is_file() {
                if files.len() >= limit {
                    truncated = true;
                    break 'walk;
                }
                files.push(IndexedFile {
                    rel: child_rel,
                    path: strip_verbatim(&path.to_string_lossy()),
                });
            }
        }
    }

    Ok(FileIndex {
        root: show(&base),
        files,
        truncated,
    })
}

#[tauri::command]
pub async fn list_text_files(root: String, limit: Option<u32>) -> Result<FileIndex, String> {
    let limit = limit.map(|n| n as usize).unwrap_or(MAX_LIMIT);
    tokio::task::spawn_blocking(move || index(&root, limit))
        .await
        .map_err(|e| tr!(ko: "작업을 끝내지 못했습니다: {e}", en: "The task did not finish: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Scratch(PathBuf);
    impl Scratch {
        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn tree(tag: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("aynx-file-index-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let root = dir.as_path();
        fs::create_dir_all(root).unwrap();
        fs::write(root.join("README.md"), "x").unwrap();
        fs::write(root.join("b.txt"), "x").unwrap();
        fs::create_dir_all(root.join("docs/deep")).unwrap();
        fs::write(root.join("docs/a.md"), "x").unwrap();
        fs::write(root.join("docs/deep/c.rs"), "x").unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "x").unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/HEAD"), "x").unwrap();
        Scratch(dir)
    }

    fn rels(idx: &FileIndex) -> Vec<&str> {
        idx.files.iter().map(|f| f.rel.as_str()).collect()
    }

    #[test]
    fn 넓이_우선_이름순_건너뛸_폴더는_안_들어간다() {
        let dir = tree("order");
        let idx = index(&dir.path().to_string_lossy(), 100).unwrap();
        assert_eq!(
            rels(&idx),
            vec!["b.txt", "README.md", "docs/a.md", "docs/deep/c.rs"]
        );
        assert!(!idx.truncated);
        let a = idx.files.iter().find(|f| f.rel == "docs/a.md").unwrap();
        assert!(std::path::Path::new(&a.path).is_file());
    }

    #[test]
    fn 개수_상한에_걸리면_잘림이고_얕은_것이_남는다() {
        let dir = tree("limit");
        let idx = index(&dir.path().to_string_lossy(), 2).unwrap();
        assert_eq!(rels(&idx), vec!["b.txt", "README.md"]);
        assert!(idx.truncated);
    }

    #[test]
    fn 폴더가_아니면_오류() {
        let dir = tree("notdir");
        let file = dir.path().join("b.txt");
        assert!(index(&file.to_string_lossy(), 10).is_err());
        assert!(index("relative/path", 10).is_err());
    }
}

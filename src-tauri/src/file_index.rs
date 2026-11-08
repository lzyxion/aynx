//! **팔레트 "파일 열기…" 의 로컬 목록** — 폴더 하나 아래의 파일을 재귀로 모은다
//! (docs/log/2026-09-27-doc-tile.md "A — 여는 길").
//!
//! 고르는 목록이 부분수열로 좁힐 **이름 목록**만 만든다 — 내용은 읽지 않는다. 무엇이 텍스트로 보이는지
//! (`isTextLike`)는 프런트의 `doc-lang.ts` **한 곳**이 정한다(사본을 두면 두 표가 갈라진다). 그래서 여기서는
//! 파일이면 다 싣고, 상한도 "텍스트 파일 수" 가 아니라 "파일 수" 다.
//!
//! 상한 셋 — 뿌리가 `C:\` 이거나 거대한 저장소여도 한 번의 부름이 짧게 끝나야 한다:
//! - 깊이 [`MAX_DEPTH`] 단(뿌리 바로 아래가 1).
//! - 파일 `limit` 개(프런트가 준다, [`MAX_LIMIT`] 로 죈다) — 넘으면 `truncated`.
//! - 훑은 항목(폴더 포함) [`MAX_VISITED`] 개 — 파일은 적고 폴더만 끝없는 나무(드라이브 뿌리)도 멈춘다.
//!
//! 넓이 우선이다: 잘릴 때 얕은 파일이 먼저 남는다(찾는 파일은 대개 뿌리 가까이 있다). 심링크는 따라가지
//! 않는다(고리 · 뿌리 밖으로 새는 길). 빌드 산출물 · 의존성 · VCS 폴더는 건너뛴다([`SKIP_DIRS`]).

use std::collections::VecDeque;
use std::path::PathBuf;

use serde::Serialize;

use crate::i18n::tr;
use crate::local_browser::{real_path, show, strip_verbatim};

/// 뿌리 바로 아래를 1 로 센 깊이 상한
const MAX_DEPTH: usize = 8;
/// 프런트가 주는 `limit` 의 천장(그리고 없을 때의 기본)
const MAX_LIMIT: usize = 20_000;
/// 훑은 항목(폴더 · 파일 · 그 밖) 전체의 상한
const MAX_VISITED: usize = 200_000;

/// 들어가지 않는 폴더 이름(대소문자 그대로 — 이 이름들은 관례상 소문자다)
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

/// 한 줄 — 뿌리에서의 상대 경로(`/` 로 잇는다 · 화면과 거르기용)와 절대 경로(여는 데 쓴다)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedFile {
    pub(crate) rel: String,
    pub(crate) path: String,
}

/// 목록 전체 — `root` 는 실경로(사람에게 보일 모양), `truncated` 는 상한에 걸렸는가
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

/// 넓이 우선으로 훑는다. 한 폴더 안은 이름순(대소문자 무시)이라 같은 나무는 언제나 같은 목록이다.
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
    // (폴더, 뿌리에서의 상대 조각들, 깊이)
    let mut queue: VecDeque<(PathBuf, String, usize)> = VecDeque::new();
    queue.push_back((base.clone(), String::new(), 0));

    'walk: while let Some((dir, rel, depth)) = queue.pop_front() {
        // 읽지 못하는 폴더(권한 · 도중에 사라짐) 하나 때문에 목록 전체가 실패하면 안 된다 — 뿌리만 예외.
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
            // `file_type` 은 lstat 의미다 — 심링크는 심링크로 보이고 따라가지 않는다.
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
                    // 깊이에 걸려 들어가지 못한 폴더가 있다 — 목록이 전부가 아니다.
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

/// 폴더 `root` 아래의 파일 목록(상대 경로 · 절대 경로) — 깊이 · 개수 · 훑기 상한이 있다(모듈 주석).
/// 디스크를 훑으므로 블로킹 풀에서 돈다(docs/conventions.md 의 "Tauri 명령은 기본 async fn").
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

    /// 테스트마다 따로인 임시 폴더 — 떨어질 때 지운다
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
        // 절대 경로는 실제로 그 파일을 가리킨다
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

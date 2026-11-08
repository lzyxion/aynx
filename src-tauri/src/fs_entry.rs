//! 파일 브라우저 **한 줄의 모양**과 정렬 — SFTP(원격)와 로컬 디스크가 함께 쓴다.
//!
//! ```text
//!  sftp_browser.rs ─┐
//!                   ├─→ SftpEntry · sort_entries   (이 파일)
//!  local_browser.rs ┘
//! ```
//!
//! 프런트는 원격/로컬 두 백엔드에 **같은 브라우저 UI 하나**를 물린다. 그래서 목록 한 줄의
//! 필드와 "어느 것이 위에 오는가" 는 두 곳에서 반드시 같아야 한다 — 복사해 두면 한쪽만
//! 고쳐지는 날이 오고, 그날 UI 는 두 벌의 정렬 규칙을 갖게 된다. 이름이 `SftpEntry` 로
//! 남은 것은 프런트 타입 이름이 이미 그것이기 때문이다 (계약을 흔들지 않는다).

/// 목록 한 줄. **camelCase** 로 나간다 (`symlinkTarget` · `linkIsDir`).
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    /// 이름 한 조각 (경로 없음). 루트만 자기 자신이다 (`"/"` · `"C:\\"`).
    pub name: String,
    /// 절대 경로. **심링크는 따라가지 않는다** — 보이는 그 자리다.
    /// 윈도우에서는 `\\?\` 접두사를 뗀 모양으로 나간다 (local_browser 참고).
    pub path: String,
    /// `"dir"` · `"file"` · `"symlink"` · `"other"` (fifo·소켓·장치).
    pub kind: String,
    pub size: u64,
    /// 유닉스 초. 서버/파일시스템이 안 주면 `null`.
    pub mtime: Option<i64>,
    /// **권한 비트만** (`mode & 0o7777`). 종류는 `kind` 가 이미 말한다.
    /// 윈도우 로컬은 항상 `null` 이다 (ACL 을 8진수로 꾸며 내지 않는다).
    pub mode: Option<u32>,
    /// `kind == "symlink"` 일 때 링크가 적어 둔 문자열 (상대 경로일 수 있다).
    pub symlink_target: Option<String>,
    /// 심링크가 **디렉터리를 가리키는가**. UI 가 링크된 디렉터리로 들어갈 수 있게 하는 값.
    /// 심링크가 아니거나 끊어진 링크면 `false`.
    pub link_is_dir: bool,
    /// **윈도우 숨김 속성**(`FILE_ATTRIBUTE_HIDDEN`). 그런 속성이 없는 자리는 `null` 이다
    /// (SFTP 는 언제나 `null`, 유닉스 로컬은 `false`). 프런트는 **점 파일이거나
    /// `hidden == true`** 면 숨김으로 친다 — 두 규칙을 OR 로 묶어야 윈도우의 `NTUSER.DAT`
    /// 같은 파일도, 유닉스의 `.bashrc` 도 한 스위치로 접힌다.
    pub hidden: Option<bool>,
}

/// 목록 정렬 기준에서 "디렉터리" 로 볼 것인가.
///
/// 디렉터리를 가리키는 심링크도 디렉터리 쪽에 둔다 — UI 에서 **들어갈 수 있는 것**이
/// 위에 모이는 편이 `ls` 의 형식적 분류보다 쓸모 있다.
fn is_dir_like(entry: &SftpEntry) -> bool {
    entry.kind == "dir" || (entry.kind == "symlink" && entry.link_is_dir)
}

/// 디렉터리 먼저, 그다음 이름 오름차순(대소문자 무시). 같은 이름이 대소문자만 다르면
/// 원래 이름으로 한 번 더 갈라 **순서가 항상 같게** 한다.
pub(crate) fn sort_entries(entries: &mut [SftpEntry]) {
    entries.sort_by_cached_key(|e| (!is_dir_like(e), e.name.to_lowercase(), e.name.clone()));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, kind: &str, link_is_dir: bool) -> SftpEntry {
        SftpEntry {
            name: name.to_string(),
            path: format!("/x/{name}"),
            kind: kind.to_string(),
            size: 0,
            mtime: None,
            mode: None,
            symlink_target: None,
            link_is_dir,
            hidden: None,
        }
    }

    fn names(entries: &[SftpEntry]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn sorts_dirs_first_then_case_insensitive_name() {
        let mut list = vec![
            entry("zeta.txt", "file", false),
            entry("Beta", "dir", false),
            entry("alpha.txt", "file", false),
            entry("apple", "dir", false),
        ];
        sort_entries(&mut list);
        // 디렉터리 둘이 먼저(대소문자 무시 → apple, Beta), 그다음 파일 둘
        assert_eq!(names(&list), vec!["apple", "Beta", "alpha.txt", "zeta.txt"]);
    }

    /// 디렉터리를 가리키는 심링크는 디렉터리 쪽에 선다 (들어갈 수 있는 것이 위에 모인다).
    #[test]
    fn sorts_dir_symlinks_with_dirs() {
        let mut list = vec![
            entry("readme", "file", false),
            entry("broken", "symlink", false),
            entry("current", "symlink", true),
            entry("data", "dir", false),
        ];
        sort_entries(&mut list);
        assert_eq!(names(&list), vec!["current", "data", "broken", "readme"]);
    }

    /// 대소문자만 다른 이름도 순서가 흔들리면 안 된다 (새로고침마다 자리가 바뀐다).
    #[test]
    fn breaks_ties_deterministically() {
        let mut list = vec![entry("a.txt", "file", false), entry("A.txt", "file", false)];
        sort_entries(&mut list);
        assert_eq!(names(&list), vec!["A.txt", "a.txt"]);
        let mut reversed = vec![entry("A.txt", "file", false), entry("a.txt", "file", false)];
        sort_entries(&mut reversed);
        assert_eq!(names(&reversed), names(&list));
    }

    #[test]
    fn sorts_hangul_and_digits_by_name() {
        let mut list = vec![
            entry("나중.txt", "file", false),
            entry("10.txt", "file", false),
            entry("가장.txt", "file", false),
            entry("2.txt", "file", false),
        ];
        sort_entries(&mut list);
        // 사전순이라 "10" 이 "2" 앞이다 (자연 정렬은 하지 않는다 — UI 의 선택지다)
        assert_eq!(
            names(&list),
            vec!["10.txt", "2.txt", "가장.txt", "나중.txt"]
        );
    }

    /// 프런트 계약은 camelCase 다 (`symlinkTarget` · `linkIsDir` · `hidden`).
    #[test]
    fn serializes_as_camel_case() {
        let mut e = entry("link", "symlink", true);
        e.symlink_target = Some("../data".to_string());
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"symlinkTarget\":\"../data\""), "{json}");
        assert!(json.contains("\"linkIsDir\":true"), "{json}");
        assert!(json.contains("\"mtime\":null"), "{json}");
        // 숨김을 모르는 자리는 null 로 나간다 (false 라고 단정하지 않는다)
        assert!(json.contains("\"hidden\":null"), "{json}");
    }

    #[test]
    fn serializes_hidden_flag() {
        let mut e = entry("NTUSER.DAT", "file", false);
        e.hidden = Some(true);
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"hidden\":true"), "{json}");
    }
}

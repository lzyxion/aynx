//! 파일 브라우저 한 줄의 모양과 정렬 — 원격 · 로컬 두 백엔드가 같은 브라우저 UI 를 물리므로 이 한 벌을 함께 쓴다(복사하지 않는다).
//! 이름이 `SftpEntry` 인 것은 프런트 타입 이름이 이미 그것이기 때문이다.

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    /// 루트만 자기 자신이다(`"/"` · `"C:\\"`).
    pub name: String,
    /// 심링크는 따라가지 않는다. 윈도우에서는 `\\?\` 접두사를 뗀 모양이다.
    pub path: String,
    /// `"dir"` · `"file"` · `"symlink"` · `"other"`.
    pub kind: String,
    pub size: u64,
    /// 유닉스 초.
    pub mtime: Option<i64>,
    /// 권한 비트만(`mode & 0o7777`). 윈도우 로컬은 늘 `null` — ACL 을 8진수로 꾸며 내지 않는다.
    pub mode: Option<u32>,
    pub symlink_target: Option<String>,
    /// 끊어진 링크면 `false`.
    pub link_is_dir: bool,
    /// 윈도우 숨김 속성 — 모르는 자리(SFTP)는 `null` 이다. 프런트는 점 파일 **또는** `hidden == true` 를 숨김으로 친다.
    pub hidden: Option<bool>,
}

/// 디렉터리를 가리키는 심링크도 디렉터리 쪽에 둔다 — 들어갈 수 있는 것이 위에 모인다.
fn is_dir_like(entry: &SftpEntry) -> bool {
    entry.kind == "dir" || (entry.kind == "symlink" && entry.link_is_dir)
}

/// 대소문자만 다른 이름은 원래 이름으로 한 번 더 갈라 순서가 늘 같게 한다.
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
        assert_eq!(names(&list), vec!["apple", "Beta", "alpha.txt", "zeta.txt"]);
    }

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
        // 자연 정렬은 하지 않는다 — UI 의 선택지다
        assert_eq!(
            names(&list),
            vec!["10.txt", "2.txt", "가장.txt", "나중.txt"]
        );
    }

    #[test]
    fn serializes_as_camel_case() {
        let mut e = entry("link", "symlink", true);
        e.symlink_target = Some("../data".to_string());
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"symlinkTarget\":\"../data\""), "{json}");
        assert!(json.contains("\"linkIsDir\":true"), "{json}");
        assert!(json.contains("\"mtime\":null"), "{json}");
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

//! **사용자 터미널 테마** — 사람이 가져온 색 구성(Windows Terminal · iTerm2 · Ghostty · Alacritty)을 정규화한 21색 한 벌로
//! `<설정 루트>/terminal-themes/<id>.json` 에 둔다. 형식 판별 · 해석은 프런트의 순수 모듈(`src/lib/term-theme-import.ts`)이고,
//! 여기는 **받은 결과를 다시 검증해 쓰고 · 읽고 · 이름을 바꾸고 · 지우는** 것뿐이다.
//!
//! 불변식:
//! - **폴더가 곧 목록이다** — 설정 파일에 목록 칸은 없고 `[terminal] theme` 에 `user:<id>` 하나만 적힌다(키 모양은 프런트
//!   `theme.ts` 의 `isUserTermKey` 와 같은 [`is_id`]). 사람이 폴더에 직접 넣은 파일도 이름이 id 모양이고 내용이 같은 형식이면 뜬다.
//!   **깨진 파일은 건너뛴다** — 한 장이 상해도 목록 전체가 실패하지 않는다(크기 상한 넘음 · JSON 아님 · 칸 빠짐 · 색 모양 틀림 · 모르는 판).
//! - id 는 `[a-z0-9]` 로 시작하는 `[a-z0-9-]` 48자까지 — 구분자 · `.` · 대문자가 없어 경로 조작이 없다. 새 id 는 이름의 슬러그
//!   (ASCII 영숫자만 남김 · 나머지는 `-` · 비면 `theme`)에 겹치면 `-2`, `-3` … 를 붙인다. 이름을 바꿔도 **id 는 그대로**다
//!   (설정 · 테마 프로필에 적힌 키가 살아 있게).
//! - 받은 것을 믿지 않는다 — 21칸 전부 `#rrggbb`(대문자는 소문자로 접는다) · 이름은 앞뒤 공백을 걷고 1~[`MAX_NAME`]자 · 제어 문자 없음.
//!   파일은 우리가 다시 직렬화해 [`crate::fs_atomic::write_atomic`] 으로 원자 교체한다. 읽을 때도 [`MAX_FILE_BYTES`] 를 넘으면 읽지 않는다.
//! - 개수 상한 [`MAX_THEMES`](드롭다운이 끝없이 길어지지 않게 — 넘으면 넣기를 거절한다).
//! - GUI 프로세스의 명령이다(설정 파일과 같은 쪽 — 세션 서버를 지나지 않는다). 디스크라 전부 `async fn` + `spawn_blocking`.
//! - 원격 웹 클라이언트에서도 열려 있다(`remote/deny.rs` 의 `ALLOW` — 테마 프로필 저장 · 월페이퍼와 같은 결의 설정 폴더 쓰기다.
//!   붙여넣기로 가져오기는 원격 창에서도 된다 — 파일은 그 브라우저에서 읽어 글자만 넘긴다).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::i18n::tr;

/// 폴더 이름 — `<설정 루트>/terminal-themes`.
const DIR_NAME: &str = "terminal-themes";
const EXT: &str = "json";
/// 지금 쓰는 파일 판. 없으면 1 로 본다(사람이 손으로 만든 파일). 이보다 크면 모르는 판이라 건너뛴다.
const VERSION: u32 = 1;
/// id 길이 상한(슬러그 + 접미사).
const MAX_ID: usize = 48;
/// 이름 글자 수 상한.
pub(crate) const MAX_NAME: usize = 64;
/// 한 파일의 바이트 상한 — 21색 한 벌은 1KB 남짓이다.
const MAX_FILE_BYTES: u64 = 16 * 1024;
/// 쌓아 둘 수 있는 테마 수.
pub(crate) const MAX_THEMES: usize = 200;

/// 21칸 — xterm `ITheme` 의 이름 그대로(camelCase). 프런트 `theme.ts` 의 `TERM_COLOR_KEYS` 와 같은 칸.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Colors {
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub cursor_accent: String,
    pub selection_background: String,
    pub black: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub magenta: String,
    pub cyan: String,
    pub white: String,
    pub bright_black: String,
    pub bright_red: String,
    pub bright_green: String,
    pub bright_yellow: String,
    pub bright_blue: String,
    pub bright_magenta: String,
    pub bright_cyan: String,
    pub bright_white: String,
}

impl Colors {
    fn fields_mut(&mut self) -> [&mut String; 21] {
        [
            &mut self.background,
            &mut self.foreground,
            &mut self.cursor,
            &mut self.cursor_accent,
            &mut self.selection_background,
            &mut self.black,
            &mut self.red,
            &mut self.green,
            &mut self.yellow,
            &mut self.blue,
            &mut self.magenta,
            &mut self.cyan,
            &mut self.white,
            &mut self.bright_black,
            &mut self.bright_red,
            &mut self.bright_green,
            &mut self.bright_yellow,
            &mut self.bright_blue,
            &mut self.bright_magenta,
            &mut self.bright_cyan,
            &mut self.bright_white,
        ]
    }

    /// 21칸 전부 `#rrggbb` 인가 — 맞으면 소문자로 접은 사본, 아니면 `None`.
    fn normalized(&self) -> Option<Colors> {
        let mut out = self.clone();
        for c in out.fields_mut() {
            *c = hex6(c)?;
        }
        Some(out)
    }
}

/// `#rrggbb`(대소문자 무관) → 소문자. 그 밖은 `None`.
fn hex6(s: &str) -> Option<String> {
    let b = s.as_bytes();
    (b.len() == 7 && b[0] == b'#' && b[1..].iter().all(u8::is_ascii_hexdigit)).then(|| s.to_ascii_lowercase())
}

/// 파일 한 장의 모양.
#[derive(Debug, Serialize, Deserialize)]
struct ThemeFile {
    #[serde(default = "default_version")]
    version: u32,
    name: String,
    colors: Colors,
}

fn default_version() -> u32 {
    VERSION
}

/// 프런트로 가는 한 줄 — id · 이름 · 21색.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TermThemeEntry {
    pub id: String,
    pub name: String,
    pub colors: Colors,
}

/// id 모양인가 — `[a-z0-9]` 로 시작 · `[a-z0-9-]` · 1~[`MAX_ID`]자.
pub(crate) fn is_id(id: &str) -> bool {
    let b = id.as_bytes();
    !b.is_empty()
        && b.len() <= MAX_ID
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter().all(|&c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

/// 이름 다듬기 — 앞뒤 공백을 걷고 1~[`MAX_NAME`]자 · 제어 문자 없음.
fn clean_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(tr!(ko: "테마 이름이 비어 있습니다", en: "The theme name is empty"));
    }
    if name.chars().count() > MAX_NAME {
        return Err(tr!(
            ko: "테마 이름은 {max}자까지입니다",
            en: "The theme name can be at most {max} characters",
            max = MAX_NAME
        ));
    }
    if name.chars().any(char::is_control) {
        return Err(tr!(ko: "테마 이름에 쓸 수 없는 글자가 있습니다", en: "The theme name contains characters that are not allowed"));
    }
    Ok(name.to_string())
}

fn bad_colors() -> String {
    tr!(ko: "색 21칸이 모두 #rrggbb 모양이어야 합니다", en: "All 21 colors must be in #rrggbb form")
}

/// 이름 → 슬러그(ASCII 영숫자만 · 나머지는 `-` 하나로 · 앞뒤 `-` 걷기 · 비면 `theme`). 접미사 자리를 남겨 40자로 자른다.
fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let mut out: String = out.trim_end_matches('-').chars().take(40).collect();
    out.truncate(out.trim_end_matches('-').len());
    if out.is_empty() {
        "theme".to_string()
    } else {
        out
    }
}

fn file_name(id: &str) -> String {
    format!("{id}.{EXT}")
}

/// 파일 이름 → id(우리 모양일 때만).
fn id_of_file(name: &str) -> Option<&str> {
    let id = name.strip_suffix(EXT)?.strip_suffix('.')?;
    is_id(id).then_some(id)
}

/// `<설정 루트>/terminal-themes` — 개발 빌드는 `aynx-dev` 쪽이다(`instance`).
fn dir() -> Result<PathBuf, String> {
    crate::instance::config_root()
        .map(|root| root.join(DIR_NAME))
        .ok_or_else(|| tr!(ko: "앱 설정 폴더를 찾을 수 없습니다", en: "The app settings folder is unavailable"))
}

/// 한 장 읽기 — 크기 상한 · JSON · 판 · 이름 · 색을 모두 본다. 하나라도 틀리면 `None`(건너뛴다).
fn read_entry(dir: &Path, id: &str) -> Option<TermThemeEntry> {
    let path = dir.join(file_name(id));
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return None;
    }
    let text = std::fs::read_to_string(&path).ok()?;
    let file: ThemeFile = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    if file.version == 0 || file.version > VERSION {
        return None;
    }
    let name = clean_name(&file.name).ok()?;
    let colors = file.colors.normalized()?;
    Some(TermThemeEntry { id: id.to_string(), name, colors })
}

/// 폴더 안의 id 들(우리 모양의 파일 이름만 · 정렬).
fn ids_at(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new(); // 폴더 없음 = 아직 하나도 없다
    };
    let mut ids: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_str().and_then(id_of_file).map(str::to_owned))
        .collect();
    ids.sort();
    ids
}

/// 목록 — 깨진 파일은 건너뛰고 이름순(대소문자 무시) · 같으면 id 순.
pub(crate) fn list_at(dir: &Path) -> Vec<TermThemeEntry> {
    let mut list: Vec<TermThemeEntry> = ids_at(dir).iter().filter_map(|id| read_entry(dir, id)).collect();
    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.id.cmp(&b.id)));
    list
}

fn write_entry(dir: &Path, entry: &TermThemeEntry) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| {
        tr!(ko: "{dir} 폴더를 만들지 못했습니다: {e}", en: "Could not create the folder {dir}: {e}", dir = dir.display())
    })?;
    let file = ThemeFile { version: VERSION, name: entry.name.clone(), colors: entry.colors.clone() };
    let mut json = serde_json::to_string_pretty(&file)
        .map_err(|e| tr!(ko: "테마를 직렬화하지 못했습니다: {e}", en: "Could not serialize the theme: {e}"))?;
    json.push('\n');
    let path = dir.join(file_name(&entry.id));
    crate::fs_atomic::write_atomic(&path, json.as_bytes())
        .map_err(|e| tr!(ko: "{path} 를 쓰지 못했습니다: {e}", en: "Could not write {path}: {e}", path = path.display()))
}

/// 새 테마 넣기 — 검증 · 새 id(슬러그 + 겹치면 접미사) · 원자 쓰기.
pub(crate) fn add_at(dir: &Path, name: &str, colors: &Colors) -> Result<TermThemeEntry, String> {
    let name = clean_name(name)?;
    let colors = colors.normalized().ok_or_else(bad_colors)?;
    let taken = ids_at(dir);
    if taken.len() >= MAX_THEMES {
        return Err(tr!(
            ko: "내 테마는 {max}개까지 둘 수 있습니다 — 하나를 지우고 넣으세요",
            en: "You can keep up to {max} custom themes — remove one first",
            max = MAX_THEMES
        ));
    }
    let base = slug(&name);
    let id = (1..)
        .map(|n| if n == 1 { base.clone() } else { format!("{base}-{n}") })
        .find(|id| !taken.contains(id) && !dir.join(file_name(id)).exists())
        .expect("끝없는 접미사 중 하나는 비어 있다");
    debug_assert!(is_id(&id));
    let entry = TermThemeEntry { id, name, colors };
    write_entry(dir, &entry)?;
    Ok(entry)
}

fn not_found() -> String {
    tr!(ko: "그 테마를 찾을 수 없습니다", en: "That theme was not found")
}

fn bad_id() -> String {
    tr!(ko: "테마 id 가 올바르지 않습니다", en: "The theme id is not valid")
}

/// 이름 바꾸기 — id 는 그대로 · 색은 읽은 그대로(검증을 지난 것) 다시 쓴다.
pub(crate) fn rename_at(dir: &Path, id: &str, name: &str) -> Result<TermThemeEntry, String> {
    if !is_id(id) {
        return Err(bad_id());
    }
    let name = clean_name(name)?;
    let mut entry = read_entry(dir, id).ok_or_else(not_found)?;
    entry.name = name;
    write_entry(dir, &entry)?;
    Ok(entry)
}

/// 지우기 — 파일 하나. 이미 없으면 그대로 성공(다른 창이 먼저 지웠다).
pub(crate) fn remove_at(dir: &Path, id: &str) -> Result<(), String> {
    if !is_id(id) {
        return Err(bad_id());
    }
    match std::fs::remove_file(dir.join(file_name(id))) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(tr!(ko: "테마를 지우지 못했습니다: {e}", en: "Could not remove the theme: {e}")),
    }
}

fn blocking_err(e: impl std::fmt::Display) -> String {
    tr!(ko: "터미널 테마 작업이 실패했습니다: {e}", en: "The terminal theme task failed: {e}")
}

// ---------------------------------------------------------------------------
// 명령 — 넷 다 async + spawn_blocking (디스크)
// ---------------------------------------------------------------------------

/// 내 테마 목록(깨진 파일은 건너뛴다).
#[tauri::command]
pub async fn term_theme_list() -> Result<Vec<TermThemeEntry>, String> {
    let dir = dir()?;
    tauri::async_runtime::spawn_blocking(move || list_at(&dir)).await.map_err(blocking_err)
}

/// 가져온 테마 하나를 넣는다 — 프런트가 해석 · 채운 21색과 이름. 여기서 다시 검증한다.
#[tauri::command]
pub async fn term_theme_add(name: String, colors: Colors) -> Result<TermThemeEntry, String> {
    let dir = dir()?;
    tauri::async_runtime::spawn_blocking(move || add_at(&dir, &name, &colors)).await.map_err(blocking_err)?
}

/// 이름 바꾸기(id 는 그대로).
#[tauri::command]
pub async fn term_theme_rename(id: String, name: String) -> Result<TermThemeEntry, String> {
    let dir = dir()?;
    tauri::async_runtime::spawn_blocking(move || rename_at(&dir, &id, &name)).await.map_err(blocking_err)?
}

/// 지우기 — 그 테마를 쓰던 설정을 기본으로 돌리는 것은 프런트다(설정 저장과 한 길).
#[tauri::command]
pub async fn term_theme_remove(id: String) -> Result<(), String> {
    let dir = dir()?;
    tauri::async_runtime::spawn_blocking(move || remove_at(&dir, &id)).await.map_err(blocking_err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!("aynx-터미널테마-{tag}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn colors() -> Colors {
        let c = |s: &str| s.to_string();
        Colors {
            background: c("#1A1B26"),
            foreground: c("#c0caf5"),
            cursor: c("#c0caf5"),
            cursor_accent: c("#1a1b26"),
            selection_background: c("#283457"),
            black: c("#15161e"),
            red: c("#f7768e"),
            green: c("#9ece6a"),
            yellow: c("#e0af68"),
            blue: c("#7aa2f7"),
            magenta: c("#bb9af7"),
            cyan: c("#7dcfff"),
            white: c("#a9b1d6"),
            bright_black: c("#414868"),
            bright_red: c("#f7768e"),
            bright_green: c("#9ece6a"),
            bright_yellow: c("#e0af68"),
            bright_blue: c("#7aa2f7"),
            bright_magenta: c("#bb9af7"),
            bright_cyan: c("#7dcfff"),
            bright_white: c("#c0caf5"),
        }
    }

    #[test]
    fn id_shape_blocks_path_tricks() {
        for ok in ["a", "tokyo-night", "0x", "theme-2"] {
            assert!(is_id(ok), "{ok}");
        }
        for bad in ["", "-a", "A", "a.b", "../x", "a/b", "a\\b", "a b", &"a".repeat(MAX_ID + 1)] {
            assert!(!is_id(bad), "{bad}");
        }
    }

    #[test]
    fn slug_keeps_ascii_and_falls_back() {
        assert_eq!(slug("Tokyo Night"), "tokyo-night");
        assert_eq!(slug("  Dracula+ (Pro) "), "dracula-pro");
        assert_eq!(slug("내 테마"), "theme");
        assert_eq!(slug("../../etc"), "etc");
        assert!(slug(&"x".repeat(100)).len() <= 40);
    }

    #[test]
    fn add_validates_normalizes_and_suffixes() {
        let tmp = TempDir::new("add");
        let a = add_at(&tmp.0, " Tokyo Night ", &colors()).unwrap();
        assert_eq!(a.id, "tokyo-night");
        assert_eq!(a.name, "Tokyo Night");
        assert_eq!(a.colors.background, "#1a1b26", "소문자로 접는다");
        let b = add_at(&tmp.0, "Tokyo Night", &colors()).unwrap();
        assert_eq!(b.id, "tokyo-night-2");
        let list = list_at(&tmp.0);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0], a);

        let mut bad = colors();
        bad.red = "red".into();
        assert!(add_at(&tmp.0, "x", &bad).is_err());
        bad.red = "#fff".into();
        assert!(add_at(&tmp.0, "x", &bad).is_err());
        assert!(add_at(&tmp.0, "   ", &colors()).is_err());
        assert!(add_at(&tmp.0, &"가".repeat(MAX_NAME + 1), &colors()).is_err());
        assert!(add_at(&tmp.0, "a\u{7}b", &colors()).is_err());
        assert!(add_at(&tmp.0, &"가".repeat(MAX_NAME), &colors()).is_ok());
    }

    #[test]
    fn list_skips_broken_and_foreign_files() {
        let tmp = TempDir::new("list");
        add_at(&tmp.0, "Good", &colors()).unwrap();
        let write = |name: &str, body: &str| std::fs::write(tmp.0.join(name), body).unwrap();
        write("broken.json", "{ not json");
        write("missing.json", r##"{"name":"x","colors":{"background":"#000000"}}"##);
        write("future.json", &format!(r#"{{"version":9,"name":"x","colors":{}}}"#, serde_json::to_string(&colors()).unwrap()));
        write("Upper.json", &format!(r#"{{"name":"x","colors":{}}}"#, serde_json::to_string(&colors()).unwrap()));
        write("notes.txt", "hello");
        write("huge.json", &" ".repeat(MAX_FILE_BYTES as usize + 1));
        // 손으로 넣은 판 없는 파일(BOM 포함)은 뜬다.
        write("hand.json", &format!("\u{feff}{{\"name\":\"Hand\",\"colors\":{}}}", serde_json::to_string(&colors()).unwrap()));
        let names: Vec<String> = list_at(&tmp.0).into_iter().map(|e| e.id).collect();
        assert_eq!(names, vec!["good", "hand"]);
    }

    #[test]
    fn rename_keeps_id_and_remove_is_idempotent() {
        let tmp = TempDir::new("rename");
        let a = add_at(&tmp.0, "One", &colors()).unwrap();
        let r = rename_at(&tmp.0, &a.id, "Two").unwrap();
        assert_eq!(r.id, a.id);
        assert_eq!(r.name, "Two");
        assert_eq!(list_at(&tmp.0)[0].name, "Two");
        assert!(rename_at(&tmp.0, "nope", "x").is_err());
        assert!(rename_at(&tmp.0, "../one", "x").is_err());
        remove_at(&tmp.0, &a.id).unwrap();
        remove_at(&tmp.0, &a.id).unwrap();
        assert!(list_at(&tmp.0).is_empty());
        assert!(remove_at(&tmp.0, "..").is_err());
    }

    #[test]
    fn add_refuses_past_the_cap() {
        let tmp = TempDir::new("cap");
        for i in 0..MAX_THEMES {
            std::fs::write(tmp.0.join(format!("t{i}.json")), "{}").unwrap();
        }
        assert!(add_at(&tmp.0, "more", &colors()).is_err());
    }
}

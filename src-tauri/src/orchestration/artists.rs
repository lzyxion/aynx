//! **아티스트 목록** — 실행 권한 없는 전역 프로필(앨범 먼저 설계 2-1 · S1).
//! GUI 명령만 파일을 통째로 쓰고, 세션 서버는 [`load_artists`] 로 지금 프로필을 읽는다.
//! 손 편집의 모르는 칸은 버리고, 꼴이 틀린 아티스트만 제외한다(`role-invalid` 와 같은 좁은 쪽).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::orchestration::config::{
    effort_ok, model_ok, new_role_id, RoleCli, RoleKind, INSTRUCTIONS_MAX, NAME_MAX,
};

const FILE_NAME: &str = "orchestration-artists.toml";
const ARTISTS_MAX: usize = 32;
const CHANGED: &str = "orchestration-artists-changed";
const HEADER: &str = "# orchestration-artists.toml — 오케스트레이션 아티스트 (aynx 전용)\n# 오케스트레이션 탭이 통째로 다시 씁니다(손으로 적은 주석은 남지 않습니다).\n\n";

/// 권한 · 허용 명령 · 한도는 이 타입에도 파일 해석에도 없다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Artist {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub cli: RoleCli,
    pub kind: RoleKind,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub instructions: String,
}

pub(crate) type Artists = Vec<Artist>;

/// id 없이 만들고, 이미 있는 id 로만 고친다. 종류 · CLI 누락은 역직렬화에서 거절한다.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ArtistInput {
    pub id: Option<String>,
    pub name: String,
    pub icon: String,
    pub cli: RoleCli,
    pub kind: RoleKind,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub instructions: String,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct FileRaw {
    artist: Vec<toml::Value>,
}

pub(crate) fn id_ok(id: &str) -> bool {
    id.len() == 10
        && id.starts_with("a-")
        && id[2..]
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// 앱 내장 낱말 + Codex. `user:<12hex>` 는 앱의 `user-<12hex>` 해시 규칙을 따른다(경로는 받지 않는다).
fn icon_ok(icon: &str) -> bool {
    if let Some(id) = icon.strip_prefix("user:") {
        let app_id = format!("user-{id}");
        return crate::app_icon::normalize(Some(&app_id)) == app_id;
    }
    icon == "codex"
        || (!icon.starts_with("user-") && crate::app_icon::normalize(Some(icon)) == icon)
}

fn validate(artist: &mut Artist) -> Result<(), String> {
    artist.name = artist.name.trim().to_owned();
    artist.icon = artist.icon.trim().to_owned();
    artist.model = artist.model.trim().to_owned();
    artist.effort = artist.effort.trim().to_owned();
    if artist.name.is_empty()
        || artist.name.chars().count() > NAME_MAX
        || artist.name.chars().any(char::is_control)
    {
        return Err(format!(
            "아티스트 이름은 1~{NAME_MAX}자(줄바꿈 없음)여야 합니다"
        ));
    }
    if !icon_ok(&artist.icon) {
        return Err("아티스트 아이콘 낱말이 올바르지 않습니다".into());
    }
    if !model_ok(&artist.model) || !effort_ok(artist.cli, &artist.effort) {
        return Err("아티스트 모델 또는 CLI별 강도가 올바르지 않습니다".into());
    }
    if artist.instructions.len() > INSTRUCTIONS_MAX || artist.instructions.contains('\0') {
        return Err("아티스트 지침은 4 KiB까지이며 NUL을 넣을 수 없습니다".into());
    }
    Ok(())
}

fn parse_artists(text: &str) -> Result<Artists, String> {
    let file: FileRaw =
        toml::from_str(text).map_err(|e| format!("아티스트 파일 해석 실패: {e}"))?;
    let mut artists: Artists = Vec::new();
    for value in file.artist {
        let Ok(mut artist) = value.try_into::<Artist>() else {
            continue;
        };
        if !id_ok(&artist.id)
            || validate(&mut artist).is_err()
            || artists
                .iter()
                .any(|a| a.id == artist.id || a.name.to_lowercase() == artist.name.to_lowercase())
        {
            continue;
        }
        if artists.len() == ARTISTS_MAX {
            break;
        }
        artists.push(artist);
    }
    Ok(artists)
}

/// 세션 서버용 읽기 전용 함수 — 잠금 밖에서 부른다. 파일이 없으면 빈 목록이며 씨앗은 GUI만 쓴다.
pub(crate) fn load_artists(config_root: &Path) -> Result<Artists, String> {
    let path = config_root.join(FILE_NAME);
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_artists(&text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("{} 읽기 실패: {e}", path.display())),
    }
}

fn new_artist_id(artists: &[Artist]) -> String {
    loop {
        // 기존 역할 id 의 뽑기만 재사용한다 — 아티스트는 별도 이름 공간이다.
        let id = format!("a-{}", &new_role_id(&[])[2..]);
        if !artists.iter().any(|a| a.id == id) {
            return id;
        }
    }
}

fn upsert_artist(artists: &mut Artists, input: ArtistInput) -> Result<Artist, String> {
    let old = match input.id.as_deref() {
        Some(id) => Some(
            artists
                .iter()
                .position(|a| a.id == id)
                .ok_or("모르는 아티스트입니다 — 화면을 다시 읽고 저장하세요")?,
        ),
        None => None,
    };
    if let Some(i) = old {
        if artists[i].kind != input.kind {
            return Err("아티스트 종류는 만든 뒤 바꿀 수 없습니다".into());
        }
    } else if artists.len() >= ARTISTS_MAX {
        return Err(format!("아티스트는 {ARTISTS_MAX}명까지입니다"));
    }
    let mut artist = Artist {
        id: old.map_or_else(|| new_artist_id(artists), |i| artists[i].id.clone()),
        name: input.name,
        icon: input.icon,
        cli: input.cli,
        kind: input.kind,
        model: input.model,
        effort: input.effort,
        instructions: input.instructions,
    };
    validate(&mut artist)?;
    if artists
        .iter()
        .any(|a| a.id != artist.id && a.name.to_lowercase() == artist.name.to_lowercase())
    {
        return Err(format!(
            "아티스트 이름 '{}' 이(가) 이미 있습니다",
            artist.name
        ));
    }
    match old {
        Some(i) => artists[i] = artist.clone(),
        None => artists.push(artist.clone()),
    }
    Ok(artist)
}

fn write_artists(config_root: &Path, artists: &[Artist]) -> Result<(), String> {
    #[derive(Serialize)]
    struct FileOut<'a> {
        artist: &'a [Artist],
    }
    let path = config_root.join(FILE_NAME);
    let body = toml::to_string(&FileOut { artist: artists })
        .map_err(|e| format!("아티스트 파일 직렬화 실패: {e}"))?;
    let before = std::fs::read_to_string(&path).unwrap_or_default();
    let text = crate::sessions_meta::match_line_endings(&before, format!("{HEADER}{body}"));
    std::fs::create_dir_all(config_root).map_err(|e| format!("설정 폴더 만들기 실패: {e}"))?;
    crate::fs_atomic::replace_through_link(&path, text.as_bytes())
        .map_err(|e| format!("{} 쓰기 실패: {e}", path.display()))
}

/// 파일이 없을 때만 처음 한 번. 호출자는 아티스트 파일 잠금을 쥔다.
fn seed_if_missing(config_root: &Path) -> Result<bool, String> {
    match std::fs::metadata(config_root.join(FILE_NAME)) {
        Ok(_) => return Ok(false),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("아티스트 파일 확인 실패: {e}")),
    }
    let mut artists = Vec::new();
    for (name, icon, cli, kind) in [
        ("Builder", "claude", RoleCli::Claude, RoleKind::Write),
        ("Reviewer", "codex", RoleCli::Codex, RoleKind::Judge),
    ] {
        upsert_artist(
            &mut artists,
            ArtistInput {
                id: None,
                name: name.into(),
                icon: icon.into(),
                cli,
                kind,
                model: String::new(),
                effort: String::new(),
                instructions: String::new(),
            },
        )?;
    }
    write_artists(config_root, &artists)?;
    Ok(true)
}

/// 산 앨범(running · paused · stopping)의 멤버 검사(`artist-in-use{runIds}`)를 파일 쓰기 전에 거친다.
fn remove_artist(
    artists: &mut Artists,
    id: &str,
    check_unused: impl FnOnce(&str) -> Result<(), String>,
) -> Result<bool, String> {
    let Some(i) = artists.iter().position(|a| a.id == id) else {
        return Ok(false);
    };
    check_unused(id)?;
    artists.remove(i);
    Ok(true)
}

fn config_root() -> Result<PathBuf, String> {
    crate::instance::config_root().ok_or_else(|| "설정 폴더를 찾을 수 없습니다".into())
}

fn announce_on_ok<T>(app: &tauri::AppHandle, out: Result<T, String>) -> Result<T, String> {
    if out.is_ok() {
        let _ = app.emit(CHANGED, ());
    }
    out
}

/// 목록 읽기(원격 ALLOW). 씨앗을 썼을 때만 변경을 알린다 — 목록 재조회가 이벤트를 되풀이하지 않게.
#[tauri::command]
pub async fn orchestration_artist_list(app: tauri::AppHandle) -> Result<Artists, String> {
    let (artists, seeded) = tauri::async_runtime::spawn_blocking(|| {
        let root = config_root()?;
        crate::worktree::with_file_lock(&root.join(FILE_NAME), || {
            let seeded = seed_if_missing(&root)?;
            Ok((load_artists(&root)?, seeded))
        })
    })
    .await
    .map_err(|e| format!("아티스트 목록 작업 실패: {e}"))??;
    if seeded {
        let _ = app.emit(CHANGED, ());
    }
    Ok(artists)
}

/// 프로필 만들기 · 고치기(원격 ALLOW — 권한 없음). 종류는 고정이고 CLI는 바꿀 수 있다.
#[tauri::command]
pub async fn orchestration_artist_set(
    app: tauri::AppHandle,
    input: ArtistInput,
) -> Result<Artist, String> {
    let out = tauri::async_runtime::spawn_blocking(move || {
        let root = config_root()?;
        crate::worktree::with_file_lock(&root.join(FILE_NAME), || {
            seed_if_missing(&root)?;
            let mut artists = load_artists(&root)?;
            let artist = upsert_artist(&mut artists, input)?;
            write_artists(&root, &artists)?;
            Ok(artist)
        })
    })
    .await
    .map_err(|e| format!("아티스트 저장 작업 실패: {e}"))?;
    announce_on_ok(&app, out)
}

/// 프로필 지우기(원격 ALLOW). 지웠으면 `true`.
#[tauri::command]
pub async fn orchestration_artist_remove(
    app: tauri::AppHandle,
    id: String,
) -> Result<bool, String> {
    let out = crate::server::client::request(crate::server::ipc::Grade::Write, "orchestration_artist_remove", serde_json::json!({"id": id}))
        .await.map_err(crate::server::ai_proxy::wire_message)
        .and_then(|v| v.as_bool().ok_or_else(|| "아티스트 삭제 응답이 올바르지 않습니다".into()));
    announce_on_ok(&app, out)
}

/// 세션 서버에서만 지운다. 시작 op와 직렬화한 뒤 파일 잠금 안에서 산 앨범 훅을 검사한다.
pub(crate) fn remove_on_server(id: &str, check_unused: impl FnOnce(&str) -> Result<(), String>) -> Result<bool, String> {
    let root = config_root()?;
    crate::worktree::with_file_lock(&root.join(FILE_NAME), || {
        seed_if_missing(&root)?;
        let mut artists = load_artists(&root)?;
        let removed = remove_artist(&mut artists, id, check_unused)?;
        if removed {
            write_artists(&root, &artists)?;
        }
        Ok(removed)
    })
}

#[cfg(test)]
#[path = "artists_tests.rs"]
mod tests;

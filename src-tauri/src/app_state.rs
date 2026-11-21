//! 앱 소유 JSON 의 공용 원자적 읽기 · 쓰기와 theme-profiles 명령. 모든 JSON 저장소가 이 한 벌(임시 파일 + rename · 같은
//! 바이트면 생략)을 지난다 — 파일마다 저장 규칙이 갈리지 않게.

use std::path::{Path, PathBuf};

use crate::i18n::tr;

/// 이름 붙여 저장한 모양 프로필 목록(docs/log/2026-09-15-theme-profiles.md). `settings.toml` 에 넣지 않는다 — 저기는 "지금 쓰는
/// 값" 한 벌이고 여기는 "아껴 둔 여러 벌" 이다.
pub(crate) fn theme_profiles_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("theme-profiles.json"))
}

/// 파일 없음은 `Ok(None)`(첫 실행) — 파일이 있는데 못 읽는 것만 `Err` 다. 내용은 검사하지 않는다(스키마는 프런트가 본다).
pub(crate) fn load_at(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(
            tr!(ko: "{path} 를 읽지 못했습니다: {e}", en: "Could not read {path}: {e}", path = path.display()),
        ),
    }
}

/// 이미 같은 내용이면 쓰지 않는다 — `bool` 은 "실제로 썼는가". 임시 파일 이름의 pid 는 두 프로세스가 동시에 저장해도 서로의
/// 임시 파일을 덮지 않게 한다.
pub(crate) fn save_at(path: &Path, json: &str) -> Result<bool, String> {
    if json.trim().is_empty() {
        return Err(
            tr!(ko: "저장할 배치 정보가 비어 있습니다", en: "There is no layout information to save"),
        );
    }

    if load_at(path)?.as_deref() == Some(json) {
        return Ok(false);
    }

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| tr!(ko: "{dir} 폴더를 만들지 못했습니다: {e}", en: "Could not create the folder {dir}: {e}", dir = dir.display()))?;
    }

    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, json)
        .map_err(|e| tr!(ko: "{tmp} 임시 파일을 쓰지 못했습니다: {e}", en: "Could not write the temporary file {tmp}: {e}", tmp = tmp.display()))?;

    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        tr!(ko: "{path} 저장에 실패했습니다: {e}", en: "Could not save {path}: {e}", path = path.display())
    })?;

    Ok(true)
}

pub(crate) fn missing_dir() -> String {
    tr!(ko: "설정 디렉터리를 찾을 수 없습니다", en: "Could not find the settings folder")
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn load_theme_profiles() -> Result<Option<String>, String> {
    let path = theme_profiles_path().ok_or_else(missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || load_at(&path))
        .await
        .map_err(|e| tr!(ko: "테마 프로필을 읽는 작업이 실패했습니다: {e}", en: "The task that reads the theme profiles failed: {e}"))?
}

// ---------------------------------------------------------------------------
// 모양 프로필 — 조작 단위 쓰기
// ---------------------------------------------------------------------------
//
// 목록을 통째로 쓰지 않는다 — 창이 여럿이면 다른 창의 변경을 옛 사본으로 덮는다. 잠금 아래에서 디스크의 최신을 읽고 조작 하나만 얹는다.
// 백엔드는 `id` · `name` 만 안다 — 나머지 칸은 프런트가 만든 값을 그대로 담는다(검사는 프런트 `parseProfiles`).

/// 모양 프로필 조작 하나 — 프런트 `theme-profiles.svelte.ts` 가 만든다.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub(crate) enum ProfileOp {
    Put { profile: serde_json::Value, max: usize, activate: bool },
    /// 그 프로필의 시작 화면 칸(`startBoard`)만.
    Board { id: String, board: serde_json::Value },
    Remove { id: String },
    Rename { id: String, name: String },
    Activate { id: Option<String> },
}

const PROFILE_FILE_VERSION: u64 = 1;

fn profile_doc(raw: Option<&str>) -> serde_json::Value {
    let fresh = || serde_json::json!({ "version": PROFILE_FILE_VERSION, "active": null, "profiles": [] });
    let Some(raw) = raw else { return fresh() };
    match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(v) if v.get("version").and_then(|x| x.as_u64()) == Some(PROFILE_FILE_VERSION)
            && v.get("profiles").map(|p| p.is_array()).unwrap_or(false) =>
        {
            v
        }
        _ => fresh(),
    }
}

fn profile_id(p: &serde_json::Value) -> Option<&str> {
    p.get("id").and_then(|v| v.as_str())
}

fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

pub(crate) fn apply_profile_op(doc: &mut serde_json::Value, op: ProfileOp) -> Result<bool, String> {
    let before = doc.clone();
    let active = doc.get("active").and_then(|v| v.as_str()).map(str::to_owned);
    let Some(list) = doc.get_mut("profiles").and_then(|v| v.as_array_mut()) else {
        return Err("profiles 가 목록이 아닙니다".into());
    };
    let mut next_active = active.clone();
    match op {
        ProfileOp::Put { profile, max, activate } => {
            let Some(id) = profile_id(&profile).map(str::to_owned) else {
                return Err(tr!(ko: "저장할 프로필에 id 가 없습니다", en: "The profile to save has no id"));
            };
            list.retain(|p| profile_id(p) != Some(id.as_str()));
            list.insert(0, profile);
            list.truncate(max.max(1));
            if activate {
                next_active = Some(id);
            }
        }
        ProfileOp::Board { id, board } => {
            if let Some(obj) = list.iter_mut().find(|p| profile_id(p) == Some(id.as_str())).and_then(|p| p.as_object_mut()) {
                obj.insert("startBoard".into(), board);
            }
        }
        ProfileOp::Remove { id } => {
            list.retain(|p| profile_id(p) != Some(id.as_str()));
            if active.as_deref() == Some(id.as_str()) {
                next_active = None;
            }
        }
        ProfileOp::Rename { id, name } => {
            let clean = name.trim().to_string();
            let key = name_key(&clean);
            let clash = list.iter().any(|p| {
                profile_id(p) != Some(id.as_str()) && p.get("name").and_then(|n| n.as_str()).map(name_key).as_deref() == Some(key.as_str())
            });
            if !clean.is_empty() && !clash {
                if let Some(obj) = list.iter_mut().find(|p| profile_id(p) == Some(id.as_str())).and_then(|p| p.as_object_mut()) {
                    obj.insert("name".into(), serde_json::Value::String(clean));
                }
            }
        }
        ProfileOp::Activate { id } => next_active = id,
    }
    // 프런트 `serializeProfiles` 와 같은 판정
    if let Some(a) = next_active.as_deref() {
        if !list.iter().any(|p| profile_id(p) == Some(a)) {
            next_active = None;
        }
    }
    doc["active"] = next_active.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null);
    Ok(*doc != before)
}

static PROFILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn edit_profiles_at(path: &Path, op: ProfileOp) -> Result<(String, bool), String> {
    let _guard = PROFILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    crate::worktree::with_file_lock(path, || {
        let raw = load_at(path)?;
        let mut doc = profile_doc(raw.as_deref());
        let changed = apply_profile_op(&mut doc, op)?;
        let json = serde_json::to_string(&doc).map_err(|e| e.to_string())?;
        if changed || raw.is_none() {
            save_at(path, &json)?;
        }
        Ok((json, changed))
    })
}

#[tauri::command]
pub async fn theme_profiles_edit(app: tauri::AppHandle, op: ProfileOp) -> Result<String, String> {
    use tauri::Emitter;
    let path = theme_profiles_path().ok_or_else(missing_dir)?;
    let (json, changed) = tauri::async_runtime::spawn_blocking(move || edit_profiles_at(&path, op))
        .await
        .map_err(|e| tr!(ko: "테마 프로필을 쓰는 작업이 실패했습니다: {e}", en: "The task that writes the theme profiles failed: {e}"))??;
    if changed {
        let _ = app.emit("theme-profiles-changed", ());
    }
    Ok(json)
}

#[cfg(test)]
mod tests;

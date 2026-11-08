//! 앱 소유 JSON의 공용 원자적 읽기·쓰기와 theme-profiles 명령.
//! 워크스페이스 스키마·저장은 workspaces 모듈, 구형 파일 읽기는 workspaces/migrate.rs 몫이다.
//! 임시 파일 + rename, 같은 바이트면 쓰기 생략 규칙은 모든 JSON 저장소가 공유한다.

use std::path::{Path, PathBuf};

use crate::i18n::tr;

/// `<config_dir>/aynx/theme-profiles.json` — **이름 붙여 저장한 모양 프로필** 목록
/// (docs/log/2026-09-15-theme-profiles.md).
///
/// 담기는 것은 설정의 **앱 테마 섹션 한 벌**(월페이퍼·모드·색과 투명도·탭/상태바/타일 헤더
/// 모양 + `[terminal] theme` 과 동적 팔레트)의 스냅숏이다. `layouts.json` 과 완전히 같은
/// 관례다 — 불투명 blob, 원자적 쓰기, `clear_*` 없음.
///
/// **왜 `settings.toml` 이 아닌가**: 저기는 "지금 쓰는 값" 한 벌이고 여기는 "아껴 둔 여러
/// 벌" 이다 (`workspaces.json` ↔ `layouts.json` 과 정확히 같은 수명 차이). 한 파일이었다면
/// 손으로 설정을 고치는 사람이 자기 취향 보관함까지 함께 들여다보게 되고, 프로필 하나를
/// 고치는 저장이 `settings.toml` 전체 재작성이 된다.
pub(crate) fn theme_profiles_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("theme-profiles.json"))
}

/// 경로 하나를 읽는다. **파일 없음은 오류가 아니라 `Ok(None)`** 이다(첫 실행 = 저장된 배치 없음).
///
/// 그 외 실패(권한·깨진 경로)만 `Err` 로 올린다 — 파일이 있는데 못 읽는 것은 사용자가 알아야
/// 할 사고다. 내용은 검사하지 않고 문자열 그대로 돌려준다(모듈 문서의 "백엔드는 스키마를 모른다").
///
/// `pub(crate)` 인 이유: [`crate::snippets`] 도 **같은 헬퍼**를 쓴다 (모듈 문서의 "세 파일
/// 모두 같은 헬퍼를 지난다" 를 네 번째 파일까지 넓힌 것이다 — 원자적 쓰기와 무변경 생략이
/// 한 벌뿐이어야 파일마다 저장 규칙이 갈릴 수 없다).
pub(crate) fn load_at(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(
            tr!(ko: "{path} 를 읽지 못했습니다: {e}", en: "Could not read {path}: {e}", path = path.display()),
        ),
    }
}

/// 경로 하나에 원자적으로 쓴다. **이미 같은 내용이면 아무것도 하지 않는다.**
///
/// 돌려주는 `bool` 은 "실제로 디스크에 썼는가" 다 — 무변경 생략이 도는지 테스트가 볼 수 있게
/// 내보낸다(명령 쪽에서는 버린다. 프런트에 알릴 필요가 없다).
///
/// 임시 파일 이름에 pid 를 넣는 것은 두 창(= 두 프로세스)이 동시에 저장해도 서로의 임시
/// 파일을 덮지 않게 하려는 것이다. `rename` 은 두 OS 모두 원자적이고 대상이 있어도 갈아친다.
/// (`load_at` 과 같은 이유로 `pub(crate)` — [`crate::snippets`] 가 이 한 벌을 그대로 쓴다.)
pub(crate) fn save_at(path: &Path, json: &str) -> Result<bool, String> {
    if json.trim().is_empty() {
        return Err(
            tr!(ko: "저장할 배치 정보가 비어 있습니다", en: "There is no layout information to save"),
        );
    }

    // 같은 내용이면 생략 — 디바운스 틱마다 SSD 를 때리지 않는다.
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
        // 갈아치기가 실패하면 임시 파일이 남는다 — 지우고 오류를 올린다.
        let _ = std::fs::remove_file(&tmp);
        tr!(ko: "{path} 저장에 실패했습니다: {e}", en: "Could not save {path}: {e}", path = path.display())
    })?;

    Ok(true)
}

/// 경로를 구하지 못했을 때의 공통 오류. ([`crate::snippets`] 도 같은 문구를 쓴다.)
pub(crate) fn missing_dir() -> String {
    tr!(ko: "설정 디렉터리를 찾을 수 없습니다", en: "Could not find the settings folder")
}

// ---------------------------------------------------------------------------
// 명령 — 셋 다 async + spawn_blocking
// ---------------------------------------------------------------------------
//
// 파일 하나를 읽고 쓰는 것뿐이라 "동기 명령이면 안 되나" 싶지만, 동기 `#[tauri::command]` 은
// **이벤트 루프(메인) 스레드**에서 돈다. 이 앱은 그걸로 이미 한 번 데였다 — `mcp_status` 가
// 동기였을 때 설정 탭이 조회 중에 통째로 멈췄다(mcp.rs 의 같은 대목 참고). 여기 쓰기는 그보다
// 훨씬 싸지만 공짜는 아니고(디스크가 바쁘면 `create_dir_all`·`rename` 이 수십 ms 씩 튄다),
// 무엇보다 **저장이 잦다** — 타일을 끌 때마다 디바운스로 들어온다. 프레임을 떨어뜨릴 여지를
// 남기느니 블로킹 풀로 내보낸다. 비용은 스레드 홉 하나뿐이다.

/// 저장된 **모양 프로필** 목록을 읽는다. 아직 하나도 저장하지 않았으면 `None`.
///
/// `load_layouts` 와 같은 관례다 — 문자열을 그대로 올려 주고 스키마는 프런트가 본다
/// (`src/lib/theme-profiles.ts` 의 `parseProfiles`).
#[tauri::command]
pub async fn load_theme_profiles() -> Result<Option<String>, String> {
    let path = theme_profiles_path().ok_or_else(missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || load_at(&path))
        .await
        .map_err(|e| tr!(ko: "테마 프로필을 읽는 작업이 실패했습니다: {e}", en: "The task that reads the theme profiles failed: {e}"))?
}

// ---------------------------------------------------------------------------
// 모양 프로필 — **조작 단위 쓰기** (2026-11-03)
// ---------------------------------------------------------------------------
//
// 예전엔 창마다 목록 전체를 들고 `save_theme_profiles` 로 파일을 **통째로** 썼다. 창이 여럿이면 창 A 가 쓴 변경(특히 시작 화면
// 배치의 자동 저장 — 잦다)을 창 B 의 다음 통째 쓰기가 B 의 옛 사본으로 덮었다. 이제 쓰기는 **조작 하나**([`ProfileOp`])를 받아
// 이 프로세스의 잠금 + 파일 옆 OS 잠금(`crate::worktree::with_file_lock`) 아래에서 **디스크의 최신을 읽고 → 그 조작만 얹고 →
// 원자 쓰기**([`save_at`])한다. 그래서 다른 창이 고친 프로필 · 칸은 그대로 남는다. 쓴 뒤에는 `theme-profiles-changed` 를 내고
// 창마다 목록을 다시 읽는다(원격 웹 창도 — 원격 JS 의 `listen` 은 Rust 리스너 `listen_any` 로 대신 달린다, `remote/bridge.rs`).
//
// 백엔드가 아는 스키마는 최소다 — 프로필은 `id` · `name` 으로만 찾고, 나머지 칸(`appearance` · `startBoard`)은 프런트가 만든
// 값을 그대로 담는다(검사는 여전히 프런트 `parseProfiles`). 파일이 없거나 · 깨졌거나 · 모르는 판이면 빈 목록에서 시작한다(예전
// 통째 쓰기도 같은 경우 빈 목록으로 덮었다).

/// 모양 프로필 조작 하나 — 프런트 `theme-profiles.svelte.ts` 가 만든다.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub(crate) enum ProfileOp {
    /// 새로 저장 · 덮어쓰기 — 같은 `id` 가 있으면 갈아 끼우고 맨 앞으로, 없으면 앞에 붙인다(`max` 를 넘으면 뒤에서 민다).
    /// `activate` 면 고른 프로필도 그것으로.
    Put { profile: serde_json::Value, max: usize, activate: bool },
    /// 그 프로필의 시작 화면 칸(`startBoard`)만 — 자리 · 저장 시각은 그대로. 없는 id 면 아무 일도 없다.
    Board { id: String, board: serde_json::Value },
    /// 지운다 — 고른 프로필이었으면 고른 것도 비운다.
    Remove { id: String },
    /// 이름만 — 다른 프로필이 이미 쓰는 이름(대소문자 · 앞뒤 공백 무시)이면 아무 일도 없다.
    Rename { id: String, name: String },
    /// 고른 프로필 — 목록에 없는 id 면 비운다.
    Activate { id: Option<String> },
}

const PROFILE_FILE_VERSION: u64 = 1;

/// 파일 글자 → 고칠 문서(없음 · 깨짐 · 모르는 판 = 빈 목록)
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

/// 조작 하나를 문서에 얹는다 — **순수**(시험이 그대로 부른다). 바뀌었으면 `true`.
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
    // 목록에 없는 id 는 고른 것으로 남기지 않는다(프런트 `serializeProfiles` 와 같은 판정)
    if let Some(a) = next_active.as_deref() {
        if !list.iter().any(|p| profile_id(p) == Some(a)) {
            next_active = None;
        }
    }
    doc["active"] = next_active.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null);
    Ok(*doc != before)
}

/// 같은 프로세스 안의 창들(= 같은 GUI) 사이의 잠금 — 파일 옆 OS 잠금과 함께 쥔다(세션 서버 등 다른 프로세스는 이 파일을 쓰지 않지만
/// 곁 파일 쓰기와 같은 모양으로 둔다).
static PROFILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 디스크의 최신을 읽고 조작 하나를 얹어 원자 쓰기 — 돌려주는 것은 (쓴 뒤의 파일 글자, 실제로 바뀌었나)
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

/// 모양 프로필 조작 하나 — 디스크의 최신 위에 얹어 쓰고(창이 여럿이어도 다른 창의 변경을 지우지 않는다), 바뀌었으면
/// `theme-profiles-changed` 를 낸다. 쓴 뒤의 파일 글자를 돌려준다(부른 창은 그것으로 목록을 맞춘다).
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

//! 월페이퍼 — 앱 창 전체의 배경 이미지. 고른 파일 · 올린 바이트 · 랜덤 그림 모두 앱 폴더의 해시 이름 사본으로 건다.
//!
//! - 원본 경로를 저장하지 않고 복사한다 — 원본을 옮기거나 지워도 배경이 남게.
//! - 사본 이름 규칙(`wp-<SHA-1 앞 12자>.<ext>` · 평평 · 원본 이름을 따라가지 않는다 — 경로 조작 길)을 바꾸면 asset 스코프도 같이
//!   바꾼다(`instance::asset_scope`) — 웹뷰에는 이 이름들만 열려 있다. 옛 이름 `wallpaper.<ext>` 는 그대로 읽힌다.
//! - 지우기는 GC 한 곳에서만 — 설정 · 모든 프로필 · 편집 중인 이름 어디에도 없는 사본만. 하나라도 해석하지 못하면 돌지 않는다.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::i18n::tr;

mod random;

/// SVG 는 일부러 뺀다 — 스크립트를 품을 수 있는 문서 형식이다.
const ALLOWED_EXTS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];

/// 디스크가 아니라 메모리 때문이다 — 배경은 창이 떠 있는 내내 디코드된 채 남는다.
const MAX_BYTES: u64 = 50 * 1024 * 1024;

const HASH_PREFIX: &str = "wp-";

const HASH_HEX_LEN: usize = 12;

/// 옛 고정 이름 `wallpaper.<확장자>` — 설정 · 프로필이 아직 가리킬 수 있어 읽기는 남긴다.
const LEGACY_STEM: &str = "wallpaper";

// ── 순수 함수 ──

fn checked_ext(source: &Path) -> Result<String, String> {
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(|| {
            tr!(
                ko: "이미지 파일이 아닙니다: 확장자가 없습니다",
                en: "This is not an image file: it has no extension"
            )
        })?;

    if ALLOWED_EXTS.contains(&ext.as_str()) {
        Ok(ext)
    } else {
        Err(tr!(
            ko: "지원하지 않는 이미지 형식입니다: .{ext} (가능: {list})",
            en: "Unsupported image format: .{ext} (allowed: {list})",
            list = ALLOWED_EXTS.join(", ")
        ))
    }
}

fn human_mb(bytes: u64) -> String {
    format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0))
}

fn checked_size(len: u64) -> Result<(), String> {
    if len == 0 {
        return Err(tr!(
            ko: "이미지가 비어 있습니다 (0바이트)",
            en: "The image is empty (0 bytes)"
        ));
    }
    if len > MAX_BYTES {
        return Err(tr!(
            ko: "이미지가 너무 큽니다: {size} (최대 {max})",
            en: "The image is too large: {size} (maximum {max})",
            size = human_mb(len),
            max = human_mb(MAX_BYTES)
        ));
    }
    Ok(())
}

fn hashed_name(digest_hex: &str, ext: &str) -> String {
    let cut = digest_hex.len().min(HASH_HEX_LEN);
    format!("{HASH_PREFIX}{}.{ext}", &digest_hex[..cut])
}

/// GC 가 손대도 되는 이름 — 같은 폴더에 `settings.toml` · `theme-profiles.json` · 볼트가 함께 산다. 모양이 조금이라도 다르면 우리 것이 아니다.
pub(crate) fn is_managed_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    if !ALLOWED_EXTS.contains(&ext) {
        return false;
    }
    if stem == LEGACY_STEM {
        return true;
    }
    stem.strip_prefix(HASH_PREFIX).is_some_and(|hex| {
        hex.len() == HASH_HEX_LEN
            && hex
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

/// 백엔드는 프로필 안을 들여다보지 않는 분담이라(`app_state.rs`) 이 한 칸만 더듬는다. 모양이 틀리면 `None` — GC 를 건너뛴다.
fn profile_wallpapers(json: &str) -> Option<Vec<String>> {
    let root: serde_json::Value = serde_json::from_str(json).ok()?;
    let list = root.get("profiles")?.as_array()?;
    Some(
        list.iter()
            .filter_map(|p| {
                p.pointer("/appearance/wallpaper/file")?
                    .as_str()
                    .map(str::to_owned)
            })
            .collect(),
    )
}

/// `profiles_json` 이 있는데 해석되지 않으면 `None`(= GC 금지).
fn referenced(
    settings_file: Option<&str>,
    profiles_json: Option<&str>,
    extra: Option<&str>,
) -> Option<HashSet<String>> {
    let mut keep: HashSet<String> = HashSet::new();
    if let Some(json) = profiles_json {
        keep.extend(profile_wallpapers(json)?);
    }
    keep.extend(settings_file.map(str::to_owned));
    keep.extend(extra.map(str::to_owned));
    Some(keep)
}

// ── 실제 일(블로킹) ──

fn dir() -> Result<PathBuf, String> {
    crate::instance::config_root().ok_or_else(
        || tr!(ko: "설정 디렉터리를 찾을 수 없습니다", en: "Could not find the settings folder"),
    )
}

fn file_digest_hex(path: &Path) -> Result<String, String> {
    use sha1::{Digest, Sha1};
    let read_err = |e: std::io::Error| {
        tr!(
            ko: "{what} 를 읽지 못했습니다: {e}",
            en: "Could not read {what}: {e}",
            what = path.display()
        )
    };
    let mut file = std::fs::File::open(path).map_err(read_err)?;
    let mut hasher = Sha1::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(read_err)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex(&hasher.finalize()))
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// [`copy_hashed`] 의 바이트 판 — 임시 이름 → `rename` 인 까닭도 같다.
fn write_hashed(bytes: &[u8], ext: &str, dir: &Path) -> Result<String, String> {
    use sha1::{Digest, Sha1};
    let name = hashed_name(&hex(&Sha1::digest(bytes)), ext);
    let dest = dir.join(&name);
    if dest.is_file() {
        return Ok(name);
    }
    let tmp = dir.join(format!("{name}.{}.tmp", std::process::id()));
    if let Err(e) = std::fs::write(&tmp, bytes).and_then(|_| std::fs::rename(&tmp, &dest)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(tr!(
            ko: "{what} 에 쓰지 못했습니다: {e}",
            en: "Could not write {what}: {e}",
            what = dest.display()
        ));
    }
    Ok(name)
}

/// 임시 이름에 쓰고 `rename` 한다 — 끊기면 반쪽 파일이 해시 이름으로 남아 다음에 "이미 있다" 로 보여 영영 배경이 된다.
fn copy_hashed(source: &Path, ext: &str, dir: &Path) -> Result<String, String> {
    let name = hashed_name(&file_digest_hex(source)?, ext);
    let dest = dir.join(&name);
    if dest.is_file() {
        return Ok(name);
    }
    let tmp = dir.join(format!("{name}.{}.tmp", std::process::id()));
    if let Err(e) = std::fs::copy(source, &tmp).and_then(|_| std::fs::rename(&tmp, &dest)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(tr!(
            ko: "{what} 로 복사하지 못했습니다: {e}",
            en: "Could not copy to {what}: {e}",
            what = dest.display()
        ));
    }
    Ok(name)
}

fn gc_in(dir: &Path, keep: &HashSet<String>) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut removed = Vec::new();
    for entry in entries.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if !is_managed_name(&name) || keep.contains(&name) {
            continue;
        }
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        match std::fs::remove_file(entry.path()) {
            Ok(()) => removed.push(name),
            Err(e) => {
                eprintln!("[aynx] 월페이퍼 사본 {name} 를 지우지 못했습니다 (다음에 다시): {e}")
            }
        }
    }
    removed
}

/// 어느 쪽이든 해석하지 못하면 아무것도 지우지 않는다. `extra` = 편집 중인 설정의 배경 이름 — 지키지 않으면 [저장] 순간 없는 사진을 가리킨다.
fn gc(extra: Option<&str>) {
    let Ok(dir) = dir() else { return };
    let settings_file = match crate::settings::wallpaper_file_checked() {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[aynx] 설정을 해석하지 못해 월페이퍼 정리를 건너뜁니다: {e}");
            return;
        }
    };
    let profiles_json =
        match crate::app_state::theme_profiles_path().map(|p| crate::app_state::load_at(&p)) {
            Some(Ok(json)) => json,
            Some(Err(e)) => {
                eprintln!("[aynx] 테마 프로필을 읽지 못해 월페이퍼 정리를 건너뜁니다: {e}");
                return;
            }
            None => return,
        };
    let Some(keep) = referenced(settings_file.as_deref(), profiles_json.as_deref(), extra) else {
        eprintln!("[aynx] 테마 프로필을 해석하지 못해 월페이퍼 정리를 건너뜁니다");
        return;
    };
    gc_in(&dir, &keep);
}

fn set(source: &str) -> Result<String, String> {
    let source = Path::new(source);
    let ext = checked_ext(source)?;

    let meta = std::fs::metadata(source).map_err(|e| {
        tr!(
            ko: "{what} 를 읽지 못했습니다: {e}",
            en: "Could not read {what}: {e}",
            what = source.display()
        )
    })?;
    if !meta.is_file() {
        return Err(tr!(
            ko: "{what} 는 파일이 아닙니다",
            en: "{what} is not a file",
            what = source.display()
        ));
    }
    checked_size(meta.len())?;

    let dir = ensure_dir()?;
    let name = copy_hashed(source, &ext, &dir)?;
    adopt(&dir, name)
}

fn ensure_dir() -> Result<PathBuf, String> {
    let dir = dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| {
        tr!(
            ko: "{what} 폴더를 만들지 못했습니다: {e}",
            en: "Could not create the folder {what}: {e}",
            what = dir.display()
        )
    })?;
    Ok(dir)
}

/// 고른 파일 · 올린 바이트 · 랜덤 그림이 함께 지나는 끝.
fn adopt(dir: &Path, name: String) -> Result<String, String> {
    let dest = dir.join(&name);
    crate::settings::set_wallpaper_file(Some(name))?;
    gc(None);
    Ok(dest.to_string_lossy().into_owned())
}

fn set_bytes(bytes: &[u8], ext: &str) -> Result<String, String> {
    let dir = ensure_dir()?;
    let name = write_hashed(bytes, ext, &dir)?;
    adopt(&dir, name)
}

/// `file_name` 은 확장자를 얻는 데만 쓴다 — 사본 이름은 내용의 해시라 `..` · 절대 경로가 와도 저장 자리는 `dir` 안이다.
fn upload_in(dir: &Path, file_name: &str, bytes: &[u8]) -> Result<String, String> {
    let ext = checked_ext(Path::new(file_name))?;
    checked_size(bytes.len() as u64)?;
    write_hashed(bytes, &ext, dir)
}

fn set_upload(file_name: &str, bytes: &[u8]) -> Result<String, String> {
    let dir = ensure_dir()?;
    let name = upload_in(&dir, file_name, bytes)?;
    adopt(&dir, name)
}

/// 사본은 GC 가 판단한다 — 프로필이 가리키면 남는다.
fn clear() -> Result<(), String> {
    crate::settings::set_wallpaper_file(None)?;
    gc(None);
    Ok(())
}

/// 경로가 섞인 값(`../x.png` · `sub/x.png`)은 없는 것으로 본다 — 손으로 고칠 수 있는 파일에서 오므로 폴더 밖 질문에 답하지 않는다.
fn exists_in(dir: &Path, name: &str) -> bool {
    let bare = Path::new(name);
    if bare
        .file_name()
        .map(|n| n != std::ffi::OsStr::new(name))
        .unwrap_or(true)
    {
        return false;
    }
    dir.join(bare).is_file()
}

fn resolve_in(dir: &Path, name: &str) -> Option<String> {
    exists_in(dir, name).then(|| dir.join(name).to_string_lossy().into_owned())
}

async fn blocking<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| tr!(ko: "작업을 끝내지 못했습니다: {e}", en: "The task did not finish: {e}"))?
}

// ── 명령 ──

#[tauri::command]
pub async fn wallpaper_set(source: String) -> Result<String, String> {
    blocking(move || set(&source)).await
}

/// 원격 창이 그 기기에서 고른 그림 — 내용은 raw 바디, 원본 이름은 헤더 `x-file-name`(`encodeURIComponent`).
#[tauri::command]
pub async fn wallpaper_set_bytes(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| tr!(ko: "파일 이름이 없습니다", en: "The file name is missing"))?;
    let name = crate::sftp::percent_decode(name)?;
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err(tr!(ko: "본문이 바이너리가 아닙니다", en: "The body is not binary"));
    };
    // 복사 전에 한 번 본다 — 50MB 를 넘는 것을 한 벌 더 만들지 않게.
    checked_size(data.len() as u64)?;
    let bytes = data.clone();
    blocking(move || set_upload(&name, &bytes)).await
}

#[derive(Debug, serde::Serialize)]
pub struct RandomWallpaper {
    pub path: String,
    /// 그 그림의 원본 게시물 주소.
    pub source: String,
}

/// 버튼을 눌렀을 때만 불린다 — 자동 갱신은 없다.
#[tauri::command]
pub async fn wallpaper_random() -> Result<RandomWallpaper, String> {
    let got = random::fetch().await?;
    let source = got.source;
    let bytes = got.bytes;
    let ext = got.ext;
    let path = blocking(move || set_bytes(&bytes, ext)).await?;
    Ok(RandomWallpaper { path, source })
}

#[tauri::command]
pub async fn wallpaper_clear() -> Result<(), String> {
    blocking(clear).await
}

/// 이름은 파일이 아니라 지금 화면의 설정에서 온다 — 미저장 변경 중 프로필을 적용하면 파일은 옛 이름 그대로다.
#[tauri::command]
pub async fn wallpaper_resolve(file: String) -> Option<String> {
    tokio::task::spawn_blocking(move || dir().ok().and_then(|d| resolve_in(&d, &file)))
        .await
        .unwrap_or(None)
}

/// `keep` 은 편집 중인 설정의 배경 이름([`gc`] 의 `extra`).
#[tauri::command]
pub async fn wallpaper_gc(keep: Option<String>) {
    let _ = tokio::task::spawn_blocking(move || gc(keep.as_deref())).await;
}

#[cfg(test)]
mod tests;

//! 월페이퍼 — 앱 창 **전체**의 배경 이미지.
//!
//! ```text
//!  wallpaper_set(source)    원본을 <config_dir>/aynx/wp-<해시>.<ext> 로 복사 → 절대 경로
//!  wallpaper_clear()        설정의 file 을 비운다 (파일은 GC 가 판단한다)
//!  wallpaper_resolve(file)  이름 하나 → 앱 폴더 안 사본의 절대 경로 (없으면 null)
//!  wallpaper_gc(keep)       아무도 가리키지 않는 사본을 지운다
//!  wallpaper_random()       konachan.net 에서 16:9 한 장을 받아 같은 길로 건다 → 경로 + 출처
//! ```
//!
//! 받아 오는 쪽(호스트 허용 목록·크기 상한·형식 확인)은 [`random`] 에 있고, 받은 바이트는
//! [`write_hashed`] → [`adopt`] 로 **고른 파일과 같은 저장 규칙**을 지난다
//! (docs/log/2026-10-01-random-wallpaper.md).
//!
//! ## 왜 원본 경로를 저장하지 않고 **복사**하는가
//!
//! `settings.toml` 에 `C:\Users\wl\Pictures\밤바다.jpg` 를 적어 두면, 그 사진을 다른 폴더로
//! 옮기거나 이름을 바꾸는 순간 앱의 배경이 사라진다 — 사용자는 그 두 사건을 연결하지 못한다
//! (사진 정리는 앱과 아무 상관 없는 일로 느껴진다). 그래서 고른 그 순간의 **바이트를 앱 폴더에
//! 복사해 소유**한다. 원본이 옮겨지든 지워지든 배경은 그대로다.
//!
//! 부수 효과로 프런트가 읽을 경로가 **한 폴더 안**으로 좁혀진다 — `tauri.conf.json` 의
//! `assetProtocol.scope` 를 `$CONFIG/aynx/wp-*`·`wallpaper.*` 로만 열어 두면 되고, 사용자의 사진
//! 폴더도, 같은 폴더의 설정·웹훅·토큰 파일도 웹뷰에 노출하지 않는다 (개발 인스턴스는 `instance.rs` 가
//! `aynx-dev` 로 연다). **사본 이름 규칙을 바꾸면 그 스코프도 같이 바꾼다** (`instance::asset_scope`).
//!
//! ## 파일 이름은 **내용의 해시**다 — `wp-<SHA-1 앞 12자>.<확장자>`
//!
//! 예전에는 `wallpaper.<확장자>` **한 장**이었고 새로 걸 때 옛 사본을 지웠다. 그러면 모양
//! 프로필이 담은 `[wallpaper] file` 이 전부 같은 이름을 가리켜, 프로필을 바꿔도 사진이 안
//! 바뀌었다 (docs/log/2026-09-28-profile-cards-wallpapers.md). 이제 사진마다 제 이름을 갖는다.
//!
//! - **원본 이름을 따라가지 않는다.** 공백·유니코드·`..` 가 `settings.toml` 을 거쳐 다시 경로로
//!   조립되는 길(=경로 조작)이 생긴다. 16진수와 허용 목록의 확장자만으로 만든 이름은 언제나
//!   우리 폴더 안의 한 파일이다. **평평하다** — 하위 폴더를 만들지 않으므로 `settings` 의
//!   "이름 한 조각" 검사와 asset 스코프가 그대로 맞는다.
//! - **같은 내용 = 같은 이름.** 같은 사진을 두 번 걸거나 두 프로필이 같은 사진을 써도 사본은
//!   하나다. 해시는 보안이 아니라 중복 제거용이라 이미 의존에 있는 SHA-1 로 충분하다.
//! - 이름이 내용을 따라가므로 **URL 이 곧 캐시 키**다 — 예전의 `?v=` 캐시 무효화가 필요 없다.
//! - 옛 이름 `wallpaper.<확장자>` 는 **그대로 읽힌다** (설정·프로필이 가리키고 있으면 계속
//!   쓰인다). 그 이름으로 새로 쓰지 않을 뿐이다.
//!
//! ## 지우기는 **GC** 한 곳에서만
//!
//! 사본을 지워도 되는지는 "지금 설정이 가리키는가" 만으로는 모른다 — 프로필도 가리킨다.
//! 그래서 걸기·떼기는 파일을 직접 지우지 않고, [`gc_in`] 이 설정의 `[wallpaper] file` · 모든
//! 프로필의 `appearance.wallpaper.file` · 프런트가 넘긴 이름(편집 중인 설정) 셋 중 **어디에도
//! 없는** 사본만 지운다. `theme-profiles.json` 이나 `settings.toml` 을 해석하지 못하면 **아예
//! 돌지 않는다** — 참조를 모르는 채로 지우는 것보다 파일이 남는 쪽이 싸다.
//!
//! ## 크기·형식 제한
//!
//! 웹뷰가 디코드할 수 있는 것만 받는다(png/jpg/jpeg/webp/gif/bmp). 50MB 상한은 디스크가
//! 아니라 **메모리** 때문이다 — 배경은 창이 떠 있는 내내 디코드된 채로 남는다.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::i18n::tr;

mod random;

/// 사본에 붙일 수 있는 확장자 (소문자). 웹뷰가 `<img>`/`background-image` 로 디코드하는 것들.
///
/// SVG 는 **일부러 빠져 있다**: 스크립트를 품을 수 있는 문서 형식이라 배경으로 깔 값이 아니다.
const ALLOWED_EXTS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];

/// 원본 크기 상한(바이트). 창이 떠 있는 내내 디코드된 비트맵이 메모리에 남으므로 여기서 자른다.
const MAX_BYTES: u64 = 50 * 1024 * 1024;

/// 해시 이름의 머리 — `wp-<16진수>.<확장자>`.
const HASH_PREFIX: &str = "wp-";

/// 해시 이름에 쓰는 16진수 자릿수 (SHA-1 앞 6바이트 = 48비트). 한 사람이 거는 사진 수에서
/// 겹칠 일이 없고, 설정 파일에서 눈으로 읽을 만큼 짧다.
const HASH_HEX_LEN: usize = 12;

/// 옛 고정 이름의 몸통 — `wallpaper.<확장자>` (2026-09-28 이전에 건 배경).
const LEGACY_STEM: &str = "wallpaper";

// ---------------------------------------------------------------------------
// 순수 함수 (유닛 테스트 대상)
// ---------------------------------------------------------------------------

/// 원본 경로에서 **사본에 쓸 확장자**를 고른다 (소문자, 허용 목록 안의 것만).
///
/// 확장자가 없거나 목록 밖이면 오류다 — 여기서 막지 않으면 `.exe` 를 앱 폴더에 복사해
/// 두는 일이 되고, 웹뷰는 그것을 그리지도 못한다.
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

/// 사람이 읽을 크기 문구 — 오류에 "얼마나 큰지" 를 같이 적어 준다.
fn human_mb(bytes: u64) -> String {
    format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0))
}

/// 내용 해시로 사본 이름을 만든다 — `wp-<hex 앞 12자>.<ext>`.
fn hashed_name(digest_hex: &str, ext: &str) -> String {
    let cut = digest_hex.len().min(HASH_HEX_LEN);
    format!("{HASH_PREFIX}{}.{ext}", &digest_hex[..cut])
}

/// 이 이름이 **우리가 만든 사본**인가 — GC 가 손대도 되는 이름은 이 둘뿐이다.
///
/// - `wp-<16진수 소문자 12자>.<허용 확장자>` (해시 이름)
/// - `wallpaper.<허용 확장자>` (옛 고정 이름)
///
/// 같은 폴더에 `settings.toml`·`theme-profiles.json`·볼트가 함께 산다 — 모양이 조금이라도
/// 다르면 우리 것이 아니다.
fn is_managed_name(name: &str) -> bool {
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

/// `theme-profiles.json` 에서 **배경 이름만** 뽑는다 (`profiles[].appearance.wallpaper.file`).
///
/// 백엔드는 프로필 안을 들여다보지 않는 것이 원래 분담이지만(`app_state.rs`), GC 는 "누가 이
/// 사본을 가리키는가" 를 알아야 한다 — 그 한 칸만 `Value` 로 더듬는다. 모양이 틀리면(JSON 이
/// 깨짐·`profiles` 가 배열이 아님) `None` 이고, 부르는 쪽은 그때 **GC 를 건너뛴다**.
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

/// 가리켜지는 이름의 집합. `profiles_json` 이 있는데 해석되지 않으면 `None` (= GC 금지).
/// 파일이 아예 없는 것(`None`)은 "프로필 없음" 이라 괜찮다.
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

// ---------------------------------------------------------------------------
// 실제 일 (블로킹 — 전부 spawn_blocking 안에서 돈다)
// ---------------------------------------------------------------------------

/// 사본이 사는 폴더 = 설정 파일과 같은 `<config_dir>/aynx`.
fn dir() -> Result<PathBuf, String> {
    crate::instance::config_root().ok_or_else(
        || tr!(ko: "설정 디렉터리를 찾을 수 없습니다", en: "Could not find the settings folder"),
    )
}

/// 파일 내용의 SHA-1 (16진수 소문자). 50MB 까지 오므로 통째로 읽지 않고 흘려 넣는다.
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

/// 해시 바이트 → 16진수 소문자.
fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// 메모리의 바이트(랜덤 월페이퍼로 받은 것)를 `dir` 안의 해시 이름으로 쓴다 — [`copy_hashed`] 의
/// 바이트 판. 같은 내용의 사본이 이미 있으면 쓰지 않는다. 임시 이름 → `rename` 인 까닭도 같다.
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

/// 원본을 `dir` 안의 해시 이름으로 복사한다 — 같은 내용의 사본이 이미 있으면 복사하지 않는다.
/// 돌려주는 값은 **사본 이름**.
///
/// 임시 이름에 쓰고 `rename` 한다: 복사가 중간에 끊기면 해시 이름의 파일이 반쪽으로 남고,
/// 다음에 같은 사진을 고를 때 "이미 있다" 로 보여 그 반쪽이 영영 배경이 된다.
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

/// 폴더 안의 **우리 사본 중 `keep` 에 없는 것**을 지운다. 돌려주는 값은 지운 이름들.
///
/// 한 파일을 못 지워도 나머지는 계속한다 (잠긴 파일 하나 때문에 청소 전체가 멈출 이유가 없다 —
/// 다음 GC 가 다시 본다).
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

/// 설정·프로필 파일을 읽어 GC 를 한 번 돈다. **어느 쪽이든 해석하지 못하면 아무것도 지우지 않는다.**
///
/// `extra` 는 프런트가 넘기는 **편집 중인 설정의 배경 이름**이다 — 설정 화면에 미저장 변경이
/// 있을 때 프로필을 적용하면 화면의 배경은 파일에 아직 안 적힌 이름이다. 그것까지 지키지 않으면
/// [저장] 을 누르는 순간 없는 사진을 가리키게 된다.
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

/// 원본을 사본 자리에 복사하고 설정의 `file` 을 갱신한다. 돌려주는 값은 **사본의 절대 경로**.
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
    if meta.len() > MAX_BYTES {
        return Err(tr!(
            ko: "이미지가 너무 큽니다: {size} (최대 {max})",
            en: "The image is too large: {size} (maximum {max})",
            size = human_mb(meta.len()),
            max = human_mb(MAX_BYTES)
        ));
    }

    let dir = ensure_dir()?;
    // 이미 걸린 사본을 그대로 다시 고른 경우도 여기서 끝난다 — 해시가 같으니 복사하지 않는다.
    let name = copy_hashed(source, &ext, &dir)?;
    adopt(&dir, name)
}

/// 사본 폴더를 (없으면 만들어) 돌려준다.
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

/// 폴더 안의 사본 `name` 을 배경으로 건다 — 설정의 `file` 을 바꾸고 GC 를 돈다. **고른 파일과
/// 랜덤으로 받은 파일이 함께 지나는 끝**이다. 돌려주는 값은 사본의 절대 경로.
fn adopt(dir: &Path, name: String) -> Result<String, String> {
    let dest = dir.join(&name);
    crate::settings::set_wallpaper_file(Some(name))?;
    // 앞 배경을 아무 프로필도 가리키지 않으면 여기서 정리된다.
    gc(None);
    Ok(dest.to_string_lossy().into_owned())
}

/// 받은 바이트를 사본으로 쓰고 건다 (랜덤 월페이퍼). 블로킹.
fn set_bytes(bytes: &[u8], ext: &str) -> Result<String, String> {
    let dir = ensure_dir()?;
    let name = write_hashed(bytes, ext, &dir)?;
    adopt(&dir, name)
}

/// 설정의 `file` 을 비운다. 사본은 **GC 가** 판단한다 — 프로필이 가리키면 남는다.
fn clear() -> Result<(), String> {
    crate::settings::set_wallpaper_file(None)?;
    gc(None);
    Ok(())
}

/// 이름 한 조각(`"wp-0a1b2c3d4e5f.jpg"`)이 **그 폴더 안에 실제로 있는가**.
///
/// 경로가 섞인 값(`../x.png`·`sub/x.png`)은 **없는 것으로 본다** — 이 함수가 받는 값은
/// `settings.toml`·`theme-profiles.json` 처럼 손으로 고칠 수 있는 파일에서 오므로, 폴더
/// 밖을 물어보는 질문에 답하지 않는 것이 규칙이다 ([`crate::settings`] 의 `sanitize` 가
/// `[wallpaper] file` 에 하는 검사와 같은 뜻).
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

/// 이름 한 조각 → 그 사본의 절대 경로. 없거나 이름이 경로면 `None`.
fn resolve_in(dir: &Path, name: &str) -> Option<String> {
    exists_in(dir, name).then(|| dir.join(name).to_string_lossy().into_owned())
}

/// 파일시스템 호출은 **블로킹**이다 (50MB 복사·해시는 특히). tokio 워커를 붙잡지 않게 넘긴다 —
/// `local_browser` 의 같은 이름 헬퍼와 같은 규칙이다.
async fn blocking<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| tr!(ko: "작업을 끝내지 못했습니다: {e}", en: "The task did not finish: {e}"))?
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// 이미지를 앱 폴더로 복사해 배경으로 건다. 돌려주는 값은 **사본의 절대 경로**
/// (프런트가 `convertFileSrc` 로 웹뷰 URL 을 만든다).
#[tauri::command]
pub async fn wallpaper_set(source: String) -> Result<String, String> {
    blocking(move || set(&source)).await
}

/// [`wallpaper_random`] 이 돌려주는 값 — 사본의 절대 경로와 그 그림의 원본 게시물 주소.
#[derive(Debug, serde::Serialize)]
pub struct RandomWallpaper {
    pub path: String,
    pub source: String,
}

/// konachan.net 에서 16:9 · 1920×1080 이상인 그림 하나를 받아 **곧바로 배경으로 건다**
/// ([`random`] 이 받고, 저장·적용은 [`wallpaper_set`] 과 같은 [`adopt`] 길). 버튼을 눌렀을
/// 때만 불린다 — 자동 갱신은 없다.
#[tauri::command]
pub async fn wallpaper_random() -> Result<RandomWallpaper, String> {
    let got = random::fetch().await?;
    let source = got.source;
    let bytes = got.bytes;
    let ext = got.ext;
    let path = blocking(move || set_bytes(&bytes, ext)).await?;
    Ok(RandomWallpaper { path, source })
}

/// 배경을 뗀다 — 설정의 `file` 을 비우고, 아무도 안 가리키게 된 사본은 GC 가 지운다.
#[tauri::command]
pub async fn wallpaper_clear() -> Result<(), String> {
    blocking(clear).await
}

/// 이 **이름의 사본**의 절대 경로 (앱 폴더에 없거나 이름이 경로면 `null`).
///
/// 프런트는 **지금 화면의 설정**(`settings.current.wallpaper.file`)을 들고 묻는다 — 파일에 적힌
/// 값이 아니다. 설정 화면에 미저장 변경이 있을 때 프로필을 적용하면 설정 파일은 옛 이름
/// 그대로라, 파일을 읽어 URL 을 만들던 예전 방식(`wallpaper_path`)으로는 사진이 안 바뀐다.
/// 모양 프로필이 적용 **전에** "이 배경이 아직 있는가" 를 묻는 것도 같은 질문이다
/// (예전의 `wallpaper_exists` 를 흡수했다).
///
/// 오류를 내지 않는다 — 폴더를 못 찾으면 없는 것과 같은 결말이다.
#[tauri::command]
pub async fn wallpaper_resolve(file: String) -> Option<String> {
    tokio::task::spawn_blocking(move || dir().ok().and_then(|d| resolve_in(&d, &file)))
        .await
        .unwrap_or(None)
}

/// 아무도 가리키지 않는 사본을 지운다 — 프로필을 저장(덮어쓰기·삭제 포함)하거나 적용한 뒤
/// 프런트가 부른다.
///
/// `keep` 은 편집 중인 설정의 배경 이름([`gc`] 의 `extra`). 오류를 내지 않는다 — 청소는 다음
/// 기회가 있다.
#[tauri::command]
pub async fn wallpaper_gc(keep: Option<String>) {
    let _ = tokio::task::spawn_blocking(move || gc(keep.as_deref())).await;
}

#[cfg(test)]
mod tests;

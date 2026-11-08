//! **사용자 앱 아이콘** — 사람이 고른 그림을 내장 캐릭터와 같은 모양(256px · 둥근 사각 · 모서리 투명)으로 만들어 앱 폴더에 둔다
//! (docs/log/2026-10-22-custom-app-icon.md).
//!
//! 불변식:
//! - **폴더가 곧 목록이다** — `<설정 루트>/app-icons/user-<SHA-1 앞 12자>.png`. 설정 파일에 목록 칸은 없고 `[app] app_icon` 에
//!   id(`user-<12hex>`) 하나만 적힌다. 이름은 16진수와 고정 확장자뿐이라 경로 조작이 없다(`wallpaper.rs` 의 해시 이름과 같은 규칙 ·
//!   평평한 폴더 · 원본 이름을 따르지 않는다). Windows 에서는 같은 폴더에 작업 표시줄의 `current.ico` 가 산다(부모의
//!   `sync_taskbar`) — [`is_user_id`] 모양이 아닌 파일은 목록에도 지우기에도 들지 않는다.
//! - 받는 것은 **프런트가 자르기 화면에서 고른 정사각 영역을 캔버스로 만든 PNG** 하나다. 프런트를 믿지 않는다 — 다시 디코드하고
//!   (PNG 만 · 바이트 상한 · 한 변 상한 · 정사각), 256px 로 줄이고(알파를 곱한 채 Lanczos3 — 스크립트의 `shrink` 와 같은 뜻),
//!   둥근 마스크를 곱해 **우리가 인코드한** PNG 를 쓴다. 이름은 그 결과의 해시라 같은 그림은 한 파일이다.
//! - 모양([`mask`])은 **내장 그림을 잰 값**이다 — `scripts/gen-character-icons.py` 는 반경을 정하지 않고 원본 그림의 둥근 사각을
//!   플러드 필로 따 낸다. 256px 결과 넷을 재면 왼쪽 5.3 · 오른쪽 250.9 · 아래 247.6 px 에 모서리 반경 약 46px 이다(위쪽은 머리카락이
//!   덮어 잴 수 없다). 그래서 사방 [`INSET`](좌우 잰 값의 평균) 안쪽 · 반경 [`RADIUS`] 의 둥근 사각을 가운데에 쓴다. 경계의 부드러움은 스크립트가 약 5배 큰 이진
//!   마스크를 줄여 얻는 것과 같게, 한 화소를 [`SUB`]×[`SUB`] 로 나눠 덮인 비율을 알파로 한다.
//! - 개수 상한 [`MAX_ICONS`]. 지우기는 파일 하나를 지우는 것뿐이다(지금 고른 것이면 부모가 기본으로 돌린다).
//! - 원격 웹 클라이언트는 **읽기만** 한다(10-31 아바타 — 목록 · 큰 그림은 `remote/deny.rs` 의 허용 표, 넣기 · 지우기 · 이름 바꾸기는
//!   미지원 표 — 프런트는 원격에서 관리 단추를 숨긴다).
//! - **이름**(10-31 설정 › 아바타)은 같은 폴더의 `names.json` 하나(id → 이름, 원자 쓰기 · 1~[`NAME_MAX`] 글자 · 제어 문자 없음).
//!   목록에 들지 않는다(우리 id 모양이 아니다). 모르는 id 는 읽을 때 버리고, 그림을 지우면 이름도 걷는다.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::{ImageFormat, ImageReader, Limits, RgbaImage};

use crate::i18n::tr;

/// id 의 머리 — `user-<16진수 소문자 12자>`. 파일 이름은 여기에 [`EXT`] 를 붙인 것이다.
const PREFIX: &str = "user-";
/// SHA-1 앞 6바이트(48비트) — 월페이퍼 사본과 같은 길이다. 한 사람이 쌓는 아이콘 수에서 겹칠 일이 없다.
const HEX_LEN: usize = 12;
const EXT: &str = "png";

/// 결과 그림 한 변 — 내장 캐릭터 PNG(`icons/characters/*.png`)와 같다. 부모의 `ico_from_png` 가 이 크기를 가정한다.
pub const SIZE: u32 = 256;
/// 설정 화면 썸네일 한 변 — 내장 썸네일(`src/lib/assets/app-icons/*.png`, 표시 40px × HiDPI)과 같다.
const THUMB: u32 = 96;
/// 쌓아 둘 수 있는 사용자 아이콘 수 — 고르기 칩 줄이 몇 줄로 넘치지 않을 만큼.
pub const MAX_ICONS: usize = 24;
/// 받는 PNG 바이트 상한. 프런트는 한 변 1024px 이하로 만들어 보낸다(사진이어도 수 MB).
const MAX_BYTES: usize = 16 * 1024 * 1024;
/// 받는 그림 한 변의 범위 — 너무 작으면 256px 로 늘린 그림이 뭉개지고, 너무 크면 디코드 메모리가 는다.
const MIN_SIDE: u32 = 32;
const MAX_SIDE: u32 = 2048;
/// 둥근 사각의 안쪽 여백 · 모서리 반경(256px 기준 — 위 머리말의 잰 값).
const INSET: f32 = 5.2;
const RADIUS: f32 = 46.0;
/// 경계 안티앨리어싱 — 한 화소를 SUB×SUB 점으로 나눠 센다.
const SUB: u32 = 5;

/// 이 글자가 사용자 아이콘 id 모양인가 — `user-` + 16진수 소문자 정확히 12자. 그 밖은 전부 아니다(`..`·구분자·확장자 포함).
pub fn is_user_id(id: &str) -> bool {
    id.strip_prefix(PREFIX).is_some_and(|hex| {
        hex.len() == HEX_LEN && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

fn file_name(id: &str) -> String {
    format!("{id}.{EXT}")
}

/// 파일 이름 → id(우리 모양일 때만).
fn id_of_file(name: &str) -> Option<&str> {
    let id = name.strip_suffix(EXT)?.strip_suffix('.')?;
    is_user_id(id).then_some(id)
}

/// `<설정 루트>/app-icons` — 개발 빌드는 `aynx-dev` 쪽이다(`instance`).
pub fn dir() -> Result<PathBuf, String> {
    crate::instance::config_root()
        .map(|root| root.join("app-icons"))
        .ok_or_else(|| tr!(ko: "앱 설정 폴더를 찾을 수 없습니다", en: "The app settings folder is unavailable"))
}

/// 저장된 사용자 아이콘의 PNG(256px). id 모양이 아니거나 파일이 없으면 `None` — 부모가 기본으로 접는다. 디스크라 블로킹이다.
pub fn read(id: &str) -> Option<Vec<u8>> {
    read_at(&dir().ok()?, id)
}

/// [`read`] 의 폴더를 받는 쪽 — 목록이 썸네일을 만들 때 쓴다.
pub fn read_at(dir: &Path, id: &str) -> Option<Vec<u8>> {
    if !is_user_id(id) {
        return None;
    }
    std::fs::read(dir.join(file_name(id))).ok()
}

/// 받은 그림의 크기가 받을 만한가 — 정사각 · [`MIN_SIDE`]..=[`MAX_SIDE`].
fn check_dims(w: u32, h: u32) -> Result<(), String> {
    if w != h {
        return Err(tr!(
            ko: "정사각형 그림이 아닙니다 ({w}×{h})",
            en: "The picture is not square ({w}×{h})"
        ));
    }
    if !(MIN_SIDE..=MAX_SIDE).contains(&w) {
        return Err(tr!(
            ko: "그림 한 변은 {min}~{max}px 이어야 합니다 (받은 것 {w}px)",
            en: "The picture side must be {min}–{max}px (got {w}px)",
            min = MIN_SIDE,
            max = MAX_SIDE
        ));
    }
    Ok(())
}

fn decode_err(e: impl std::fmt::Display) -> String {
    tr!(ko: "그림을 읽지 못했습니다: {e}", en: "Could not read the picture: {e}")
}

/// 받은 바이트 → 검증한 정사각 RGBA. PNG 만 받는다(프런트의 캔버스가 만든 것) — 크기는 디코드 전에 머리에서 먼저 본다.
fn decode_square(bytes: &[u8]) -> Result<RgbaImage, String> {
    if bytes.len() > MAX_BYTES {
        return Err(tr!(
            ko: "그림이 너무 큽니다 (최대 {mb}MB)",
            en: "The picture is too large (up to {mb} MB)",
            mb = MAX_BYTES / (1024 * 1024)
        ));
    }
    let reader = || {
        let mut r = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Png);
        let mut limits = Limits::default();
        limits.max_image_width = Some(MAX_SIDE);
        limits.max_image_height = Some(MAX_SIDE);
        limits.max_alloc = Some(64 * 1024 * 1024);
        r.limits(limits);
        r
    };
    let (w, h) = reader().into_dimensions().map_err(decode_err)?;
    check_dims(w, h)?;
    Ok(reader().decode().map_err(decode_err)?.into_rgba8())
}

/// 알파를 곱한 채로 `size` 로 줄인다 — 투명 화소의 RGB 가 경계로 번지지 않게(스크립트의 `shrink` 와 같은 뜻).
fn resize_premultiplied(img: &RgbaImage, size: u32) -> RgbaImage {
    if img.width() == size && img.height() == size {
        return img.clone();
    }
    let mut pre = img.clone();
    for px in pre.pixels_mut() {
        let a = u32::from(px[3]);
        for c in 0..3 {
            px[c] = ((u32::from(px[c]) * a + 127) / 255) as u8;
        }
    }
    let mut out = image::imageops::resize(&pre, size, size, FilterType::Lanczos3);
    for px in out.pixels_mut() {
        let a = u32::from(px[3]);
        for c in 0..3 {
            // 알파 0 이면 색도 0(투명 화소의 RGB 는 뜻이 없다).
            px[c] = (u32::from(px[c]) * 255 + a / 2).checked_div(a).map_or(0, |v| v.min(255) as u8);
        }
    }
    out
}

/// 둥근 사각 마스크(행 우선 `size×size` 알파) — 안쪽 255 · 바깥 0 · 경계는 덮인 비율.
fn mask(size: u32) -> Vec<u8> {
    let scale = size as f32 / SIZE as f32;
    let (inset, radius) = (INSET * scale, RADIUS * scale);
    let (lo, hi) = (inset, size as f32 - inset);
    let inside = |x: f32, y: f32| {
        if x < lo || x > hi || y < lo || y > hi {
            return false;
        }
        let cx = x.clamp(lo + radius, hi - radius);
        let cy = y.clamp(lo + radius, hi - radius);
        (x - cx).powi(2) + (y - cy).powi(2) <= radius * radius
    };
    let total = SUB * SUB;
    let mut out = Vec::with_capacity((size * size) as usize);
    for py in 0..size {
        for px in 0..size {
            let mut hit = 0;
            for sy in 0..SUB {
                for sx in 0..SUB {
                    let x = px as f32 + (sx as f32 + 0.5) / SUB as f32;
                    let y = py as f32 + (sy as f32 + 0.5) / SUB as f32;
                    hit += u32::from(inside(x, y));
                }
            }
            out.push(((hit * 255 + total / 2) / total) as u8);
        }
    }
    out
}

fn encode_png(img: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Png)
        .map_err(|e| tr!(ko: "아이콘을 만들지 못했습니다: {e}", en: "Could not build the icon: {e}"))?;
    Ok(out.into_inner())
}

/// 받은 PNG → 아이콘 PNG(256px · 둥근 사각 · 모서리 투명). 순수 — **시험 대상**.
pub fn make_icon(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut img = resize_premultiplied(&decode_square(bytes)?, SIZE);
    for (px, m) in img.pixels_mut().zip(mask(SIZE)) {
        px[3] = ((u32::from(px[3]) * u32::from(m) + 127) / 255) as u8;
    }
    encode_png(&img)
}

/// 아이콘 PNG → 썸네일 data URL(`data:image/png;base64,…`) — 설정 화면이 asset 프로토콜 없이 그린다.
pub fn thumb_data_url(png: &[u8]) -> Option<String> {
    let img = image::load_from_memory_with_format(png, ImageFormat::Png).ok()?.into_rgba8();
    let small = encode_png(&resize_premultiplied(&img, THUMB)).ok()?;
    Some(format!("data:image/png;base64,{}", data_encoding::BASE64.encode(&small)))
}

/// 아이콘 PNG 그대로(256px) data URL — 크게 그리는 자리(AI 로딩 덮개 88px 등)가 쓴다([`super::app_icon_image`]). 다시 디코드해
/// PNG 인지만 확인한다(폴더의 파일은 우리가 인코드한 것이지만 손으로 바꿔 넣은 파일이 웹뷰로 그대로 나가지 않게).
pub fn full_data_url(png: &[u8]) -> Option<String> {
    image::load_from_memory_with_format(png, ImageFormat::Png).ok()?;
    Some(format!("data:image/png;base64,{}", data_encoding::BASE64.encode(png)))
}

/// 폴더의 사용자 아이콘 id — 넣은 순서(수정 시각, 같으면 이름). 폴더가 없으면 빈 목록. 우리 모양이 아닌 파일은 세지 않는다.
pub fn list_at(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<(std::time::SystemTime, String)> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let name = e.file_name();
            let id = id_of_file(name.to_str()?)?.to_owned();
            let at = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
            Some((at, id))
        })
        .collect();
    found.sort();
    found.into_iter().map(|(_, id)| id).collect()
}

/// 받은 PNG 를 아이콘으로 만들어 `dir` 에 둔다 → (id, 아이콘 PNG). 같은 그림이 이미 있으면 쓰지 않고 그 id 를 준다(상한에 안 걸린다).
/// 임시 이름에 쓰고 `rename` 한다 — 끊기면 해시 이름의 반쪽 파일이 "이미 있음" 으로 영영 남는다(`wallpaper::write_hashed` 와 같다).
pub fn add_at(dir: &Path, bytes: &[u8]) -> Result<(String, Vec<u8>), String> {
    use sha1::{Digest, Sha1};
    let png = make_icon(bytes)?;
    let hex: String = Sha1::digest(&png).iter().take(HEX_LEN / 2).map(|b| format!("{b:02x}")).collect();
    let id = format!("{PREFIX}{hex}");
    let dest = dir.join(file_name(&id));
    if dest.is_file() {
        return Ok((id, png));
    }
    if list_at(dir).len() >= MAX_ICONS {
        return Err(tr!(
            ko: "사용자 아이콘은 {max}개까지 둘 수 있습니다 — 하나를 지우고 다시 넣으세요",
            en: "You can keep up to {max} custom icons — remove one and try again",
            max = MAX_ICONS
        ));
    }
    let write_err = |e: std::io::Error| tr!(ko: "아이콘을 저장하지 못했습니다: {e}", en: "Could not save the icon: {e}");
    std::fs::create_dir_all(dir).map_err(write_err)?;
    let tmp = dir.join(format!("{}.{}.tmp", file_name(&id), std::process::id()));
    if let Err(e) = std::fs::write(&tmp, &png).and_then(|()| std::fs::rename(&tmp, &dest)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(write_err(e));
    }
    Ok((id, png))
}

/// 사용자 아이콘 하나를 지운다 — id 모양이 아니면 거절(경로 조작), 이미 없으면 그대로 성공. 이름([`NAMES`])도 함께 걷는다
/// (이름 파일을 못 고쳐도 그림은 지워졌다 — 남은 이름은 목록이 모르는 id 라 무시되고, 같은 그림을 다시 넣으면 그 이름이 되살아날 뿐이다).
pub fn remove_at(dir: &Path, id: &str) -> Result<(), String> {
    if !is_user_id(id) {
        return Err(tr!(ko: "사용자 아이콘 id 가 아닙니다: {id}", en: "Not a custom icon id: {id}"));
    }
    match std::fs::remove_file(dir.join(file_name(id))) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(tr!(ko: "아이콘을 지우지 못했습니다: {e}", en: "Could not remove the icon: {e}")),
    }
    if let Err(e) = set_name_unchecked(dir, id, None) {
        eprintln!("[aynx] 아바타 {id} 의 이름을 걷지 못했습니다 (무시): {e}");
    }
    Ok(())
}

// ── 이름 (2026-10-31 — 설정 › 아바타) ─────────────────────────────────────────

/// 사용자 그림의 이름표 — 같은 폴더의 작은 JSON 하나(`{ "user-<12hex>": "이름" }`). 그림 파일과 따로 사는 까닭: 파일 이름은 내용
/// 해시라 이름을 실을 자리가 없고, 설정 파일(`settings.toml`)은 미저장 변경 규칙을 따르지만 이름은 넣기 · 지우기처럼 곧바로 파일 작업이다.
/// 모르는 id(모양이 틀리거나 그림이 없는 것) · 규칙에 안 맞는 이름은 읽을 때 버린다 — 손으로 고친 파일이 앱을 막지 않는다.
const NAMES: &str = "names.json";
/// 이름 길이 상한(글자 수) — 카드 한 줄에 들어갈 만큼.
pub const NAME_MAX: usize = 32;

/// 같은 프로세스(GUI 창 여럿)의 읽고-고쳐-쓰기를 줄 세운다 — 이름 파일은 GUI 만 쓴다(세션 서버는 이 폴더를 모른다).
static NAMES_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 받은 이름 → 저장할 이름. 앞뒤 공백을 걷고 1~[`NAME_MAX`] 글자 · 제어 문자 없음이면 `Some`. 빈 글자는 `Ok(None)`(이름 걷기).
pub fn clean_name(raw: &str) -> Result<Option<String>, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Ok(None);
    }
    if name.chars().count() > NAME_MAX || name.chars().any(char::is_control) {
        return Err(tr!(
            ko: "이름은 제어 문자 없이 1~{max}자여야 합니다",
            en: "The name must be 1–{max} characters with no control characters",
            max = NAME_MAX
        ));
    }
    Ok(Some(name.to_owned()))
}

/// 이름 표를 읽는다 — 파일이 없거나 깨졌으면 빈 표. 모양이 틀린 id · 규칙에 안 맞는 이름은 빠진다.
pub fn names_at(dir: &Path) -> std::collections::BTreeMap<String, String> {
    let Ok(text) = std::fs::read_to_string(dir.join(NAMES)) else {
        return Default::default();
    };
    let Ok(raw) = serde_json::from_str::<std::collections::BTreeMap<String, String>>(&text) else {
        return Default::default();
    };
    raw.into_iter()
        .filter(|(id, _)| is_user_id(id))
        .filter_map(|(id, name)| Some((id, clean_name(&name).ok()??)))
        .collect()
}

/// 이름 하나를 바꾼다(`None` = 걷는다) — 그림 파일이 있는 id 만. 돌려주는 것은 저장한 이름.
pub fn set_name_at(dir: &Path, id: &str, name: Option<&str>) -> Result<Option<String>, String> {
    if !is_user_id(id) {
        return Err(tr!(ko: "사용자 아이콘 id 가 아닙니다: {id}", en: "Not a custom icon id: {id}"));
    }
    let name = match name {
        Some(raw) => clean_name(raw)?,
        None => None,
    };
    if !dir.join(file_name(id)).is_file() {
        return Err(tr!(ko: "그 아바타가 없습니다: {id}", en: "No such avatar: {id}"));
    }
    set_name_unchecked(dir, id, name.as_deref())?;
    Ok(name)
}

/// 이름 표의 한 칸을 바꿔 원자적으로 쓴다(임시 파일 → `rename`). 그림이 있는지는 보지 않는다(지우기가 부른다). 표에서 그림이 없는
/// id 는 이때 함께 걷는다 — 손으로 지운 그림의 이름이 쌓이지 않게.
fn set_name_unchecked(dir: &Path, id: &str, name: Option<&str>) -> Result<(), String> {
    let _guard = NAMES_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut names = names_at(dir);
    let before = names.clone();
    match name {
        Some(n) => {
            names.insert(id.to_owned(), n.to_owned());
        }
        None => {
            names.remove(id);
        }
    }
    names.retain(|k, _| dir.join(file_name(k)).is_file());
    if names == before {
        return Ok(());
    }
    let write_err = |e: std::io::Error| tr!(ko: "이름을 저장하지 못했습니다: {e}", en: "Could not save the name: {e}");
    let body = serde_json::to_string_pretty(&names).map_err(|e| write_err(std::io::Error::other(e)))?;
    std::fs::create_dir_all(dir).map_err(write_err)?;
    let tmp = dir.join(format!("{NAMES}.{}.tmp", std::process::id()));
    if let Err(e) = std::fs::write(&tmp, body).and_then(|()| std::fs::rename(&tmp, dir.join(NAMES))) {
        let _ = std::fs::remove_file(&tmp);
        return Err(write_err(e));
    }
    Ok(())
}

/// 그림 파일의 수정 시각(넣은 때 — 같은 그림을 다시 넣으면 쓰지 않으니 처음 넣은 때) — 유닉스 밀리초. 모르면 `None`.
pub fn added_at(dir: &Path, id: &str) -> Option<u64> {
    if !is_user_id(id) {
        return None;
    }
    let at = std::fs::metadata(dir.join(file_name(id))).ok()?.modified().ok()?;
    u64::try_from(at.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 테스트마다 겹치지 않는 임시 폴더 (끝나면 지운다).
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!("aynx-앱아이콘-{tag}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&dir).expect("임시 폴더");
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 한 색으로 칠한 w×h PNG.
    fn png(w: u32, h: u32, rgba: [u8; 4]) -> Vec<u8> {
        encode_png(&RgbaImage::from_pixel(w, h, image::Rgba(rgba))).expect("인코드")
    }

    #[test]
    fn user_id_shape_is_strict() {
        assert!(is_user_id("user-0123456789ab"));
        for bad in [
            "",
            "user-",
            "user-0123456789a",
            "user-0123456789abc",
            "user-0123456789AB",
            "user-0123456789ag",
            "user-0123456789ab.png",
            "user-../../settings",
            "user-..\\..\\x123456",
            "gpt",
            " user-0123456789ab",
        ] {
            assert!(!is_user_id(bad), "{bad:?}");
        }
        assert_eq!(id_of_file("user-0123456789ab.png"), Some("user-0123456789ab"));
        assert_eq!(id_of_file("user-0123456789ab.ico"), None);
        assert_eq!(id_of_file("current.ico"), None);
        assert_eq!(id_of_file("user-0123456789ab.png.123.tmp"), None);
    }

    #[test]
    fn dims_must_be_square_and_in_range() {
        assert!(check_dims(256, 256).is_ok());
        assert!(check_dims(MIN_SIDE, MIN_SIDE).is_ok());
        assert!(check_dims(MAX_SIDE, MAX_SIDE).is_ok());
        assert!(check_dims(300, 200).is_err());
        assert!(check_dims(MIN_SIDE - 1, MIN_SIDE - 1).is_err());
        assert!(check_dims(MAX_SIDE + 1, MAX_SIDE + 1).is_err());
    }

    /// 내장 그림과 같은 기준 — 256px RGBA · 모서리 투명 · 가운데 불투명(`embedded_icons_decode_as_256px_rgba`).
    #[test]
    fn made_icon_is_256_rounded_like_builtin() {
        let out = make_icon(&png(300, 300, [200, 40, 40, 255])).expect("만들기");
        let img = image::load_from_memory_with_format(&out, ImageFormat::Png).expect("디코드").into_rgba8();
        assert_eq!(img.dimensions(), (SIZE, SIZE));
        for (x, y) in [(0, 0), (255, 0), (0, 255), (255, 255), (6, 6), (249, 249)] {
            assert_eq!(img.get_pixel(x, y)[3], 0, "모서리 ({x},{y}) 알파");
        }
        assert_eq!(img.get_pixel(128, 128)[3], 255, "가운데 알파");
        assert!(img.get_pixel(128, 128)[0].abs_diff(200) <= 1, "색은 그대로");
        // 곧은 변의 경계는 안티앨리어싱 — 바깥 0 · 경계 중간값 · 안쪽 255.
        assert_eq!(img.get_pixel(3, 128)[3], 0);
        let edge = img.get_pixel(5, 128)[3];
        assert!(edge > 0 && edge < 255, "경계 화소 알파 {edge}");
        assert_eq!(img.get_pixel(7, 128)[3], 255);
    }

    #[test]
    fn mask_has_transparent_corners_and_soft_edges() {
        let m = mask(SIZE);
        let at = |x: u32, y: u32| m[(y * SIZE + x) as usize];
        assert_eq!(at(0, 0), 0);
        assert_eq!(at(128, 128), 255);
        // 모서리 호 — 반경 46 이면 대각선 위 (18,18) 근처는 바깥, (25,25) 는 안쪽.
        assert_eq!(at(15, 15), 0);
        assert_eq!(at(25, 25), 255);
        assert!(m.iter().any(|&a| a > 0 && a < 255), "중간 알파가 있어야 한다");
        // 좌우·상하 대칭.
        for (x, y) in [(5, 128), (20, 20), (40, 8)] {
            assert_eq!(at(x, y), at(SIZE - 1 - x, y), "좌우 ({x},{y})");
            assert_eq!(at(x, y), at(x, SIZE - 1 - y), "상하 ({x},{y})");
        }
    }

    #[test]
    fn rejects_non_square_garbage_and_oversize() {
        assert!(make_icon(&png(300, 200, [0, 0, 0, 255])).is_err(), "정사각 아님");
        assert!(make_icon(&png(8, 8, [0, 0, 0, 255])).is_err(), "너무 작음");
        assert!(make_icon(b"not a png").is_err(), "PNG 아님");
        assert!(make_icon(&vec![0u8; MAX_BYTES + 1]).is_err(), "바이트 상한");
    }

    #[test]
    fn add_list_remove_in_folder() {
        let tmp = TempDir::new("add");
        let dir = tmp.0.join("app-icons");
        // 우리 것이 아닌 파일은 목록에 들지 않는다.
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("current.ico"), b"ico").unwrap();
        std::fs::write(dir.join("settings.toml"), b"x").unwrap();
        assert!(list_at(&dir).is_empty());

        let (a, _) = add_at(&dir, &png(64, 64, [1, 2, 3, 255])).expect("넣기");
        assert!(is_user_id(&a));
        let (again, _) = add_at(&dir, &png(64, 64, [1, 2, 3, 255])).expect("같은 그림");
        assert_eq!(a, again, "같은 그림 = 같은 id");
        let (b, _) = add_at(&dir, &png(64, 64, [9, 9, 9, 255])).expect("다른 그림");
        assert_ne!(a, b);
        let listed = list_at(&dir);
        assert_eq!(listed.len(), 2);
        assert!(listed.contains(&a) && listed.contains(&b));

        assert!(remove_at(&dir, "../settings").is_err(), "경로 조작 거절");
        assert!(remove_at(&dir, "current").is_err());
        remove_at(&dir, &a).expect("지우기");
        remove_at(&dir, &a).expect("이미 없으면 그대로 성공");
        assert_eq!(list_at(&dir), vec![b.clone()]);
        assert!(dir.join("current.ico").is_file(), "남의 파일은 그대로");
    }

    #[test]
    fn names_round_trip_and_follow_the_picture() {
        let tmp = TempDir::new("names");
        let dir = tmp.0.join("app-icons");
        let (a, _) = add_at(&dir, &png(64, 64, [1, 2, 3, 255])).expect("넣기");
        let (b, _) = add_at(&dir, &png(64, 64, [4, 5, 6, 255])).expect("넣기");
        assert!(names_at(&dir).is_empty(), "처음엔 이름 없음");
        assert_eq!(set_name_at(&dir, &a, Some("  리나 ")).unwrap().as_deref(), Some("리나"), "앞뒤 공백을 걷는다");
        set_name_at(&dir, &b, Some("둘")).unwrap();
        assert_eq!(names_at(&dir).get(&a).map(String::as_str), Some("리나"));
        // 빈 이름 = 걷기 · 규칙 밖 이름 · 모르는 id · 그림 없는 id 는 거절
        assert_eq!(set_name_at(&dir, &b, Some("  ")).unwrap(), None);
        assert!(!names_at(&dir).contains_key(&b));
        assert!(set_name_at(&dir, &a, Some(&"가".repeat(NAME_MAX + 1))).is_err(), "길이");
        assert!(set_name_at(&dir, &a, Some("a\nb")).is_err(), "제어 문자");
        assert!(set_name_at(&dir, "../x", Some("x")).is_err(), "id 모양");
        assert!(set_name_at(&dir, "user-ffffffffffff", Some("x")).is_err(), "그림 없음");
        assert_eq!(set_name_at(&dir, &a, Some(&"가".repeat(NAME_MAX))).unwrap().map(|n| n.chars().count()), Some(NAME_MAX));
        // 그림을 지우면 이름도 걷힌다 — 목록은 이름 파일을 세지 않는다
        remove_at(&dir, &a).unwrap();
        assert!(names_at(&dir).is_empty());
        assert_eq!(list_at(&dir), vec![b.clone()]);
        // 손으로 고친 파일 — 모르는 id · 나쁜 이름은 읽을 때 버린다 · 깨진 파일은 빈 표
        std::fs::write(dir.join(NAMES), format!(r#"{{"{b}":"좋음","../x":"y","user-000000000000":"a\u0007"}}"#)).unwrap();
        let names = names_at(&dir);
        assert_eq!(names.len(), 1);
        assert_eq!(names.get(&b).map(String::as_str), Some("좋음"));
        std::fs::write(dir.join(NAMES), "{not json").unwrap();
        assert!(names_at(&dir).is_empty());
        assert!(added_at(&dir, &b).is_some());
        assert!(added_at(&dir, &a).is_none());
    }

    #[test]
    fn add_stops_at_the_cap() {
        let tmp = TempDir::new("cap");
        let dir = tmp.0.clone();
        for i in 0..MAX_ICONS {
            std::fs::write(dir.join(format!("user-{i:012x}.png")), b"x").unwrap();
        }
        assert_eq!(list_at(&dir).len(), MAX_ICONS);
        assert!(add_at(&dir, &png(64, 64, [5, 5, 5, 255])).is_err(), "상한");
        std::fs::remove_file(dir.join("user-000000000000.png")).unwrap();
        assert!(add_at(&dir, &png(64, 64, [5, 5, 5, 255])).is_ok(), "하나 지우면 다시 된다");
    }

    #[test]
    fn full_data_url_keeps_the_256_png() {
        let icon = make_icon(&png(64, 64, [10, 20, 30, 255])).unwrap();
        let url = full_data_url(&icon).expect("큰 그림");
        let b64 = url.strip_prefix("data:image/png;base64,").expect("머리");
        assert_eq!(data_encoding::BASE64.decode(b64.as_bytes()).unwrap(), icon);
        assert!(full_data_url(b"not a png").is_none());
    }

    #[test]
    fn thumb_is_a_png_data_url() {
        let icon = make_icon(&png(64, 64, [10, 20, 30, 255])).unwrap();
        let url = thumb_data_url(&icon).expect("썸네일");
        let b64 = url.strip_prefix("data:image/png;base64,").expect("머리");
        let bytes = data_encoding::BASE64.decode(b64.as_bytes()).unwrap();
        let img = image::load_from_memory_with_format(&bytes, ImageFormat::Png).unwrap();
        assert_eq!((img.width(), img.height()), (THUMB, THUMB));
    }
}

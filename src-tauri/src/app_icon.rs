//! 앱 아이콘 고르기 — 창 · 작업 표시줄 아이콘을 내장 캐릭터 아이콘이나 사용자가 넣은 그림 중 하나로 바꾼다
//! (docs/log/2026-10-04-app-icon-switch.md · docs/log/2026-10-22-custom-app-icon.md).
//! 후보(내장 넷 + 사용자 그림)가 곧 앱의 아바타 라이브러리다 — 같은 id 를 `[app] app_icon` · `[ai] avatar_claude` · `avatar_codex` ·
//! 오케스트레이션 아티스트(`orchestration/artists.rs` 의 `icon_ok` 가 [`normalize`] 를 빌린다)가 함께 쓴다(docs/log/2026-10-31-avatars.md).
//!
//! 불변식:
//! - 그림을 웹뷰에 주는 길은 data URL 둘뿐이다([`app_icon_list`] · [`app_icon_image`]) — asset 프로토콜 범위를 넓히지 않는다.
//! - 새 창(`on_page_load`, 메인 스레드)은 디스크를 만지지 않는다 — 사용자 아이콘의 바이트는 고르는 순간 읽어 [`CURRENT`] 에 든다.
//! - 내장 id 는 `settings.toml` 의 `[app] app_icon` 값이라 바꾸지 않는다(프런트 `APP_ICONS` 와 같은 글자). 모르는 값(옛 id 포함)은
//!   기본으로 접힌다. 내장 그림의 둥근 마스크는 [`user`] 의 `INSET` · `RADIUS` 와 같은 값으로 `scripts/gen-character-icons.py` 가 만든다.
//! - **바꾸는 것은 창 아이콘뿐이다.** exe · 설치 관리자 · 바로 가기 아이콘은 빌드 리소스라 실행 중에 고칠 수 없다.
//! - 원격 웹 클라이언트는 **읽기만** 한다 — 목록 · 큰 그림은 `remote/deny.rs` 의 허용 표, 고르기 · 넣기 · 지우기 · 이름 바꾸기는 미지원 표다.
//! - Windows 는 [`set_big_icon`] 을 한 자리 더 건다 — Tauri `set_icon` 은 `ICON_SMALL` 만 바꾸고, 제목 표시줄이 없는 우리 창은
//!   작업 표시줄 · Alt+Tab 의 `ICON_BIG` 이 그대로면 화면 어디에도 변화가 없다.
//! - **Windows 작업 표시줄은 창을 같은 exe 경로(또는 앱 ID)의 시작 메뉴 바로 가기와 묶어 바로 가기 아이콘을 그린다** — 그래서 창을
//!   만들기 전에 바로 가기와 다른 앱 ID(`<identifier>.window`)를 걸고([`set_process_app_id`]) 그 앱 ID 의 바로 가기도 우리가 만든다
//!   ([`sync_taskbar`]). 대가: 시작 메뉴 바로 가기를 고정하면 그 단추와 실행 중인 창이 따로 선다(docs/log/2026-10-06-taskbar-app-id.md).

use std::sync::{Arc, OnceLock, RwLock};

use serde::Serialize;
use tauri::image::Image;
use tauri::{AppHandle, Manager, Runtime, Window};

use crate::i18n::tr;

pub(crate) mod user;

/// 빌드 아이콘(`tauri.conf.json` 의 `bundle.icon`)과 **같은 그림** — 기본이면 새 창에 아무것도 걸지 않는다.
pub const DEFAULT_ID: &str = "gpt";

/// `(id, 256px RGBA PNG)`.
const CHARACTERS: &[(&str, &[u8])] = &[
    ("claude", include_bytes!("../icons/characters/claude.png")),
    ("gemini", include_bytes!("../icons/characters/gemini.png")),
    ("gpt", include_bytes!("../icons/characters/gpt.png")),
    ("grok", include_bytes!("../icons/characters/grok.png")),
];

#[derive(Clone)]
struct Current {
    id: String,
    png: Option<Arc<[u8]>>,
}

impl Current {
    fn default_icon() -> Self {
        Self { id: DEFAULT_ID.to_owned(), png: None }
    }

    fn png(&self) -> Option<&[u8]> {
        self.png
            .as_deref()
            .or_else(|| CHARACTERS.iter().find(|(cid, _)| *cid == self.id).map(|(_, bytes)| *bytes))
    }
}

/// `None` = 기본.
static CURRENT: RwLock<Option<Current>> = RwLock::new(None);

/// 모르는 값 · 빈 값(옛 내장 id 포함)은 기본으로 접는다. 사용자 아이콘 id 는 **모양만** 본다(파일은 [`resolve`] 가 본다).
pub fn normalize(raw: Option<&str>) -> String {
    let raw = raw.map(str::trim).unwrap_or_default();
    if CHARACTERS.iter().any(|(id, _)| *id == raw) || user::is_user_id(raw) {
        raw.to_owned()
    } else {
        DEFAULT_ID.to_owned()
    }
}

/// 사용자 아이콘이면 디스크를 읽는다 — setup 이나 블로킹 풀에서.
fn resolve(raw: Option<&str>) -> Current {
    let id = normalize(raw);
    if !user::is_user_id(&id) {
        return Current { id, png: None };
    }
    match user::read(&id) {
        Some(png) => Current { id, png: Some(png.into()) },
        None => {
            eprintln!("[aynx] 사용자 앱 아이콘 {id} 파일이 없어 기본으로 돌아갑니다");
            Current::default_icon()
        }
    }
}

fn current() -> Current {
    CURRENT.read().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_else(Current::default_icon)
}

fn set_current(next: Current) {
    *CURRENT.write().unwrap_or_else(|e| e.into_inner()) = Some(next);
}

fn image_for<R: Runtime>(app: &AppHandle<R>, cur: &Current) -> Option<Image<'static>> {
    match cur.png() {
        Some(bytes) => match Image::from_bytes(bytes) {
            Ok(img) => Some(img),
            Err(e) => {
                eprintln!("[aynx] 앱 아이콘 {} 를 풀지 못했습니다: {e}", cur.id);
                None
            }
        },
        None => app.default_window_icon().map(|img| img.clone().to_owned()),
    }
}

pub fn current_image<R: Runtime>(app: &AppHandle<R>) -> Option<Image<'static>> {
    image_for(app, &current())
}

/// **창을 만들기 전에** 한 번(`run()`). 실패는 삼킨다. Windows 밖에서는 아무 일도 없다.
pub fn set_process_app_id(identifier: &str) {
    let id = APP_ID.get_or_init(|| format!("{identifier}.window"));
    #[cfg(target_os = "windows")]
    win::set_process_app_id(id);
    #[cfg(not(target_os = "windows"))]
    let _ = id;
}

static APP_ID: OnceLock<String> = OnceLock::new();

/// 파일 · COM 이라 블로킹 풀에서 돈다. Windows 밖에서는 아무 일도 없다. 사용자 아이콘도 256px PNG 라([`user::SIZE`])
/// [`ico_from_png`] 의 가정이 그대로 맞는다.
pub fn sync_taskbar<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "windows")]
    {
        let cur = current();
        let (Some(app_id), Some(png), Some(data), Ok(exe)) = (
            APP_ID.get(),
            cur.png(),
            crate::instance::data_root(),
            std::env::current_exe(),
        ) else {
            return;
        };
        let _ = app;
        let spec = crate::taskbar_shortcut::Spec {
            app_id: app_id.clone(),
            name: crate::instance::WINDOW_TITLE.to_owned(),
            exe,
            ico: data.join("app-icons").join("current.ico"),
            ico_bytes: ico_from_png(png),
        };
        tauri::async_runtime::spawn_blocking(move || crate::taskbar_shortcut::sync(&spec));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }
}

/// 256px PNG 하나를 담은 `.ico` — 헤더 6 + 항목 16 바이트 뒤에 PNG 그대로(Vista 이후의 PNG 항목, 폭·높이 0 = 256).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn ico_from_png(png: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(22 + png.len());
    out.extend_from_slice(&[0, 0, 1, 0, 1, 0]); // 예약 · 형식(아이콘) · 항목 1
    out.extend_from_slice(&[0, 0, 0, 0]); // 폭 · 높이(0 = 256) · 팔레트 · 예약
    out.extend_from_slice(&1u16.to_le_bytes()); // 평면
    out.extend_from_slice(&32u16.to_le_bytes()); // 비트
    out.extend_from_slice(&(png.len() as u32).to_le_bytes());
    out.extend_from_slice(&22u32.to_le_bytes()); // 그림 시작
    out.extend_from_slice(png);
    out
}

pub fn init(saved: Option<&str>) {
    set_current(resolve(saved));
}

/// `on_page_load`(메인 스레드)에서 불린다 — PNG 디코드 하나만 하고 디스크를 만지지 않는다.
pub fn apply_to_window<R: Runtime>(window: &Window<R>) {
    let cur = current();
    if cur.id == DEFAULT_ID {
        return;
    }
    if let Some(img) = image_for(window.app_handle(), &cur) {
        set_on(window, &cur.id, img);
    }
}

fn set_on<R: Runtime>(window: &Window<R>, id: &str, img: Image<'static>) {
    set_big_icon(window, id, &img);
    if let Err(e) = window.set_icon(img) {
        eprintln!("[aynx] 창 {} 에 앱 아이콘을 걸지 못했습니다: {e}", window.label());
    }
}

/// Tauri 가 열어 두지 않은 자리라 직접 `WM_SETICON` 을 보낸다. Windows 밖에서는 아무 일도 하지 않는다.
fn set_big_icon<R: Runtime>(window: &Window<R>, id: &str, img: &Image<'_>) {
    #[cfg(target_os = "windows")]
    {
        match window.hwnd() {
            Ok(hwnd) => win::set_big_icon(hwnd.0, id, img),
            Err(e) => eprintln!("[aynx] 창 {} 의 HWND 를 얻지 못했습니다: {e}", window.label()),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, id, img);
    }
}

#[cfg(target_os = "windows")]
mod win {
    use std::sync::Mutex;

    use tauri::image::Image;
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateIcon, SendMessageW, ICON_BIG, WM_SETICON};

    /// **지우지 않는다** — 창이 아직 들고 있는 핸들을 `DestroyIcon` 하면 작업 표시줄이 빈 그림을 그린다. 사용자 아이콘 id 는
    /// 내용 해시라 같은 id 의 그림은 늘 같다.
    static BIG: Mutex<Vec<(String, usize)>> = Mutex::new(Vec::new());

    pub fn set_process_app_id(id: &str) {
        let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
        // SAFETY: 널로 끝나는 UTF-16 버퍼가 호출 동안 살아 있다.
        let hr = unsafe { windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(wide.as_ptr()) };
        if hr < 0 {
            eprintln!("[aynx] 작업 표시줄 앱 ID 를 걸지 못했습니다 (HRESULT {hr:#x})");
        }
    }

    pub fn set_big_icon(hwnd: *mut core::ffi::c_void, id: &str, img: &Image<'_>) {
        let Some(hicon) = icon_for(id, img) else {
            return;
        };
        // SAFETY: 살아 있는 창의 HWND 와 이 모듈이 만들어 지우지 않는 HICON 이다. 다른 스레드의 창이면
        // SendMessage 가 그 스레드의 처리를 기다린다(메시지 하나 — 막힘 없음).
        unsafe {
            SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, hicon as isize);
        }
    }

    fn icon_for(id: &str, img: &Image<'_>) -> Option<usize> {
        let mut cache = super::lock(&BIG);
        if let Some(&(_, h)) = cache.iter().find(|(cid, _)| cid == id) {
            return Some(h);
        }
        let (w, h) = (img.width(), img.height());
        // 32bpp 색 비트는 BGRA(알파가 그대로 쓰인다). AND 마스크(1bpp, 행은 WORD 정렬)는 전부 0 — 알파가 투명을 맡는다.
        let mut bgra = img.rgba().to_vec();
        for px in bgra.as_chunks_mut::<4>().0 {
            px.swap(0, 2);
        }
        let mask = vec![0u8; w.div_ceil(16) as usize * 2 * h as usize];
        // SAFETY: 두 버퍼는 w×h 크기에 맞고 호출 동안 살아 있다. 실패하면 널이 온다.
        let hicon = unsafe {
            CreateIcon(
                std::ptr::null_mut(),
                w as i32,
                h as i32,
                1,
                32,
                mask.as_ptr(),
                bgra.as_ptr(),
            )
        };
        if hicon.is_null() {
            eprintln!("[aynx] 앱 아이콘 {id} 의 큰 아이콘을 만들지 못했습니다");
            return None;
        }
        cache.push((id.to_owned(), hicon as usize));
        Some(hicon as usize)
    }
}

#[cfg(target_os = "windows")]
fn lock<T>(m: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 파일 저장은 프런트의 몫(`saveSettings`) — 메모리의 지금 값과 창 아이콘만 바꾼다. 같은 값이면 아무것도 하지 않는다(창마다
/// 설정을 다시 읽을 때 겹쳐 불린다).
#[tauri::command]
pub async fn set_app_icon(app: AppHandle, id: String) -> Result<(), String> {
    let next = tauri::async_runtime::spawn_blocking(move || resolve(Some(&id)))
        .await
        .map_err(blocking_err)?;
    if next.id == current().id {
        return Ok(());
    }
    switch_to(&app, next);
    Ok(())
}

fn switch_to(app: &AppHandle, next: Current) {
    set_current(next.clone());
    sync_taskbar(app);
    crate::tray::icon_changed(app);
    let Some(img) = image_for(app, &next) else {
        return;
    };
    for window in crate::remote::home_windows(app).values() {
        set_on(&window.as_ref().window(), &next.id, img.clone());
    }
}

/// 썸네일은 `data:` URL(asset 프로토콜 범위를 넓히지 않는다). `name` 이 `null` 이면 화면이 "사용자 N". `added` = 그림 파일 수정 시각(유닉스 ms).
#[derive(Serialize)]
pub struct UserIcon {
    id: String,
    src: String,
    name: Option<String>,
    added: Option<u64>,
}

fn blocking_err(e: impl std::fmt::Display) -> String {
    tr!(ko: "앱 아이콘 작업이 끝나지 못했습니다: {e}", en: "The app icon task did not finish: {e}")
}

#[tauri::command]
pub async fn app_icon_list() -> Result<Vec<UserIcon>, String> {
    let dir = user::dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut names = user::names_at(&dir);
        user::list_at(&dir)
            .into_iter()
            .filter_map(|id| {
                let png = user::read_at(&dir, &id)?;
                let added = user::added_at(&dir, &id);
                Some(UserIcon { src: user::thumb_data_url(&png)?, name: names.remove(&id), added, id })
            })
            .collect()
    })
    .await
    .map_err(blocking_err)
}

/// 내장 넷은 프런트 번들에 원본이 있다. 원격도 읽는다(허용 표).
#[tauri::command]
pub async fn app_icon_image(id: String) -> Result<Option<String>, String> {
    if !user::is_user_id(&id) {
        return Ok(None);
    }
    let dir = user::dir()?;
    tauri::async_runtime::spawn_blocking(move || user::read_at(&dir, &id).and_then(|png| user::full_data_url(&png)))
        .await
        .map_err(blocking_err)
}

/// 고르지는 않는다 — 고르기는 프런트가 [`set_app_icon`] 으로 한다(설정 저장과 한 길).
#[tauri::command]
pub async fn app_icon_add(request: tauri::ipc::Request<'_>) -> Result<UserIcon, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(tr!(ko: "본문이 바이너리가 아닙니다", en: "The body is not binary"));
    };
    let bytes = bytes.clone();
    let dir = user::dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        let (id, png) = user::add_at(&dir, &bytes)?;
        let src = user::thumb_data_url(&png)
            .ok_or_else(|| tr!(ko: "썸네일을 만들지 못했습니다", en: "Could not build the thumbnail"))?;
        let name = user::names_at(&dir).remove(&id);
        let added = user::added_at(&dir, &id);
        Ok(UserIcon { id, src, name, added })
    })
    .await
    .map_err(blocking_err)?
}

/// 곧바로 파일(`names.json`)에 쓴다 — 미저장 변경이 아니다. 빈 글자 = 이름 걷기. 원격은 미지원 표.
#[tauri::command]
pub async fn app_icon_rename(id: String, name: String) -> Result<Option<String>, String> {
    let dir = user::dir()?;
    tauri::async_runtime::spawn_blocking(move || user::set_name_at(&dir, &id, Some(&name)))
        .await
        .map_err(blocking_err)?
}

/// 설정 값은 프런트가 지우고 저장한다.
#[tauri::command]
pub async fn app_icon_remove(app: AppHandle, id: String) -> Result<(), String> {
    let dir = user::dir()?;
    let target = id.clone();
    tauri::async_runtime::spawn_blocking(move || user::remove_at(&dir, &target))
        .await
        .map_err(blocking_err)??;
    if current().id == id {
        switch_to(&app, Current::default_icon());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_folds_unknown_and_blank_to_default() {
        assert_eq!(normalize(None), DEFAULT_ID);
        assert_eq!(normalize(Some("")), DEFAULT_ID);
        assert_eq!(normalize(Some("nobody")), DEFAULT_ID);
        for old in ["aoi", "hikari", "luna", "sumire"] {
            assert_eq!(normalize(Some(old)), DEFAULT_ID, "10-22 에 걷은 옛 내장 id {old} 는 기본으로");
        }
        assert_eq!(DEFAULT_ID, "gpt");
        assert!(CHARACTERS.iter().any(|(id, _)| *id == DEFAULT_ID), "기본은 표 안에");
        assert_eq!(CHARACTERS.len(), 4);
        assert_eq!(normalize(Some(" grok ")), "grok");
        for (id, _) in CHARACTERS {
            assert_eq!(normalize(Some(id)), *id);
        }
        assert_eq!(normalize(Some("user-0123456789ab")), "user-0123456789ab");
        assert_eq!(normalize(Some(" user-0123456789ab ")), "user-0123456789ab");
        assert_eq!(normalize(Some("user-../../vault")), DEFAULT_ID);
        assert_eq!(normalize(Some("user-0123456789AB")), DEFAULT_ID);
    }

    #[test]
    fn resolve_folds_missing_user_icon_to_default() {
        let cur = resolve(Some("user-ffffffffffff"));
        assert_eq!(cur.id, DEFAULT_ID);
        assert!(cur.png.is_none());
        let claude = resolve(Some("claude"));
        assert_eq!(claude.id, "claude");
        assert_eq!(claude.png(), Some(CHARACTERS[0].1), "내장은 표에서 꺼낸다");
    }

    #[test]
    fn ico_wraps_png_as_single_256_entry() {
        let png = CHARACTERS[0].1;
        let ico = ico_from_png(png);
        assert_eq!(&ico[..6], &[0, 0, 1, 0, 1, 0]);
        assert_eq!(&ico[6..8], &[0, 0], "폭·높이 0 = 256");
        assert_eq!(u32::from_le_bytes(ico[14..18].try_into().unwrap()) as usize, png.len());
        assert_eq!(u32::from_le_bytes(ico[18..22].try_into().unwrap()), 22);
        assert_eq!(&ico[22..], png);
    }

    /// 스크립트를 다시 돌린 뒤 깨진 파일이 섞이면 여기서 걸린다.
    #[test]
    fn embedded_icons_decode_as_256px_rgba() {
        for (id, bytes) in CHARACTERS {
            let img = Image::from_bytes(bytes).unwrap_or_else(|e| panic!("{id}: {e}"));
            assert_eq!((img.width(), img.height()), (256, 256), "{id}");
            assert_eq!(img.width(), user::SIZE, "사용자 아이콘과 같은 크기");
            let rgba = img.rgba();
            assert_eq!(rgba[3], 0, "{id} 왼쪽 위 모서리 알파");
            let center = ((128 * 256 + 128) * 4 + 3) as usize;
            assert_eq!(rgba[center], 255, "{id} 가운데 알파");
        }
    }
}

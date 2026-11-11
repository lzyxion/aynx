//! 작업 표시줄 아이콘 — **사용자 시작 메뉴 바로 가기**로 고른 캐릭터를 작업 표시줄에 싣는다 (Windows 전용,
//! docs/log/2026-10-06-taskbar-app-id.md).
//!
//! Windows 11 작업 표시줄은 창의 앱 ID 와 **같은 앱 ID 의 바로 가기**가 있으면 단추에 창 아이콘이 아니라
//! 그 바로 가기 아이콘을 그린다(실측 — 창에 `ICON_BIG` 이 걸려 있어도). 그래서 Chromium 의 프로필 아이콘과 같은 길을 간다:
//!
//! - 아이콘 파일은 **경로 하나로 고정**(`<데이터 루트>/app-icons/current.ico`)하고, 고를 때는 그 **내용만** 바꾼다 —
//!   고정한 단추·암시적 바로 가기처럼 셸이 따로 만든 `.lnk` 도 같은 경로를 계속 가리키게 하려는 것이다.
//! - 사용자 시작 메뉴(`%APPDATA%\Microsoft\Windows\Start Menu\Programs\<이름>.lnk`)에 우리 앱 ID
//!   (`app_icon::set_process_app_id` 가 건 `<identifier>.window`)와 그 아이콘을 가진 바로 가기를 둔다.
//!   MSI 의 바로 가기(모든 사용자, 관리자 전용)는 건드리지 않는다.
//! - 시작 메뉴·`User Pinned`(고정·`ImplicitAppShortcuts`) 아래에서 우리 앱 ID 를 가진 `.lnk` 를 모두 찾아 아이콘이
//!   다른 곳을 가리키면 `current.ico` 로 고치고, `SHCNE_ASSOCCHANGED` + 바로 가기마다 `SHCNE_UPDATEITEM` 을 보낸다 —
//!   Windows 11 은 전역 알림만으로는 작업 표시줄이 갱신되지 않는다(Chromium `profile_shortcut_manager_win.cc`).
//!   실측: 실행 중인 단추가 이것으로 곧바로 바뀐다.
//!
//! 대가(알고 받음): 시작 메뉴에 Aynx 가 둘(MSI 것 + 이것) 보이고, 앱을 제거해도 이 `.lnk` 와 `.ico` 는 남는다.
//! 블로킹(파일·COM)이라 `spawn_blocking` 에서 부른다. 실패는 삼킨다 — 작업 표시줄 그림만 빌드 아이콘으로 남을 뿐이다.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use windows::core::{Interface, HSTRING, PWSTR};
use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
use windows::Win32::System::Com::StructuredStorage::{PropVariantToStringAlloc, PROPVARIANT};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED, STGM_READWRITE,
};
use windows::Win32::System::Variant::VT_LPWSTR;
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{
    IShellLinkW, SHChangeNotify, SHStrDupW, ShellLink, SHCNE_ASSOCCHANGED, SHCNE_UPDATEITEM, SHCNF_FLUSH, SHCNF_IDLIST,
    SHCNF_PATHW,
};

/// 맞출 것 한 벌 — `app_icon` 이 채운다.
pub struct Spec {
    /// 작업 표시줄 앱 ID (`<identifier>.window`)
    pub app_id: String,
    /// 바로 가기 이름·설명 (`Aynx` · 개발 빌드 `Aynx (dev)`)
    pub name: String,
    /// 바로 가기가 띄울 exe (지금 실행 중인 것)
    pub exe: PathBuf,
    /// 고정 경로 `.ico` — 이 파일의 **내용**만 바뀐다
    pub ico: PathBuf,
    /// 그 `.ico` 에 쓸 바이트 (고른 캐릭터)
    pub ico_bytes: Vec<u8>,
}

/// 겹친 고르기(빠른 연타)가 같은 파일·바로 가기를 동시에 쓰지 않게 한 줄로 세운다.
static LOCK: Mutex<()> = Mutex::new(());

/// 아이콘 파일·바로 가기를 맞추고, 무엇이든 바뀌었으면 셸에 알린다. **블로킹** — `spawn_blocking` 에서.
pub fn sync(spec: &Spec) {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let ico_changed = match write_if_changed(&spec.ico, &spec.ico_bytes) {
        Ok(changed) => changed,
        Err(e) => {
            eprintln!("[aynx] 작업 표시줄 아이콘 파일 {} 을 쓰지 못했습니다: {e}", spec.ico.display());
            return;
        }
    };
    // SAFETY: 이 스레드의 COM 을 STA 로 연다. 이미 열려 있으면(S_FALSE) 그대로 쓰고, 열었을 때만 닫는다.
    let com = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if let Err(e) = sync_links(spec, ico_changed) {
        eprintln!("[aynx] 작업 표시줄 바로 가기를 맞추지 못했습니다: {e}");
    }
    if com.is_ok() {
        // SAFETY: 위에서 성공한 CoInitializeEx 의 짝.
        unsafe { CoUninitialize() };
    }
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> std::io::Result<bool> {
    if std::fs::read(path).ok().as_deref() == Some(bytes) {
        return Ok(false);
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, bytes)?;
    Ok(true)
}

fn sync_links(spec: &Spec, ico_changed: bool) -> windows::core::Result<()> {
    let Some(roaming) = dirs::data_dir() else {
        return Ok(());
    };
    let programs = roaming.join(r"Microsoft\Windows\Start Menu\Programs");
    let pinned = roaming.join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned");
    let own = programs.join(format!("{}.lnk", spec.name));

    let mut touched = ico_changed;
    if !own_link_ok(&own, spec) {
        create_link(&own, spec)?;
        touched = true;
    }

    // 우리 앱 ID 의 바로 가기 전부 — 고정·암시적 바로 가기는 셸이 만든 것이라 아이콘 경로가 옛것일 수 있다.
    let mut links = Vec::new();
    for root in [&programs, &pinned] {
        collect_links(root, &mut links);
    }
    let ours: Vec<PathBuf> = links
        .into_iter()
        .filter(|p| read_app_id(p).as_deref() == Some(spec.app_id.as_str()))
        .collect();
    for link in &ours {
        if read_icon(link).as_deref() != Some(spec.ico.as_path()) && set_icon(link, &spec.ico).is_ok() {
            touched = true;
        }
    }

    if touched {
        // SAFETY: 인자 없는 전역 알림, 그리고 널로 끝나는 경로 버퍼를 가리키는 개별 알림.
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST | SHCNF_FLUSH, None, None);
            for link in &ours {
                let wide = HSTRING::from(link.as_os_str());
                SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, Some(wide.as_ptr().cast()), None);
            }
        }
    }
    Ok(())
}

/// 내 바로 가기가 지금 exe·아이콘·앱 ID 를 그대로 갖고 있는가.
fn own_link_ok(path: &Path, spec: &Spec) -> bool {
    path.exists()
        && read_target(path).as_deref() == Some(spec.exe.as_path())
        && read_icon(path).as_deref() == Some(spec.ico.as_path())
        && read_app_id(path).as_deref() == Some(spec.app_id.as_str())
}

fn collect_links(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(t) if t.is_dir() => collect_links(&path, out),
            Ok(t) if t.is_file() && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) => out.push(path),
            _ => {}
        }
    }
}

fn load(path: &Path) -> windows::core::Result<IShellLinkW> {
    // SAFETY: 셸 링크 COM 객체를 만들고 파일에서 읽는다(이 스레드는 COM 이 열려 있다).
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        link.cast::<IPersistFile>()?.Load(&HSTRING::from(path.as_os_str()), STGM_READWRITE)?;
        Ok(link)
    }
}

fn read_target(path: &Path) -> Option<PathBuf> {
    let link = load(path).ok()?;
    let mut buf = [0u16; 1024];
    // SAFETY: 버퍼 길이를 함께 넘긴다. 찾기 데이터는 받지 않는다.
    unsafe { link.GetPath(&mut buf, std::ptr::null_mut(), 0) }.ok()?;
    Some(PathBuf::from(from_wide(&buf)))
}

fn read_icon(path: &Path) -> Option<PathBuf> {
    let link = load(path).ok()?;
    let mut buf = [0u16; 1024];
    let mut index = 0;
    // SAFETY: 버퍼 길이를 함께 넘긴다.
    unsafe { link.GetIconLocation(&mut buf, &mut index) }.ok()?;
    let s = from_wide(&buf);
    (!s.is_empty()).then(|| PathBuf::from(s))
}

fn read_app_id(path: &Path) -> Option<String> {
    let link = load(path).ok()?;
    // SAFETY: 속성 값을 읽어 문자열로 복사하고, 셸이 할당한 버퍼를 돌려준다.
    unsafe {
        let value = link.cast::<IPropertyStore>().ok()?.GetValue(&PKEY_AppUserModel_ID).ok()?;
        let p = PropVariantToStringAlloc(&value).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0.cast()));
        s.filter(|s| !s.is_empty())
    }
}

fn set_icon(path: &Path, ico: &Path) -> windows::core::Result<()> {
    let link = load(path)?;
    // SAFETY: 불러온 링크의 아이콘만 바꿔 같은 파일에 다시 쓴다(다른 속성은 그대로).
    unsafe {
        link.SetIconLocation(&HSTRING::from(ico.as_os_str()), 0)?;
        link.cast::<IPersistFile>()?.Save(&HSTRING::from(path.as_os_str()), true)
    }
}

fn create_link(path: &Path, spec: &Spec) -> windows::core::Result<()> {
    // SAFETY: 새 셸 링크를 채워 저장한다. 앱 ID 값(VT_LPWSTR)은 셸 할당자(SHStrDupW)로 만들어
    // PROPVARIANT 가 버릴 때(PropVariantClear) 함께 풀린다.
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        link.SetPath(&HSTRING::from(spec.exe.as_os_str()))?;
        link.SetIconLocation(&HSTRING::from(spec.ico.as_os_str()), 0)?;
        link.SetDescription(&HSTRING::from(spec.name.as_str()))?;
        let store: IPropertyStore = link.cast()?;
        let value = string_propvariant(&spec.app_id)?;
        store.SetValue(&PKEY_AppUserModel_ID, &value)?;
        store.Commit()?;
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        link.cast::<IPersistFile>()?.Save(&HSTRING::from(path.as_os_str()), true)
    }
}

/// `VT_LPWSTR` 문자열 PROPVARIANT — `From<&str>` 은 BSTR 이라 앱 ID 칸에 맞지 않는다(셸은 LPWSTR 을 기대한다).
unsafe fn string_propvariant(s: &str) -> windows::core::Result<PROPVARIANT> {
    // SAFETY: 셸 할당자로 복사한 문자열을 넣는다. 소유권은 PROPVARIANT 로 넘어간다.
    unsafe {
        let p: PWSTR = SHStrDupW(&HSTRING::from(s))?;
        let mut value = PROPVARIANT::default();
        let inner = &mut *value.Anonymous.Anonymous;
        inner.vt = VT_LPWSTR;
        inner.Anonymous.pwszVal = p;
        Ok(value)
    }
}

fn from_wide(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

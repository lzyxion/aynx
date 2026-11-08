//! `settings.toml` 의 경로 · 읽기(실패하면 기본값) · 깨진 파일 사본 · 전체 다시 쓰기 — `settings.rs` 에서 그대로 옮겼다.
//! 런타임 조회 · Tauri 명령은 부모 `settings.rs` 에 남는다.

use std::path::{Path, PathBuf};

use crate::i18n::tr;

use super::AppSettings;

/// 파일 맨 위에 남기는 안내 — 전체 재작성이라 사람이 고쳐도 다음 저장에 지워진다는 것을 알린다.
const HEADER: &str = "\
# aynx 앱 설정 — 설정 화면에서 저장하면 이 파일 전체가 다시 쓰입니다.
# 손으로 고쳐도 되지만, 앱에서 저장하는 순간 여기 적힌 주석은 사라집니다.
";

/// `<config_dir>/aynx/settings.toml` (개발 빌드는 `aynx-dev` — [`crate::instance::config_root`]).
pub(super) fn settings_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("settings.toml"))
}

/// 경로 하나를 읽는다. **어떤 이유로든 실패하면 기본값**이다 — 설정 파일이 앱을 못 뜨게 하면 안 된다.
///
/// 파일 없음은 정상(첫 실행)이라 조용하고, 그 외 실패만 콘솔에 한 줄 남긴다. 해석 실패면 다음 저장이
/// 기본값으로 덮기 전에 깨진 내용을 옆에 떠 둔다([`keep_broken_copy`]).
pub(super) fn load_at(path: &Path) -> AppSettings {
    let mut settings = match std::fs::read_to_string(path) {
        Ok(content) => match toml::from_str::<AppSettings>(&content) {
            Ok(parsed) => parsed,
            Err(e) => {
                let kept = match keep_broken_copy(path, &content) {
                    Ok(copy) => format!("원본은 {} 에 남겼습니다", copy.display()),
                    Err(e) => format!("원본을 떠 두지 못했습니다: {e}"),
                };
                eprintln!(
                    "[aynx] {} 를 해석할 수 없습니다 — 기본 설정으로 시작합니다({kept}): {e}",
                    path.display()
                );
                AppSettings::default()
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => AppSettings::default(),
        Err(e) => {
            eprintln!(
                "[aynx] {} 읽기 실패 — 기본 설정으로 시작합니다: {e}",
                path.display()
            );
            AppSettings::default()
        }
    };
    settings.sanitize();
    settings
}

/// 깨진 설정을 `settings.toml.broken-<시각>` 으로 **복사**해 둔다 — 다음 저장이 기본값으로 덮어도
/// 손으로 되살릴 수 있게. 같은 내용의 사본이 이미 있으면 그 경로를 돌려준다(좁은 조회가 부를 때마다
/// 쌓이지 않게).
///
/// 옮기지(rename) 않고 복사하는 것은 [`load_at`] 을 부르는 자리가 많고(상태줄 도우미 프로세스 포함)
/// 동시에 돌기 때문이다 — 읽은 뒤 옮기기 전에 다른 저장이 새 파일을 갈아 끼우면 **멀쩡한 파일**을
/// 치우게 된다. 원본은 다음 저장이 원자적으로 바꾼다.
fn keep_broken_copy(path: &Path, content: &str) -> std::io::Result<PathBuf> {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(std::io::ErrorKind::NotFound.into());
    };
    let prefix = format!("{}.broken-", name.to_string_lossy());
    for entry in std::fs::read_dir(dir)?.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix)
            && std::fs::read(entry.path()).is_ok_and(|kept| kept == content.as_bytes())
        {
            return Ok(entry.path());
        }
    }
    let now = chrono::Local::now();
    let mut offset = 0;
    loop {
        let stamp = (now + chrono::Duration::seconds(offset)).format("%Y%m%d-%H%M%S");
        let copy = dir.join(format!("{prefix}{stamp}"));
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&copy) {
            Ok(mut file) => {
                use std::io::Write;
                file.write_all(content.as_bytes())?;
                return Ok(copy);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => offset += 1,
            Err(e) => return Err(e),
        }
    }
}

/// 경로 하나에 **전체를 다시 쓴다**(임시 파일 + rename — [`crate::fs_atomic`]). 상위 디렉터리가 없으면
/// 만든다(첫 저장).
pub(super) fn save_at(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let mut settings = settings.clone();
    settings.sanitize();

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| tr!(ko: "{dir} 폴더를 만들지 못했습니다: {e}", en: "Could not create the folder {dir}: {e}", dir = dir.display()))?;
    }

    let body = toml::to_string_pretty(&settings)
        .map_err(|e| tr!(ko: "설정을 TOML 로 바꾸지 못했습니다: {e}", en: "Could not turn the settings into TOML: {e}"))?;

    crate::fs_atomic::replace_through_link(path, format!("{HEADER}\n{body}").as_bytes())
        .map_err(|e| tr!(ko: "{path} 저장에 실패했습니다: {e}", en: "Could not save {path}: {e}", path = path.display()))
}

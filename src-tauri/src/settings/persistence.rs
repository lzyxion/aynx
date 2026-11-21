//! `settings.toml` 의 경로 · 읽기 · 깨진 파일 사본 · 전체 다시 쓰기.

use std::path::{Path, PathBuf};

use crate::i18n::tr;

use super::AppSettings;

const HEADER: &str = "\
# aynx 앱 설정 — 설정 화면에서 저장하면 이 파일 전체가 다시 쓰입니다.
# 손으로 고쳐도 되지만, 앱에서 저장하는 순간 여기 적힌 주석은 사라집니다.
";

pub(super) fn settings_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("settings.toml"))
}

/// 어떤 이유로든 실패하면 기본값 — 설정 파일이 앱을 못 뜨게 하면 안 된다.
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

/// 다음 저장이 기본값으로 덮어도 되살릴 수 있게 복사해 둔다(같은 내용의 사본이 있으면 그 경로 — 부를 때마다 쌓이지 않게).
/// rename 하지 않는다 — [`load_at`] 은 여러 자리에서 동시에 돌아, 읽은 뒤 다른 저장이 갈아 끼운 멀쩡한 파일을 치우게 된다.
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

/// 전체를 원자적으로 다시 쓴다(임시 파일 + rename).
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

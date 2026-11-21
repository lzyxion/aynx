//! 옛 제품 이름 폴더 → 지금 앱 폴더 1회 이전.

use std::path::Path;

#[cfg(test)]
pub(super) const APP_DIR: &str = crate::instance::app_dir_name(false);

#[cfg(test)]
pub(super) const LEGACY_APP_DIRS: &[&str] = crate::instance::legacy_app_dir_names(false);

/// 복사 폴백은 두지 않는다 — 복사가 중간에 끊기면 두 폴더에 서로 다른 진실이 남는다. 옮기지 못하면 빈 새 폴더로 시작하고 옛 폴더는 그대로 남는다.
pub(crate) fn rename_legacy_dir(old: &Path, new: &Path, what: &str) -> bool {
    if new.exists() || !old.exists() {
        return false;
    }
    match std::fs::rename(old, new) {
        Ok(()) => true,
        Err(e) => {
            eprintln!(
                "[aynx] 옛 {what} 폴더를 옮기지 못했습니다 — 새 폴더로 시작합니다 ({} → {}): {e}",
                old.display(),
                new.display()
            );
            false
        }
    }
}

/// 목록 순서(최근 이름 먼저)로 첫 성공에서 멈춘다. 나머지 후보 폴더는 합치지도 지우지도 않는다 — 어느 쪽이 진실인지는 사용자가 정한다.
pub(crate) fn rename_first_legacy_dir(
    base: &Path,
    legacy: &[&str],
    new_name: &str,
    what: &str,
) -> bool {
    let new = base.join(new_name);
    legacy
        .iter()
        .any(|old| rename_legacy_dir(&base.join(old), &new, what))
}

/// 부팅 최초, 설정을 읽기 전에 딱 한 번 부른다. 개발 빌드는 제 옛 폴더만 본다 — 릴리스의 옛 폴더는 건드리지 않는다.
pub fn migrate_legacy_app_dir() {
    let dev = crate::instance::DEV;
    let config = dirs::config_dir();
    let data = dirs::data_dir();
    for base in config.iter().chain(data.iter().filter(|d| Some(*d) != config.as_ref())) {
        migrate_app_dir_at(
            base,
            crate::instance::legacy_app_dir_names(dev),
            crate::instance::app_dir_name(dev),
        );
    }
}

pub(super) fn migrate_app_dir_at(base: &Path, legacy: &[&str], new_name: &str) -> bool {
    rename_first_legacy_dir(base, legacy, new_name, "설정")
}

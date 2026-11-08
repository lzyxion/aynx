//! 옛 제품 이름 폴더 → 지금 앱 폴더 **1회 이전** — `settings.rs` 에서 그대로 옮겼다(바깥 경로는
//! `crate::settings::{migrate_legacy_app_dir, rename_first_legacy_dir}` 재수출 그대로).

use std::path::Path;

/// **릴리스** 앱 폴더 이름 — 테스트가 이전의 목적지로 쓴다. 앱이 실제로 쓰는 폴더는
/// [`crate::instance::config_root`] 가 정한다(개발 빌드는 `aynx-dev`).
#[cfg(test)]
pub(super) const APP_DIR: &str = crate::instance::app_dir_name(false);

/// 옛 제품 이름 시절의 같은 폴더(릴리스 판) — **이전(migration) 전용**, 결정은
/// [`crate::instance::legacy_app_dir_names`] 한 곳(지금은 비어 있다 — 다음 개명 때 채운다).
///
/// **순서가 곧 우선순위다** — 최근에 쓰던 이름이 앞에 온다. 여러 폴더가 다 남아 있으면 최근 것
/// 하나만 옮기고 나머지는 건드리지 않는다(합치지도, 지우지도 않는다 — [`rename_first_legacy_dir`]).
#[cfg(test)]
pub(super) const LEGACY_APP_DIRS: &[&str] = crate::instance::legacy_app_dir_names(false);

/// 옛 이름의 폴더를 새 이름으로 **한 번만** 옮긴다 — `settings.rs`·`mcp.rs` 공용 원시 함수.
///
/// 규칙이 셋이고 전부 보수적이다:
/// - 새 폴더가 **이미 있으면** 손대지 않는다(이미 이전됐거나 새로 만들어 쓰고 있다).
/// - 옛 폴더가 **없으면** 할 일이 없다(새로 설치한 사용자).
/// - 둘 다 만족할 때만 [`std::fs::rename`] **한 번**. 실패하면 경고 한 줄이고 그대로 부팅한다.
///
/// **복사 폴백을 두지 않는 것이 의도다.** rename 은 원자적이라 "반쯤 옮겨진" 상태가 없지만,
/// 복사는 중간에 끊기면 두 폴더에 서로 다른 진실이 남는다 — 그 상태를 사용자가 풀어야 한다.
/// 옮기지 못하면 그냥 빈 새 폴더로 시작하고, 옛 폴더는 손대지 않은 채 남아 되살릴 수 있다.
///
/// `true` = 실제로 옮겼다.
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

/// 후보 목록을 **순서대로** 훑어 첫 번째로 존재하는 옛 폴더 하나만 옮긴다 — `mcp.rs` 공용.
///
/// 후보는 목록이다(개명이 거듭됐고 지금은 바로 앞 이름 하나만 남겼다 — `instance::legacy_*_dir_names`). 규칙:
/// - 새 폴더가 이미 있으면 [`rename_legacy_dir`] 이 곧바로 `false` 라 **아무것도 안 한다**.
/// - 없으면 목록 순서(= 최근 이름 먼저)로 첫 성공에서 멈춘다.
/// - **나머지 후보 폴더는 그대로 둔다** — 지우지도, 합치지도 않는다. 합치기는 "어느 쪽 파일이
///   진실인가" 를 앱이 정해야 하는 일이고, 그 판단을 사용자에게서 뺏지 않는다.
///
/// `true` = 실제로 하나 옮겼다.
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

/// `<config_dir>/<옛 이름>` → `<config_dir>/aynx` **1회 이전**(후보는 [`crate::instance::legacy_app_dir_names`] — 지금은 없다)
/// (호스트·설정·배치·월페이퍼·볼트·웹훅 파일 보존 — 폴더째 rename 이라 안의 파일은 그대로다).
/// 개발 빌드는 제 옛 폴더(`<옛 이름>-dev` → `aynx-dev`)만 본다 — 릴리스의 옛 폴더는 건드리지 않는다
/// ([`crate::instance::legacy_app_dir_names`]).
///
/// `<data_dir>`(로그·감사·편집 사본)가 `<config_dir>` 와 다른 OS(Linux·macOS)면 거기서도 같은 규칙으로
/// 한 번 옮긴다. Windows 는 둘이 같은 폴더(`%APPDATA%`)다.
///
/// 부팅 최초, 설정을 **읽기 전에** 딱 한 번 부른다 (`lib.rs` 의 `run()` 첫머리).
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

/// 베이스 디렉터리를 받는 순수 I/O — **테스트 대상**.
pub(super) fn migrate_app_dir_at(base: &Path, legacy: &[&str], new_name: &str) -> bool {
    rename_first_legacy_dir(base, legacy, new_name, "설정")
}

//! **설정 옮기기** — 이 PC 의 설정을 `.zip` 한 장으로 내보내고, 다른 PC(또는 같은 PC)에서 미리 본 뒤 들인다
//! (설정 › 일반 › 설정 옮기기 · 팔레트 — docs/log/2026-11-17-settings-transfer.md).
//!
//! | 하위 모듈 | 맡는 것 |
//! | --- | --- |
//! | `catalog` | 허용 목록 하나 — 묶음 경로 → 범주 · `settings.toml` 칸 → 범주 · 설정 루트 파일별 담음/뺌 표 |
//! | `zipfile` | zip 쓰기 · 읽기(경로 탈출 · 크기 상한 · 암호화 · zip64 거절) — `flate2` 위의 작은 구현 |
//! | `export` | 지금 설정에서 범주별 파일을 모은다(허용 목록 밖은 열지도 않는다) |
//! | `import` | 묶음 ↔ 지금 설정을 비교해 미리 보기 줄과 쓸 파일 목록을 **한 함수**로 만든다(미리 보기와 적용이 갈리지 않게) |
//!
//! ## 불변식
//!
//! - **볼트 · 토큰 · 웹훅 URL · 원격 기기는 담지 않는다** — 내보내기는 볼트를 열지도 읽지도 않고(`vault.bin` 을 경로로도 열지 않는다),
//!   허용 목록([`catalog::category_of`])에 없는 파일은 묶음에 있어도 가져오지 않는다. 시험 `export_never_contains_secrets` ·
//!   `import_ignores_unlisted_paths`.
//! - **가져오기는 미리 보기에서 사람이 확정해야만 쓴다** — 미리 보기 명령은 아무것도 바꾸지 않는다. 적용은 Tauri 명령
//!   [`settings_import_apply`] 하나이고 **MCP 에 도구가 없다**. 이것은 위임(AI 권한)을 바꾸는 세 번째 길이다
//!   (호스트 폼 · 타일 AI 권한 팝오버 · 설정 가져오기 — docs/invariants.md 2절). 기본은 파일 값 그대로이고 사람이 [Off 로 들이기]를
//!   고를 수 있다. 위임 블록의 **신원 스냅샷은 그대로 옮긴다** — 이 PC 의 `~/.ssh/config` · DB 연결이 다른 곳을 가리키면 기존 규칙대로
//!   저절로 꺼진다(`Delegation::identity_matches` · `db_level`).
//! - `~/.ssh/config` 는 **덮지 않는다** — 없는 별칭의 `Host` 블록만 끝에 덧붙인다(같은 이름은 그대로 둔다 · `config_edit` 의 덧붙이기 규칙).
//! - 적용 직전 지금 설정을 같은 형식으로 `<설정 루트>/backups/aynx-before-import-<시각>.zip` 에 남기고, 파일마다 원자 교체
//!   (`fs_atomic`)하며, 도중에 실패하면 이미 바꾼 파일을 되돌린다.
//! - 원격 웹 클라이언트에서는 네 명령 모두 막는다(`remote/deny.rs` 의 `HOME_ONLY`).

mod catalog;
mod export;
mod import;
mod zipfile;

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::i18n::tr;

pub(crate) use import::{ImportChoices, PreviewCategory};

/// 묶음 형식 판 — 모르는 판은 거절한다.
pub(crate) const FORMAT: u32 = 1;

/// 읽고 쓰는 세 자리. 시험은 임시 폴더를 넣는다.
#[derive(Debug, Clone)]
pub(crate) struct Roots {
    /// `<config_dir>/aynx[-dev]` — `instance::config_root`.
    pub config: PathBuf,
    /// `~/.aynx[-dev]` — `instance::home_root`(위임 표).
    pub home: PathBuf,
    /// `~/.ssh` — 사용자의 것(두 인스턴스가 같이 본다 — `instance` 머리말).
    pub ssh: PathBuf,
}

impl Roots {
    pub(crate) fn current() -> Result<Roots, String> {
        let missing = || tr!(ko: "설정 폴더를 찾을 수 없습니다", en: "Could not find the settings folder");
        Ok(Roots {
            config: crate::instance::config_root().ok_or_else(missing)?,
            home: crate::instance::home_root().ok_or_else(missing)?,
            ssh: dirs::home_dir().ok_or_else(missing)?.join(".ssh"),
        })
    }

    /// 아무것도 없는 자리 — 내보내기 요약이 "모두 새로" 로 세어 개수를 얻는다.
    fn nowhere() -> Roots {
        let base = std::env::temp_dir().join(format!("aynx-transfer-none-{}", std::process::id())).join("none");
        Roots { config: base.join("c"), home: base.join("h"), ssh: base.join("s") }
    }
}

/// `manifest.json` — 묶음의 머리.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: u32,
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub exported_at: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub files: Vec<ManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestFile {
    pub path: String,
    pub size: u64,
}

/// 받은 묶음 — 허용 목록을 지난 파일만 남는다.
#[derive(Debug, Clone)]
pub struct Bundle {
    pub manifest: Manifest,
    pub files: BTreeMap<String, Vec<u8>>,
}

/// 받은 zip 바이트 → 묶음. 형식 판 · manifest · 경로를 본다. 허용 목록 밖 경로는 조용히 버린다(쓸 자리가 없다).
pub(crate) fn open_bundle(bytes: &[u8]) -> Result<Bundle, String> {
    let entries = zipfile::read(bytes)?;
    let not_ours = || tr!(ko: "Aynx 설정 묶음이 아닙니다(manifest.json 이 없음)", en: "This is not an Aynx settings bundle (no manifest.json)");
    let manifest_bytes = entries.iter().find(|e| e.name == catalog::MANIFEST).ok_or_else(not_ours)?;
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes.bytes).map_err(|_| not_ours())?;
    if manifest.format != FORMAT {
        return Err(tr!(
            ko: "모르는 묶음 형식입니다(판 {v}) — 이 앱을 새 판으로 올린 뒤 다시 가져오세요",
            en: "Unknown bundle format (version {v}) — update this app, then import again",
            v = manifest.format,
        ));
    }
    let files = entries
        .into_iter()
        .filter(|e| catalog::category_of(&e.name).is_some())
        .map(|e| (e.name, e.bytes))
        .collect();
    Ok(Bundle { manifest, files })
}

/// 범주들을 담은 zip 바이트(manifest 첫 장).
pub(crate) fn build_zip(roots: &Roots, categories: &[&str]) -> Result<(Vec<u8>, usize), String> {
    let entries = export::collect(roots, categories)?;
    let manifest = Manifest {
        format: FORMAT,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        exported_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        categories: categories.iter().map(|c| (*c).to_string()).collect(),
        files: entries.iter().map(|e| ManifestFile { path: e.name.clone(), size: e.bytes.len() as u64 }).collect(),
    };
    let mut all = vec![zipfile::Entry {
        name: catalog::MANIFEST.into(),
        bytes: serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    }];
    let files = entries.len();
    all.extend(entries);
    Ok((zipfile::write(&all)?, files))
}

/// 받은 범주 id 를 표의 것으로만 거른다(모르는 글자는 버림).
fn known_categories(raw: &[String]) -> Vec<&'static str> {
    catalog::CATEGORIES.iter().copied().filter(|c| raw.iter().any(|r| r == c)).collect()
}

// ---------------------------------------------------------------------------
// 순수에 가까운 몸통(경로를 받는다 — 시험 대상)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCategory {
    pub id: &'static str,
    pub count: usize,
    pub bytes: u64,
}

pub(crate) fn summary_at(roots: &Roots) -> Result<Vec<ExportCategory>, String> {
    let mut out = Vec::new();
    for &id in catalog::CATEGORIES {
        let entries = export::collect(roots, &[id])?;
        let bytes = entries.iter().map(|e| e.bytes.len() as u64).sum();
        let bundle = Bundle {
            manifest: Manifest { format: FORMAT, app_version: String::new(), exported_at: String::new(), categories: vec![], files: vec![] },
            files: entries.into_iter().map(|e| (e.name, e.bytes)).collect(),
        };
        let plan = import::plan(&Roots::nowhere(), &bundle, &ImportChoices::none())?;
        let count = plan.categories.iter().find(|c| c.id == id).map_or(0, |c| c.items.len());
        out.push(ExportCategory { id, count, bytes });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub app_version: String,
    pub exported_at: String,
    pub categories: Vec<PreviewCategory>,
}

pub(crate) fn preview_at(roots: &Roots, bytes: &[u8]) -> Result<ImportPreview, String> {
    let bundle = open_bundle(bytes)?;
    let plan = import::plan(roots, &bundle, &ImportChoices::none())?;
    Ok(ImportPreview {
        app_version: bundle.manifest.app_version,
        exported_at: bundle.manifest.exported_at,
        categories: plan.categories,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDone {
    pub changed: usize,
    pub backup: String,
    /// 바꾼 파일의 묶음 경로 — 프런트가 무엇을 다시 읽을지 고른다.
    pub touched: Vec<String>,
}

/// 백업 → 적용(파일마다 원자 교체 · 실패하면 되돌림).
pub(crate) fn apply_at(roots: &Roots, bytes: &[u8], choices: &ImportChoices) -> Result<ImportDone, String> {
    let bundle = open_bundle(bytes)?;
    let plan = import::plan(roots, &bundle, choices)?;
    let backup = write_backup(roots)?;
    let _projects = crate::projects::FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut done: Vec<(PathBuf, Option<Vec<u8>>)> = Vec::new();
    for w in &plan.writes {
        let original = match std::fs::read(&w.path) {
            Ok(b) => Some(b),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => {
                restore(&done);
                return Err(io_err(&w.path, &e));
            }
        };
        let result = (|| {
            if let Some(dir) = w.path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            if w.locked {
                let mut out = Ok(());
                crate::worktree::with_file_lock(&w.path, || {
                    out = crate::fs_atomic::replace_through_link(&w.path, &w.bytes);
                    Ok(())
                })
                .map_err(std::io::Error::other)?;
                out
            } else {
                crate::fs_atomic::replace_through_link(&w.path, &w.bytes)
            }
        })();
        if let Err(e) = result {
            restore(&done);
            return Err(io_err(&w.path, &e));
        }
        done.push((w.path.clone(), original));
    }
    Ok(ImportDone {
        changed: plan.changed,
        backup: backup.display().to_string(),
        touched: plan.writes.iter().map(|w| w.label.clone()).collect(),
    })
}

fn io_err(path: &Path, e: &std::io::Error) -> String {
    tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display())
}

/// 이미 바꾼 파일을 원래대로(없던 파일은 지운다). 실패는 삼킨다 — 백업 zip 이 남아 있다.
fn restore(done: &[(PathBuf, Option<Vec<u8>>)]) {
    for (path, original) in done.iter().rev() {
        let _ = match original {
            Some(bytes) => crate::fs_atomic::replace_through_link(path, bytes),
            None => std::fs::remove_file(path),
        };
    }
}

/// 지금 설정 전부를 같은 형식으로 `<설정 루트>/backups/` 에.
fn write_backup(roots: &Roots) -> Result<PathBuf, String> {
    let (zip, _) = build_zip(roots, catalog::CATEGORIES)?;
    let dir = roots.config.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| io_err(&dir, &e))?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let mut path = dir.join(format!("aynx-before-import-{stamp}.zip"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("aynx-before-import-{stamp}-{n}.zip"));
        n += 1;
    }
    crate::fs_atomic::write_atomic(&path, &zip).map_err(|e| io_err(&path, &e))?;
    Ok(path)
}

/// 사람이 고른 저장 · 열기 자리 — `.zip` 만.
fn zip_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    let ok = path.is_absolute() && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip"));
    if !ok {
        return Err(tr!(ko: ".zip 파일을 골라 주세요", en: "Pick a .zip file"));
    }
    Ok(path)
}

fn read_zip_file(path: &Path) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(path)
        .map_err(|e| tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()))?;
    if meta.len() > zipfile::MAX_ARCHIVE_BYTES {
        return Err(tr!(ko: "파일이 너무 큽니다", en: "The file is too large"));
    }
    std::fs::read(path).map_err(|e| tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()))
}

fn join_err(e: impl std::fmt::Display) -> String {
    tr!(ko: "설정 옮기기 작업이 실패했습니다: {e}", en: "The settings transfer task failed: {e}")
}

// ---------------------------------------------------------------------------
// 명령 — 전부 async + spawn_blocking(디스크) · 원격 창에서는 막힘(`remote/deny.rs` HOME_ONLY) · MCP 도구 없음
// ---------------------------------------------------------------------------

/// 내보내기 모달의 범주별 개수 · 크기(아무것도 쓰지 않는다).
#[tauri::command]
pub async fn settings_export_summary() -> Result<Vec<ExportCategory>, String> {
    tauri::async_runtime::spawn_blocking(|| summary_at(&Roots::current()?)).await.map_err(join_err)?
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDone {
    pub path: String,
    pub bytes: u64,
    pub files: usize,
}

/// 고른 범주를 `.zip` 한 장으로 쓴다.
#[tauri::command]
pub async fn settings_export(path: String, categories: Vec<String>) -> Result<ExportDone, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = zip_path(&path)?;
        let cats = known_categories(&categories);
        if cats.is_empty() {
            return Err(tr!(ko: "담을 범주를 하나 이상 고르세요", en: "Pick at least one category"));
        }
        let (zip, files) = build_zip(&Roots::current()?, &cats)?;
        crate::fs_atomic::write_atomic(&path, &zip).map_err(|e| io_err(&path, &e))?;
        Ok(ExportDone { path: path.display().to_string(), bytes: zip.len() as u64, files })
    })
    .await
    .map_err(join_err)?
}

/// 묶음을 읽어 미리 보기 줄을 만든다 — **아무것도 바꾸지 않는다**.
#[tauri::command]
pub async fn settings_import_preview(path: String) -> Result<ImportPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_zip_file(&zip_path(&path)?)?;
        preview_at(&Roots::current()?, &bytes)
    })
    .await
    .map_err(join_err)?
}

/// 사람이 미리 보기에서 확정한 대로 들인다(백업 먼저). 파일을 **다시 읽어** 다시 판정한다 — 프런트가 보낸 것은 선택뿐이다.
#[tauri::command]
pub async fn settings_import_apply(app: tauri::AppHandle, path: String, choices: ImportChoices) -> Result<ImportDone, String> {
    let done = tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_zip_file(&zip_path(&path)?)?;
        apply_at(&Roots::current()?, &bytes, &choices)
    })
    .await
    .map_err(join_err)??;
    use tauri::Emitter;
    let touched = |p: &str| done.touched.iter().any(|t| t == p);
    if touched(catalog::DELEGATION) {
        let _ = app.emit(crate::delegation::CHANGED_EVENT, ());
    }
    if touched("config/projects.json") {
        let _ = app.emit(crate::projects::CHANGED_EVENT, ());
    }
    if touched("config/theme-profiles.json") {
        let _ = app.emit("theme-profiles-changed", ());
    }
    if touched("config/orchestration-artists.toml") {
        let _ = app.emit(crate::orchestration::artists::CHANGED, ());
    }
    Ok(done)
}

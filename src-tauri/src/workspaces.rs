//! 워크스페이스 v2 저장·이관. 모든 빌드와 창이 이 경로를 사용한다.
//!
//! 불변식:
//! - 구형 파일은 migrate.rs에서만 읽는다. 부팅 조회 전에 미완료 journal을 회복한다.
//! - kind/version으로 v1을 구분하며 이관 commit 전에는 새 API로 덮어쓰지 않는다.
//! - 영속 tabKey/tileKey는 파일 전체에서 유일하다. 트리의 추가 필드는 Value로 보존한다.
//! - 최신 파일에 범위별 변경만 적용하고 writer의 실제 창 label과 generation을 함께 검사한다.
//! - 파일 IO는 전부 async + spawn_blocking. save_at의 성공 응답만 저장 완료를 뜻한다.
//! - workspace 연산은 workspaces FILE_LOCK만 잡는다. 프로젝트 목록에는 접근하지 않는다.
//! - 이관은 원본 전체 검사 → 원본 바이트 백업 → journal → workspace 대상 → layout 보관 → 기록 순서다.
//! - 제목·경로·트리 본문을 로그나 Debug에 담지 않는다. 오류는 파일/위치/기계 코드만 담는다.
//!
//! schema.rs: 값·순수 검증/정규화, store.rs: lease·변경, migrate.rs: 계획·commit/복구.

mod migrate;
pub(crate) mod schema;
mod store;
#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use crate::i18n::tr;
use schema::{Mutation, Scope, WorkspaceFile};
use store::{Error, Journal, LoadResult, Writers};

static FILE_LOCK: LazyLock<Mutex<Writers>> = LazyLock::new(|| Mutex::new(Writers::default()));

fn workspace_error(error: Error) -> String {
    match error {
        Error::Failed { message } => message,
        _ => tr!(
            ko: "워크스페이스 파일이 유효하지 않습니다",
            en: "The workspace file is invalid"
        ),
    }
}

fn root() -> Result<PathBuf, Error> {
    crate::instance::config_root().ok_or_else(|| crate::app_state::missing_dir().into())
}

fn task_error(e: impl std::fmt::Display) -> Error {
    Error::from(
        tr!(ko: "워크스페이스 작업이 실패했습니다: {e}", en: "The workspace task failed: {e}"),
    )
}

#[tauri::command]
pub async fn workspaces_load() -> Result<LoadResult, Error> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let root = root()?;
        if root
            .join("workspaces-migration.json")
            .try_exists()
            .map_err(|_| store::failure("journalReadFailed"))?
        {
            migrate::migrate_at(&root, &mut migrate::RandomIds, |_| Ok(()))?;
        }
        store::load_at_root(&root)
    })
    .await
    .map_err(task_error)?
}

/// label은 요청 JSON이 아니라 Tauri의 실제 호출 창에서 가져온다.
#[tauri::command]
pub async fn workspaces_claim_writer(
    window: tauri::WebviewWindow,
    scope: Scope,
) -> Result<u64, Error> {
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let mut writers = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        writers.claim(scope, label)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn workspaces_apply(
    window: tauri::WebviewWindow,
    mutation: Mutation,
) -> Result<u64, Error> {
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let writers = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        store::apply_at(&root()?, &writers, &label, mutation)
    })
    .await
    .map_err(task_error)?
}

/// 첫 실행의 메인 부팅에서 엄격하게 이관한다.
#[tauri::command]
pub async fn workspaces_migrate() -> Result<WorkspaceFile, Error> {
    tauri::async_runtime::spawn_blocking(move || {
        let _workspaces = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        migrate::migrate_at(&root()?, &mut migrate::RandomIds, |_| Ok(()))
    })
    .await
    .map_err(task_error)?
}

/// 복구 화면에서 명시적으로 선택한 새 시작. 원본과 journal을 같은 백업 폴더로 옮긴다.
#[tauri::command]
pub async fn workspaces_start_fresh() -> Result<WorkspaceFile, Error> {
    tauri::async_runtime::spawn_blocking(move || {
        let _workspaces = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let root = root()?;
        migrate::backup_for_fresh_start(&root)?;
        migrate::migrate_at(&root, &mut migrate::RandomIds, |_| Ok(()))
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn workspaces_migration_status() -> Result<Option<Journal>, Error> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        migrate::status_at(&root()?)
    })
    .await
    .map_err(task_error)?
}

/// mailbox 잠금 안에서 부른다. 저장 실패면 mailbox와 세션 owner는 원래대로 남는다.
pub(crate) fn transfer_handoff(
    label: &str,
    workspace_id: String,
    source_tab_key: String,
    source_label: &str,
    source_scope: &Scope,
    tab: schema::SavedWorkspaceTab,
    merge: Option<schema::TabMerge>,
) -> Result<(), String> {
    let writers = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let root = root().map_err(workspace_error)?;
    if !writers.owns_label(source_scope, source_label) || !writers.owns_label(&tab.placement, label)
    {
        return Err("handoffWriterMismatch".into());
    }
    let file = match store::load_at_root(&root).map_err(workspace_error)? {
        LoadResult::V2 { file } => file,
        _ => return Err("workspaceLoadFailed".into()),
    };
    if !file.workspaces.iter().any(|workspace| {
        workspace.id == workspace_id
            && workspace
                .tabs
                .iter()
                .any(|source| source.tab_key == source_tab_key && &source.placement == source_scope)
    }) {
        return Err("handoffSourceMismatch".into());
    }
    // 탭 전체 이관은 기존 MoveTab 계약을 그대로 사용한다.
    let arriving_key = tab.tab_key.clone();
    let mutation = if source_tab_key == tab.tab_key && merge.is_none() {
        Mutation::MoveTab {
            tab_key: tab.tab_key,
            to_workspace_id: Some(workspace_id),
            to_placement: tab.placement,
        }
    } else {
        Mutation::TransferTab {
            workspace_id,
            source_tab_key,
            tab: Box::new(tab),
            merge,
        }
    };
    store::apply_at(&root, &writers, label, mutation).map_err(workspace_error)?;
    // 받는 큐가 이미 멈춰 있으므로 일반 이관은 arrival 보호가 필요 없다(즉시 탭 닫기도 삭제).
    writers.acknowledge_arrival(&arriving_key);
    Ok(())
}

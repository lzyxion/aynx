//! 최신 디스크 상태에 범위별 변경을 적용한다. 전역 잠금은 부모의 FILE_LOCK이다.
use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::migrate::IdSource;
use super::schema::*;
use crate::app_state::{load_at, save_at};
use crate::i18n::tr;

#[derive(Debug, Serialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum Error {
    Stale,
    NeedsMigration,
    Empty,
    Corrupt { problems: Vec<Problem> },
    Invalid { problems: Vec<Problem> },
    Failed { message: String },
}

impl From<String> for Error {
    fn from(message: String) -> Self {
        Self::Failed { message }
    }
}

#[derive(Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum LoadResult {
    V2 { file: Box<WorkspaceFile> },
    NeedsMigration,
    Empty,
    Corrupt { problems: Vec<Problem> },
}

#[derive(Default)]
pub(super) struct Writers {
    next_generation: u64,
    leases: HashMap<Scope, (String, u64)>,
    // 보조 X로 main에 돌린 배치는 아직 메인 UI에 없으므로 옛 PutTabs가 삭제하면 안 된다.
    arrivals: std::sync::Mutex<HashSet<String>>,
}

impl Writers {
    pub(super) fn claim(&mut self, scope: Scope, label: String) -> Result<u64, Error> {
        self.next_generation = self
            .next_generation
            .checked_add(1)
            .ok_or_else(|| failure("generationOverflow"))?;
        self.leases.insert(scope, (label, self.next_generation));
        Ok(self.next_generation)
    }

    pub(super) fn owns_label(&self, scope: &Scope, label: &str) -> bool {
        self.leases
            .get(scope)
            .is_some_and(|(owner, _)| owner == label)
    }

    pub(super) fn acknowledge_arrival(&self, key: &str) {
        self.arrivals
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(key);
    }

    fn owns(&self, scope: &Scope, label: &str, generation: u64) -> bool {
        self.leases
            .get(scope)
            .is_some_and(|(owner, current)| owner == label && *current == generation)
    }
}

pub(super) fn failure(code: &str) -> Error {
    Error::Failed {
        message: tr!(ko: "워크스페이스 작업을 완료하지 못했습니다 ({code})", en: "Could not complete the workspace operation ({code})"),
    }
}

/// kind/version를 먼저 분기한다. 손상 파일과 v1은 절대로 v2 변경의 입력이 되지 않는다.
pub(super) fn load_at_root(root: &Path) -> Result<LoadResult, Error> {
    let Some(raw) = load_at(&root.join("workspaces.json"))? else {
        return Ok(LoadResult::Empty);
    };
    let corrupt = |code| LoadResult::Corrupt {
        problems: vec![Problem::new("workspaces.json", None, "", code)],
    };
    let value: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Ok(corrupt("invalidJson")),
    };
    if value.get("kind").is_none() && value["version"] == 1 {
        return Ok(LoadResult::NeedsMigration);
    }
    if value["kind"] != "aynx.workspaces" || value["version"] != 2 {
        return Ok(corrupt("unknownSchema"));
    }
    let mut file: WorkspaceFile = match serde_json::from_value(value) {
        Ok(f) => f,
        Err(_) => return Ok(corrupt("invalidSchema")),
    };
    if let Err(problems) = validate(&file) {
        return Ok(LoadResult::Corrupt { problems });
    }
    normalize(&mut file);
    Ok(LoadResult::V2 {
        file: Box::new(file),
    })
}

pub(super) fn save_file(root: &Path, file: &WorkspaceFile) -> Result<(), Error> {
    validate(file).map_err(|problems| Error::Invalid { problems })?;
    let json = serde_json::to_string_pretty(file).map_err(|_| failure("serialize"))?;
    save_at(&root.join("workspaces.json"), &json)?;
    Ok(())
}

pub(super) fn workspace_index(file: &WorkspaceFile, id: &str) -> Result<usize, Error> {
    file.workspaces
        .iter()
        .position(|w| w.id == id)
        .ok_or_else(|| failure("workspaceMissing"))
}

/// 호출자는 workspaces FILE_LOCK을 쥔다. 프로젝트 파일에는 접근하지 않는다.
pub(super) fn apply_at(
    root: &Path,
    writers: &Writers,
    label: &str,
    mutation: Mutation,
) -> Result<u64, Error> {
    if root.join("workspaces-migration.json").try_exists().map_err(|e| Error::from(tr!(ko: "이관 journal을 확인하지 못했습니다: {e}", en: "Could not check the migration journal: {e}")))? {
        return Err(failure("migrationPending"));
    }
    let mut file = match load_at_root(root)? {
        LoadResult::V2 { file } => *file,
        LoadResult::NeedsMigration => return Err(Error::NeedsMigration),
        LoadResult::Empty => return Err(Error::Empty),
        LoadResult::Corrupt { problems } => return Err(Error::Corrupt { problems }),
    };
    let mut arrivals = Vec::new();
    let mut acknowledged = Vec::new();
    match mutation {
        Mutation::PutTabs {
            workspace_id,
            scope,
            generation,
            tabs,
            last_active,
        } => {
            if !writers.owns(&scope, label, generation) {
                return Err(Error::Stale);
            }
            let index = workspace_index(&file, &workspace_id)?;
            if tabs.iter().any(|t| t.placement != scope) {
                return Err(failure("placementMismatch"));
            }
            let incoming: HashSet<_> = tabs.iter().map(|t| t.tab_key.as_str()).collect();
            if file.workspaces.iter().any(|w| {
                w.tabs.iter().any(|t| {
                    incoming.contains(t.tab_key.as_str())
                        && (w.id != workspace_id || t.placement != scope)
                })
            }) {
                return Err(failure("tabKeyCollision"));
            }
            let mut tabs = tabs;
            let pending = writers.arrivals.lock().unwrap_or_else(|p| p.into_inner());
            for existing in &file.workspaces[index].tabs {
                if existing.placement != scope || !pending.contains(&existing.tab_key) {
                    continue;
                }
                if tabs.iter().any(|tab| tab.tab_key == existing.tab_key) {
                    acknowledged.push(existing.tab_key.clone());
                } else {
                    tabs.push(existing.clone());
                }
            }
            drop(pending);
            let workspace = &mut file.workspaces[index];
            // 원래 scope의 첫 위치에 새 목록을 넣어 다른 scope들의 상대 순서도 보존한다.
            let at = workspace
                .tabs
                .iter()
                .position(|t| t.placement == scope)
                .unwrap_or(workspace.tabs.len());
            workspace.tabs.retain(|t| t.placement != scope);
            workspace.tabs.splice(at..at, tabs);
            if let Some(last) = last_active {
                workspace.last_active = last;
            }
        }
        Mutation::MoveTab {
            tab_key,
            to_workspace_id,
            to_placement,
        } => {
            let (from, tab_index) = file
                .workspaces
                .iter()
                .enumerate()
                .find_map(|(i, w)| {
                    w.tabs
                        .iter()
                        .position(|t| t.tab_key == tab_key)
                        .map(|j| (i, j))
                })
                .ok_or_else(|| failure("tabMissing"))?;
            let to = match to_workspace_id {
                Some(id) => workspace_index(&file, &id)?,
                None => from,
            };
            let mut tab = file.workspaces[from].tabs.remove(tab_index);
            tab.placement = to_placement;
            arrivals.push(tab.tab_key.clone());
            file.workspaces[to].tabs.push(tab);
        }
        Mutation::TransferTab {
            workspace_id,
            source_tab_key,
            tab,
            merge,
        } => transfer_tab(&mut file, &workspace_id, &source_tab_key, *tab, merge)?,
        Mutation::ReturnAuxGroup {
            workspace_id,
            group_id,
        } => {
            let scope = Scope::Aux { group_id };
            if !writers
                .leases
                .get(&scope)
                .is_some_and(|(owner, _)| owner == label)
            {
                return Err(Error::Stale);
            }
            let index = workspace_index(&file, &workspace_id)?;
            for tab in &mut file.workspaces[index].tabs {
                if tab.placement == scope {
                    tab.placement = Scope::Main;
                    arrivals.push(tab.tab_key.clone());
                }
            }
        }
        Mutation::CreateWorkspace {
            id,
            name,
            icon,
            color,
        } => {
            file.workspaces.push(Workspace {
                id,
                name,
                icon,
                color,
                tabs: Vec::new(),
                last_active: LastActive::default(),
                extra: Default::default(),
            });
        }
        Mutation::RenameWorkspace { id, name } => {
            let i = workspace_index(&file, &id)?;
            file.workspaces[i].name = name;
        }
        Mutation::SetWorkspaceStyle { id, icon, color } => {
            let i = workspace_index(&file, &id)?;
            file.workspaces[i].icon = icon;
            file.workspaces[i].color = color;
        }
        Mutation::ReorderWorkspaces { ids } => {
            let unique: HashSet<_> = ids.iter().map(String::as_str).collect();
            if ids.len() != file.workspaces.len()
                || unique.len() != ids.len()
                || file
                    .workspaces
                    .iter()
                    .any(|w| !unique.contains(w.id.as_str()))
            {
                return Err(failure("invalidPermutation"));
            }
            let mut by_id: HashMap<_, _> = file
                .workspaces
                .drain(..)
                .map(|w| (w.id.clone(), w))
                .collect();
            file.workspaces = ids
                .into_iter()
                .map(|id| by_id.remove(&id).expect("validated permutation"))
                .collect();
        }
        Mutation::SetActiveWorkspace { id } => {
            workspace_index(&file, &id)?;
            file.active_workspace_id = id;
        }
        Mutation::DeleteWorkspace { id } => {
            let i = workspace_index(&file, &id)?;
            if file.workspaces.len() == 1 {
                return Err(failure("lastWorkspace"));
            }
            if !file.workspaces[i].tabs.is_empty() {
                return Err(failure("workspaceHasTabs"));
            }
            file.workspaces.remove(i);
            if file.active_workspace_id == id {
                file.active_workspace_id = file.workspaces[0].id.clone();
            }
        }
        Mutation::RewriteHostAliases { aliases, to } => {
            let keys: HashSet<_> = aliases
                .iter()
                .map(|alias| alias.trim().to_lowercase())
                .filter(|alias| !alias.is_empty())
                .collect();
            let to = to
                .as_deref()
                .map(str::trim)
                .filter(|alias| !alias.is_empty());
            for workspace in &mut file.workspaces {
                for tab in &mut workspace.tabs {
                    tab.root = rewrite_host_tree(&tab.root, &keys, to)
                        .unwrap_or_else(|| empty_host_tree(&tab.root));
                }
            }
        }
        Mutation::ReturnAuxTabsToMain => return_aux_tabs_to_main(&mut file),
    }
    normalize(&mut file);
    file.revision = file
        .revision
        .checked_add(1)
        .ok_or_else(|| failure("revisionOverflow"))?;
    validate(&file).map_err(|problems| Error::Invalid { problems })?;
    save_file(root, &file)?;
    let mut pending = writers.arrivals.lock().unwrap_or_else(|p| p.into_inner());
    for key in acknowledged {
        pending.remove(&key);
    }
    pending.extend(arrivals);
    Ok(file.revision)
}

/// journal의 phase는 기계 코드다. 미완료 이관은 migrate 명령에서만 회복한다.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub phase: String,
    pub backup_dir: String,
    pub layout_id_to_workspace_id: HashMap<String, String>,
    pub started_at: String,
}

// 타일 tear/타일 위 merge도 단일 원자적 파일 변경이다. 원본 제거와 대상 추가 사이 IO가 없다.
fn remove_tiles(root: &serde_json::Value, keys: &HashSet<String>) -> Option<serde_json::Value> {
    if root.get("dir").is_some() {
        let a = remove_tiles(&root["a"], keys);
        let b = remove_tiles(&root["b"], keys);
        match (a, b) {
            (Some(a), Some(b)) => {
                let mut next = root.clone();
                next["a"] = a;
                next["b"] = b;
                Some(next)
            }
            (Some(node), None) | (None, Some(node)) => Some(node),
            (None, None) => None,
        }
    } else if root["tileKey"]
        .as_str()
        .is_some_and(|key| keys.contains(key))
    {
        None
    } else {
        Some(root.clone())
    }
}

fn insert_tree(
    root: &mut serde_json::Value,
    incoming: &serde_json::Value,
    merge: &TabMerge,
) -> bool {
    if root["tileKey"].as_str() == Some(merge.tile_key.as_str()) {
        let target = root.clone();
        let (a, b) = if merge.side == "before" {
            (incoming.clone(), target)
        } else {
            (target, incoming.clone())
        };
        *root = serde_json::json!({"dir": merge.dir, "ratio": 0.5, "a": a, "b": b});
        return true;
    }
    if root.get("dir").is_some() {
        return insert_tree(&mut root["a"], incoming, merge)
            || insert_tree(&mut root["b"], incoming, merge);
    }
    false
}

fn transfer_tab(
    file: &mut WorkspaceFile,
    workspace_id: &str,
    source_tab_key: &str,
    incoming: SavedWorkspaceTab,
    merge: Option<TabMerge>,
) -> Result<(), Error> {
    let index = workspace_index(file, workspace_id)?;
    let workspace = &mut file.workspaces[index];
    let source = workspace
        .tabs
        .iter()
        .position(|tab| tab.tab_key == source_tab_key)
        .ok_or_else(|| failure("tabMissing"))?;
    if source_tab_key == incoming.tab_key {
        workspace.tabs.remove(source);
    } else {
        let keys = inspect_tree(&incoming.root, "handoff", None, true)
            .map_err(|problems| Error::Invalid { problems })?
            .into_iter()
            .collect::<HashSet<_>>();
        let source_keys = inspect_tree(&workspace.tabs[source].root, "handoff", None, true)
            .map_err(|problems| Error::Invalid { problems })?;
        if keys.iter().any(|key| !source_keys.contains(key)) {
            return Err(failure("sourceTileMissing"));
        }
        workspace.tabs[source].root = remove_tiles(&workspace.tabs[source].root, &keys)
            .unwrap_or_else(|| {
                serde_json::json!({"kind": "start", "tileKey": super::migrate::RandomIds.uuid()})
            });
    }
    if let Some(merge) = merge {
        if !matches!(merge.dir.as_str(), "row" | "col")
            || !matches!(merge.side.as_str(), "before" | "after")
        {
            return Err(failure("invalidMerge"));
        }
        let target = workspace
            .tabs
            .iter_mut()
            .find(|tab| tab.tab_key == merge.tab_key && tab.placement == incoming.placement)
            .ok_or_else(|| failure("mergeTargetMissing"))?;
        if !insert_tree(&mut target.root, &incoming.root, &merge) {
            return Err(failure("mergeTargetMissing"));
        }
    } else {
        workspace.tabs.push(incoming);
    }
    Ok(())
}

fn empty_host_tree(root: &serde_json::Value) -> serde_json::Value {
    if root.get("dir").is_some() {
        empty_host_tree(&root["a"])
    } else {
        serde_json::json!({"kind": "start", "tileKey": root["tileKey"]})
    }
}

fn rewrite_host_tree(
    root: &serde_json::Value,
    aliases: &HashSet<String>,
    to: Option<&str>,
) -> Option<serde_json::Value> {
    if root.get("dir").is_some() {
        let a = rewrite_host_tree(&root["a"], aliases, to);
        let b = rewrite_host_tree(&root["b"], aliases, to);
        return match (a, b) {
            (Some(a), Some(b)) => {
                let mut next = root.clone();
                next["a"] = a;
                next["b"] = b;
                Some(next)
            }
            (Some(node), None) | (None, Some(node)) => Some(node),
            (None, None) => None,
        };
    }
    let alias = root["alias"]
        .as_str()
        .or_else(|| root["startProject"]["host"].as_str());
    if root["adhoc"].is_object()
        || !alias.is_some_and(|alias| aliases.contains(&alias.trim().to_lowercase()))
    {
        return Some(root.clone());
    }
    let to = to?;
    let mut next = root.clone();
    if next["alias"].is_string() {
        next["alias"] = to.into();
    }
    if next["startProject"]["host"].is_string() {
        next["startProject"]["host"] = to.into();
    }
    Some(next)
}

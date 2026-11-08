//! v2 값·검증. 트리의 추가 필드는 Value로 보존하고 런타임 상태는 해석하지 않는다.
use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFile {
    pub kind: String,
    pub version: u32,
    pub revision: u64,
    pub active_workspace_id: String,
    pub workspaces: Vec<Workspace>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub migration: Option<MigrationRecord>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub tabs: Vec<SavedWorkspaceTab>,
    pub last_active: LastActive,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastActive {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tile_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<u64>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedWorkspaceTab {
    pub tab_key: String,
    pub placement: Scope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_folder: Option<String>,
    pub title: String,
    pub root: Value,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Scope {
    Main,
    Aux {
        #[serde(rename = "groupId")]
        group_id: String,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRecord {
    pub from: u32,
    pub at: String,
    pub backup_dir: String,
    pub imported_layouts: usize,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// 사람이 적은 제목·경로·원시 JSON을 오류에 담지 않는다. code는 번역하지 않는 기계 코드다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
    pub path: String,
    pub code: String,
}

impl Problem {
    pub fn new(file: &str, index: Option<usize>, path: &str, code: &str) -> Self {
        Self {
            file: file.into(),
            index,
            path: path.into(),
            code: code.into(),
        }
    }
}

/// SavedNode의 구조만 검사한다. a/b 둘 다 필수이며 잎은 kind와 영속 키를 가진다.
/// 구형 이관에서는 keys=false로 먼저 검사한 뒤 새 키를 넣는다.
pub(super) fn inspect_tree(
    root: &Value,
    file: &str,
    index: Option<usize>,
    keys: bool,
) -> Result<Vec<String>, Vec<Problem>> {
    let mut tiles = Vec::new();
    let mut problems = Vec::new();
    let null = Value::Null;
    let mut stack = vec![(root, String::from("root"), 0)];
    while let Some((node, path, depth)) = stack.pop() {
        let Some(o) = node.as_object() else {
            problems.push(Problem::new(file, index, &path, "invalidNode"));
            continue;
        };
        if depth > 64 {
            problems.push(Problem::new(file, index, &path, "treeTooDeep"));
            continue;
        }
        if o.contains_key("dir") {
            if !matches!(o["dir"].as_str(), Some("row" | "col"))
                || !o.get("ratio").is_some_and(Value::is_number)
            {
                problems.push(Problem::new(file, index, &path, "invalidSplit"));
            }
            for key in ["b", "a"] {
                stack.push((
                    o.get(key).unwrap_or(&null),
                    format!("{path}.{key}"),
                    depth + 1,
                ));
            }
        } else {
            if !o
                .get("kind")
                .and_then(Value::as_str)
                .is_some_and(|k| !k.is_empty())
                || o.contains_key("a")
                || o.contains_key("b")
            {
                problems.push(Problem::new(file, index, &path, "invalidLeaf"));
            }
            if keys {
                match o.get("tileKey").and_then(Value::as_str) {
                    Some(k) if !k.trim().is_empty() => tiles.push(k.to_string()),
                    _ => problems.push(Problem::new(file, index, &path, "missingTileKey")),
                }
            }
        }
    }
    if problems.is_empty() {
        Ok(tiles)
    } else {
        Err(problems)
    }
}

pub fn validate(file: &WorkspaceFile) -> Result<(), Vec<Problem>> {
    let mut problems = Vec::new();
    let mut add =
        |path: &str, code: &str| problems.push(Problem::new("workspaces.json", None, path, code));
    if file.kind != "aynx.workspaces" {
        add("kind", "unknownKind");
    }
    if file.version != 2 {
        add("version", "unknownVersion");
    }
    if file.workspaces.is_empty() {
        add("workspaces", "emptyWorkspaces");
    }
    let mut ids = HashSet::new();
    let mut tabs = HashSet::new();
    let mut tiles = HashSet::new();
    for (i, workspace) in file.workspaces.iter().enumerate() {
        let mut add = |path: &str, code: &str| {
            problems.push(Problem::new("workspaces.json", Some(i), path, code))
        };
        if workspace.id.trim().is_empty() || !ids.insert(workspace.id.as_str()) {
            add("id", "invalidWorkspaceId");
        }
        if workspace.name.trim().is_empty() {
            add("name", "emptyName");
        }
        for tab in &workspace.tabs {
            if tab.tab_key.trim().is_empty() || !tabs.insert(tab.tab_key.as_str()) {
                add("tabs.tabKey", "invalidTabKey");
            }
            if matches!(&tab.placement, Scope::Aux { group_id } if group_id.trim().is_empty()) {
                add("tabs.placement", "emptyGroupId");
            }
        }
        for tab in &workspace.tabs {
            match inspect_tree(&tab.root, "workspaces.json", Some(i), true) {
                Ok(keys) => {
                    for key in keys {
                        if !tiles.insert(key) {
                            problems.push(Problem::new(
                                "workspaces.json",
                                Some(i),
                                "tabs.root.tileKey",
                                "duplicateTileKey",
                            ));
                        }
                    }
                }
                Err(mut p) => problems.append(&mut p),
            }
        }
    }
    if !ids.contains(file.active_workspace_id.as_str()) {
        problems.push(Problem::new(
            "workspaces.json",
            None,
            "activeWorkspaceId",
            "missingActiveWorkspace",
        ));
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems)
    }
}

/// 마지막 선택은 힌트이므로 다른 workspace를 가리키거나 사라진 키만 지운다.
pub fn normalize(file: &mut WorkspaceFile) {
    for workspace in &mut file.workspaces {
        let tabs: HashSet<_> = workspace.tabs.iter().map(|t| t.tab_key.as_str()).collect();
        let tiles: HashSet<_> = workspace
            .tabs
            .iter()
            .flat_map(|t| inspect_tree(&t.root, "workspaces.json", None, true).unwrap_or_default())
            .collect();
        if workspace
            .last_active
            .tab_key
            .as_deref()
            .is_some_and(|k| !tabs.contains(k))
        {
            workspace.last_active.tab_key = None;
        }
        if workspace
            .last_active
            .tile_key
            .as_ref()
            .is_some_and(|k| !tiles.contains(k))
        {
            workspace.last_active.tile_key = None;
        }
    }
}

/// 재시작 때 보조 창을 다시 열지 않는다(설계 결정 3). IO 없는 순수 변환.
pub fn return_aux_tabs_to_main(file: &mut WorkspaceFile) {
    for workspace in &mut file.workspaces {
        for tab in &mut workspace.tabs {
            tab.placement = Scope::Main;
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabMerge {
    pub tab_key: String,
    pub tile_key: String,
    pub dir: String,
    pub side: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Mutation {
    PutTabs {
        workspace_id: String,
        scope: Scope,
        generation: u64,
        tabs: Vec<SavedWorkspaceTab>,
        last_active: Option<LastActive>,
    },
    MoveTab {
        tab_key: String,
        to_workspace_id: Option<String>,
        to_placement: Scope,
    },
    TransferTab {
        workspace_id: String,
        source_tab_key: String,
        tab: Box<SavedWorkspaceTab>,
        merge: Option<TabMerge>,
    },
    ReturnAuxGroup {
        workspace_id: String,
        group_id: String,
    },
    CreateWorkspace {
        id: String,
        name: String,
        icon: Option<String>,
        color: Option<String>,
    },
    RenameWorkspace {
        id: String,
        name: String,
    },
    SetWorkspaceStyle {
        id: String,
        icon: Option<String>,
        color: Option<String>,
    },
    ReorderWorkspaces {
        ids: Vec<String>,
    },
    SetActiveWorkspace {
        id: String,
    },
    DeleteWorkspace {
        id: String,
    },
    RewriteHostAliases {
        aliases: Vec<String>,
        to: Option<String>,
    },
    ReturnAuxTabsToMain,
}

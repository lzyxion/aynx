//! 구형 파일의 엄격한 순수 계획과 백업/journal commit. 첫 부팅과 journal 복구에서 사용한다.
use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde_json::{json, Value};

use super::schema::*;
use super::store::{failure, load_at_root, save_file, Error, Journal, LoadResult};
use crate::app_state::{load_at, save_at};
use crate::i18n::tr;

const SOURCES: [&str; 2] = ["workspaces.json", "layouts.json"];
const JOURNAL: &str = "workspaces-migration.json";

pub trait IdSource {
    fn uuid(&mut self) -> String;
    fn stream_id(&mut self) -> String;
    fn default_name(&self) -> String {
        "Home".into()
    }
}

pub(super) struct RandomIds;

impl RandomIds {
    fn bytes() -> [u8; 16] {
        let mut bytes = [0; 16];
        // 식별자일 뿐 비밀이 아니다. 난수 실패 시 시각 + 단조 카운터로 유일성을 유지한다.
        if getrandom::fill(&mut bytes).is_err() {
            static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let tick = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            bytes = (tick ^ ((seq as u128) << 64)).to_be_bytes();
        }
        bytes
    }
}

impl IdSource for RandomIds {
    fn uuid(&mut self) -> String {
        let mut b = Self::bytes();
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
        format!(
            "{}-{}-{}-{}-{}",
            &hex[..8],
            &hex[8..12],
            &hex[12..16],
            &hex[16..20],
            &hex[20..]
        )
    }
    fn stream_id(&mut self) -> String {
        // factory.ts::nextHistoryStreamId와 같은 128비트, 소문자 hex 32자리(하이픈 없음).
        Self::bytes().iter().map(|x| format!("{x:02x}")).collect()
    }
}

pub struct MigrationPlan {
    pub file: WorkspaceFile,
    pub layout_id_to_workspace_id: HashMap<String, String>,
}

fn source(bytes: Option<&[u8]>, file: &str, problems: &mut Vec<Problem>) -> Option<Value> {
    let bytes = bytes?;
    match serde_json::from_slice::<Value>(bytes) {
        Ok(v) if v.is_object() => Some(v),
        _ => {
            problems.push(Problem::new(file, None, "", "invalidJson"));
            None
        }
    }
}

/// 관대한 frontend parser를 쓰지 않는다. 아는 필드의 잘못된 타입도 유실 없이 오류로 올린다.
fn legacy_tree(root: &Value, file: &str, index: usize) -> Result<(), Vec<Problem>> {
    inspect_tree(root, file, Some(index), false)?;
    let mut problems = Vec::new();
    let mut stack = vec![(root, String::from("root"))];
    while let Some((node, path)) = stack.pop() {
        if node.get("dir").is_some() {
            stack.push((&node["a"], format!("{path}.a")));
            stack.push((&node["b"], format!("{path}.b")));
        } else {
            if !matches!(
                node["kind"].as_str(),
                Some("local" | "ssh" | "sftp" | "localfs" | "start" | "doc" | "branches")
            ) {
                problems.push(Problem::new(file, Some(index), &path, "unknownLeafKind"));
            }
            if matches!(node["kind"].as_str(), Some("ssh" | "sftp"))
                && !node["alias"].as_str().is_some_and(|s| !s.trim().is_empty())
            {
                problems.push(Problem::new(
                    file,
                    Some(index),
                    &format!("{path}.alias"),
                    "missingAlias",
                ));
            }
            if node["kind"] == "doc" && !node["path"].as_str().is_some_and(|s| !s.trim().is_empty())
            {
                problems.push(Problem::new(
                    file,
                    Some(index),
                    &format!("{path}.path"),
                    "missingDocPath",
                ));
            }
            if node["kind"] == "branches" && node.get("branchGraph").is_none() {
                problems.push(Problem::new(
                    file,
                    Some(index),
                    &format!("{path}.branchGraph"),
                    "missingBranchGraph",
                ));
            }
            for key in [
                "historyStreamId",
                "tileKey",
                "alias",
                "shell",
                "tmux",
                "autorun",
                "cwd",
                "path",
                "fileView",
                "docMode",
            ] {
                if node.get(key).is_some_and(|v| !v.is_string()) {
                    problems.push(Problem::new(
                        file,
                        Some(index),
                        &format!("{path}.{key}"),
                        "invalidField",
                    ));
                }
            }
            for key in [
                "noTmux",
                "forceTmux",
                "injectMcpToken",
                "docPreview",
            ] {
                if node.get(key).is_some_and(|v| !v.is_boolean()) {
                    problems.push(Problem::new(
                        file,
                        Some(index),
                        &format!("{path}.{key}"),
                        "invalidField",
                    ));
                }
            }
            if node.get("scrollback").is_some_and(|v| !v.is_number()) {
                problems.push(Problem::new(file, Some(index), &path, "invalidScrollback"));
            }
            for (key, required) in [
                ("adhoc", "host"),
                ("startProject", "projectId"),
                ("branchGraph", "projectId"),
            ] {
                if node.get(key).is_some_and(|v| {
                    !v.is_object()
                        || !v
                            .get(required)
                            .and_then(Value::as_str)
                            .is_some_and(|s| !s.trim().is_empty())
                }) {
                    problems.push(Problem::new(
                        file,
                        Some(index),
                        &format!("{path}.{key}"),
                        "invalidField",
                    ));
                }
            }
            for (key, field) in [
                ("adhoc", "user"),
                ("startProject", "host"),
                ("branchGraph", "branch"),
            ] {
                if node
                    .get(key)
                    .and_then(|v| v.get(field))
                    .is_some_and(|v| !v.is_string())
                {
                    problems.push(Problem::new(
                        file,
                        Some(index),
                        &format!("{path}.{key}.{field}"),
                        "invalidField",
                    ));
                }
            }
            if node
                .get("adhoc")
                .and_then(|v| v.get("port"))
                .is_some_and(|v| !v.as_u64().is_some_and(|port| (1..=65535).contains(&port)))
            {
                problems.push(Problem::new(
                    file,
                    Some(index),
                    &format!("{path}.adhoc.port"),
                    "invalidPort",
                ));
            }
            if node
                .get("fileView")
                .is_some_and(|v| !matches!(v.as_str(), Some("tree" | "navigate")))
                || node
                    .get("docMode")
                    .is_some_and(|v| !matches!(v.as_str(), Some("rendered" | "source")))
            {
                problems.push(Problem::new(file, Some(index), &path, "unknownView"));
            }
            if node.get("startProject").is_some_and(|v| {
                !v.get("folder")
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.trim().is_empty())
            }) {
                problems.push(Problem::new(
                    file,
                    Some(index),
                    &format!("{path}.startProject"),
                    "invalidField",
                ));
            }
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems)
    }
}

fn assign(root: &mut Value, ids: &mut impl IdSource, new_streams: bool) {
    if root.get("dir").is_some() {
        assign(&mut root["a"], ids, new_streams);
        assign(&mut root["b"], ids, new_streams);
    } else {
        root["tileKey"] = ids.uuid().into();
        if new_streams {
            root["historyStreamId"] = ids.stream_id().into();
        }
    }
}

fn empty_workspace(id: String, name: String) -> Workspace {
    Workspace {
        id,
        name,
        icon: None,
        color: None,
        tabs: Vec::new(),
        last_active: LastActive::default(),
        extra: Default::default(),
    }
}

pub fn plan_migration(
    v1_tabs: Option<&[u8]>,
    layouts: Option<&[u8]>,
    ids: &mut impl IdSource,
) -> Result<MigrationPlan, Vec<Problem>> {
    let mut problems = Vec::new();
    let tabs = source(v1_tabs, SOURCES[0], &mut problems);
    let layouts = source(layouts, SOURCES[1], &mut problems);
    let default_id = ids.uuid();
    let mut default = empty_workspace(default_id.clone(), ids.default_name());
    default.icon = Some("svg:lucide:house".into());
    if let Some(tabs) = tabs {
        if tabs["version"] != 1 || tabs.get("kind").is_some() {
            problems.push(Problem::new(SOURCES[0], None, "version", "unknownVersion"));
        }
        if !tabs
            .get("activeIndex")
            .is_some_and(|v| v.as_u64().is_some())
        {
            problems.push(Problem::new(
                SOURCES[0],
                None,
                "activeIndex",
                "invalidActiveIndex",
            ));
        }
        if let Some(rows) = tabs["workspaces"].as_array() {
            for (i, row) in rows.iter().enumerate() {
                let mut tab_problems = Vec::new();
                if let Err(mut p) = legacy_tree(&row["root"], SOURCES[0], i) {
                    tab_problems.append(&mut p);
                }
                let mut value = row.clone();
                if let Some(o) = value.as_object_mut() {
                    o.insert("tabKey".into(), ids.uuid().into());
                    o.insert("placement".into(), json!({"kind":"main"}));
                }
                let parsed = serde_json::from_value::<SavedWorkspaceTab>(value);
                match parsed {
                    Ok(mut tab) if tab_problems.is_empty() => {
                        assign(&mut tab.root, ids, false);
                        default.tabs.push(tab);
                    }
                    Ok(_) => {}
                    Err(_) => {
                        tab_problems.push(Problem::new(SOURCES[0], Some(i), "", "invalidTab"))
                    }
                }
                problems.append(&mut tab_problems);
            }
            let at = tabs["activeIndex"].as_u64().unwrap_or(0) as usize;
            default.last_active.tab_key = default
                .tabs
                .get(at)
                .or_else(|| default.tabs.first())
                .map(|t| t.tab_key.clone());
        } else {
            problems.push(Problem::new(SOURCES[0], None, "workspaces", "invalidTabs"));
        }
    }
    let mut names = HashSet::from([default.name.trim().to_lowercase()]);
    let mut workspaces = vec![default];
    let mut mapping = HashMap::new();
    if let Some(layouts) = layouts {
        if layouts["version"] != 1 {
            problems.push(Problem::new(SOURCES[1], None, "version", "unknownVersion"));
        }
        if let Some(rows) = layouts["layouts"].as_array() {
            for (i, row) in rows.iter().enumerate() {
                let id = row["id"].as_str().filter(|s| !s.trim().is_empty());
                let name = row["name"].as_str().filter(|s| !s.trim().is_empty());
                let mut good = true;
                if id.is_none() || name.is_none() || !row["createdAt"].is_number() {
                    problems.push(Problem::new(SOURCES[1], Some(i), "", "invalidLayout"));
                    good = false;
                }
                if let Err(mut p) = legacy_tree(&row["tree"], SOURCES[1], i) {
                    problems.append(&mut p);
                    good = false;
                }
                if id.is_some_and(|id| mapping.contains_key(id)) {
                    problems.push(Problem::new(SOURCES[1], Some(i), "id", "duplicateLayoutId"));
                    good = false;
                }
                if !good {
                    continue;
                }
                let base = name.expect("checked layout name");
                let mut name = base.to_string();
                let mut suffix = 2;
                while !names.insert(name.trim().to_lowercase()) {
                    name = format!("{base} ({suffix})");
                    suffix += 1;
                }
                let mut workspace = empty_workspace(ids.uuid(), name);
                let mut root = row["tree"].clone();
                assign(&mut root, ids, true);
                let key = ids.uuid();
                workspace.last_active.tab_key = Some(key.clone());
                workspace.tabs.push(SavedWorkspaceTab {
                    tab_key: key,
                    placement: Scope::Main,
                    project_id: None,
                    name: None,
                    pinned_title: None,
                    project_folder: None,
                    title: base.into(),
                    root,
                    extra: Default::default(),
                });
                mapping.insert(id.expect("checked layout id").into(), workspace.id.clone());
                workspaces.push(workspace);
            }
        } else {
            problems.push(Problem::new(SOURCES[1], None, "layouts", "invalidLayouts"));
        }
    }
    if !problems.is_empty() {
        return Err(problems);
    }
    let file = WorkspaceFile {
        kind: "aynx.workspaces".into(),
        version: 2,
        revision: 1,
        active_workspace_id: default_id,
        workspaces,
        migration: None,
        extra: Default::default(),
    };
    validate(&file)?;
    Ok(MigrationPlan {
        file,
        layout_id_to_workspace_id: mapping,
    })
}

fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>, Error> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::from(
            tr!(ko: "이관 원본을 읽지 못했습니다: {e}", en: "Could not read a migration source: {e}"),
        )),
    }
}

fn io(e: std::io::Error) -> Error {
    Error::from(
        tr!(ko: "워크스페이스 이관 파일 작업에 실패했습니다: {e}", en: "Workspace migration file operation failed: {e}"),
    )
}

fn remove_if_exists(path: &Path) -> Result<(), Error> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io(e)),
    }
}

fn save_journal(root: &Path, journal: &Journal) -> Result<(), Error> {
    let json = serde_json::to_string_pretty(journal).map_err(|_| failure("serialize"))?;
    save_at(&root.join(JOURNAL), &json)?;
    Ok(())
}

pub(super) fn status_at(root: &Path) -> Result<Option<Journal>, Error> {
    load_at(&root.join(JOURNAL))?
        .map(|raw| serde_json::from_str(&raw).map_err(|_| failure("invalidJournal")))
        .transpose()
}

fn targets_valid(root: &Path) -> Result<bool, Error> {
    if !matches!(load_at_root(root)?, LoadResult::V2 { .. }) {
        return Ok(false);
    }
    Ok(true)
}

/// workspace 대상이 유효하면 commit을 완료하고 유효하지 않으면 원본 둘로 되돌린다.
fn restore(root: &Path, backup: &Path) -> Result<(), Error> {
    if backup.as_os_str().is_empty() {
        // 빈 backupDir은 원본 둘이 모두 없었다는 뜻이다. 부분 저장을 지우고 재시도한다.
        for name in SOURCES {
            remove_if_exists(&root.join(name))?;
        }
        return remove_if_exists(&root.join(JOURNAL));
    }
    if !backup.is_dir() {
        return Err(failure("backupMissing"));
    }
    for name in SOURCES {
        if let Some(bytes) = read_bytes(&backup.join(name))? {
            // 재직렬화하지 않고 원본 바이트 그대로 공용 원자적 저장을 지난다.
            let raw = std::str::from_utf8(&bytes).map_err(|_| failure("invalidBackup"))?;
            save_at(&root.join(name), raw)?;
        } else {
            remove_if_exists(&root.join(name))?;
        }
    }
    remove_if_exists(&root.join(JOURNAL))
}

fn finish(
    root: &Path,
    mut journal: Journal,
    hook: &mut impl FnMut(u8) -> Result<(), Error>,
) -> Result<WorkspaceFile, Error> {
    journal.phase = "committed".into();
    save_journal(root, &journal)?;
    hook(5)?;
    let backup = Path::new(&journal.backup_dir);
    if !journal.backup_dir.is_empty() && read_bytes(&root.join("layouts.json"))?.is_some() {
        // 백업한 원본 이름으로 옮긴다. 이미 있는 원본 사본도 같은 바이트로 교체한다.
        std::fs::rename(root.join("layouts.json"), backup.join("layouts.json")).map_err(io)?;
    }
    hook(6)?;
    let LoadResult::V2 { file } = load_at_root(root)? else {
        return Err(failure("invalidMigrationTarget"));
    };
    let mut file = *file;
    if file.migration.is_none() {
        file.migration = Some(MigrationRecord {
            from: 1,
            at: journal.started_at,
            backup_dir: journal.backup_dir,
            imported_layouts: journal.layout_id_to_workspace_id.len(),
            extra: Default::default(),
        });
        file.revision = file
            .revision
            .checked_add(1)
            .ok_or_else(|| failure("revisionOverflow"))?;
        save_file(root, &file)?;
    }
    hook(7)?;
    remove_if_exists(&root.join(JOURNAL))?;
    hook(8)?;
    Ok(file)
}

/// 호출자는 workspaces 잠금을 쥔다. hook은 실제 쓰기 경계의 crash 테스트용이다.
/// 1 백업, 2 prepared, 3 workspace, 4 대상 검증, 5 committed, 6 layout 이동, 7 기록, 8 journal 제거.
pub(super) fn migrate_at(
    root: &Path,
    ids: &mut impl IdSource,
    mut hook: impl FnMut(u8) -> Result<(), Error>,
) -> Result<WorkspaceFile, Error> {
    if let Some(journal) = status_at(root)? {
        if !matches!(journal.phase.as_str(), "prepared" | "committed") {
            return Err(failure("unknownJournalPhase"));
        }
        if targets_valid(root)? {
            return finish(root, journal, &mut hook);
        }
        restore(root, Path::new(&journal.backup_dir))?;
    }
    match load_at_root(root)? {
        LoadResult::V2 { file } => return Ok(*file), // 남은 layout을 다시 가져오지 않는다.
        LoadResult::Corrupt { problems } => return Err(Error::Corrupt { problems }),
        LoadResult::NeedsMigration | LoadResult::Empty => {}
    }
    let tabs = read_bytes(&root.join(SOURCES[0]))?;
    let layouts = read_bytes(&root.join(SOURCES[1]))?;
    let plan = plan_migration(tabs.as_deref(), layouts.as_deref(), ids)
        .map_err(|problems| Error::Invalid { problems })?;
    std::fs::create_dir_all(root).map_err(io)?;
    let now = chrono::Utc::now();
    let backup_dir = if tabs.is_none() && layouts.is_none() {
        String::new()
    } else {
        let mut offset = 0;
        let backup = loop {
            let candidate = root.join(format!(
                "migration-backup-{}",
                (now + chrono::Duration::seconds(offset)).format("%Y%m%d%H%M%S")
            ));
            match std::fs::create_dir(&candidate) {
                Ok(()) => break candidate,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => offset += 1,
                Err(e) => return Err(io(e)),
            }
        };
        for (name, bytes) in SOURCES.into_iter().zip([tabs, layouts]) {
            if let Some(bytes) = bytes {
                std::fs::write(backup.join(name), bytes).map_err(io)?;
            }
        }
        backup.to_string_lossy().into_owned()
    };
    hook(1)?;
    let journal = Journal {
        phase: "prepared".into(),
        backup_dir,
        layout_id_to_workspace_id: plan.layout_id_to_workspace_id,
        started_at: now.to_rfc3339(),
    };
    save_journal(root, &journal)?;
    hook(2)?;
    save_file(root, &plan.file)?;
    hook(3)?;
    hook(4)?;
    if !targets_valid(root)? {
        return Err(failure("invalidMigrationTarget"));
    }
    finish(root, journal, &mut hook)
}

/// 사용자가 원본 보관을 선택한 경우에만 호출한다. 부분 이동 실패는 옮긴 파일을 되돌린다.
pub(super) fn backup_for_fresh_start(root: &Path) -> Result<(), Error> {
    std::fs::create_dir_all(root).map_err(io)?;
    let now = chrono::Utc::now();
    let mut offset = 0;
    let backup = loop {
        let candidate = root.join(format!(
            "migration-backup-{}",
            (now + chrono::Duration::seconds(offset)).format("%Y%m%d%H%M%S")
        ));
        match std::fs::create_dir(&candidate) {
            Ok(()) => break candidate,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => offset += 1,
            Err(e) => return Err(io(e)),
        }
    };
    let mut moved = Vec::new();
    for name in SOURCES.into_iter().chain([JOURNAL]) {
        match std::fs::rename(root.join(name), backup.join(name)) {
            Ok(()) => moved.push(name),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                for name in moved.into_iter().rev() {
                    std::fs::rename(backup.join(name), root.join(name)).map_err(io)?;
                }
                return Err(io(e));
            }
        }
    }
    Ok(())
}

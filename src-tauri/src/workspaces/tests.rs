use super::migrate::{migrate_at, plan_migration, IdSource};
use super::schema::*;
use super::store::{apply_at, load_at_root, save_file};
use super::*;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let mut ids = migrate::RandomIds;
        let dir = std::env::temp_dir().join(format!("aynx-workspaces-{}", ids.uuid()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
    fn write(&self, name: &str, bytes: &[u8]) {
        std::fs::write(self.0.join(name), bytes).unwrap();
    }
    fn read(&self, name: &str) -> Vec<u8> {
        std::fs::read(self.0.join(name)).unwrap()
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
struct Ids(u64);
impl IdSource for Ids {
    fn uuid(&mut self) -> String {
        self.0 += 1;
        format!("id-{}", self.0)
    }
    fn stream_id(&mut self) -> String {
        self.0 += 1;
        format!("{:032x}", self.0)
    }
    fn default_name(&self) -> String {
        "기본".into()
    }
}

const TABS: &[u8] = br#"{"version":1,"activeIndex":1,"workspaces":[
 {"title":"first","futureTab":{"x":1},"root":{"kind":"local","historyStreamId":"keep-first","futureLeaf":42}},
 {"title":"second","pinnedTitle":"pinned","projectFolder":"/src","root":{"dir":"row","ratio":0.3,"fixed":{"axis":"w","size":200},"futureSplit":true,"a":{"kind":"ssh","alias":"h","historyStreamId":"keep-ssh"},"b":{"kind":"doc","path":"/note","locked":true,"docMode":"source"}}}]}"#;
const LAYOUTS: &[u8] = br#"{"version":1,"layouts":[
 {"id":"l1","name":"deploy","createdAt":1,"tree":{"kind":"local","historyStreamId":"keep-first","futureLeaf":true}},
 {"id":"l2","name":"deploy","createdAt":2,"tree":{"dir":"col","ratio":0.6,"a":{"kind":"ssh","historyStreamId":"keep-ssh","alias":"h"},"b":{"kind":"start"}}}]}"#;
const PROJECTS: &[u8] = br#"{"futureFile":{"enabled":true},"projects":[
 {"id":"p1","name":"one","path":"/src","command":"claude --flag","futureProject":{"n":7}},
 {"id":"p2","name":"two","path":"/two","agent":null,"workspaceId":"existing","setupScript":"a\nb"}]}"#;

fn seed(tmp: &TempDir) {
    for (name, bytes) in [
        ("workspaces.json", TABS),
        ("layouts.json", LAYOUTS),
        ("projects.json", PROJECTS),
    ] {
        tmp.write(name, bytes);
    }
}
fn migrate(tmp: &TempDir) -> WorkspaceFile {
    migrate_at(&tmp.0, &mut Ids::default(), |_| Ok(())).unwrap()
}
fn loaded(tmp: &TempDir) -> WorkspaceFile {
    match load_at_root(&tmp.0).unwrap() {
        LoadResult::V2 { file } => *file,
        _ => panic!("v2여야 한다"),
    }
}
fn tab(key: &str, placement: Scope) -> SavedWorkspaceTab {
    serde_json::from_value(json!({"tabKey":key,"placement":placement,"title":"title","root":{"kind":"start","tileKey":format!("tile-{key}")}})).unwrap()
}
fn put(workspace: &str, scope: Scope, generation: u64, tabs: Vec<SavedWorkspaceTab>) -> Mutation {
    Mutation::PutTabs {
        workspace_id: workspace.into(),
        scope,
        generation,
        tabs,
        last_active: None,
    }
}
fn apply(tmp: &TempDir, writers: &Writers, mutation: Mutation) -> Result<u64, Error> {
    apply_at(&tmp.0, writers, "main", mutation)
}
fn value(file: &WorkspaceFile) -> Value {
    serde_json::to_value(file).unwrap()
}

#[test]
fn v1_layouts_plan_preserves_values_and_assigns_global_keys() {
    let plan = plan_migration(Some(TABS), Some(LAYOUTS), &mut Ids::default()).unwrap();
    let file = &plan.file;
    validate(file).unwrap();
    assert_eq!(file.kind, "aynx.workspaces");
    assert_eq!(file.version, 2);
    assert_eq!(file.workspaces.len(), 3);
    assert_eq!(file.active_workspace_id, file.workspaces[0].id);
    assert_eq!(file.workspaces[0].name, "기본");
    assert_eq!(file.workspaces[0].tabs.len(), 2);
    assert_eq!(
        file.workspaces[0].last_active.tab_key.as_ref(),
        Some(&file.workspaces[0].tabs[1].tab_key)
    );
    assert_eq!(file.workspaces[1].name, "deploy");
    assert_eq!(file.workspaces[2].name, "deploy (2)");
    assert!(file.workspaces[1..]
        .iter()
        .all(|w| w.tabs.len() == 1 && w.tabs[0].project_id.is_none()));
    let tabs: Vec<_> = file.workspaces.iter().flat_map(|w| &w.tabs).collect();
    assert_eq!(
        tabs.iter()
            .map(|t| &t.tab_key)
            .collect::<HashSet<_>>()
            .len(),
        tabs.len()
    );
    let tiles: Vec<_> = tabs
        .iter()
        .flat_map(|t| inspect_tree(&t.root, "test", None, true).unwrap())
        .collect();
    assert_eq!(tiles.len(), 6);
    assert_eq!(tiles.iter().collect::<HashSet<_>>().len(), tiles.len());
    assert_eq!(
        file.workspaces[0].tabs[0].root["historyStreamId"],
        "keep-first"
    );
    assert_eq!(
        file.workspaces[0].tabs[1].root["a"]["historyStreamId"],
        "keep-ssh"
    );
    for root in [
        &file.workspaces[1].tabs[0].root,
        &file.workspaces[2].tabs[0].root["a"],
        &file.workspaces[2].tabs[0].root["b"],
    ] {
        let stream = root["historyStreamId"].as_str().unwrap();
        assert_eq!(stream.len(), 32);
        assert!(stream.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(stream, "keep-first");
        assert_ne!(stream, "keep-ssh");
    }
    assert_eq!(
        file.workspaces[0].tabs[0].extra["futureTab"],
        json!({"x":1})
    );
    assert_eq!(file.workspaces[0].tabs[0].root["futureLeaf"], 42);
    assert_eq!(file.workspaces[0].tabs[1].root["futureSplit"], true);
    assert_eq!(plan.layout_id_to_workspace_id.len(), 2);
}

#[test]
fn absent_sources_only_tabs_and_only_layouts() {
    for (tabs, layouts, count, default_tabs) in [
        (None, None, 1, 0),
        (Some(TABS), None, 1, 2),
        (None, Some(LAYOUTS), 3, 0),
    ] {
        let plan = plan_migration(tabs, layouts, &mut Ids::default()).unwrap();
        assert_eq!(plan.file.workspaces.len(), count);
        assert_eq!(plan.file.workspaces[0].tabs.len(), default_tabs);
        assert_eq!(plan.file.active_workspace_id, plan.file.workspaces[0].id);
        let tmp = TempDir::new();
        if let Some(bytes) = tabs {
            tmp.write("workspaces.json", bytes);
        }
        if let Some(bytes) = layouts {
            tmp.write("layouts.json", bytes);
        }
        let result = migrate(&tmp);
        assert_eq!(result.workspaces.len(), count);
        assert!(result.migration.is_some());
        assert!(migrate::status_at(&tmp.0).unwrap().is_none());
    }
}

#[test]
fn absent_sources_write_v2_without_a_backup_and_recover_crashes() {
    for stop in 0..=8 {
        let tmp = TempDir::new();
        let mut ids = Ids::default();
        let first = migrate_at(&tmp.0, &mut ids, |step| {
            if step == stop {
                Err(store::failure("simulatedCrash"))
            } else {
                Ok(())
            }
        });
        assert_eq!(first.is_err(), stop != 0, "checkpoint {stop}");
        assert!(std::fs::read_dir(&tmp.0)
            .unwrap()
            .all(|entry| !entry.unwrap().path().is_dir()));
        let file = migrate_at(&tmp.0, &mut ids, |_| Ok(())).unwrap();
        assert_eq!(file.workspaces.len(), 1, "checkpoint {stop}");
        assert!(file.workspaces[0].tabs.is_empty());
        assert!(file.migration.as_ref().unwrap().backup_dir.is_empty());
        assert_eq!(value(&loaded(&tmp)), value(&file));
        assert_eq!(value(&file)["migration"]["backupDir"], "");
        assert!(targets_have_v2(&tmp.0));
        assert!(migrate::status_at(&tmp.0).unwrap().is_none());
        assert_eq!(std::fs::read_dir(&tmp.0).unwrap().count(), 1);
    }
}

#[test]
fn duplicate_names_include_default_and_existing_suffix() {
    let layouts = json!({"version":1,"layouts":[
        {"id":"a","name":"기본","createdAt":0,"tree":{"kind":"start"}},
        {"id":"b","name":"기본","createdAt":0,"tree":{"kind":"start"}},
        {"id":"c","name":"기본 (2)","createdAt":0,"tree":{"kind":"start"}}
    ]});
    let bytes = serde_json::to_vec(&layouts).unwrap();
    let plan = plan_migration(None, Some(&bytes), &mut Ids::default()).unwrap();
    assert_eq!(
        plan.file
            .workspaces
            .iter()
            .map(|w| w.name.as_str())
            .collect::<Vec<_>>(),
        ["기본", "기본 (2)", "기본 (3)", "기본 (2) (2)"]
    );
}

#[test]
fn default_name_is_home_and_real_ids_have_the_expected_shape() {
    crate::i18n::set_lang(crate::i18n::Lang::En);
    let mut ids = migrate::RandomIds;
    let plan = plan_migration(None, None, &mut ids).unwrap();
    assert_eq!(plan.file.workspaces[0].name, "Home");
    assert_eq!(plan.file.workspaces[0].icon.as_deref(), Some("svg:lucide:house"));
    assert_eq!(plan.file.active_workspace_id.len(), 36);
    let stream = ids.stream_id();
    assert_eq!(stream.len(), 32);
    assert!(stream.chars().all(|c| c.is_ascii_hexdigit()));
    crate::i18n::set_lang(crate::i18n::Lang::Ko);
}

#[test]
fn corrupt_sources_abort_without_any_writes() {
    for (name, bytes, code, index) in [
        ("workspaces.json", b"{bad".as_slice(), "invalidJson", None),
        (
            "layouts.json",
            br#"{"version":9,"layouts":[]}"#.as_slice(),
            "unknownVersion",
            None,
        ),
        (
            "layouts.json",
            br#"{"version":1,"layouts":[{"id":"x","name":"n","createdAt":0}]}"#.as_slice(),
            "invalidNode",
            Some(0),
        ),
        (
            "workspaces.json",
            br#"{"version":1,"activeIndex":0,"workspaces":[{"title":"settings","root":{"kind":"settings"}}]}"#.as_slice(),
            "unknownLeafKind",
            Some(0),
        ),
        (
            "layouts.json",
            br#"{"version":1,"layouts":[{"id":"x","name":"settings","createdAt":0,"tree":{"kind":"settings"}}]}"#.as_slice(),
            "unknownLeafKind",
            Some(0),
        ),
    ] {
        let tmp = TempDir::new();
        seed(&tmp);
        tmp.write(name, bytes);
        let before: Vec<_> = ["workspaces.json", "layouts.json", "projects.json"]
            .iter()
            .map(|n| tmp.read(n))
            .collect();
        let err = migrate_at(&tmp.0, &mut Ids::default(), |_| Ok(()))
            .err()
            .unwrap();
        let problems = match err {
            Error::Invalid { problems } | Error::Corrupt { problems } => problems,
            _ => panic!("원본 검사 오류여야 한다"),
        };
        assert!(problems
            .iter()
            .any(|p| p.file == name && p.code == code && p.index == index));
        let after: Vec<_> = ["workspaces.json", "layouts.json", "projects.json"]
            .iter()
            .map(|n| tmp.read(n))
            .collect();
        assert_eq!(before, after);
        assert_eq!(std::fs::read_dir(&tmp.0).unwrap().count(), 3);
    }
}

#[test]
fn strict_plan_checks_every_item_and_does_not_limit_layouts_to_40() {
    let rows: Vec<_> = (0..45).map(|i| json!({"id":format!("layout-{i}"),"name":format!("n-{i}"),"createdAt":0,"tree":{"kind":"start"}})).collect();
    let good = serde_json::to_vec(&json!({"version":1,"layouts":rows})).unwrap();
    assert_eq!(
        plan_migration(None, Some(&good), &mut Ids::default())
            .unwrap()
            .file
            .workspaces
            .len(),
        46
    );
    let bad = br#"{"version":1,"layouts":[{"id":"a","name":"a","createdAt":0},{"id":"b","name":"b","createdAt":0,"tree":{"kind":"local","historyStreamId":5}}]}"#;
    let problems = plan_migration(Some(b"{"), Some(bad), &mut Ids::default())
        .err()
        .unwrap();
    assert!(problems.iter().any(|p| p.file == "workspaces.json"));
    for i in [0, 1] {
        assert!(problems
            .iter()
            .any(|p| p.file == "layouts.json" && p.index == Some(i)));
    }
}

#[test]
fn read_error_is_not_an_empty_source() {
    let tmp = TempDir::new();
    std::fs::create_dir(tmp.0.join("layouts.json")).unwrap();
    assert!(migrate_at(&tmp.0, &mut Ids::default(), |_| Ok(())).is_err());
    assert!(!tmp.0.join("workspaces.json").exists());
}

#[test]
fn journal_crashes_at_every_write_boundary_recover_without_duplicates() {
    for stop in 1..=8 {
        let tmp = TempDir::new();
        seed(&tmp);
        let mut ids = Ids::default();
        let first = migrate_at(&tmp.0, &mut ids, |step| {
            if step == stop {
                Err(store::failure("simulatedCrash"))
            } else {
                Ok(())
            }
        });
        assert!(first.is_err(), "checkpoint {stop}");
        let file = migrate_at(&tmp.0, &mut ids, |_| Ok(())).unwrap();
        assert_eq!(file.workspaces.len(), 3, "checkpoint {stop}");
        assert_eq!(
            file.workspaces.iter().map(|w| w.tabs.len()).sum::<usize>(),
            4
        );
        validate(&file).unwrap();
        assert!(targets_have_v2(&tmp.0));
        assert!(!tmp.0.join("layouts.json").exists());
        assert!(migrate::status_at(&tmp.0).unwrap().is_none());
        let record = file.migration.as_ref().unwrap();
        assert_eq!(record.imported_layouts, 2);
        for (name, bytes) in [("workspaces.json", TABS), ("layouts.json", LAYOUTS)] {
            assert_eq!(
                std::fs::read(Path::new(&record.backup_dir).join(name)).unwrap(),
                bytes,
                "{name} checkpoint {stop}"
            );
        }
        let before = tmp.read("workspaces.json");
        let projects_before = tmp.read("projects.json");
        assert_eq!(
            value(&migrate_at(&tmp.0, &mut ids, |_| Ok(())).unwrap()),
            value(&file)
        );
        assert_eq!(tmp.read("workspaces.json"), before);
        assert_eq!(tmp.read("projects.json"), projects_before);
    }
}
fn targets_have_v2(root: &Path) -> bool {
    matches!(load_at_root(root).unwrap(), LoadResult::V2 { .. })
}

#[test]
fn rollback_handles_originally_missing_sources_and_invalid_target() {
    for stop in [2, 3] {
        let tmp = TempDir::new();
        tmp.write("layouts.json", LAYOUTS);
        assert!(migrate_at(&tmp.0, &mut Ids::default(), |n| if n == stop {
            Err(store::failure("crash"))
        } else {
            Ok(())
        })
        .is_err());
        tmp.write("workspaces.json", b"{broken");
        let file = migrate(&tmp);
        assert_eq!(file.workspaces.len(), 3);
        assert_eq!(file.workspaces[0].tabs.len(), 0);
        let backup = Path::new(&file.migration.as_ref().unwrap().backup_dir);
        assert!(!backup.join("workspaces.json").exists());
        assert!(!backup.join("projects.json").exists());
        assert_eq!(std::fs::read(backup.join("layouts.json")).unwrap(), LAYOUTS);
    }
}

#[test]
fn second_migration_is_a_noop_even_with_stray_layouts() {
    let tmp = TempDir::new();
    seed(&tmp);
    let file = migrate(&tmp);
    let before = tmp.read("workspaces.json");
    tmp.write("layouts.json", LAYOUTS);
    assert_eq!(value(&migrate(&tmp)), value(&file));
    assert_eq!(tmp.read("workspaces.json"), before);
    assert_eq!(tmp.read("layouts.json"), LAYOUTS);
}

#[test]
fn loader_distinguishes_v1_v2_empty_and_corrupt_without_overwriting() {
    let tmp = TempDir::new();
    assert!(matches!(load_at_root(&tmp.0).unwrap(), LoadResult::Empty));
    tmp.write("workspaces.json", TABS);
    assert!(matches!(
        load_at_root(&tmp.0).unwrap(),
        LoadResult::NeedsMigration
    ));
    assert!(matches!(
        apply(&tmp, &Writers::default(), Mutation::ReturnAuxTabsToMain),
        Err(Error::NeedsMigration)
    ));
    assert_eq!(tmp.read("workspaces.json"), TABS);
    tmp.write("workspaces.json", br#"{"kind":"other","version":2}"#);
    assert!(matches!(
        load_at_root(&tmp.0).unwrap(),
        LoadResult::Corrupt { .. }
    ));
    tmp.write(
        "workspaces.json",
        br#"{"kind":"aynx.workspaces","version":2}"#,
    );
    assert!(matches!(
        load_at_root(&tmp.0).unwrap(),
        LoadResult::Corrupt { .. }
    ));
}

#[test]
fn put_tabs_isolates_main_aux_groups_and_other_workspaces() {
    let tmp = TempDir::new();
    seed(&tmp);
    let mut file = migrate(&tmp);
    let id = file.workspaces[0].id.clone();
    let aux = Scope::Aux {
        group_id: "g1".into(),
    };
    let aux2 = Scope::Aux {
        group_id: "g2".into(),
    };
    file.workspaces[0].tabs.push(tab("aux", aux.clone()));
    file.workspaces[0].tabs.push(tab("aux2", aux2.clone()));
    save_file(&tmp.0, &file).unwrap();
    let other = value(&file)["workspaces"][1].clone();
    let mut writers = Writers::default();
    let main_generation = writers.claim(Scope::Main, "main".into()).unwrap();
    let aux_generation = writers.claim(aux.clone(), "aux-window".into()).unwrap();
    let revision = apply(
        &tmp,
        &writers,
        put(
            &id,
            Scope::Main,
            main_generation,
            vec![tab("new", Scope::Main)],
        ),
    )
    .unwrap();
    assert_eq!(revision, file.revision + 1);
    let current = loaded(&tmp);
    assert_eq!(
        current.workspaces[0]
            .tabs
            .iter()
            .map(|t| t.tab_key.as_str())
            .collect::<Vec<_>>(),
        ["new", "aux", "aux2"]
    );
    assert_eq!(value(&current)["workspaces"][1], other);
    apply_at(
        &tmp.0,
        &writers,
        "aux-window",
        put(
            &id,
            aux.clone(),
            aux_generation,
            vec![tab("replaced-aux", aux)],
        ),
    )
    .unwrap();
    assert_eq!(
        loaded(&tmp).workspaces[0]
            .tabs
            .iter()
            .map(|t| t.tab_key.as_str())
            .collect::<Vec<_>>(),
        ["new", "replaced-aux", "aux2"]
    );
    assert!(apply(&tmp, &writers, put(&id, aux2, main_generation, vec![])).is_err());
}

#[test]
fn stale_generation_and_wrong_label_leave_bytes_and_revision_unchanged() {
    let tmp = TempDir::new();
    let file = migrate(&tmp);
    let mut writers = Writers::default();
    let stale = writers.claim(Scope::Main, "main".into()).unwrap();
    let generation = writers.claim(Scope::Main, "new-window".into()).unwrap();
    assert!(generation > stale);
    let before = tmp.read("workspaces.json");
    assert!(matches!(
        apply(
            &tmp,
            &writers,
            put(&file.active_workspace_id, Scope::Main, stale, vec![])
        ),
        Err(Error::Stale)
    ));
    assert!(matches!(
        apply(
            &tmp,
            &writers,
            put(&file.active_workspace_id, Scope::Main, generation, vec![])
        ),
        Err(Error::Stale)
    ));
    assert_eq!(tmp.read("workspaces.json"), before);
}

#[test]
fn collisions_wrong_scope_and_invalid_keys_abort_the_write() {
    let tmp = TempDir::new();
    seed(&tmp);
    let file = migrate(&tmp);
    let id = &file.workspaces[0].id;
    let mut writers = Writers::default();
    let generation = writers.claim(Scope::Main, "main".into()).unwrap();
    let before = tmp.read("workspaces.json");
    let collision = file.workspaces[1].tabs[0].clone();
    assert!(apply(
        &tmp,
        &writers,
        put(id, Scope::Main, generation, vec![collision])
    )
    .is_err());
    assert!(apply(
        &tmp,
        &writers,
        put(
            id,
            Scope::Main,
            generation,
            vec![tab(
                "aux",
                Scope::Aux {
                    group_id: "g".into()
                }
            )]
        )
    )
    .is_err());
    assert!(apply(
        &tmp,
        &writers,
        put(
            id,
            Scope::Main,
            generation,
            vec![tab("same", Scope::Main), tab("same", Scope::Main)]
        )
    )
    .is_err());
    let mut collision = tab("different", Scope::Main);
    collision.root["tileKey"] = file.workspaces[1].tabs[0].root["tileKey"].clone();
    assert!(apply(
        &tmp,
        &writers,
        put(id, Scope::Main, generation, vec![collision])
    )
    .is_err());
    assert_eq!(tmp.read("workspaces.json"), before);
}

#[test]
fn delete_refuses_last_nonempty_and_missing_without_touching_projects() {
    let tmp = TempDir::new();
    let mut file = migrate(&tmp);
    let id = file.active_workspace_id.clone();
    let writers = Writers::default();
    assert!(apply(&tmp, &writers, Mutation::DeleteWorkspace { id: id.clone() }).is_err());
    apply(
        &tmp,
        &writers,
        Mutation::CreateWorkspace {
            id: "other".into(),
            name: "other".into(),
            icon: None,
            color: None,
        },
    )
    .unwrap();
    file = loaded(&tmp);
    file.workspaces[0].tabs.push(tab("busy", Scope::Main));
    save_file(&tmp.0, &file).unwrap();
    let before = tmp.read("workspaces.json");
    for deleting in [id.as_str(), "missing"] {
        assert!(apply(
            &tmp,
            &writers,
            Mutation::DeleteWorkspace {
                id: deleting.into()
            }
        )
        .is_err());
        assert_eq!(tmp.read("workspaces.json"), before);
    }
    file.workspaces[0].tabs.clear();
    save_file(&tmp.0, &file).unwrap();
    tmp.write("projects.json", b"{broken");
    apply(&tmp, &writers, Mutation::DeleteWorkspace { id }).unwrap();
    assert_eq!(tmp.read("projects.json"), b"{broken");
    assert_eq!(loaded(&tmp).active_workspace_id, "other");
}

#[test]
fn metadata_mutations_and_move_are_explicit_and_normalize_last_active() {
    let tmp = TempDir::new();
    seed(&tmp);
    let file = migrate(&tmp);
    let writers = Writers::default();
    let id = file.workspaces[0].id.clone();
    apply(
        &tmp,
        &writers,
        Mutation::RenameWorkspace {
            id: id.clone(),
            name: "renamed".into(),
        },
    )
    .unwrap();
    apply(
        &tmp,
        &writers,
        Mutation::SetWorkspaceStyle {
            id: id.clone(),
            icon: Some("i".into()),
            color: Some("#123".into()),
        },
    )
    .unwrap();
    apply(
        &tmp,
        &writers,
        Mutation::SetActiveWorkspace {
            id: file.workspaces[1].id.clone(),
        },
    )
    .unwrap();
    let ids: Vec<_> = file.workspaces.iter().rev().map(|w| w.id.clone()).collect();
    apply(
        &tmp,
        &writers,
        Mutation::ReorderWorkspaces { ids: ids.clone() },
    )
    .unwrap();
    assert_eq!(
        loaded(&tmp)
            .workspaces
            .iter()
            .map(|w| w.id.clone())
            .collect::<Vec<_>>(),
        ids
    );
    let before = tmp.read("workspaces.json");
    assert!(apply(
        &tmp,
        &writers,
        Mutation::ReorderWorkspaces {
            ids: vec![id.clone(); 3]
        }
    )
    .is_err());
    assert!(apply(
        &tmp,
        &writers,
        Mutation::RenameWorkspace {
            id: id.clone(),
            name: "  ".into()
        }
    )
    .is_err());
    assert!(apply(
        &tmp,
        &writers,
        Mutation::CreateWorkspace {
            id: id.clone(),
            name: "duplicate".into(),
            icon: None,
            color: None
        }
    )
    .is_err());
    assert_eq!(tmp.read("workspaces.json"), before);
    let key = file.workspaces[0].tabs[1].tab_key.clone();
    apply(
        &tmp,
        &writers,
        Mutation::MoveTab {
            tab_key: key.clone(),
            to_workspace_id: Some(file.workspaces[1].id.clone()),
            to_placement: Scope::Aux {
                group_id: "g".into(),
            },
        },
    )
    .unwrap();
    let current = loaded(&tmp);
    let source = current.workspaces.iter().find(|w| w.id == id).unwrap();
    assert!(source.last_active.tab_key.is_none());
    let target = current
        .workspaces
        .iter()
        .find(|w| w.id == file.workspaces[1].id)
        .unwrap();
    assert_eq!(target.tabs.last().unwrap().tab_key, key);
}

#[test]
fn return_aux_is_pure_and_applies_in_each_original_workspace() {
    let tmp = TempDir::new();
    seed(&tmp);
    let mut file = migrate(&tmp);
    for (i, w) in file.workspaces.iter_mut().enumerate() {
        w.tabs[0].placement = Scope::Aux {
            group_id: format!("g{i}"),
        };
    }
    save_file(&tmp.0, &file).unwrap();
    let before = value(&file);
    return_aux_tabs_to_main(&mut file);
    assert!(file
        .workspaces
        .iter()
        .flat_map(|w| &w.tabs)
        .all(|t| t.placement == Scope::Main));
    for (i, w) in file.workspaces.iter().enumerate() {
        assert_eq!(w.id, before["workspaces"][i]["id"].as_str().unwrap());
    }
    apply(&tmp, &Writers::default(), Mutation::ReturnAuxTabsToMain).unwrap();
    let mut actual = loaded(&tmp);
    actual.revision = file.revision;
    assert_eq!(value(&actual), value(&file));
}

#[test]
fn validation_and_normalization_preserve_unknown_fields() {
    let tmp = TempDir::new();
    let mut file = migrate(&tmp);
    file.extra.insert("futureFile".into(), json!([1, 2]));
    let w = &mut file.workspaces[0];
    w.extra.insert("futureWorkspace".into(), json!(true));
    w.tabs.push(tab("x", Scope::Main));
    w.tabs[0].extra.insert("futureTab".into(), json!({"x":1}));
    w.tabs[0].root["futureLeaf"] = json!({"sourceTileKey":"new"});
    w.last_active.extra.insert("futureActive".into(), json!(5));
    w.last_active.tab_key = Some("dangling".into());
    w.last_active.tile_key = Some("dangling".into());
    validate(&file).unwrap(); // 마지막 선택의 끊긴 참조는 오류가 아니다.
    normalize(&mut file);
    assert!(file.workspaces[0].last_active.tab_key.is_none());
    assert!(file.workspaces[0].last_active.tile_key.is_none());
    save_file(&tmp.0, &file).unwrap();
    assert_eq!(value(&loaded(&tmp)), value(&file));
    let mut bad = file.clone();
    bad.workspaces[0].tabs[0].root =
        json!({"dir":"row","ratio":0.5,"a":{"kind":"start","tileKey":"a"}});
    assert!(validate(&bad).is_err());
    bad.workspaces[0].tabs[0].root = json!({"kind":"start"});
    assert!(validate(&bad).is_err());
    bad = file.clone();
    bad.workspaces[0].id.clear();
    assert!(validate(&bad).is_err());
    bad = file.clone();
    bad.active_workspace_id = "missing".into();
    assert!(validate(&bad).is_err());
}

#[test]
fn failed_save_is_an_error_and_pending_journal_blocks_mutations() {
    let tmp = TempDir::new();
    let file = migrate(&tmp);
    let writers = Writers::default();
    tmp.write("workspaces-migration.json", b"{}");
    assert!(apply(
        &tmp,
        &writers,
        Mutation::RenameWorkspace {
            id: file.active_workspace_id.clone(),
            name: "n".into()
        }
    )
    .is_err());
    std::fs::remove_file(tmp.0.join("workspaces-migration.json")).unwrap();
    // save_at의 실제 임시 경로를 폴더로 막아 쓰기 실패를 일으킨다.
    std::fs::create_dir(
        tmp.0
            .join(format!("workspaces.json.{}.tmp", std::process::id())),
    )
    .unwrap();
    let before = tmp.read("workspaces.json");
    assert!(apply(
        &tmp,
        &writers,
        Mutation::RenameWorkspace {
            id: file.active_workspace_id,
            name: "n".into()
        }
    )
    .is_err());
    assert_eq!(tmp.read("workspaces.json"), before);
}

#[test]
#[ignore = "AYNX_MIGRATE_FIXTURE=<설정 사본 폴더> cargo test workspaces::tests::migrate_fixture_copy -- --ignored --nocapture"]
fn migrate_fixture_copy() {
    let Some(source) = std::env::var_os("AYNX_MIGRATE_FIXTURE") else {
        return;
    };
    let tmp = TempDir::new();
    fn copy(source: &Path, target: &Path) {
        std::fs::create_dir_all(target).unwrap();
        for entry in std::fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            let to = target.join(entry.file_name());
            let kind = entry.file_type().unwrap();
            if kind.is_dir() {
                copy(&entry.path(), &to);
            } else if kind.is_file() {
                std::fs::copy(entry.path(), to).unwrap();
            }
        }
    }
    copy(Path::new(&source), &tmp.0);
    let file = migrate_at(&tmp.0, &mut migrate::RandomIds, |_| Ok(())).unwrap();
    let tabs: usize = file.workspaces.iter().map(|w| w.tabs.len()).sum();
    let tiles: usize = file
        .workspaces
        .iter()
        .flat_map(|w| &w.tabs)
        .map(|t| inspect_tree(&t.root, "test", None, true).unwrap().len())
        .sum();
    println!(
        "workspaces={} tabs={} tiles={} importedLayouts={}",
        file.workspaces.len(),
        tabs,
        tiles,
        file.migration.as_ref().map_or(0, |m| m.imported_layouts)
    );
}

#[test]
fn simultaneous_scope_writes_are_serialized_and_preserve_both_results() {
    let tmp = TempDir::new();
    let initial = migrate(&tmp);
    let id = initial.active_workspace_id;
    let aux = Scope::Aux {
        group_id: "concurrent".into(),
    };
    let mut writers = Writers::default();
    let main_generation = writers.claim(Scope::Main, "main".into()).unwrap();
    let aux_generation = writers.claim(aux.clone(), "aux".into()).unwrap();
    let lock = std::sync::Arc::new(std::sync::Mutex::new(writers));
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let mut handles = Vec::new();
    for (scope, generation, label, key) in [
        (Scope::Main, main_generation, "main", "main-tab"),
        (aux, aux_generation, "aux", "aux-tab"),
    ] {
        let lock = lock.clone();
        let barrier = barrier.clone();
        let root = tmp.0.clone();
        let id = id.clone();
        handles.push(std::thread::spawn(move || {
            barrier.wait();
            let writers = lock.lock().unwrap();
            apply_at(
                &root,
                &writers,
                label,
                put(&id, scope.clone(), generation, vec![tab(key, scope)]),
            )
        }));
    }
    let mut revisions: Vec<_> = handles
        .into_iter()
        .map(|h| h.join().unwrap().unwrap())
        .collect();
    revisions.sort_unstable();
    assert_eq!(revisions, [3, 4]);
    let current = loaded(&tmp);
    let keys: HashSet<_> = current.workspaces[0]
        .tabs
        .iter()
        .map(|t| t.tab_key.as_str())
        .collect();
    assert_eq!(keys, HashSet::from(["main-tab", "aux-tab"]));
}

#[test]
fn tagged_mutations_use_camel_case_and_last_active_is_an_optional_hint() {
    let tmp = TempDir::new();
    let initial = migrate(&tmp);
    let id = initial.active_workspace_id;
    let mut writers = Writers::default();
    let generation = writers.claim(Scope::Main, "main".into()).unwrap();
    let mutation: Mutation = serde_json::from_value(json!({
        "op":"putTabs", "workspaceId":id, "scope":{"kind":"main"}, "generation":generation,
        "tabs":[{"tabKey":"t","placement":{"kind":"main"},"title":"title","root":{"kind":"start","tileKey":"leaf"}}],
        "lastActive":{"tabKey":"t","tileKey":"leaf","at":123,"future":true}
    })).unwrap();
    let encoded = serde_json::to_value(&mutation).unwrap();
    assert_eq!(encoded["op"], "putTabs");
    assert_eq!(encoded["workspaceId"], id);
    assert!(encoded.get("workspace_id").is_none());
    apply(&tmp, &writers, mutation).unwrap();
    let current = loaded(&tmp);
    assert_eq!(
        current.workspaces[0].last_active.tab_key.as_deref(),
        Some("t")
    );
    assert_eq!(
        current.workspaces[0].last_active.tile_key.as_deref(),
        Some("leaf")
    );
    assert_eq!(current.workspaces[0].last_active.at, Some(123));
    assert_eq!(current.workspaces[0].last_active.extra["future"], true);
    let no_hint: Mutation = serde_json::from_value(json!({"op":"putTabs","workspaceId":id,"scope":{"kind":"main"},"generation":generation,"tabs":[]})).unwrap();
    apply(&tmp, &writers, no_hint).unwrap();
    assert!(loaded(&tmp).workspaces[0].last_active.tab_key.is_none());
}

#[test]
fn validation_rejects_global_duplicates_and_normalizes_foreign_last_active_keys() {
    let tmp = TempDir::new();
    seed(&tmp);
    let mut file = migrate(&tmp);
    file.workspaces[0].last_active.tab_key = Some(file.workspaces[1].tabs[0].tab_key.clone());
    file.workspaces[0].last_active.tile_key = file.workspaces[1].tabs[0].root["tileKey"]
        .as_str()
        .map(str::to_string);
    validate(&file).unwrap();
    normalize(&mut file);
    assert!(file.workspaces[0].last_active.tab_key.is_none());
    assert!(file.workspaces[0].last_active.tile_key.is_none());
    for (field, expected) in [
        ("kind", "unknownKind"),
        ("version", "unknownVersion"),
        ("workspaces", "emptyWorkspaces"),
    ] {
        let mut bad = file.clone();
        match field {
            "kind" => bad.kind = "other".into(),
            "version" => bad.version = 99,
            _ => bad.workspaces.clear(),
        }
        assert!(validate(&bad)
            .err()
            .unwrap()
            .iter()
            .any(|p| p.code == expected));
    }
    let mut bad = file.clone();
    bad.workspaces[1].id = bad.workspaces[0].id.clone();
    assert!(validate(&bad)
        .err()
        .unwrap()
        .iter()
        .any(|p| p.code == "invalidWorkspaceId"));
    let mut bad = file.clone();
    bad.workspaces[1].tabs[0].tab_key = bad.workspaces[0].tabs[0].tab_key.clone();
    assert!(validate(&bad)
        .err()
        .unwrap()
        .iter()
        .any(|p| p.code == "invalidTabKey"));
}

#[test]
fn move_commit_then_failed_target_put_never_duplicates_the_tab() {
    let tmp = TempDir::new();
    let file = migrate(&tmp);
    let workspace = &file.workspaces[0].id;
    let mut writers = Writers::default();
    let generation = writers.claim(Scope::Main, "main".into()).unwrap();
    apply(
        &tmp,
        &writers,
        put(
            workspace,
            Scope::Main,
            generation,
            vec![tab("moving", Scope::Main)],
        ),
    )
    .unwrap();
    let aux = Scope::Aux {
        group_id: "fresh-group".into(),
    };
    let aux_generation = writers.claim(aux.clone(), "aux-window".into()).unwrap();
    apply(
        &tmp,
        &writers,
        Mutation::MoveTab {
            tab_key: "moving".into(),
            to_workspace_id: None,
            to_placement: aux.clone(),
        },
    )
    .unwrap();
    // MoveTab 성공 뒤 대상 PutTabs가 실패해도 이미 이동한 항목 하나만 남는다.
    let mut invalid = tab("moving", aux.clone());
    invalid.root = json!({"kind": "local"});
    assert!(apply_at(
        &tmp.0,
        &writers,
        "aux-window",
        put(workspace, aux.clone(), aux_generation, vec![invalid]),
    )
    .is_err());
    let disk = loaded(&tmp);
    let tabs: Vec<_> = disk.workspaces.iter().flat_map(|w| &w.tabs).collect();
    assert_eq!(tabs.len(), 1);
    assert_eq!(tabs[0].placement, aux);
    // 소스의 늦은 스냅숏도 복제할 수 없다.
    assert!(apply(
        &tmp,
        &writers,
        put(
            workspace,
            Scope::Main,
            generation,
            vec![tab("moving", Scope::Main)]
        ),
    )
    .is_err());
    validate(&loaded(&tmp)).unwrap();
}

#[test]
fn failed_move_keeps_original_bytes_and_placement() {
    let tmp = TempDir::new();
    let file = migrate(&tmp);
    let workspace = &file.workspaces[0].id;
    let mut writers = Writers::default();
    let generation = writers.claim(Scope::Main, "main".into()).unwrap();
    apply(
        &tmp,
        &writers,
        put(
            workspace,
            Scope::Main,
            generation,
            vec![tab("moving", Scope::Main)],
        ),
    )
    .unwrap();
    let before = tmp.read("workspaces.json");
    let blocked = tmp
        .0
        .join(format!("workspaces.json.{}.tmp", std::process::id()));
    std::fs::create_dir(&blocked).unwrap();
    assert!(apply(
        &tmp,
        &writers,
        Mutation::MoveTab {
            tab_key: "moving".into(),
            to_workspace_id: None,
            to_placement: Scope::Aux {
                group_id: "fresh".into(),
            },
        },
    )
    .is_err());
    assert_eq!(tmp.read("workspaces.json"), before);
    assert_eq!(loaded(&tmp).workspaces[0].tabs.len(), 1);
}

#[test]
fn aux_x_returns_only_its_group_and_old_main_snapshot_cannot_erase_it() {
    let tmp = TempDir::new();
    let file = migrate(&tmp);
    let workspace = &file.workspaces[0].id;
    let a = Scope::Aux {
        group_id: "a".into(),
    };
    let b = Scope::Aux {
        group_id: "b".into(),
    };
    let mut writers = Writers::default();
    let main_generation = writers.claim(Scope::Main, "main".into()).unwrap();
    let generation_a = writers.claim(a.clone(), "aux-a".into()).unwrap();
    let generation_b = writers.claim(b.clone(), "aux-b".into()).unwrap();
    apply_at(
        &tmp.0,
        &writers,
        "aux-a",
        put(workspace, a.clone(), generation_a, vec![tab("a", a)]),
    )
    .unwrap();
    apply_at(
        &tmp.0,
        &writers,
        "aux-b",
        put(
            workspace,
            b.clone(),
            generation_b,
            vec![tab("b", b.clone())],
        ),
    )
    .unwrap();
    apply_at(
        &tmp.0,
        &writers,
        "aux-a",
        Mutation::ReturnAuxGroup {
            workspace_id: workspace.clone(),
            group_id: "a".into(),
        },
    )
    .unwrap();
    apply(
        &tmp,
        &writers,
        put(workspace, Scope::Main, main_generation, vec![]),
    )
    .unwrap();
    let disk = loaded(&tmp);
    assert_eq!(disk.workspaces[0].tabs.len(), 2);
    assert_eq!(
        disk.workspaces[0]
            .tabs
            .iter()
            .find(|t| t.tab_key == "a")
            .unwrap()
            .placement,
        Scope::Main,
    );
    assert_eq!(
        disk.workspaces[0]
            .tabs
            .iter()
            .find(|t| t.tab_key == "b")
            .unwrap()
            .placement,
        b,
    );
    // 다음 프로세스의 부팅에서는 남은 aux도 전부 main으로 복귀한다.
    apply(&tmp, &Writers::default(), Mutation::ReturnAuxTabsToMain).unwrap();
    assert!(loaded(&tmp).workspaces[0]
        .tabs
        .iter()
        .all(|t| t.placement == Scope::Main));
    validate(&loaded(&tmp)).unwrap();
}

#[test]
fn pane_transfer_and_merge_remove_source_keys_in_the_same_commit() {
    let tmp = TempDir::new();
    let file = migrate(&tmp);
    let workspace = &file.workspaces[0].id;
    let mut writers = Writers::default();
    let generation = writers.claim(Scope::Main, "main".into()).unwrap();
    let mut source = tab("source", Scope::Main);
    source.root = json!({"dir": "row", "ratio": 0.5,
        "a": {"kind": "local", "tileKey": "moving-tile", "autorun": "claude", "cwd": "/project"},
        "b": {"kind": "start", "tileKey": "staying-tile"}});
    apply(
        &tmp,
        &writers,
        put(
            workspace,
            Scope::Main,
            generation,
            vec![source, tab("target", Scope::Main)],
        ),
    )
    .unwrap();
    let mut incoming = tab("new-tab", Scope::Main);
    incoming.root = json!({
        "kind": "local", "tileKey": "moving-tile", "autorun": "claude", "cwd": "/project"
    });
    apply(
        &tmp,
        &writers,
        Mutation::TransferTab {
            workspace_id: workspace.clone(),
            source_tab_key: "source".into(),
            tab: Box::new(incoming),
            merge: Some(TabMerge {
                tab_key: "target".into(),
                tile_key: "tile-target".into(),
                dir: "col".into(),
                side: "after".into(),
            }),
        },
    )
    .unwrap();
    let disk = loaded(&tmp);
    validate(&disk).unwrap();
    assert_eq!(disk.workspaces[0].tabs.len(), 2);
    let source = disk.workspaces[0]
        .tabs
        .iter()
        .find(|t| t.tab_key == "source")
        .unwrap();
    assert_eq!(source.root["tileKey"], "staying-tile");
    let target = disk.workspaces[0]
        .tabs
        .iter()
        .find(|t| t.tab_key == "target")
        .unwrap();
    assert_eq!(target.root["b"]["tileKey"], "moving-tile");
    assert_eq!(target.root["b"]["autorun"], "claude");
    assert_eq!(target.root["b"]["cwd"], "/project");
}

#[test]
fn fresh_start_moves_sources_without_rewriting_their_bytes() {
    let tmp = TempDir::new();
    seed(&tmp);
    tmp.write("layouts.json", b"broken");
    assert!(migrate_at(&tmp.0, &mut Ids::default(), |_| Ok(())).is_err());
    assert_eq!(tmp.read("workspaces.json"), TABS);
    assert_eq!(tmp.read("layouts.json"), b"broken");
    assert_eq!(tmp.read("projects.json"), PROJECTS);
    migrate::backup_for_fresh_start(&tmp.0).unwrap();
    let backup = std::fs::read_dir(&tmp.0)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.is_dir())
        .unwrap();
    assert_eq!(std::fs::read(backup.join("workspaces.json")).unwrap(), TABS);
    assert_eq!(
        std::fs::read(backup.join("layouts.json")).unwrap(),
        b"broken"
    );
    assert!(!backup.join("projects.json").exists());
    let file = migrate(&tmp);
    assert_eq!(file.workspaces.len(), 1);
    assert!(file.workspaces[0].tabs.is_empty());
    assert!(file.migration.as_ref().unwrap().backup_dir.is_empty());
    assert_eq!(std::fs::read_dir(&tmp.0).unwrap().count(), 3);
}

#[test]
fn host_alias_mutation_visits_every_workspace_and_aux_without_losing_keys() {
    let tmp = TempDir::new();
    seed(&tmp);
    let mut file = migrate(&tmp);
    file.workspaces[1].tabs[0].root = json!({
        "kind": "ssh", "alias": " H ", "tileKey": "cold-key", "future": 42
    });
    file.workspaces[2].tabs[0].placement = Scope::Aux {
        group_id: "group".into(),
    };
    save_file(&tmp.0, &file).unwrap();
    let writers = Writers::default();
    apply(
        &tmp,
        &writers,
        Mutation::RewriteHostAliases {
            aliases: vec!["h".into()],
            to: Some("new".into()),
        },
    )
    .unwrap();
    let renamed = loaded(&tmp);
    assert_eq!(renamed.workspaces[0].tabs[1].root["a"]["alias"], "new");
    assert_eq!(renamed.workspaces[1].tabs[0].root["tileKey"], "cold-key");
    assert_eq!(renamed.workspaces[1].tabs[0].root["future"], 42);
    assert_eq!(renamed.workspaces[2].tabs[0].root["a"]["alias"], "new");
    assert!(matches!(
        renamed.workspaces[2].tabs[0].placement,
        Scope::Aux { .. }
    ));
    apply(
        &tmp,
        &writers,
        Mutation::RewriteHostAliases {
            aliases: vec!["NEW".into()],
            to: None,
        },
    )
    .unwrap();
    let removed = loaded(&tmp);
    validate(&removed).unwrap();
    assert_eq!(
        removed.workspaces[1].tabs[0].root,
        json!({"kind": "start", "tileKey": "cold-key"})
    );
    assert_eq!(removed.workspaces[0].tabs[1].root["kind"], "doc");
}

#[test]
fn migration_does_not_read_or_write_projects() {
    for bytes in [PROJECTS, b"{broken".as_slice()] {
        let tmp = TempDir::new();
        seed(&tmp);
        tmp.write("projects.json", bytes);
        migrate(&tmp);
        assert_eq!(tmp.read("projects.json"), bytes);
        for entry in std::fs::read_dir(&tmp.0).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                assert!(!path.join("projects.json").exists());
            }
        }
    }
}

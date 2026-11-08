use super::*;

struct TempRoot(PathBuf);

impl TempRoot {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "aynx-artists-{}-{}",
            std::process::id(),
            new_role_id(&[])
        ));
        std::fs::create_dir_all(&root).unwrap();
        Self(root)
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn input(name: &str) -> ArtistInput {
    ArtistInput {
        id: None,
        name: name.into(),
        icon: "claude".into(),
        cli: RoleCli::Claude,
        kind: RoleKind::Write,
        model: String::new(),
        effort: String::new(),
        instructions: String::new(),
    }
}

fn edit(artist: &Artist) -> ArtistInput {
    ArtistInput {
        id: Some(artist.id.clone()),
        name: artist.name.clone(),
        icon: artist.icon.clone(),
        cli: artist.cli,
        kind: artist.kind,
        model: artist.model.clone(),
        effort: artist.effort.clone(),
        instructions: artist.instructions.clone(),
    }
}

fn block(id: &str, name: &str) -> String {
    format!("[[artist]]\nid = '{id}'\nname = '{name}'\nicon = 'claude'\ncli = 'claude'\nkind = 'write'\n")
}

#[test]
fn artist_round_trip() {
    let root = TempRoot::new();
    let mut artists = Vec::new();
    let mut data = input("구현가");
    data.model = "sonnet".into();
    data.effort = "high".into();
    data.instructions = "첫 줄\n둘째 줄: \"시험\" · 경로 C:\\작업\n".into();
    upsert_artist(&mut artists, data).unwrap();
    let mut judge = input("검토자");
    judge.cli = RoleCli::Codex;
    judge.kind = RoleKind::Judge;
    judge.icon = "codex".into();
    upsert_artist(&mut artists, judge).unwrap();
    write_artists(&root.0, &artists).unwrap();
    assert_eq!(load_artists(&root.0).unwrap(), artists);
    let text = std::fs::read_to_string(root.0.join(FILE_NAME)).unwrap();
    assert_eq!(text.matches("[[artist]]").count(), 2);
    let mut loaded = load_artists(&root.0).unwrap();
    let mut changed = edit(&loaded[0]);
    changed.name = "다듬는 사람".into();
    upsert_artist(&mut loaded, changed).unwrap();
    assert!(remove_artist(&mut loaded, &artists[1].id, |_| Ok(())).unwrap());
    write_artists(&root.0, &loaded).unwrap();
    assert_eq!(load_artists(&root.0).unwrap(), loaded);
}

#[test]
fn artist_has_no_permission() {
    let root = TempRoot::new();
    let text = format!("{}permission = 'full'\nallowed_commands = ['Bash(*)']\ngrade = 'full'\nmax_turns = 999\n[artist.limits]\nmax_workers = 999\n", block("a-01234567", "권한 없는 프로필"));
    std::fs::write(root.0.join(FILE_NAME), text).unwrap();
    let artists = load_artists(&root.0).unwrap();
    assert_eq!(artists.len(), 1);
    let value = serde_json::to_value(&artists[0]).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 8);
    for key in [
        "permission",
        "allowed_commands",
        "grade",
        "limits",
        "max_turns",
    ] {
        assert!(value.get(key).is_none(), "{key}");
    }
    let mut payload = serde_json::to_value(&artists[0]).unwrap();
    payload.as_object_mut().unwrap().remove("id");
    payload["permission"] = "full".into();
    payload["allowed_commands"] = serde_json::json!(["Bash(*)"]);
    payload["grade"] = "full".into();
    let mut next = Vec::new();
    upsert_artist(&mut next, serde_json::from_value(payload).unwrap()).unwrap();
    write_artists(&root.0, &next).unwrap();
    let written = std::fs::read_to_string(root.0.join(FILE_NAME)).unwrap();
    for key in [
        "permission",
        "allowed_commands",
        "grade",
        "limits",
        "max_turns",
    ] {
        assert!(!written.contains(key), "{key}");
    }
}

#[test]
fn artist_id_from_rust() {
    let mut artists = Vec::new();
    for supplied in ["a-12345678", "r-12345678", "", "자유 id"] {
        let mut data = input("만들기");
        data.id = Some(supplied.into());
        assert!(upsert_artist(&mut artists, data).is_err());
        assert!(artists.is_empty());
    }
    for n in 0..ARTISTS_MAX {
        let artist = upsert_artist(&mut artists, input(&format!("아티스트 {n}"))).unwrap();
        assert!(id_ok(&artist.id));
    }
    let ids: std::collections::HashSet<_> = artists.iter().map(|a| &a.id).collect();
    assert_eq!(ids.len(), ARTISTS_MAX);
    assert!(upsert_artist(&mut artists, input("넘침")).is_err());
    let mut data = edit(&artists[0]);
    data.name = "상한에서도 편집".into();
    let id = data.id.clone().unwrap();
    assert_eq!(upsert_artist(&mut artists, data).unwrap().id, id);
    assert_eq!(artists.len(), ARTISTS_MAX);
}

#[test]
fn artist_kind_locked() {
    let mut artists = Vec::new();
    let artist = upsert_artist(&mut artists, input("구현가")).unwrap();
    let mut changed = edit(&artist);
    changed.kind = RoleKind::Judge;
    assert!(upsert_artist(&mut artists, changed).is_err());
    assert_eq!(artists, vec![artist.clone()]);
    let mut changed = edit(&artist);
    changed.cli = RoleCli::Codex;
    let updated = upsert_artist(&mut artists, changed).unwrap();
    assert_eq!(updated.id, artist.id);
    assert_eq!(updated.kind, RoleKind::Write);
    assert_eq!(updated.cli, RoleCli::Codex);
}

#[test]
fn artist_seed_only_once() {
    let root = TempRoot::new();
    assert!(load_artists(&root.0).unwrap().is_empty());
    assert!(
        !root.0.join(FILE_NAME).exists(),
        "서버의 읽기는 파일을 만들지 않는다"
    );
    assert!(seed_if_missing(&root.0).unwrap());
    let artists = load_artists(&root.0).unwrap();
    assert_eq!(artists.len(), 2);
    assert_eq!(
        (
            &*artists[0].name,
            &*artists[0].icon,
            artists[0].cli,
            artists[0].kind
        ),
        ("Builder", "claude", RoleCli::Claude, RoleKind::Write)
    );
    assert_eq!(
        (
            &*artists[1].name,
            &*artists[1].icon,
            artists[1].cli,
            artists[1].kind
        ),
        ("Reviewer", "codex", RoleCli::Codex, RoleKind::Judge)
    );
    assert!(artists
        .iter()
        .all(|a| a.model.is_empty() && a.effort.is_empty() && a.instructions.is_empty()));
    assert!(!seed_if_missing(&root.0).unwrap());
    assert_eq!(load_artists(&root.0).unwrap(), artists);
    let mut remaining = artists.clone();
    for artist in artists {
        assert!(remove_artist(&mut remaining, &artist.id, |_| Ok(())).unwrap());
    }
    write_artists(&root.0, &remaining).unwrap();
    assert!(!seed_if_missing(&root.0).unwrap());
    assert!(load_artists(&root.0).unwrap().is_empty());
    std::fs::write(root.0.join(FILE_NAME), "").unwrap();
    assert!(!seed_if_missing(&root.0).unwrap());
    assert!(load_artists(&root.0).unwrap().is_empty());
}

#[test]
fn artist_duplicate_name_rejected() {
    let mut artists = Vec::new();
    let artist = upsert_artist(&mut artists, input(" Builder ")).unwrap();
    assert_eq!(artist.name, "Builder");
    assert!(upsert_artist(&mut artists, input("builder")).is_err());
    let other = upsert_artist(&mut artists, input("다른 사람")).unwrap();
    let mut changed = edit(&other);
    changed.name = " BUILDER ".into();
    assert!(upsert_artist(&mut artists, changed).is_err());
    assert_eq!(artists, vec![artist.clone(), other]);
    upsert_artist(&mut artists, edit(&artist)).unwrap();
}

#[test]
fn artist_invalid_row_is_skipped() {
    let valid = block("a-00000001", "앞 사람");
    let tail = block("a-00000003", "뒤 사람");
    let middle = block("a-00000002", "틀린 사람");
    for invalid in [
        middle.replace("name = '틀린 사람'", "name = 42"),
        middle.replace("kind = 'write'", "kind = 'unknown'"),
        middle.replace("cli = 'claude'", "cli = 'unknown'"),
        middle.replace("icon = 'claude'", "icon = '../image.png'"),
        format!("{middle}model = '--evil'\neffort = 'unknown'\n"),
        format!("{middle}instructions = '{}'\n", "가".repeat(1400)),
        middle.replace("a-00000002", "임의 id"),
        middle.replace("틀린 사람", "앞 사람"),
        middle.replace("a-00000002", "a-00000001"),
    ] {
        let artists = parse_artists(&format!("{valid}{invalid}{tail}")).unwrap();
        assert_eq!(
            artists.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            ["a-00000001", "a-00000003"]
        );
    }
    let many: String = (0..40)
        .map(|n| block(&format!("a-{n:08x}"), &format!("사람 {n}")))
        .collect();
    assert_eq!(parse_artists(&many).unwrap().len(), ARTISTS_MAX);
}

#[test]
fn artist_validation_limits() {
    let mut artists = Vec::new();
    let mut data = input(&"가".repeat(NAME_MAX));
    data.instructions = "é".repeat(INSTRUCTIONS_MAX / 2);
    data.model = "a".repeat(64);
    data.effort = "max".into();
    let artist = upsert_artist(&mut artists, data).unwrap();
    for invalid in [
        ArtistInput {
            name: "가".repeat(NAME_MAX + 1),
            ..edit(&artist)
        },
        ArtistInput {
            name: " \t ".into(),
            ..edit(&artist)
        },
        ArtistInput {
            name: "가\n나".into(),
            ..edit(&artist)
        },
        ArtistInput {
            instructions: format!("{}a", artist.instructions),
            ..edit(&artist)
        },
        ArtistInput {
            instructions: "금지\0".into(),
            ..edit(&artist)
        },
        ArtistInput {
            model: "a".repeat(65),
            ..edit(&artist)
        },
        ArtistInput {
            model: "model --flag".into(),
            ..edit(&artist)
        },
        ArtistInput {
            cli: RoleCli::Codex,
            effort: "max".into(),
            ..edit(&artist)
        },
    ] {
        assert!(upsert_artist(&mut artists, invalid).is_err());
        assert_eq!(artists, vec![artist.clone()]);
    }
}

#[test]
fn artist_icon_tokens() {
    for icon in [
        "claude",
        "codex",
        "gemini",
        "gpt",
        "grok",
        "user:012345abcdef",
    ] {
        assert!(icon_ok(icon), "{icon}");
    }
    for icon in [
        "",
        "unknown",
        "user:",
        "user:../x",
        "user:012345abcdeg",
        "user:012345ABCDEF",
        "user:012345abcde",
        "user-012345abcdef",
        "https://example.com/icon.png",
    ] {
        assert!(!icon_ok(icon), "{icon}");
    }
}

#[test]
fn artist_remove_in_use_hook() {
    let mut artists = Vec::new();
    let artist = upsert_artist(&mut artists, input("산 앨범의 멤버")).unwrap();
    let error = remove_artist(&mut artists, &artist.id, |id| {
        assert_eq!(id, artist.id);
        Err("artist-in-use{runIds:[run-1]}".into())
    })
    .unwrap_err();
    assert!(error.starts_with("artist-in-use"));
    assert_eq!(artists, vec![artist.clone()]);
    assert!(remove_artist(&mut artists, &artist.id, |_| Ok(())).unwrap());
    assert!(!remove_artist(&mut artists, &artist.id, |_| panic!(
        "없는 id는 검사하지 않는다"
    ))
    .unwrap());
}

#[test]
fn artist_file_error_does_not_reseed() {
    let root = TempRoot::new();
    let text = "[[artist]\n깨진 TOML";
    std::fs::write(root.0.join(FILE_NAME), text).unwrap();
    assert!(!seed_if_missing(&root.0).unwrap());
    assert!(load_artists(&root.0).is_err());
    assert_eq!(
        std::fs::read_to_string(root.0.join(FILE_NAME)).unwrap(),
        text
    );
}

#[test]
fn artist_write_preserves_crlf() {
    let root = TempRoot::new();
    std::fs::write(root.0.join(FILE_NAME), "# 빈 목록\r\n").unwrap();
    let mut artists = Vec::new();
    upsert_artist(&mut artists, input("줄 끝")).unwrap();
    write_artists(&root.0, &artists).unwrap();
    let text = std::fs::read_to_string(root.0.join(FILE_NAME)).unwrap();
    assert!(text.contains("\r\n"));
    assert!(!text.replace("\r\n", "").contains('\n'));
    assert_eq!(load_artists(&root.0).unwrap(), artists);
}

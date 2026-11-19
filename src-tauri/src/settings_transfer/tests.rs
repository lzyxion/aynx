//! 설정 옮기기 시험 — 임시 폴더의 세 자리(설정 루트 · `~/.aynx` · `~/.ssh`)에 비밀 파일까지 깔고 내보내기 · 가져오기를 돈다.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use super::catalog::CATEGORIES;
use super::import::{AiMode, Conflict};
use super::zipfile::{self, Entry};
use super::*;

static SEQ: AtomicU64 = AtomicU64::new(0);

const WEBHOOK: &str = "https://discord.com/api/webhooks/1/SECRET-WEBHOOK-VALUE";
const MCP_TOKEN: &str = "MCP-TOKEN-VALUE-0123456789";
const REMOTE_TOKEN: &str = "REMOTE-DEVICE-TOKEN-VALUE";
const KEY_TEXT: &str = "-----BEGIN OPENSSH PRIVATE KEY----- PRIVATE-KEY-VALUE";
const VAULT_BYTES: &str = "VAULT-CIPHERTEXT-VALUE";

fn tmp(tag: &str) -> PathBuf {
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("aynx-transfer-{tag}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn roots(base: &Path) -> Roots {
    Roots { config: base.join("config"), home: base.join("home"), ssh: base.join("ssh") }
}

fn put(path: PathBuf, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

const SSH_CONFIG: &str = "\
# 내 설정
Host *
    ServerAliveInterval 30

Host web-01
    HostName 10.0.0.5
    User deploy
    IdentityFile ~/.ssh/id_ed25519

Host db-01 db-01-alt
    HostName 10.0.0.6
    ProxyCommand ssh -W %h:%p jump

Match host foo
    User bar
";

const SETTINGS: &str = r#"[app]
language = "ko"

[terminal]
font_size = 14

[keybindings]
"new-tab" = "Ctrl+Shift+T"

[[triggers]]
pattern = "ERROR"

[automation]
auto_approve = true
allow_patterns = ["df"]

[messenger]
discord = true

[shell]
default = "pwsh"

[vault]
auto_lock_minutes = 5

[remote]
enabled = true
port = 47821
host = "pc.tailnet.ts.net"

[ai]
start_dir = "C:\\work"

[[ai.mcp_servers]]
name = "github"
enabled = true
transport = "stdio"
command = "npx"
side_chat_no_ask = true

[[ai.mcp_servers.env]]
name = "GITHUB_TOKEN"
secret_ref = "mcp-env-github"
"#;

const DELEGATION: &str = r#"[[target]]
alias = "web-01"
expect_user = "deploy"
expect_host = "10.0.0.5"
expect_port = 22
connect = true
read = true
propose = true
auto_execute = true
vault_passphrase = false

[[database]]
id = "pg-1"
ai = "read"
headless = false
expect_engine = "postgres"
expect_host = "db"
expect_port = 5432
expect_database = "app"
expect_user = "ro"

[[repo]]
path = "C:\\repo"
verify_command = "npm test"
"#;

/// 비밀 파일까지 다 있는 이 PC.
fn seed(base: &Path) -> Roots {
    let r = roots(base);
    let c = |n: &str| r.config.join(n);
    put(c("settings.toml"), SETTINGS);
    put(c("vault.bin"), VAULT_BYTES);
    put(c("vault.key"), VAULT_BYTES);
    put(c("discord-webhook"), WEBHOOK);
    put(c("slack-webhook"), "https://hooks.slack.com/services/SECRET-WEBHOOK-VALUE");
    put(c("telegram-bot"), "123456789:SECRET-WEBHOOK-VALUE-telegram-bot-token");
    put(c("telegram-chat"), r#"{"userId":1,"chatId":1,"name":"me"}"#);
    put(c("discord-bot"), "SECRET-WEBHOOK-VALUE.discord.bot-token");
    put(c("discord-chat"), r#"{"userId":2,"chatId":3,"name":"me"}"#);
    put(c("remote-devices.json"), &format!(r#"{{"devices":[{{"id":"d1","token":"{REMOTE_TOKEN}"}}]}}"#));
    put(c("workspaces.json"), r#"{"tabs":[]}"#);
    put(c("history.json"), r#"{"web-01":1}"#);
    put(c("db-history.json"), r#"{}"#);
    put(c("server.json"), r#"{"pid":1}"#);
    put(c("updater.json"), r#"{}"#);
    put(c("instructions-written.json"), r#"{}"#);
    put(c("worktrees.json"), r#"{}"#);
    put(c("agent-mcp/1-abc.json"), &format!(r#"{{"mcpServers":{{"x":{{"headers":{{"Authorization":"Bearer {MCP_TOKEN}"}}}}}}}}"#));
    put(c("agent-mcp/tile-1.env"), &format!("AYNX_MCP_TOKEN={MCP_TOKEN}"));
    put(c("hooks/aynx-agent-signal.cmd"), "@echo off");
    put(c("integration.ps1"), "# shell");
    put(c("sidechat/1/chat.json"), "{}");
    put(c("backups/old.zip"), "zip");
    put(c("projects.json"), r#"{"projects":[{"id":"p1","name":"Gone","host":null,"path":"Z:\\nowhere\\repo"},{"id":"p2","name":"Remote","host":"web-01","path":"~/app"}]}"#);
    put(c("db-connections.json"), r#"[{"id":"pg-1","name":"App DB","engine":"postgres","host":"db","port":5432,"database":"app","user":"ro"}]"#);
    put(c("db-folders.json"), r#"{"office":{}}"#);
    put(c("snippets.json"), r#"{"version":1,"snippets":[{"id":"s1","name":"df","command":"df -h","scope":{"kind":"all"},"enter":true}]}"#);
    put(c("tab-templates.json"), r#"{"version":1,"templates":[{"id":"t1","name":"Dev","root":{},"savedAt":1}]}"#);
    put(c("theme-profiles.json"), r#"{"version":1,"active":"tp1","profiles":[{"id":"tp1","name":"Night","savedAt":1,"appearance":{}}]}"#);
    put(c("wp-0123456789ab.png"), "PNGDATA");
    put(c("app-icons/user-0123456789ab.png"), "PNGICON");
    put(c("app-icons/names.json"), r#"{"user-0123456789ab":"Me"}"#);
    put(c("app-icons/current.ico"), "ICO");
    put(c("terminal-themes/mine.json"), r#"{"version":1,"name":"Mine"}"#);
    put(c("instructions/global.md"), "# rules");
    put(c("orchestration-artists.toml"), "[[artist]]\nid = \"a1\"\nname = \"Ann\"\n");
    put(r.home.join("delegation.toml"), DELEGATION);
    put(r.home.join("mcp.json"), &format!(r#"{{"port":1,"token":"{MCP_TOKEN}"}}"#));
    put(r.ssh.join("config"), SSH_CONFIG);
    put(r.ssh.join("sessions.toml"), "[hosts.web-01]\ncolor = \"#ff0000\"\n\n[hosts.other]\ncolor = \"#00ff00\"\n\n[groups.\"prod\"]\nicon = \"🐧\"\n");
    put(r.ssh.join("id_ed25519"), KEY_TEXT);
    put(r.ssh.join("known_hosts"), "web-01 ssh-ed25519 AAAA");
    r
}

fn all_choices() -> ImportChoices {
    ImportChoices { categories: CATEGORIES.iter().map(|c| (*c).to_string()).collect(), ..ImportChoices::default() }
}

fn export_all(r: &Roots) -> Vec<u8> {
    build_zip(r, CATEGORIES).unwrap().0
}

/// 비밀 같은 이름의 키에 글자 값이 있으면 그 경로를 모은다. `secret_ref`(볼트 참조 이름)는 값이 아니다.
fn secret_keys_json(v: &serde_json::Value, path: &str, out: &mut Vec<String>) {
    match v {
        serde_json::Value::Object(m) => {
            for (k, x) in m {
                if looks_secret(k) && x.as_str().is_some_and(|s| !s.is_empty()) {
                    out.push(format!("{path}.{k}"));
                }
                secret_keys_json(x, &format!("{path}.{k}"), out);
            }
        }
        serde_json::Value::Array(a) => a.iter().for_each(|x| secret_keys_json(x, path, out)),
        _ => {}
    }
}

fn secret_keys_toml(v: &toml::Value, path: &str, out: &mut Vec<String>) {
    match v {
        toml::Value::Table(m) => {
            for (k, x) in m {
                if looks_secret(k) && x.as_str().is_some_and(|s| !s.is_empty()) {
                    out.push(format!("{path}.{k}"));
                }
                secret_keys_toml(x, &format!("{path}.{k}"), out);
            }
        }
        toml::Value::Array(a) => a.iter().for_each(|x| secret_keys_toml(x, path, out)),
        _ => {}
    }
}

fn looks_secret(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k != "secret_ref" && ["token", "password", "passphrase", "secret", "webhook", "authorization"].iter().any(|w| k.contains(w))
}

#[test]
fn export_never_contains_secrets() {
    let base = tmp("secrets");
    let r = seed(&base);
    let entries = zipfile::read(&export_all(&r)).unwrap();
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    // (a) 빼야 할 파일이 하나도 없다 — 이름의 어느 조각에도.
    for bad in [
        "vault", "webhook", "telegram", "discord-bot", "discord-chat", "remote-devices", "mcp.json", "agent-mcp", "workspaces", "history", "server.json", "updater",
        "instructions-written", "worktrees", "hooks", "integration", "sidechat", "backups", "current.ico", "id_ed25519",
        "known_hosts",
    ] {
        assert!(!names.iter().any(|n| n.contains(bad)), "{bad} 이(가) 묶음에 있다: {names:?}");
    }
    // 담아야 할 것은 있다.
    for want in [
        "manifest.json", "ssh/hosts.conf", "ssh/sessions.toml", "home/delegation.toml", "config/settings.toml",
        "config/projects.json", "config/db-connections.json", "config/wp-0123456789ab.png",
        "config/app-icons/user-0123456789ab.png", "config/terminal-themes/mine.json", "config/instructions/global.md",
        "config/orchestration-artists.toml",
    ] {
        assert!(names.contains(&want), "{want} 이(가) 없다: {names:?}");
    }
    // (b) 비밀 값 · 비밀 같은 키가 어디에도 없다.
    let mut found = Vec::new();
    for e in &entries {
        let text = String::from_utf8_lossy(&e.bytes);
        for secret in [WEBHOOK, "SECRET-WEBHOOK-VALUE", MCP_TOKEN, REMOTE_TOKEN, "PRIVATE-KEY-VALUE", VAULT_BYTES, "tailnet"] {
            assert!(!text.contains(secret), "{} 에 비밀 값 {secret}", e.name);
        }
        if e.name.ends_with(".json") {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&e.bytes) {
                secret_keys_json(&v, &e.name, &mut found);
            }
        }
        if e.name.ends_with(".toml") {
            let v: toml::Value = toml::from_str(&text).unwrap_or_else(|err| panic!("{}: {err}", e.name));
            secret_keys_toml(&v, &e.name, &mut found);
        }
    }
    assert!(found.is_empty(), "비밀 같은 키: {found:?}");
    // 볼트 · 원격 칸과 오케스트레이션 저장소 맡기기는 빠지고, 볼트 참조 이름은 자리표시로 남는다.
    let settings = entries.iter().find(|e| e.name == "config/settings.toml").unwrap();
    let s = String::from_utf8_lossy(&settings.bytes);
    assert!(!s.contains("[vault]") && !s.contains("[remote]"), "{s}");
    assert!(s.contains("secret_ref = \"mcp-env-github\""));
    let deleg = entries.iter().find(|e| e.name == "home/delegation.toml").unwrap();
    assert!(!String::from_utf8_lossy(&deleg.bytes).contains("repo"));
    // ssh: 패턴 블록 · Match 블록 · 머리글은 없다.
    let hosts = String::from_utf8_lossy(&entries.iter().find(|e| e.name == "ssh/hosts.conf").unwrap().bytes).into_owned();
    assert!(!hosts.contains("Host *") && !hosts.contains("Match") && !hosts.contains("내 설정"), "{hosts}");
    let meta = String::from_utf8_lossy(&entries.iter().find(|e| e.name == "ssh/sessions.toml").unwrap().bytes).into_owned();
    assert!(meta.contains("web-01") && !meta.contains("other"), "{meta}");
    let _ = std::fs::remove_dir_all(&base);
}

/// (c) 허용 목록 밖의 경로는 묶음에 있어도 쓰지 않는다 — 누가 zip 에 볼트 · 웹훅 · 토큰 파일을 넣어도.
#[test]
fn import_ignores_unlisted_paths() {
    let manifest = serde_json::json!({"format": 1, "appVersion": "x", "exportedAt": "now", "categories": [], "files": []});
    let zip = zipfile::write(&[
        Entry { name: "manifest.json".into(), bytes: serde_json::to_vec(&manifest).unwrap() },
        Entry { name: "config/vault.bin".into(), bytes: b"x".to_vec() },
        Entry { name: "config/discord-webhook".into(), bytes: WEBHOOK.as_bytes().to_vec() },
        Entry { name: "home/mcp.json".into(), bytes: b"{}".to_vec() },
        Entry { name: "config/agent-mcp/a.json".into(), bytes: b"{}".to_vec() },
        Entry { name: "config/app-icons/../vault.bin".replace("../", "x/"), bytes: b"x".to_vec() },
        Entry { name: "config/snippets.json".into(), bytes: br#"{"version":1,"snippets":[{"id":"s9","name":"ls"}]}"#.to_vec() },
    ])
    .unwrap();
    let bundle = open_bundle(&zip).unwrap();
    assert_eq!(bundle.files.keys().collect::<Vec<_>>(), vec!["config/snippets.json"]);
    let base = tmp("unlisted");
    let r = roots(&base);
    apply_at(&r, &zip, &all_choices()).unwrap();
    assert!(!r.config.join("vault.bin").exists());
    assert!(!r.config.join("discord-webhook").exists());
    assert!(!r.home.join("mcp.json").exists());
    assert!(r.config.join("snippets.json").exists());
    let _ = std::fs::remove_dir_all(&base);
}

/// (f) 모르는 형식 판은 거절.
#[test]
fn unknown_format_is_rejected() {
    let manifest = serde_json::json!({"format": 2});
    let zip = zipfile::write(&[Entry { name: "manifest.json".into(), bytes: serde_json::to_vec(&manifest).unwrap() }]).unwrap();
    assert!(open_bundle(&zip).is_err());
    let zip = zipfile::write(&[Entry { name: "a.txt".into(), bytes: b"x".to_vec() }]).unwrap();
    assert!(open_bundle(&zip).is_err(), "manifest 없음");
}

/// (d) `~/.ssh/config` 는 덮지 않는다 — 같은 이름은 그대로, 없는 것만 끝에 덧붙인다.
#[test]
fn ssh_config_appends_only_new_hosts() {
    let src = tmp("ssh-src");
    let zip = export_all(&seed(&src));
    let dst = tmp("ssh-dst");
    let r = roots(&dst);
    let before = "Host web-01\n    HostName 192.168.0.9\n";
    put(r.ssh.join("config"), before);
    let preview = preview_at(&r, &zip).unwrap();
    let hosts = preview.categories.iter().find(|c| c.id == "hosts").unwrap();
    let st = |k: &str| hosts.items.iter().find(|i| i.key == k).map(|i| i.status);
    assert_eq!(st("host:web-01"), Some("changed")); // 앱 설정(색)만 다르다
    assert_eq!(st("host:db-01 db-01-alt"), Some("new"));
    assert_eq!(hosts.items.iter().find(|i| i.key == "host:db-01 db-01-alt").unwrap().note, Some("command"));
    apply_at(&r, &zip, &all_choices()).unwrap();
    let after = std::fs::read_to_string(r.ssh.join("config")).unwrap();
    assert!(after.starts_with(before), "앞 바이트가 그대로여야 한다: {after}");
    assert!(after.contains("192.168.0.9") && !after.contains("10.0.0.5"), "web-01 블록을 건드렸다: {after}");
    assert!(after.contains("Host db-01 db-01-alt"));
    assert_eq!(crate::ssh_config::parse(&after).hosts.iter().filter(|h| h.name == "web-01").count(), 1);
    // 두 번 들여도 블록이 쌓이지 않는다.
    apply_at(&r, &zip, &all_choices()).unwrap();
    assert_eq!(std::fs::read_to_string(r.ssh.join("config")).unwrap(), after);
    let _ = std::fs::remove_dir_all(&src);
    let _ = std::fs::remove_dir_all(&dst);
}

/// (e) AI 권한 — 기본은 파일 값 그대로(신원 스냅샷 포함), [Off 로 들이기]면 위임 블록 없음 · 자동 승인 끔.
#[test]
fn ai_permission_as_is_by_default_and_off_on_request() {
    let src = tmp("ai-src");
    let zip = export_all(&seed(&src));

    let dst = tmp("ai-asis");
    let r = roots(&dst);
    apply_at(&r, &zip, &all_choices()).unwrap();
    let d = crate::delegation::Delegation::parse(&std::fs::read_to_string(r.home.join("delegation.toml")).unwrap()).unwrap();
    assert!(d.auto_execute_granted("web-01"));
    assert!(d.identity_matches("web-01", "deploy", "10.0.0.5", 22), "스냅샷 그대로");
    assert!(d.database("pg-1").is_some());
    let s = std::fs::read_to_string(r.config.join("settings.toml")).unwrap();
    assert!(s.contains("auto_approve = true") && s.contains("side_chat_no_ask = true"), "{s}");

    let dst2 = tmp("ai-off");
    let r2 = roots(&dst2);
    let mut choices = all_choices();
    choices.ai_mode = AiMode::Off;
    let done = apply_at(&r2, &zip, &choices).unwrap();
    let deleg = std::fs::read_to_string(r2.home.join("delegation.toml")).unwrap_or_default();
    let d2 = crate::delegation::Delegation::parse(&deleg).unwrap();
    assert!(!d2.read_granted("web-01") && d2.database("pg-1").is_none(), "{deleg}");
    let s2 = std::fs::read_to_string(r2.config.join("settings.toml")).unwrap();
    assert!(s2.contains("auto_approve = false") && !s2.contains("side_chat_no_ask"), "{s2}");
    assert!(s2.contains("allow_patterns"), "허용 목록 자체는 들어온다");
    // 위임 두 줄은 개수에서도 빠진다.
    let asis = apply_at(&roots(&tmp("ai-count")), &zip, &all_choices()).unwrap();
    assert_eq!(asis.changed, done.changed + 2);
    let _ = std::fs::remove_dir_all(&src);
}

/// 미리 보기는 아무것도 바꾸지 않는다 · 적용은 백업을 먼저 남긴다.
#[test]
fn preview_writes_nothing_and_apply_backs_up() {
    let src = tmp("pv-src");
    let zip = export_all(&seed(&src));
    let dst = tmp("pv-dst");
    let r = roots(&dst);
    put(r.config.join("settings.toml"), "[app]\nlanguage = \"en\"\n");
    let preview = preview_at(&r, &zip).unwrap();
    assert!(!preview.categories.is_empty());
    assert!(!r.config.join("backups").exists());
    assert_eq!(std::fs::read_to_string(r.config.join("settings.toml")).unwrap(), "[app]\nlanguage = \"en\"\n");
    let done = apply_at(&r, &zip, &all_choices()).unwrap();
    let backup = std::fs::read(&done.backup).unwrap();
    let back = open_bundle(&backup).unwrap();
    assert!(String::from_utf8_lossy(&back.files["config/settings.toml"]).contains("language = \"en\""));
    let _ = std::fs::remove_dir_all(&src);
    let _ = std::fs::remove_dir_all(&dst);
}

/// 다른 값 — 건너뛰기면 그대로, 둘 다면 새 id 로 하나 더 · 테마 프로필은 지금 고른 것을 바꾸지 않는다.
#[test]
fn conflict_choices_and_profiles() {
    let src = tmp("cf-src");
    let zip = export_all(&seed(&src));
    let dst = tmp("cf-dst");
    let r = roots(&dst);
    put(r.config.join("snippets.json"), r#"{"version":1,"snippets":[{"id":"s1","name":"mine","command":"ls"}]}"#);
    put(r.config.join("theme-profiles.json"), r#"{"version":1,"active":"mine","profiles":[{"id":"mine","name":"Mine"}]}"#);
    let mut skip = all_choices();
    skip.conflict.insert("keys".into(), Conflict::Skip);
    apply_at(&r, &zip, &skip).unwrap();
    let s: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(r.config.join("snippets.json")).unwrap()).unwrap();
    assert_eq!(s["snippets"].as_array().unwrap().len(), 1);
    assert_eq!(s["snippets"][0]["name"], "mine");
    let p: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(r.config.join("theme-profiles.json")).unwrap()).unwrap();
    assert_eq!(p["active"], "mine");
    assert_eq!(p["profiles"].as_array().unwrap().len(), 2);

    let mut both = all_choices();
    both.conflict.insert("keys".into(), Conflict::Both);
    apply_at(&r, &zip, &both).unwrap();
    let s: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(r.config.join("snippets.json")).unwrap()).unwrap();
    let list = s["snippets"].as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert!(list[1]["id"].as_str().unwrap().starts_with("s1-"));
    let _ = std::fs::remove_dir_all(&src);
    let _ = std::fs::remove_dir_all(&dst);
}

/// 이 PC 에 없는 프로젝트 폴더는 미리 보기에 뜨고, 다시 고른 폴더로 들어온다.
#[test]
fn missing_project_folders_and_remap() {
    let src = tmp("pj-src");
    let zip = export_all(&seed(&src));
    let dst = tmp("pj-dst");
    let r = roots(&dst);
    let preview = preview_at(&r, &zip).unwrap();
    let projects = preview.categories.iter().find(|c| c.id == "projects").unwrap();
    assert_eq!(projects.missing_folders.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["p1"], "원격 프로젝트는 보지 않는다");
    let mut choices = all_choices();
    let here = dst.join("repo");
    std::fs::create_dir_all(&here).unwrap();
    choices.remap.insert("p1".into(), here.display().to_string());
    apply_at(&r, &zip, &choices).unwrap();
    let p: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(r.config.join("projects.json")).unwrap()).unwrap();
    assert_eq!(p["projects"][0]["path"], here.display().to_string());
    let _ = std::fs::remove_dir_all(&src);
    let _ = std::fs::remove_dir_all(&dst);
}

/// 같은 PC 에 다시 들이면 경고가 없다 — 명령 줄은 새 블록에만, 없는 폴더는 들어오는 프로젝트에만.
#[test]
fn same_pc_preview_has_no_warnings() {
    let src = tmp("same-warn");
    let r = seed(&src);
    let zip = export_all(&r);
    let preview = preview_at(&r, &zip).unwrap();
    for cat in &preview.categories {
        assert!(cat.items.iter().all(|i| i.status == "same"), "{} 에 바뀌는 줄", cat.id);
        assert!(cat.items.iter().all(|i| i.note.is_none()), "{} 에 명령 줄 경고", cat.id);
        assert!(cat.missing_folders.is_empty(), "{} 에 없는 폴더 경고", cat.id);
    }
    let _ = std::fs::remove_dir_all(&src);
}

/// 내보내기 요약 — 범주마다 개수가 선다(아무것도 쓰지 않는다).
#[test]
fn summary_counts_items() {
    let src = tmp("sum");
    let r = seed(&src);
    let sum = summary_at(&r).unwrap();
    let count = |id: &str| sum.iter().find(|c| c.id == id).unwrap().count;
    assert_eq!(count("hosts"), 2 + 1); // 블록 둘 + 그룹 하나
    assert_eq!(count("ai"), 2 + 1); // target · database · [automation]
    assert_eq!(count("mcp"), 1);
    assert_eq!(count("notifications"), 1);
    assert_eq!(count("projects"), 2);
    let _ = std::fs::remove_dir_all(&src);
}

/// (g) 원격 창에서는 네 명령 모두 막힌다 · MCP 에는 길이 없다.
#[test]
fn commands_are_home_only_and_not_in_mcp() {
    use crate::remote::deny::{class_of, Class};
    for c in ["settings_export_summary", "settings_export", "settings_import_preview", "settings_import_apply"] {
        assert_eq!(class_of(c), Class::HomeOnly, "{c}");
    }
    let mcp = Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("mcp");
    for entry in std::fs::read_dir(&mcp).unwrap().flatten() {
        let text = std::fs::read_to_string(entry.path()).unwrap_or_default();
        assert!(!text.contains("settings_transfer") && !text.contains("settings_import"), "{}", entry.path().display());
    }
}

/// 문서 표(`catalog::ROOT_FILES`)의 "뺌" 줄에 적힌 이름은 허용 목록에서도 거절된다 — 표와 판정이 어긋나지 않게.
#[test]
fn root_files_table_matches_allowlist() {
    for (names, cat, _) in super::catalog::ROOT_FILES {
        if cat.is_some() {
            continue;
        }
        for name in names.split(" · ") {
            let name = name.trim().trim_end_matches('/');
            if name.contains(['<', '*', '~', ' ']) || name.is_empty() {
                continue;
            }
            assert_eq!(super::catalog::category_of(&format!("config/{name}")), None, "{name}");
            assert_eq!(super::catalog::category_of(name), None, "{name}");
        }
    }
}

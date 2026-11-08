use super::*;
use serde_json::json;

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = std::env::temp_dir().join(format!("aynx-cu-{}-{tag}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// mod 가 넘기는 모양 — `session.measure` 의 `rateLimits` 그대로(2.1.296 실측과 같은 모양).
fn mod_json() -> Value {
    json!([
        {"kind": "five_hour", "percentUsed": 57, "resetsAt": "2026-10-10T14:20:00.000Z"},
        {"kind": "seven_day", "percentUsed": 14.5, "resetsAt": "2026-10-17T06:00:00.000Z"},
        {"kind": "spend_limit", "percentUsed": 3}
    ])
}

#[test]
fn from_mod_takes_the_two_plan_windows_in_order_with_epoch_resets() {
    let w = from_mod(&mod_json());
    assert_eq!(w.len(), 2);
    assert_eq!(
        (w[0].kind.as_deref(), w[0].window_minutes, w[0].used_percent, w[0].resets_at),
        (Some("five_hour"), Some(300), 57.0, Some(1_791_642_000))
    );
    assert_eq!(
        (w[1].kind.as_deref(), w[1].window_minutes, w[1].used_percent),
        (Some("seven_day"), Some(10080), 14.5)
    );
    // 순서가 거꾸로 와도 5시간 → 7일 · 초기화를 모르면 없음 · 모양이 틀리면 빈 목록
    let rev = from_mod(&json!([{"kind": "seven_day", "percentUsed": 1}, {"kind": "five_hour", "percentUsed": 2}]));
    assert_eq!(rev.iter().map(|w| w.window_minutes).collect::<Vec<_>>(), [Some(300), Some(10080)]);
    assert_eq!(rev[0].resets_at, None);
    assert!(from_mod(&json!({"rateLimits": []})).is_empty());
    assert!(from_mod(&json!([{"kind": "five_hour"}])).is_empty());
}

#[test]
fn record_writes_numbers_only_and_skips_unchanged_values_within_a_minute() {
    let d = temp_dir("rec");
    let p = d.join("claude-limits.json");
    let w = from_mod(&mod_json());
    record(&p, w.clone(), 1_000).unwrap();
    assert_eq!(read_limits_file(&p).unwrap().measured_at, 1_000);
    record(&p, w.clone(), 30_000).unwrap();
    assert_eq!(read_limits_file(&p).unwrap().measured_at, 1_000, "같은 값 · 1분 안 — 쓰지 않는다");
    record(&p, w.clone(), 61_000).unwrap();
    assert_eq!(read_limits_file(&p).unwrap().measured_at, 61_000);
    let mut changed = w;
    changed[0].used_percent = 60.0;
    record(&p, changed, 62_000).unwrap();
    assert_eq!(read_limits_file(&p).unwrap().windows[0].used_percent, 60.0);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn legacy_statusline_input_still_records_and_prints_a_quiet_line() {
    let v = json!({
        "session_id": "11111111-2222-4333-8444-555555555555",
        "model": {"display_name": "Opus"},
        "rate_limits": {
            "five_hour": {"used_percentage": 23.5, "resets_at": 1738425600},
            "seven_day": {"used_percentage": 83.0, "resets_at": 1738857600}
        }
    });
    let w = from_statusline(&v);
    assert_eq!(w.len(), 2);
    assert_eq!(w[0].resets_at, Some(1738425600));
    assert_eq!(default_line(Some(&v), &w), "Opus · 5h 24% · 7d 83%");
    assert_eq!(default_line(None, &[]), "");
}

#[test]
fn mod_files_are_written_once_and_name_the_hooks_module() {
    let d = temp_dir("mod");
    write_mod_files(&d).unwrap();
    let hooks: Value = serde_json::from_slice(&std::fs::read(d.join("hooks/hooks.json")).unwrap()).unwrap();
    assert_eq!(hooks["modules"], json!(["./register.js"]));
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(d.join(".claude-plugin/plugin.json")).unwrap()).unwrap();
    assert_eq!(manifest["name"], MOD_NAME);
    let js = std::fs::read_to_string(d.join("hooks/register.js")).unwrap();
    // mod 가 부르는 이름들이 Rust 쪽 이름과 같아야 한다
    assert!(js.contains(&format!("'{}'", crate::tile_env::USAGE_HELPER_ENV)), "{js}");
    assert!(js.contains("[helper, 'claude-usage']"), "{js}");
    assert!(js.contains("on('session.measure'"), "{js}");
    // 다시 적어도 내용이 같으면 손대지 않는다
    let before = std::fs::metadata(d.join("hooks/register.js")).unwrap().modified().unwrap();
    write_mod_files(&d).unwrap();
    assert_eq!(std::fs::metadata(d.join("hooks/register.js")).unwrap().modified().unwrap(), before);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn tile_env_loads_the_mod_everywhere_but_wsl_and_keeps_user_dirs_first() {
    let exe = Path::new("C:/Program Files/AYNX/aynx.exe");
    let dir = Path::new("C:/Users/me/AppData/Roaming/aynx/claude-mod/aynx-usage");
    let env = tile_env_values(true, "pwsh", exe, dir, None);
    assert_eq!(
        env,
        vec![
            (PLUGIN_DIRS_ENV.to_owned(), dir.to_string_lossy().into_owned()),
            (crate::tile_env::USAGE_HELPER_ENV.to_owned(), exe.to_string_lossy().into_owned()),
        ],
        "빈칸 든 경로도 그대로 — 명령 줄이 아니라 환경 값이다"
    );
    for shell in ["cmd", "gitbash", "powershell"] {
        assert_eq!(tile_env_values(true, shell, exe, dir, None).len(), 2, "{shell}");
    }
    assert!(tile_env_values(true, "wsl:Ubuntu", exe, dir, None).is_empty());
    assert!(tile_env_values(false, "pwsh", exe, dir, None).is_empty());
    // 사용자 값 뒤에 잇는다 · 우리 것(이 인스턴스든 다른 인스턴스든)은 한 벌만
    let mine = PathBuf::from("C:/my-mods");
    let existing = std::env::join_paths([mine.clone()]).unwrap();
    let joined = &tile_env_values(true, "pwsh", exe, dir, Some(existing))[0].1;
    let parts: Vec<PathBuf> = std::env::split_paths(joined).collect();
    assert_eq!(parts, [mine.clone(), dir.to_path_buf()]);
    let other = PathBuf::from("C:/Users/me/AppData/Roaming/aynx-dev/claude-mod/aynx-usage");
    let again = std::env::join_paths([mine.clone(), dir.to_path_buf(), other]).unwrap();
    let joined = &tile_env_values(true, "pwsh", exe, dir, Some(again))[0].1;
    let parts: Vec<PathBuf> = std::env::split_paths(joined).collect();
    assert_eq!(parts, [mine, dir.to_path_buf()]);
}

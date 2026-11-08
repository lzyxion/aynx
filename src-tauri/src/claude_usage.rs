//! **Claude Code 요금제 한도** — 5시간 · 7일 % 를 공식 mod 통로 하나로만 받는다
//! (docs/log/2026-09-26-agent-usage.md · 2026-10-10 상태줄 → mod 전환).
//!
//! Claude Code 의 한도 % 는 로컬 파일에 없다. 공식으로 열린 길은 **mod 의 `session.measure` 이벤트**(Claude Code
//! v2.1.287+ — `rateLimits: [{ kind, percentUsed, resetsAt }]`, 턴마다 · 한도가 움직일 때)다. 예전에는 상태줄 명령의
//! 표준 입력을 받으려고 `--settings` 로 상태줄 자리를 빌렸는데(사용자 상태줄 감싸기 · 셸 고르기 · `cmd /d /c` · 따옴표
//! 규칙 · 셸의 `claude` 감싸개), mod 는 상태줄을 건드리지 않는다. 문서화되지 않은 OAuth 사용량 엔드포인트는 부르지
//! 않고 다른 앱의 자격증명 파일도 읽지 않는다(사용자 결정 — 그대로).
//!
//! ## 세 쪽
//!
//! 1. **mod** — `claude_usage/mod/` 의 세 파일(`plugin.json` · `hooks/hooks.json` · `hooks/register.js`)을 앱이
//!    `<설정 폴더>/aynx/claude-mod/aynx-usage/` 에 적는다([`ensure_mod_dir`] — 내용이 다를 때만). mod 는
//!    `session.measure` 에서 한도 목록을 JSON 으로 도우미의 표준 입력에 넘긴다(바뀌었거나 1분 넘었을 때만).
//! 2. **타일 환경** — `crate::pty` 가 로컬 셸을 띄울 때 [`tile_env`] 의 두 값을 심는다: `CLAUDE_CODE_PLUGIN_DIRS`(mod 폴더 —
//!    사용자 값이 있으면 뒤에 잇는다)와 [`crate::tile_env::USAGE_HELPER_ENV`](도우미 = 앱 실행 파일). 그래서 그 타일에서 뜨는
//!    **모든** claude(AI 타일 autorun · 재개 · 손으로 친 것 · cmd 까지)가 mod 를 싣는다 — 명령 줄을 고치지 않는다.
//!    설정 `[ai] claude_statusline`(이름은 옛것 그대로 — 기본 켬)이 꺼졌거나 WSL 타일(Windows 경로가 뜻이 없다)이면 심지 않는다.
//! 3. **도우미** — 같은 실행 파일의 `aynx claude-usage` 갈래(`main.rs` 가 Tauri 앞에서 가른다, [`helper_main`]).
//!    표준 입력에서 `five_hour` · `seven_day` 만 뽑아 `<설정 폴더>/aynx/usage/claude-limits.json` 에 **숫자만**
//!    적는다(바뀌었거나 1분 넘었을 때만 · 임시 파일 → 이름 바꾸기 — mod 의 `$.fs.write` 는 원자적이지 않아 쓰지 않는다).
//!    읽는 쪽(`crate::agent_usage` 의 `LimitSource::HelperFile`)은 예전 그대로다.
//!
//! ## 옛 판의 흔적 — `aynx statusline`
//!
//! 세션 서버 덕분에 앱을 업데이트해도 옛 셸과 그 안의 claude 가 산다. 옛 claude 는 `--settings` 파일의 상태줄로
//! `aynx statusline <열쇠>` 를, 옛 셸의 감싸개는 `aynx statusline --settings-path` 를 계속 부른다. 그 갈래가
//! 없으면 Tauri 가 떠 버리므로(둘째 실행 = 첫 창 포커스) [`legacy_statusline_main`] 이 조용히 받는다: 경로 질문에는
//! 빈 답(감싸개가 그냥 claude 를 띄운다), 상태줄 입력에서는 한도를 적고 조용한 기본 줄 하나. 사용자 상태줄 감싸기는
//! 하지 않는다(옛 세션은 다시 띄울 때까지 우리 기본 줄을 본다).
//!
//! ## 한계
//!
//! - Claude Code 가 2.1.287 보다 오래됐거나 `--safe-mode` · `--bare` · `disableAllHooks` · 조직의 `disableSideloadFlags`
//!   · `allowManagedModsOnly` 면 mod 가 실리지 않는다 — 한도 % 가 빈다(상태줄 대비책은 두지 않는다, 2026-10-10 사용자 결정).
//! - 사용자 `~/.claude/settings.json` 의 `env` 가 `CLAUDE_CODE_PLUGIN_DIRS` 를 정하면 그것이 우리 값을 덮을 수 있다.
//! - 원격(SSH) claude 는 아직 받지 않는다(Codex 만 — 롤아웃 꼬리).

use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent_usage::LimitWindow;

/// 한도 파일을 새로 적는 최소 간격 — 값이 같으면 이만큼 지나야 "잰 시각" 만 새로 적는다.
const REWRITE_AFTER_MS: i64 = 60_000;
/// 표준 입력 상한 — 한도 목록은 수백 바이트, 옛 상태줄 입력은 수 KB 다.
const STDIN_MAX: u64 = 4 * 1024 * 1024;
/// mod(플러그인) 이름 — 폴더 이름이자 Claude `/plugin` 에 보이는 이름.
const MOD_NAME: &str = "aynx-usage";
/// Claude Code 가 읽는 mod 폴더 목록 변수(`--plugin-dir` 와 같은 뜻 — OS 의 경로 구분자로 잇는다).
pub(crate) const PLUGIN_DIRS_ENV: &str = "CLAUDE_CODE_PLUGIN_DIRS";

/// mod 의 세 파일 — (mod 폴더 안의 상대 경로, 내용).
const MOD_FILES: [(&str, &str); 3] = [
    (".claude-plugin/plugin.json", include_str!("claude_usage/mod/plugin.json")),
    ("hooks/hooks.json", include_str!("claude_usage/mod/hooks.json")),
    ("hooks/register.js", include_str!("claude_usage/mod/register.js")),
];

// ---------------------------------------------------------------------------
// 파일 자리
// ---------------------------------------------------------------------------

/// `<설정 폴더>/aynx/usage` — 한도 파일이 산다.
pub(crate) fn usage_dir() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("usage"))
}

/// 도우미가 적는 한도 파일.
pub(crate) fn limits_path() -> Option<PathBuf> {
    Some(usage_dir()?.join("claude-limits.json"))
}

/// `<설정 폴더>/aynx/claude-mod/aynx-usage` — 앱이 적는 mod 폴더.
fn mod_dir() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("claude-mod").join(MOD_NAME))
}

/// Claude 의 설정 폴더 — `$CLAUDE_CONFIG_DIR` 또는 `~/.claude`.
pub(crate) fn claude_home() -> Option<PathBuf> {
    match std::env::var_os("CLAUDE_CONFIG_DIR").filter(|v| !v.is_empty()) {
        Some(d) => Some(PathBuf::from(d)),
        None => Some(dirs::home_dir()?.join(".claude")),
    }
}

/// 한도 파일의 모양 — **숫자만**.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LimitsFile {
    pub windows: Vec<LimitWindow>,
    /// 잰 시각(epoch ms).
    pub measured_at: i64,
}

pub(crate) fn read_limits_file(path: &Path) -> Option<LimitsFile> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// 임시 파일에 쓰고 이름을 바꾼다 — 읽는 쪽이 반쯤 적힌 파일을 보지 않게.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// 내용이 다를 때만 쓴다.
fn write_if_changed(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if std::fs::read(path).is_ok_and(|old| old == bytes) {
        return Ok(());
    }
    write_atomic(path, bytes)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// 요금제 창 — (kind, 분). `spend_limit`(게이트웨이의 지출 한도)은 요금제 한도가 아니라 싣지 않는다.
const PLAN_WINDOWS: [(&str, u64); 2] = [("five_hour", 300), ("seven_day", 10080)];

/// 새로 적어야 하나 — 값이 바뀌었거나, 같아도 잰 시각이 [`REWRITE_AFTER_MS`] 넘게 묵었으면.
fn needs_write(old: Option<&LimitsFile>, windows: &[LimitWindow], now: i64) -> bool {
    match old {
        None => true,
        Some(o) => o.windows != windows || now - o.measured_at >= REWRITE_AFTER_MS,
    }
}

fn record(path: &Path, windows: Vec<LimitWindow>, now: i64) -> std::io::Result<()> {
    if !needs_write(read_limits_file(path).as_ref(), &windows, now) {
        return Ok(());
    }
    let bytes = serde_json::to_vec(&LimitsFile {
        windows,
        measured_at: now,
    })
    .map_err(std::io::Error::other)?;
    write_atomic(path, &bytes)
}

fn read_stdin() -> Vec<u8> {
    let mut input = Vec::new();
    let _ = std::io::stdin().take(STDIN_MAX).read_to_end(&mut input);
    input
}

fn record_now(windows: Vec<LimitWindow>) {
    if windows.is_empty() {
        return;
    }
    if let Some(p) = limits_path() {
        let _ = record(&p, windows, now_ms());
    }
}

// ---------------------------------------------------------------------------
// 도우미 — `aynx claude-usage` (mod 가 부른다)
// ---------------------------------------------------------------------------

/// mod 가 넘긴 JSON(`[{ kind, percentUsed, resetsAt(ISO 8601) }]`) → 한도 칸들. 요금제 창 둘만, 그 순서로.
fn from_mod(v: &Value) -> Vec<LimitWindow> {
    let items = v.as_array().map(Vec::as_slice).unwrap_or_default();
    PLAN_WINDOWS
        .into_iter()
        .filter_map(|(kind, minutes)| {
            let w = items.iter().find(|w| w["kind"].as_str() == Some(kind))?;
            Some(LimitWindow {
                window_minutes: Some(minutes),
                kind: Some(kind.to_owned()),
                used_percent: w["percentUsed"].as_f64()?.clamp(0.0, 1000.0),
                resets_at: w["resetsAt"]
                    .as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|t| t.timestamp()),
            })
        })
        .collect()
}

/// `aynx claude-usage` 의 몸통 — `main.rs` 가 Tauri 앞에서 부른다. 늘 0 을 돌려준다(mod 를 깨뜨리지 않는다).
pub fn helper_main() -> i32 {
    let parsed: Option<Value> = serde_json::from_slice(&read_stdin()).ok();
    record_now(parsed.as_ref().map(from_mod).unwrap_or_default());
    0
}

// ---------------------------------------------------------------------------
// 옛 판의 흔적 — `aynx statusline` (모듈 머리말)
// ---------------------------------------------------------------------------

/// 옛 셸 감싸개가 묻던 "설정 파일 경로만" 갈래.
const LEGACY_SETTINGS_PATH_ARG: &str = "--settings-path";

/// 옛 상태줄 입력 JSON → 한도 칸들(`rate_limits.<kind>.used_percentage` · `resets_at` 은 epoch 초).
fn from_statusline(v: &Value) -> Vec<LimitWindow> {
    PLAN_WINDOWS
        .into_iter()
        .filter_map(|(kind, minutes)| {
            let w = &v["rate_limits"][kind];
            Some(LimitWindow {
                window_minutes: Some(minutes),
                kind: Some(kind.to_owned()),
                used_percent: w["used_percentage"].as_f64()?.clamp(0.0, 1000.0),
                resets_at: w["resets_at"].as_f64().map(|s| s as i64),
            })
        })
        .collect()
}

/// 조용한 기본 줄 — `모델 · 5h 23% · 7d 83%`. 모델도 한도도 없으면 빈 줄.
fn default_line(v: Option<&Value>, windows: &[LimitWindow]) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(m) = v
        .and_then(|v| v["model"]["display_name"].as_str())
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        parts.push(m.chars().take(40).collect());
    }
    for w in windows {
        let label = if w.window_minutes == Some(300) { "5h" } else { "7d" };
        parts.push(format!("{label} {}%", w.used_percent.round() as i64));
    }
    parts.join(" · ")
}

/// `aynx statusline …` — 옛 판이 띄운 claude · 셸이 부르는 갈래. 늘 0.
pub fn legacy_statusline_main() -> i32 {
    if std::env::args().nth(2).as_deref() == Some(LEGACY_SETTINGS_PATH_ARG) {
        return 0; // 빈 답 — 옛 감싸개는 그냥 claude 를 띄운다
    }
    let parsed: Option<Value> = serde_json::from_slice(&read_stdin()).ok();
    let windows = parsed.as_ref().map(from_statusline).unwrap_or_default();
    record_now(windows.clone());
    let mut so = std::io::stdout().lock();
    let _ = writeln!(so, "{}", default_line(parsed.as_ref(), &windows));
    let _ = so.flush();
    0
}

// ---------------------------------------------------------------------------
// 타일 환경 — mod 폴더 · 도우미 경로
// ---------------------------------------------------------------------------

/// mod 폴더에 세 파일을 적는다(내용이 다를 때만).
fn write_mod_files(dir: &Path) -> std::io::Result<()> {
    for (rel, text) in MOD_FILES {
        write_if_changed(&dir.join(rel), text.as_bytes())?;
    }
    Ok(())
}

fn ensure_mod_dir() -> Option<PathBuf> {
    let dir = mod_dir()?;
    write_mod_files(&dir).ok()?;
    Some(dir)
}

/// 타일 셸에 심을 두 값 — **순수 함수**. 꺼졌거나 WSL 이면 없다. `existing` 은 이미 있던 `CLAUDE_CODE_PLUGIN_DIRS`
/// (있으면 우리 폴더를 **뒤에** 잇는다 — 사용자의 mod 가 먼저 돈다). 같은 이름의 다른 폴더(다른 인스턴스의 사본 — 릴리스
/// 타일에서 띄운 개발 앱이 물려받는다)는 빼서 mod 가 둘 실리지 않게 한다.
fn tile_env_values(
    enabled: bool,
    shell_id: &str,
    exe: &Path,
    mod_dir: &Path,
    existing: Option<OsString>,
) -> Vec<(String, String)> {
    if !enabled || shell_id.starts_with("wsl:") {
        return Vec::new();
    }
    let mut dirs: Vec<PathBuf> = existing
        .as_deref()
        .map(|v| {
            std::env::split_paths(v)
                .filter(|p| !p.as_os_str().is_empty() && p.file_name() != Some(MOD_NAME.as_ref()))
                .collect()
        })
        .unwrap_or_default();
    dirs.push(mod_dir.to_path_buf());
    let Ok(joined) = std::env::join_paths(dirs) else {
        return Vec::new(); // 경로에 구분자가 든 이상한 값 — 건드리지 않는다
    };
    vec![
        (PLUGIN_DIRS_ENV.to_owned(), joined.to_string_lossy().into_owned()),
        (
            crate::tile_env::USAGE_HELPER_ENV.to_owned(),
            exe.to_string_lossy().into_owned(),
        ),
    ]
}

/// `crate::pty` 가 로컬 셸을 띄울 때 부른다 — 설정을 읽고 mod 파일을 적으므로 블로킹 문맥에서만. **GUI 의 exe** 로
/// 정한다(개발 빌드의 서버는 그림자 사본에서 돈다).
pub(crate) fn tile_env(shell_id: &str) -> Vec<(String, String)> {
    let enabled = crate::settings::claude_statusline();
    if !enabled {
        return Vec::new();
    }
    let (Ok(exe), Some(dir)) = (std::env::current_exe(), ensure_mod_dir()) else {
        return Vec::new();
    };
    // 앱이 Claude Code 세션 안에서 떴으면(`CLAUDECODE`) 물려받은 값은 그 **부모 세션의** mod 폴더다 — 잇지 않는다
    // (`crate::pty::PARENT_AGENT_ENV` 가 자식 환경에서도 걷는다).
    let existing = std::env::var_os("CLAUDECODE").is_none().then(|| std::env::var_os(PLUGIN_DIRS_ENV)).flatten();
    tile_env_values(enabled, shell_id, &exe, &dir, existing)
}

#[cfg(test)]
mod tests;

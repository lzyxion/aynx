//! 프로젝트 목록 — `<config_dir>/aynx/projects.json` (docs/log/2026-09-24-projects.md).
//!
//! **프로젝트**는 저장소 폴더 하나다. 로컬이면 경로, 원격이면 호스트 별칭 + 그 서버의 경로이고,
//! "열면" 그 폴더에서 타일이 하나 뜨고 프로젝트의 **에이전트**(기본 Claude Code — `null` 이면 셸)가 뜬다.
//! 프로젝트 독(`Ctrl+Shift+J`) · 명령 팔레트 · 즐겨찾기가 이 표를 읽는다.
//!
//! ```json
//! { "projects": [
//!   { "id": "3f2a…", "name": "aynx", "host": null, "path": "C:\\Users\\me\\projects\\proj",
//!     "shell": null, "agent": "claude", "setupScript": "pnpm install", "tmux": false },
//!   { "id": "9c01…", "name": "aynx (dev-01)", "host": "dev-01", "path": "~/aynx",
//!     "shell": null, "agent": null, "tmux": true } ] }
//! ```
//!
//! ## 시작 명령 → 에이전트 · 설정 스크립트 (2026-09-28 — docs/log/2026-09-28-project-agent-setup-script.md)
//!
//! 옛 칸 `command`(자유 글자 한 줄)는 없어졌다. 읽을 때 [`migrate_command`] 가 옮기고, 새로 쓸 때는 그 칸을 쓰지
//! 않는다: 빈 글자 → 셸(`agent: null`), 첫 낱말이 에이전트 실행 파일(`crate::agent_args::TARGETS`) → 그 에이전트
//! (뒤에 인자가 있었으면 [`ProjectMigration`] `args` — 폼이 "설정 › AI 추가 인자로 옮겨 주세요" 한 줄), 그 밖의
//! 명령 → 셸 + (설정 스크립트가 비었으면) 그 명령을 설정 스크립트로(`script` — "설정 스크립트로 옮겼습니다").
//! 안내 칸은 사람이 폼을 저장하면 사라진다(폼은 그 칸을 보내지 않는다).
//!
//! **설정 스크립트**(`setupScript`)는 여러 줄 글자다 — 새 워크트리를 만들 때 그 타일에서 에이전트보다 먼저 한 번
//! 돈다(`crate::setup_script`). 이 파일에만 살고 MCP 로도 로그로도 나가지 않는다(`Debug` 는 줄 수만 적는다).
//!
//! ## 파일 관례 — `snippets.json` 과 같은 폴더·같은 원자적 쓰기, 그러나 **백엔드가 스키마를 안다**
//!
//! 쓰기는 [`crate::app_state::save_at`](원자적 교체 · 무변경 생략) 하나를 지나고, 없거나 깨진
//! 파일은 빈 목록으로 시작해 콘솔에 **한 번만** 남긴다(`host_history.rs` 와 같은 판정). 다만
//! 스니펫처럼 불투명 문자열을 보관만 하지 않는다 — **호스트 이름 변경·제거 팬아웃**이 이 표의
//! `host` 칸을 고쳐야 하고, 그 일을 프런트가 목록 전체를 다시 써서 하면 창 둘이 서로의 변경을
//! 덮는다. 그래서 명령이 한 줄씩(추가·교체·삭제·별칭 따라가기) 고치고, 고칠 때마다
//! [`CHANGED_EVENT`] 를 쏘아 창마다 든 사본이 다시 읽는다.
//!
//! ## 여기 없는 것
//!
//! `git` 을 부르지 않는다 — 워크트리는 [`crate::worktree`] 가 따로 맡는다(설계 노트의 둘째 ·
//! docs/log/2026-09-24-worktrees.md). 경로가 실제로 있는지도
//! 보지 않는다: 원격 경로는 이 PC 에서 알 수 없고, 로컬 경로가 사라져도 타일은 홈에서 뜬다
//! (`pty.rs` 의 `spawn_cwd` — 없는 폴더는 조용히 홈이다).
//!
//! **보안 메모**: 에이전트는 표의 id 하나고, 설정 스크립트는 사람이 폼에 손으로 적은 글자다. 앱은 여기에 아무것도
//! 지어 넣지 않고, 사람이 [열기] · 새 워크트리 · [설정 스크립트 실행] 을 누른 순간에만 그 타일에서 돌린다 —
//! `on_connect`·tmux 부트스트랩과 같은 자리다(AI 문자열이 PTY 로 가는 길이 아니다 — MCP 에는 이 표를 읽는 도구도
//! 쓰는 도구도 없다). 비밀은 한 글자도 담지 않는다.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

use crate::app_state::{load_at, missing_dir, save_at};
use crate::i18n::tr;

/// 한 번 고칠 때마다 쏘는 이벤트 — 창마다 든 사본(`app/projects.svelte.ts`)이 듣고 다시 읽는다.
pub const CHANGED_EVENT: &str = "projects-changed";

/// 옛 파일에 `command` 칸이 **없던** 줄의 시작 명령 — 그때의 기본값(`claude`)이다. 이관이 이 글자를 에이전트로 읽는다.
const LEGACY_DEFAULT_COMMAND: &str = "claude";

/// 이관 안내 — 옛 시작 명령을 옮기며 사람에게 한 줄 알릴 것 (모듈 머리말). 폼을 저장하면 사라진다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ProjectMigration {
    /// `args` — 에이전트로 옮겼고 뒤의 인자 `text` 는 설정 › AI 추가 인자로 옮겨야 한다 ·
    /// `script` — 명령 `text` 를 설정 스크립트로 옮겼다 · `dropped` — 설정 스크립트가 이미 있어 명령 `text` 를 옮기지 못했다.
    pub kind: String,
    /// 옛 명령의 그 조각 (사람이 적은 글자 그대로)
    pub text: String,
}

/// 프로젝트 하나.
///
/// 읽기는 [`ProjectWire`] 를 지난다(옛 `command` 칸의 이관 — [`migrate_command`]). `Debug` 는 손으로 짓는다 —
/// 설정 스크립트 본문을 남기지 않는다(줄 수만).
#[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(from = "ProjectWire")]
pub struct Project {
    /// 안정된 신원 — 즐겨찾기(`project:<id>`)·독의 선택이 이 글자로 가리킨다. 비어 오면
    /// [`project_upsert`] 가 새로 뽑는다.
    #[serde(default)]
    pub id: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
    /// 목록에 보이는 이름.
    #[serde(default)]
    pub name: String,
    /// 원격이면 `~/.ssh/config` 의 별칭, 로컬이면 `null`.
    #[serde(default)]
    pub host: Option<String>,
    /// 저장소 폴더 — 로컬이면 이 PC 의 절대 경로, 원격이면 그 서버의 경로(`~/…` 허용).
    #[serde(default)]
    pub path: String,
    /// **로컬 전용** — 열 셸의 id (`list_shells` 의 `id`). 없으면 기본 셸.
    #[serde(default)]
    pub shell: Option<String>,
    /// 열면 뜨는 에이전트 — `crate::agent_args::TARGETS` 의 id(`claude` · `codex`), `None` 이면 셸만 그 폴더에서 연다.
    /// 띄우는 줄은 AI 타일과 같은 문(`crate::agent_autorun::agent_autorun_command`)을 지난다(추가 인자 · 장식).
    pub agent: Option<String>,
    /// 설정 스크립트 — 여러 줄(`\n`), 빈 글자 = 없음. 새 워크트리를 만들 때 한 번 돈다(`crate::setup_script`).
    #[serde(rename = "setupScript", skip_serializing_if = "String::is_empty")]
    pub setup_script: String,
    /// **원격 전용** — 호스트가 tmux 호스트일 때 이 프로젝트의 타일도 tmux 안에서 뜰 것인가.
    /// 호스트가 tmux 가 아니면 뜻이 없다 (둘 다 켜져야 tmux 다 — docs/log/2026-09-24-projects.md).
    #[serde(default = "default_tmux")]
    pub tmux: bool,
    /// 새 워크트리를 만들 **부모 폴더** — 없으면 기본 자리 `<저장소 부모>/<저장소명>-wt`
    /// ([`crate::worktree::worktree_base`]). 새 워크트리는 이 폴더 아래 `<이름>` 이다.
    ///
    /// 사용자 피드백(2026-09-24, "워크트리가 어디 생기는지 모르겠다")으로 생긴 칸이다 — 자리를
    /// 숨은 규칙이 아니라 폼에 보이는 값으로 둔다. 칸 이름은 프런트(`worktreeDir`)와 같은
    /// 글자로 적고, 비어 있으면 파일에 쓰지 않는다(옛 파일과 모양이 같다).
    #[serde(
        default,
        rename = "worktreeDir",
        skip_serializing_if = "Option::is_none"
    )]
    pub worktree_dir: Option<String>,
    /// 이관 안내 (모듈 머리말) — 옛 시작 명령을 옮긴 줄에만 있다. 폼이 저장하면 사라진다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub migration: Option<ProjectMigration>,
    /// 목록에 보일 아이콘 — 호스트 메타의 `icon` 과 같은 문자열(이모지 · `svg:…`). 없으면 기본 그림
    /// (docs/log/2026-09-29-folder-project-icons.md). 앱은 해석하지 않고, 비어 있으면 파일에 쓰지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// 아이콘의 색 — CSS 색 문자열(`#4a90d9`). 단색(선) 아이콘과 기본 그림에만 입는다. 비어 있으면 쓰지 않는다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

impl std::fmt::Debug for Project {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Project")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("host", &self.host)
            .field("path", &self.path)
            .field("shell", &self.shell)
            .field("agent", &self.agent)
            // 본문은 남기지 않는다(CLAUDE.md 보안 제약 — 로그·Debug) — 줄 수만.
            .field("setup_script_lines", &script_lines(&self.setup_script))
            .field("tmux", &self.tmux)
            .field("worktree_dir", &self.worktree_dir)
            .field(
                "migration",
                &self.migration.as_ref().map(|m| m.kind.as_str()),
            )
            .field("icon", &self.icon)
            .field("color", &self.color)
            .finish()
    }
}

/// 설정 스크립트의 줄 수 — 빈 줄은 세지 않는다(제거 확인 "설정 스크립트 N줄" · `Debug`).
pub(crate) fn script_lines(script: &str) -> usize {
    script.lines().filter(|l| !l.trim().is_empty()).count()
}

fn default_tmux() -> bool {
    true
}

/// 파일·프런트에서 오는 한 줄의 모양 — 옛 `command` 칸을 받아 [`Project`] 로 옮긴다(`serde(from)`).
///
/// `agent` 칸이 **있으면**(값이 `null` 이어도) 새 모양이라 그대로 쓰고 `command` 는 버린다. 없으면 옛 모양이다 —
/// `command`(없으면 그때의 기본값 `claude`)를 [`migrate_command`] 로 옮긴다.
#[derive(serde::Deserialize)]
struct ProjectWire {
    #[serde(default)]
    id: String,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    host: Option<String>,
    #[serde(default)]
    path: String,
    #[serde(default)]
    shell: Option<String>,
    #[serde(default, deserialize_with = "present")]
    agent: Option<Option<String>>,
    #[serde(default)]
    command: Option<String>,
    #[serde(default, rename = "setupScript")]
    setup_script: String,
    #[serde(default = "default_tmux")]
    tmux: bool,
    #[serde(default, rename = "worktreeDir")]
    worktree_dir: Option<String>,
    #[serde(default)]
    migration: Option<ProjectMigration>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    color: Option<String>,
}

/// 칸이 **있었다**(값이 `null` 이어도)를 `Some(..)` 으로 — 없으면 `#[serde(default)]` 의 `None`.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    use serde::Deserialize;
    Option::<String>::deserialize(d).map(Some)
}

impl From<ProjectWire> for Project {
    fn from(w: ProjectWire) -> Self {
        let (agent, setup_script, migration) = match w.agent {
            Some(agent) => (agent, w.setup_script, w.migration),
            None => {
                let command = w.command.as_deref().unwrap_or(LEGACY_DEFAULT_COMMAND);
                migrate_command(command, &w.setup_script)
            }
        };
        Project {
            id: w.id,
            // 옛 소속은 무시하고 다음 명시적 쓰기에서 버린다.
            extra: w
                .extra
                .into_iter()
                .filter(|(key, _)| key != "workspaceId")
                .collect(),
            name: w.name,
            host: w.host,
            path: w.path,
            shell: w.shell,
            agent,
            setup_script,
            tmux: w.tmux,
            worktree_dir: w.worktree_dir,
            migration,
            icon: w.icon,
            color: w.color,
        }
    }
}

/// 옛 시작 명령 한 줄 → (에이전트, 설정 스크립트, 안내) — **순수 함수**, 이관 표(모듈 머리말)를 고정하는 자리.
/// 프런트 `src/lib/projects.ts` 의 `migrateProjectCommand` 와 같은 표다(두 테스트가 같은 줄들을 본다).
pub(crate) fn migrate_command(
    command: &str,
    setup_script: &str,
) -> (Option<String>, String, Option<ProjectMigration>) {
    let cmd = command.trim();
    if cmd.is_empty() {
        return (None, setup_script.to_string(), None);
    }
    if let Some((agent, rest)) = crate::agent_args::agent_of_line(cmd) {
        let note = (!rest.is_empty()).then(|| ProjectMigration {
            kind: "args".into(),
            text: rest,
        });
        return (Some(agent.to_string()), setup_script.to_string(), note);
    }
    if setup_script.trim().is_empty() {
        let note = ProjectMigration {
            kind: "script".into(),
            text: cmd.to_string(),
        };
        return (None, cmd.to_string(), Some(note));
    }
    let note = ProjectMigration {
        kind: "dropped".into(),
        text: cmd.to_string(),
    };
    (None, setup_script.to_string(), Some(note))
}

/// 설정 스크립트를 저장할 모양으로 — 줄 끝(`\r\n` · `\r`)을 `\n` 으로, 줄마다 끝 공백과 앞뒤의 빈 줄을 뗀다.
/// 공백뿐이면 빈 글자(= 없음). 탭 말고 다른 제어 문자는 거절한다(NUL 은 셸에 실을 수 없고, ESC 같은 것은 화면을
/// 흔든다) — 실패는 사람이 읽을 한 줄.
pub(crate) fn normalize_script(script: &str) -> Result<String, String> {
    let unified = script.replace("\r\n", "\n").replace('\r', "\n");
    if unified
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err(tr!(
            ko: "설정 스크립트에 쓸 수 없는 제어 문자가 있습니다",
            en: "The setup script contains a control character that cannot be used"
        ));
    }
    let lines: Vec<&str> = unified.split('\n').map(str::trim_end).collect();
    let joined = lines.join("\n");
    Ok(joined.trim_end().trim_start_matches('\n').to_string())
}

/// 파일 한 장의 모양 — `{ "projects": [ … ] }` (순서가 곧 사람이 넣은 차례다).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ProjectsFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u32>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub projects: Vec<Project>,
}

pub(crate) fn projects_path() -> Option<PathBuf> {
    Some(crate::instance::config_root()?.join("projects.json"))
}

/// 읽고-고치고-쓰는 한 벌을 **한 번에 하나만** 돌린다 (창이 여럿이어도 프로세스는 하나다 —
/// `host_history.rs` 의 `FILE_LOCK` 과 같은 이유).
// 프로젝트는 전역 목록이며 workspace 잠금을 잡지 않는다.
pub(crate) static FILE_LOCK: Mutex<()> = Mutex::new(());

/// 깨진 파일을 한 번 알렸는가.
static WARNED: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// 순수 조작 — 유닛 테스트 대상
// ---------------------------------------------------------------------------

/// 파일을 읽는다. 없으면 빈 목록, **깨졌으면 빈 목록 + 한 번만 경고**.
pub(crate) fn load_file(path: &Path) -> ProjectsFile {
    let warn_once = |what: String| {
        if !WARNED.swap(true, Ordering::Relaxed) {
            eprintln!("[aynx] projects.json 을 읽을 수 없어 빈 목록으로 시작합니다: {what}");
        }
    };
    match load_at(path) {
        Ok(None) => ProjectsFile::default(),
        Ok(Some(raw)) => serde_json::from_str::<ProjectsFile>(&raw).unwrap_or_else(|e| {
            warn_once(e.to_string());
            ProjectsFile::default()
        }),
        Err(e) => {
            warn_once(e);
            ProjectsFile::default()
        }
    }
}

fn write_file(path: &Path, file: &ProjectsFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    save_at(path, &json).map(|_| ())
}

/// 들어온 한 줄을 **저장할 모양**으로 다듬는다 — 실패는 사람이 읽을 한 줄.
///
/// 규칙: 이름·경로는 비면 안 된다 · 경로에 제어문자(개행 포함)가 섞이면 안 된다 · 에이전트는 표에 있는 id 이거나
/// 없음 · 설정 스크립트는 [`normalize_script`] · 로컬이면 `tmux` 는 뜻이 없고, 원격이면 `shell` 은 뜻이 없다
/// (그 칸은 비운다). 이관 안내(`migration`)는 저장에서 지운다 — 폼이 저장했다는 것이 곧 사람이 읽었다는 뜻이다.
pub(crate) fn normalize(mut p: Project) -> Result<Project, String> {
    p.name = p.name.trim().to_string();
    p.path = p.path.trim().to_string();
    p.agent = p
        .agent
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty());
    if let Some(a) = &p.agent {
        if !crate::agent_args::is_agent(a) {
            return Err(tr!(ko: "모르는 에이전트입니다: {a}", en: "Unknown agent: {a}"));
        }
    }
    p.setup_script = normalize_script(&p.setup_script)?;
    p.migration = None;
    p.host = p
        .host
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty());
    p.shell = p
        .shell
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if p.name.is_empty() {
        return Err(tr!(ko: "프로젝트 이름이 비어 있습니다", en: "The project name is empty"));
    }
    if p.path.is_empty() {
        return Err(tr!(ko: "프로젝트 경로가 비어 있습니다", en: "The project path is empty"));
    }
    if p.path.chars().any(char::is_control) {
        return Err(tr!(ko: "경로는 한 줄이어야 합니다", en: "The path must be a single line"));
    }
    // 로컬은 **절대 경로만** (2026-09-24 실기 ⑤ — 위치를 원격으로 바꾸기 전에 적은 `~/aynx-lab` 이
    // 로컬 경로로 저장됐다). 로컬 타일은 셸 없이 그 폴더에서 뜨므로 `~`·상대 경로가 펴지지 않는다.
    // 워크트리 폴더 칸과 **같은 표**(`worktree::is_absolute_dir`) · 프런트 `isAbsoluteLocalPath`.
    if p.host.is_none() && !crate::worktree::is_absolute_dir(&p.path, false) {
        return Err(tr!(
            ko: "로컬 경로는 절대 경로여야 합니다 (예: C:\\Users\\me\\repo)",
            en: "A local path must be absolute (e.g. C:\\Users\\me\\repo)"
        ));
    }
    // 아이콘·색 — 앞뒤 공백을 떼고 비면 없음(호스트 메타의 빈 칸 = 키 없음과 같은 규칙). 한 줄이어야 한다.
    p.icon = p
        .icon
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    p.color = p
        .color
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if [&p.icon, &p.color]
        .into_iter()
        .flatten()
        .any(|s| s.chars().any(char::is_control))
    {
        return Err(
            tr!(ko: "아이콘과 색은 한 줄이어야 합니다", en: "The icon and color must be a single line"),
        );
    }
    p.worktree_dir = p
        .worktree_dir
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty());
    if let Some(dir) = &p.worktree_dir {
        crate::worktree::check_worktree_dir(&p.path, dir, p.host.is_some())?;
    }
    if p.host.is_some() {
        p.shell = None;
    } else {
        // 로컬에는 tmux 가 없다 — 켠 채로 두면 파일을 읽는 사람이 뜻을 오해한다.
        p.tmux = false;
    }
    Ok(p)
}

/// 같은 id 가 있으면 **그 자리에서** 바꾸고, 없으면 맨 뒤에 붙인다. 바뀌었으면 `true`.
pub(crate) fn upsert(file: &mut ProjectsFile, mut p: Project) -> bool {
    // 모르는 추가 필드는 편집 뒤에도 보존한다.
    if let Some(old) = file.projects.iter().find(|x| x.id == p.id) {
        for (key, value) in &old.extra {
            p.extra.entry(key.clone()).or_insert_with(|| value.clone());
        }
    }
    match file.projects.iter_mut().find(|x| x.id == p.id) {
        Some(slot) if *slot == p => false,
        Some(slot) => {
            *slot = p;
            true
        }
        None => {
            file.projects.push(p);
            true
        }
    }
}

/// id 하나를 뺀다. 뺀 것이 있으면 `true`.
pub(crate) fn remove(file: &mut ProjectsFile, id: &str) -> bool {
    let before = file.projects.len();
    file.projects.retain(|p| p.id != id);
    file.projects.len() != before
}

/// 별칭 비교는 저장소 전체에서 **대소문자를 무시한다** (`favorites.ts` 의 `withRenamedHost`).
fn same_alias(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// 호스트 이름 변경을 따라간다 — 그 별칭의 원격 프로젝트들이 새 이름을 가리키게. 바꾼 게 있으면 `true`.
pub(crate) fn rename_host(file: &mut ProjectsFile, from: &str, to: &str) -> bool {
    let to = to.trim();
    if from.trim().is_empty() || to.is_empty() || from.trim() == to {
        return false;
    }
    let mut changed = false;
    for p in &mut file.projects {
        if p.host.as_deref().is_some_and(|h| same_alias(h, from)) {
            p.host = Some(to.to_string());
            changed = true;
        }
    }
    changed
}

/// 호스트가 지워졌다 — 그 별칭의 원격 프로젝트를 **함께 뺀다**. 뺀 게 있으면 `true`.
///
/// 남겨 두지 않는 이유: 호스트 없는 원격 프로젝트는 열 방법이 없는 줄이다. 로컬로 바꿔 살리면
/// 원격 경로(`/root/aynx`)가 이 PC 의 경로인 척한다.
pub(crate) fn forget_host(file: &mut ProjectsFile, alias: &str) -> bool {
    if alias.trim().is_empty() {
        return false;
    }
    let before = file.projects.len();
    file.projects
        .retain(|p| !p.host.as_deref().is_some_and(|h| same_alias(h, alias)));
    file.projects.len() != before
}

/// 새 id — 16바이트 무작위의 hex. 엔트로피를 못 얻으면 시각으로 떨어진다(신원일 뿐 비밀이 아니다).
fn new_id() -> String {
    let mut buf = [0u8; 16];
    if getrandom::fill(&mut buf).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        return format!("{nanos:x}");
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn modify(path: &Path, f: impl FnOnce(&mut ProjectsFile) -> bool) -> Result<bool, String> {
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut file = load_file(path);
    if !f(&mut file) {
        return Ok(false);
    }
    write_file(path, &file)?;
    Ok(true)
}

fn upsert_at(path: &Path, project: Project) -> Result<(Project, bool), String> {
    let mut project = normalize(project)?;
    if project.id.trim().is_empty() {
        project.id = new_id();
    }
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut file = load_file(path);
    let changed = upsert(&mut file, project.clone());
    if changed {
        write_file(path, &file)?;
    }
    let saved = file
        .projects
        .into_iter()
        .find(|p| p.id == project.id)
        .expect("upserted project");
    Ok((saved, changed))
}

fn list_at(path: &Path) -> Result<Vec<Project>, String> {
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    Ok(load_file(path).projects)
}

/// 명령의 공용 꼬리 — 블로킹 풀에서 돌리고, 바뀌었으면 이벤트를 쏜다.
async fn run_modify(
    app: AppHandle,
    f: impl FnOnce(&mut ProjectsFile) -> bool + Send + 'static,
) -> Result<(), String> {
    let path = projects_path().ok_or_else(missing_dir)?;
    let changed = tauri::async_runtime::spawn_blocking(move || modify(&path, f))
        .await
        .map_err(|e| {
            tr!(
                ko: "프로젝트 목록을 고치는 작업이 실패했습니다: {e}",
                en: "The task that updates the project list failed: {e}"
            )
        })??;
    if changed {
        let _ = app.emit(CHANGED_EVENT, ());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 명령 — 전부 async + spawn_blocking (docs/conventions.md)
// ---------------------------------------------------------------------------

/// 목록 전체 (파일 순서 그대로). 없거나 깨졌으면 빈 목록이다(오류가 아니다).
#[tauri::command]
pub async fn projects_list() -> Result<Vec<Project>, String> {
    let path = projects_path().ok_or_else(missing_dir)?;
    tauri::async_runtime::spawn_blocking(move || list_at(&path))
        .await
        .map_err(|e| {
            tr!(
                ko: "프로젝트 목록을 읽는 작업이 실패했습니다: {e}",
                en: "The task that reads the project list failed: {e}"
            )
        })?
}

/// 한 줄을 넣거나 바꾼다 — 돌려주는 것은 **저장된 모양**(id 가 비어 왔으면 새 id 가 붙어 있다).
#[tauri::command]
pub async fn project_upsert(app: AppHandle, project: Project) -> Result<Project, String> {
    let path = projects_path().ok_or_else(missing_dir)?;
    let (saved, changed) = tauri::async_runtime::spawn_blocking(move || upsert_at(&path, project))
        .await
        .map_err(|e| tr!(ko: "프로젝트 저장 작업이 실패했습니다: {e}", en: "The project save task failed: {e}"))??;
    if changed {
        let _ = app.emit(CHANGED_EVENT, ());
    }
    Ok(saved)
}

/// 한 줄을 뺀다. 없는 id 면 조용히 성공이다.
///
/// 설정 스크립트는 이 줄에 살았으므로 함께 사라지고, **로컬** 프로젝트면 그 저장소의 워크트리별 스크립트 실행
/// 기록(곁 파일 `worktrees.json` — `crate::worktree::forget_setup_records`)도 걷는다. 폴더·워크트리는 디스크에 남는다.
#[tauri::command]
pub async fn project_remove(app: AppHandle, id: String) -> Result<(), String> {
    let path = projects_path().ok_or_else(missing_dir)?;
    let changed = tauri::async_runtime::spawn_blocking(move || {
        let mut gone: Option<Project> = None;
        let changed = modify(&path, |file| {
            gone = file.projects.iter().find(|p| p.id == id).cloned();
            remove(file, &id)
        })?;
        if let Some(p) = gone.filter(|p| p.host.is_none()) {
            crate::worktree::forget_setup_records(&p.path);
        }
        Ok::<bool, String>(changed)
    })
    .await
    .map_err(|e| {
        tr!(
            ko: "프로젝트 목록을 고치는 작업이 실패했습니다: {e}",
            en: "The task that updates the project list failed: {e}"
        )
    })??;
    if changed {
        let _ = app.emit(CHANGED_EVENT, ());
    }
    Ok(())
}

/// id 하나의 프로젝트 — **블로킹**(부르는 쪽이 블로킹 풀 안이다 — `crate::setup_script` 가 설정 스크립트를 이 파일에서
/// 직접 읽는다: 프런트가 스크립트 글자를 실어 보내는 길을 만들지 않는다). 없거나 설정 폴더를 모르면 `None`.
pub(crate) fn find_blocking(id: &str) -> Option<Project> {
    let path = projects_path()?;
    load_file(&path).projects.into_iter().find(|p| p.id == id)
}

/// 호스트 이름 변경 팬아웃(`app/host-rename.ts`)이 부른다 — 원격 프로젝트가 새 별칭을 따라간다.
#[tauri::command]
pub async fn project_rename_host(app: AppHandle, from: String, to: String) -> Result<(), String> {
    run_modify(app, move |file| rename_host(file, &from, &to)).await
}

/// 호스트 제거 팬아웃(`app/host-remove.ts`)이 부른다 — 그 호스트의 원격 프로젝트를 뺀다.
#[tauri::command]
pub async fn projects_forget_host(app: AppHandle, alias: String) -> Result<(), String> {
    run_modify(app, move |file| forget_host(file, &alias)).await
}

#[cfg(test)]
mod tests;

/// MCP 실행 범위 판별에 필요한 로컬 프로젝트 신원·경로만 읽는다(블로킹 문맥).
pub(crate) fn mcp_project_roots() -> Vec<(String, String)> {
    projects_path()
        .map(|path| {
            load_file(&path)
                .projects
                .into_iter()
                .filter(|p| p.host.is_none())
                .map(|p| (p.id, p.path))
                .collect()
        })
        .unwrap_or_default()
}

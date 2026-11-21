//! **허용 목록 하나 — 기본 거절.** 여기 이름이 없는 파일은 내보내지 않고, 묶음에 들어 있어도 가져오지 않는다.

/// 범주 id — 화면 · 묶음 manifest · 가져오기 선택이 모두 이 글자를 쓴다(순서 = 화면 순서 · 프런트 `settings-transfer.ts` 와 같은 글자).
pub(crate) const CATEGORIES: &[&str] = &[
    "hosts",
    "ai",
    "db",
    "projects",
    "templates",
    "appearance",
    "keys",
    "instructions",
    "mcp",
    "artists",
    "general",
    "notifications",
];

pub(crate) const SSH_HOSTS: &str = "ssh/hosts.conf";
pub(crate) const SSH_META: &str = "ssh/sessions.toml";
pub(crate) const DELEGATION: &str = "home/delegation.toml";
pub(crate) const SETTINGS: &str = "config/settings.toml";
pub(crate) const MANIFEST: &str = "manifest.json";

const CONFIG_FILES: &[(&str, &str)] = &[
    ("db-connections.json", "db"),
    ("db-folders.json", "db"),
    ("projects.json", "projects"),
    ("tab-templates.json", "templates"),
    ("theme-profiles.json", "appearance"),
    ("snippets.json", "keys"),
    ("orchestration-artists.toml", "artists"),
];

pub(crate) fn config_files() -> &'static [(&'static str, &'static str)] {
    CONFIG_FILES
}

/// `settings.toml` 의 맨 위 칸 → 범주. 여기 없는 칸(`[vault]` · `[remote]` · 모르는 칸)은 담지 않는다.
/// `[ai]` 의 `mcp_servers` 만은 따로 `mcp` 범주다([`AI_MCP_KEY`]).
pub(crate) const SETTINGS_SECTIONS: &[(&str, &str)] = &[
    ("app", "appearance"),
    ("terminal", "appearance"),
    ("wallpaper", "appearance"),
    ("dock", "appearance"),
    ("keybindings", "keys"),
    ("triggers", "keys"),
    ("automation", "ai"),
    ("messenger", "notifications"),
    ("shell", "general"),
    ("files", "general"),
    ("hosts", "general"),
    ("projects", "general"),
    ("plans", "general"),
    ("updates", "general"),
    ("ai", "general"),
];

pub(crate) const AI_MCP_KEY: &str = "mcp_servers";

pub(crate) fn section_category(key: &str) -> Option<&'static str> {
    SETTINGS_SECTIONS.iter().find(|(k, _)| *k == key).map(|(_, c)| *c)
}

/// `None` 인 경로는 가져오기가 읽지도 쓰지도 않는다. `settings.toml` 은 `"settings"` — 칸마다 범주가 갈린다.
pub(crate) fn category_of(path: &str) -> Option<&'static str> {
    match path {
        SSH_HOSTS | SSH_META => return Some("hosts"),
        DELEGATION => return Some("ai"),
        SETTINGS => return Some("settings"),
        _ => {}
    }
    let rest = path.strip_prefix("config/")?;
    if let Some((_, c)) = CONFIG_FILES.iter().find(|(n, _)| *n == rest) {
        return Some(c);
    }
    if !rest.contains('/') && crate::wallpaper::is_managed_name(rest) {
        return Some("appearance");
    }
    if let Some(name) = rest.strip_prefix("app-icons/") {
        if name == "names.json" || name.strip_suffix(".png").is_some_and(crate::app_icon::user::is_user_id) {
            return Some("appearance");
        }
        return None;
    }
    if let Some(name) = rest.strip_prefix("terminal-themes/") {
        return name.strip_suffix(".json").filter(|id| crate::term_themes::is_id(id)).map(|_| "appearance");
    }
    if let Some(name) = rest.strip_prefix("instructions/") {
        return is_instruction_name(name).then_some("instructions");
    }
    None
}

pub(crate) fn is_instruction_name(name: &str) -> bool {
    name.len() <= 200
        && name.ends_with(".md")
        && name.len() > 3
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':'])
        && !name.chars().any(char::is_control)
}

/// 파일별 담음/뺌 판정 — `(이름 또는 꼴, 범주 — None 이면 뺌, 이유)`. 시험 `root_files_table_matches_allowlist` 가 허용 목록과 맞춰 본다.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const ROOT_FILES: &[(&str, Option<&str>, &str)] = &[
    ("settings.toml", Some("(칸별)"), "칸마다 범주 — [vault] · [remote] 는 뺀다(볼트 · 원격 관문)"),
    ("db-connections.json", Some("db"), "비밀번호 칸이 없다(볼트 db_password)"),
    ("db-folders.json", Some("db"), "폴더 아이콘 · 색"),
    ("projects.json", Some("projects"), "프로젝트 목록"),
    ("tab-templates.json", Some("templates"), "탭 템플릿"),
    ("theme-profiles.json", Some("appearance"), "테마 프로필(지금 고른 것은 가져오지 않음)"),
    ("wp-<hash>.<ext> · wallpaper.<ext>", Some("appearance"), "월페이퍼 사본"),
    ("app-icons/user-<hex>.png · names.json", Some("appearance"), "사용자 아바타 그림 · 이름"),
    ("terminal-themes/<id>.json", Some("appearance"), "가져온 터미널 테마"),
    ("snippets.json", Some("keys"), "스니펫"),
    ("instructions/<이름>.md", Some("instructions"), "에이전트 지침 라이브러리"),
    ("orchestration-artists.toml", Some("artists"), "아티스트 — 권한 없는 프로필"),
    ("~/.aynx/delegation.toml [[target]] · [[database]]", Some("ai"), "AI 권한(신원 스냅샷 그대로) — [[repo]] 는 뺀다"),
    ("~/.ssh/config 구체 Host 블록", Some("hosts"), "Host 블록 원문만 — 키 파일은 담지 않음"),
    ("~/.ssh/sessions.toml [hosts.*] · [groups.*]", Some("hosts"), "호스트별 앱 설정"),
    ("vault.bin · vault.key", None, "볼트 — 비밀"),
    ("discord-webhook · slack-webhook", None, "웹훅 URL — 비밀(전문 6)"),
    ("telegram-bot · telegram-chat", None, "Telegram 봇 토큰(비밀) · 짝지은 계정 — 다른 PC 에서 다시 짝짓는다"),
    ("discord-bot · discord-chat", None, "Discord 봇 토큰(비밀) · 짝지은 계정 — 다른 PC 에서 다시 짝짓는다"),
    ("slack-bot · slack-chat", None, "Slack 봇 · 앱 수준 토큰(비밀) · 짝지은 계정 — 다른 PC 에서 다시 짝짓는다"),
    ("remote-devices.json", None, "원격 기기 · 페어링(전문 13)"),
    ("~/.aynx/mcp.json", None, "MCP 포트 · 토큰"),
    ("agent-mcp/", None, "타일별 MCP 설정 · 토큰 env"),
    ("server.json · server.log* · server-bin/", None, "세션 서버 찾기 파일 · 로그 · 실행 사본"),
    ("workspaces.json · layouts.json", None, "창 · 탭 배치"),
    ("history.json · db-history.json · ~/.aynx/history", None, "접속 · 명령 기록"),
    ("worktrees.json", None, "이 PC 에서 만든 워크트리 기록(경로가 PC 마다 다르다)"),
    ("updater.json", None, "업데이트 확인 상태"),
    ("instructions-written.json", None, "지침을 써 둔 기록 상태"),
    ("hooks/ · integration*.ps1/.sh/.rc · claude-mod/", None, "앱이 다시 만드는 설치 산물"),
    ("usage/ · audit/ · logs/ · edit/ · attachments/", None, "사용량 · 감사 · 세션 로그 · 편집 사본 · 첨부"),
    ("sidechat/ · producer/ · orchestration/", None, "사이드 채팅 · 프로듀서 · 앨범(Run) 기록"),
    ("app-icons/current.ico", None, "작업 표시줄 아이콘 산출물"),
    ("migration-backup-*/ · backups/ · *.lock · .seeded", None, "이관 · 가져오기 백업 · 잠금 · 개발 씨앗 표식"),
    ("orchestration-presets.toml", None, "구성 묶음 — 저장소 맡기기와 같이 이 PC 의 저장소에 묶임"),
    ("~/.ssh 키 파일 · known_hosts", None, "키 · 호스트 키 — 담지 않음"),
];

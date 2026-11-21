//! `~/.aynx/delegation.toml` — 호스트마다 사용자가 **명시적으로 위임한** AI 권한. 그 별칭의 모든 원격 세션(사람이 연 타일 · 헤드리스)에 똑같이 걸린다.
//!
//! ## 불변식
//!
//! - 헤드리스 접속은 사람의 그 자리 승인이 없으므로 **위임한 별칭에만** 생긴다(→ docs/invariants.md 전문 4).
//! - 편집은 사람의 손뿐 — 파일 직접 수정 · 호스트 폼 · 타일 AI 권한 팝오버 · 설정 가져오기(모두 Tauri 명령). **MCP 에는 이 파일을 바꾸는 도구가 없다**(→ 전문 2).
//! - 단계는 누적 `off < read < approve < auto < all` 이고 저장은 불리언 칸 그대로다 — 비누적 조합도 누적으로 읽고([`Delegation::read_granted`] …), 쓰기는 [`normalize_grants`] 로 좁힌다.
//! - 헤드리스 접속은 'Ask'(작업안 대상) 이상에서만, 볼트 키 암호구는 그 접속 위에서만 — 비밀번호는 여전히 쓰지 않는다.
//! - 별칭이 config 에서 다른 서버를 가리키면 신원 스냅샷이 어긋나 거부된다([`Delegation::identity_matches`]).
//! - 파일이 없거나 깨졌으면 위임 없음(빈 목록)이다.

use std::path::{Path, PathBuf};

/// 권한 칸은 적지 않으면 `false` — 위임은 명시로만 생긴다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct DelegationTarget {
    pub alias: String,
    pub expect_user: String,
    pub expect_host: String,
    pub expect_port: u16,
    #[serde(default)]
    pub connect: bool,
    #[serde(default)]
    pub read: bool,
    #[serde(default)]
    pub propose: bool,
    #[serde(default)]
    pub auto_execute: bool,
    /// 대상이 전부 이 단계인 작업안은 명령을 가리지 않고 자동 승인된다. 옛 판은 이 키를 버린다(= 'Auto' 로 좁아진다).
    #[serde(default)]
    pub approve_all: bool,
    /// 기본 불변("헤드리스 위임은 볼트를 쓰지 않는다")을 이 호스트에서만 좁힌다 — 열리는 것은 키 암호구 하나, 비밀번호는 아니다.
    #[serde(default)]
    pub vault_passphrase: bool,
    /// 판정에는 쓰이지 않는다 — 읽어서 화면에 보일 뿐이다.
    #[serde(default = "default_client")]
    pub client: String,
}

fn default_client() -> String {
    "any".to_string()
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct Delegation {
    #[serde(default, rename = "target")]
    targets: Vec<DelegationTarget>,
    /// 옛 판은 이 키를 모른 채 버린다(호스트 위임은 그대로 읽힌다).
    #[serde(default, rename = "database")]
    databases: Vec<database::DatabaseTarget>,
}

impl Delegation {
    /// 번역하지 않는다 — 이 문자열은 [`Delegation::load_at`] 의 `eprintln!` 에만 닿는다. 화면에 내게 되면 `tr!` 로 옮긴다.
    pub fn parse(content: &str) -> Result<Delegation, String> {
        toml::from_str(content).map_err(|e| format!("delegation.toml 을 해석할 수 없습니다: {e}"))
    }

    pub fn load_default() -> Delegation {
        match delegation_path() {
            Some(path) => {
                migrate_legacy_file(&path);
                Delegation::load_at(&path)
            }
            None => Delegation::default(),
        }
    }

    fn load_at(path: &Path) -> Delegation {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return Delegation::default(),
        };
        match Delegation::parse(&content) {
            Ok(delegation) => delegation,
            Err(e) => {
                // 깨진 위임 정책으로 접속을 여느니 위임이 없는 것으로 본다(안전한 쪽).
                eprintln!("[aynx] {e} — 위임 목록을 비웁니다");
                Delegation::default()
            }
        }
    }

    /// SSH config 처럼 대소문자를 무시한다.
    pub fn target(&self, alias: &str) -> Option<&DelegationTarget> {
        self.targets
            .iter()
            .find(|t| t.alias.eq_ignore_ascii_case(alias))
    }

    /// `read` 만으로 내면 붙을 수 없는 헤드리스 유령 줄이 생긴다 — 접속 위임된 대상만 낸다.
    pub fn headless_targets(&self) -> Vec<&DelegationTarget> {
        self.targets
            .iter()
            .filter(|t| t.read && t.propose && t.connect)
            .collect()
    }

    pub fn connect_granted(&self, alias: &str) -> bool {
        self.target(alias).is_some_and(|t| t.read && t.propose && t.connect)
    }

    pub fn read_granted(&self, alias: &str) -> bool {
        self.target(alias).is_some_and(|t| t.read)
    }

    /// 타일 · 헤드리스 세션의 대상 자격과 실행 시점 재검사가 이 문 하나를 본다.
    pub fn propose_granted(&self, alias: &str) -> bool {
        self.target(alias).is_some_and(|t| t.read && t.propose)
    }

    /// 자동 승인이 명령 · 상한 · 전역 정책을 통과한 뒤 대상별로 또 보는 문이다 — 없으면 자동 실행도 없다.
    pub fn auto_execute_granted(&self, alias: &str) -> bool {
        self.target(alias)
            .is_some_and(|t| t.read && t.propose && t.auto_execute)
    }

    /// 대상이 **전부** 이 단계일 때만 자동 승인이 명령 정책과 빈도 한도를 건너뛴다(`operations::gate::approve_all_plan`).
    pub fn approve_all_granted(&self, alias: &str) -> bool {
        self.auto_execute_granted(alias) && self.target(alias).is_some_and(|t| t.approve_all)
    }

    /// MCP `get_auto_approval_policy` 용 숫자 하나 — 별칭은 내보내지 않는다.
    pub fn approve_all_granted_count(&self) -> usize {
        self.targets
            .iter()
            .filter(|t| t.read && t.propose && t.auto_execute && t.approve_all)
            .count()
    }

    /// 헤드리스 접속에서만 보는 문이다 — 사람이 있는 접속은 이 칸과 무관하게 볼트를 쓴다.
    pub fn vault_passphrase_granted(&self, alias: &str) -> bool {
        self.connect_granted(alias) && self.target(alias).is_some_and(|t| t.vault_passphrase)
    }

    /// MCP `get_auto_approval_policy` 용 숫자 하나 — 별칭 · 호스트 · 사용자 이름은 내보내지 않는다.
    pub fn auto_execute_granted_count(&self) -> usize {
        self.targets
            .iter()
            .filter(|t| t.read && t.propose && t.auto_execute)
            .count()
    }

    /// 하나라도 다르면 별칭이 다른 서버를 가리키게 바뀐 것이다 — 헤드리스 접속을 거부한다.
    pub fn identity_matches(&self, alias: &str, user: &str, host: &str, port: u16) -> bool {
        self.target(alias).is_some_and(|t| {
            t.expect_user == user && t.expect_host == host && t.expect_port == port
        })
    }
}

fn delegation_path() -> Option<PathBuf> {
    Some(crate::instance::home_root()?.join("delegation.toml"))
}

/// 옛 이름 — 스키마는 같아 내용 그대로 옮긴다. 지우면 옛 파일만 가진 사람의 위임이 사라진다.
const LEGACY_FILE_NAME: &str = "fleet.toml";

/// 새 파일이 이미 있으면 손대지 않는다(새 이름이 이긴다). (docs/log/2026-09-21-rename-fleet-to-delegation.md)
fn migrate_legacy_file(path: &Path) {
    if path.exists() {
        return;
    }
    let Some(legacy) = path.parent().map(|dir| dir.join(LEGACY_FILE_NAME)) else {
        return;
    };
    if !legacy.exists() {
        return;
    }
    match std::fs::rename(&legacy, path) {
        Ok(()) => eprintln!(
            "[aynx] {} 을(를) {} 로 옮겼습니다 (fleet → delegation 개명)",
            legacy.display(),
            path.display()
        ),
        Err(e) => eprintln!(
            "[aynx] {} 을(를) {} 로 옮기지 못했습니다 — 이번 실행은 위임이 없는 것으로 봅니다: {e}",
            legacy.display(),
            path.display()
        ),
    }
}

// ── 쓰기 — `[[target]]` 국소 편집 ──
// 재직렬화하지 않고 아는 키만 갈아 끼운다 — 사람이 적은 주석 · 키 순서 · 모르는 키가 그대로 남는다(`sessions_meta.rs` 와 같은 규칙).

use toml_edit::{ArrayOfTables, Decor, DocumentMut, Item, Table, Value};

use crate::i18n::tr;
use crate::sessions_meta::match_line_endings;

/// 새로 만들 때만 얹는다 — 이미 있는 파일에는 덧붙이지 않는다.
const NEW_FILE_HEADER: &str = "\
# ~/.aynx/delegation.toml — 호스트별 AI 권한 (aynx 전용)
# 호스트 폼 · DB 연결 폼의 \"AI 권한\" 칸이 이 파일을 고칩니다. 손으로 적은 주석·순서는 보존됩니다.

";

/// 신원 스냅샷은 여기 없다 — Rust 가 계산한다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct DelegationGrants {
    #[serde(default)]
    pub connect: bool,
    #[serde(default)]
    pub read: bool,
    #[serde(default)]
    pub propose: bool,
    #[serde(default)]
    pub auto_execute: bool,
    /// 옛 프런트는 이 칸을 보내지 않는다(= 끔).
    #[serde(default)]
    pub approve_all: bool,
    #[serde(default)]
    pub vault_passphrase: bool,
}

impl DelegationGrants {
    fn any(&self) -> bool {
        self.connect || self.read || self.propose || self.auto_execute || self.approve_all || self.vault_passphrase
    }
}

/// 신원 스냅샷은 내보내지 않는다 — 프런트가 쥐면 신원 그물이 사용자 입력으로 내려앉는다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct DelegationTargetView {
    pub alias: String,
    pub connect: bool,
    pub read: bool,
    pub propose: bool,
    pub auto_execute: bool,
    pub approve_all: bool,
    pub vault_passphrase: bool,
    pub client: String,
    /// 거짓이면 고아 위임(config 에 없는 별칭). 설정을 못 읽었으면 전부 `true` — "모른다" 를 고아로 칠하지 않는다.
    pub alias_known: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IdentitySnapshot {
    pub user: String,
    pub host: String,
    pub port: u16,
}

/// IPC 표면이라 화면 밖 호출도 늘 누적 모양으로 — 좁히는 쪽으로만 고치고 넓히지 않는다.
pub(crate) fn normalize_grants(g: &DelegationGrants) -> DelegationGrants {
    let read = g.read;
    let propose = read && g.propose;
    let auto_execute = propose && g.auto_execute;
    let approve_all = auto_execute && g.approve_all;
    let connect = propose && g.connect;
    let vault_passphrase = connect && g.vault_passphrase;
    DelegationGrants {
        connect,
        read,
        propose,
        auto_execute,
        approve_all,
        vault_passphrase,
    }
}

fn flatten(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_doc(content: &str) -> Result<DocumentMut, String> {
    content.parse::<DocumentMut>().map_err(|e| {
        tr!(
            ko: "delegation.toml 을 해석할 수 없어 저장하지 않았습니다 — 파일을 직접 고쳐 주세요: {why}",
            en: "delegation.toml could not be parsed, so nothing was saved — please fix the file by hand: {why}",
            why = flatten(&e.to_string()),
        )
    })
}

/// 인라인 `target = [{…}]` 은 읽기는 되지만 쓰기는 거절한다 — 조용히 모양을 바꾸지 않는다.
fn targets_of(doc: &DocumentMut) -> Result<Option<&ArrayOfTables>, String> {
    match doc.get("target") {
        None => Ok(None),
        Some(Item::ArrayOfTables(arr)) => Ok(Some(arr)),
        Some(_) => Err(tr!(
            ko: "delegation.toml 의 target 이 [[target]] 블록 배열이 아닙니다 — 파일을 직접 고쳐 주세요",
            en: "target in delegation.toml is not an array of [[target]] blocks — please fix the file by hand"
        )),
    }
}

/// 읽기([`Delegation::target`])와 같은 대소문자 무시 규칙이어야 한다.
fn index_of(arr: &ArrayOfTables, alias: &str) -> Option<usize> {
    arr.iter().position(|t| {
        t.get("alias")
            .and_then(Item::as_str)
            .is_some_and(|a| a.eq_ignore_ascii_case(alias))
    })
}

fn prefix_text(d: &Decor) -> String {
    d.prefix()
        .and_then(|p| p.as_str())
        .unwrap_or("")
        .to_string()
}

/// 있던 줄의 장식(정렬 공백 · 줄 끝 주석)을 물려받는다.
fn put(table: &mut Table, key: &str, new: Value) {
    match table.get_mut(key).and_then(Item::as_value_mut) {
        Some(old) => {
            let mut new = new;
            *new.decor_mut() = old.decor().clone();
            *old = new;
        }
        None => {
            table.insert(key, Item::Value(new));
        }
    }
}

/// TOML 주석은 바로 뒤 항목의 앞 장식이라 블록을 지우면 그 위 주석(첫 블록이면 파일 머리글)이 함께 사라진다 —
/// 다음 살아남는 블록 앞으로 옮기고, 옮길 곳이 없으면 돌려준다(호출부가 문서 끝에 붙인다).
fn remove_indices(arr: &mut ArrayOfTables, doomed: &[usize]) -> String {
    // 계획은 원래 번호로 먼저 다 세운다(지우면서 세면 번호가 밀린다).
    let mut carry = String::new();
    let mut moved: Vec<(usize, String)> = Vec::new();
    for i in 0..arr.len() {
        let prefix = arr
            .get(i)
            .map(|t| prefix_text(t.decor()))
            .unwrap_or_default();
        if doomed.contains(&i) {
            if prefix.contains('#') {
                carry.push_str(&prefix);
            }
        } else if !carry.is_empty() {
            moved.push((i, format!("{carry}{prefix}")));
            carry.clear();
        }
    }
    // 뒤에서부터 지운다(앞 번호가 밀리지 않게).
    for (i, prefix) in moved {
        if let Some(t) = arr.get_mut(i) {
            t.decor_mut().set_prefix(prefix);
        }
    }
    for i in doomed.iter().rev() {
        arr.remove(*i);
    }
    carry
}

fn with_rescued(rendered: String, carry: &str) -> String {
    if carry.is_empty() {
        rendered
    } else {
        format!("{rendered}{carry}")
    }
}

pub(crate) fn remove_aliases_in_doc(
    content: &str,
    aliases: &[String],
) -> Result<(String, usize), String> {
    let wanted: Vec<String> = aliases
        .iter()
        .map(|a| a.trim().to_lowercase())
        .filter(|a| !a.is_empty())
        .collect();
    if wanted.is_empty() {
        return Ok((content.to_string(), 0));
    }

    let mut doc = parse_doc(content)?;
    if targets_of(&doc)?.is_none() {
        return Ok((content.to_string(), 0));
    }

    let carry;
    let removed;
    {
        let arr = doc
            .get_mut("target")
            .and_then(Item::as_array_of_tables_mut)
            .expect("targets_of 가 방금 배열 오브 테이블임을 확인했다");
        let doomed: Vec<usize> = arr
            .iter()
            .enumerate()
            .filter(|(_, t)| {
                t.get("alias")
                    .and_then(Item::as_str)
                    .is_some_and(|a| wanted.iter().any(|w| w == &a.trim().to_lowercase()))
            })
            .map(|(i, _)| i)
            .collect();
        removed = doomed.len();
        if removed == 0 {
            return Ok((content.to_string(), 0));
        }
        carry = remove_indices(arr, &doomed);
    }

    let empty = targets_of(&doc)?.is_some_and(ArrayOfTables::is_empty);
    if empty {
        doc.remove("target");
    }

    Ok((
        match_line_endings(content, with_rescued(doc.to_string(), &carry)),
        removed,
    ))
}

/// 신원 스냅샷은 손대지 않는다 — 별칭이 바뀐 것이지 서버가 바뀐 것이 아니다.
pub(crate) fn rename_alias_in_doc(
    content: &str,
    from: &str,
    to: &str,
) -> Result<(String, bool), String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() || to.is_empty() {
        return Err(tr!(ko: "별칭이 비어 있습니다", en: "The alias is empty"));
    }
    // 글자가 똑같을 때만 no-op 이다 — 대소문자만 바꾸는 것도 이름 변경이다.
    if from == to {
        return Ok((content.to_string(), false));
    }

    let mut doc = parse_doc(content)?;
    let Some(index) = targets_of(&doc)?.and_then(|arr| index_of(arr, from)) else {
        return Ok((content.to_string(), false));
    };
    doc.get_mut("target")
        .and_then(Item::as_array_of_tables_mut)
        .and_then(|arr| arr.get_mut(index))
        .map(|t| put(t, "alias", Value::from(to)))
        .expect("방금 찾은 블록이 있어야 한다");

    Ok((match_line_endings(content, doc.to_string()), true))
}

/// 권한이 하나도 없으면 블록을 지운다 — 다 꺼진 블록도 읽는 사람에게는 "위임이 있다" 로 보인다.
pub(crate) fn upsert_target_in_doc(
    content: &str,
    alias: &str,
    snapshot: &IdentitySnapshot,
    grants: &DelegationGrants,
) -> Result<String, String> {
    let alias = alias.trim();
    if alias.is_empty() {
        return Err(tr!(ko: "별칭이 비어 있습니다", en: "The alias is empty"));
    }
    let grants = &normalize_grants(grants);

    if !grants.any() {
        return Ok(remove_aliases_in_doc(content, &[alias.to_string()])?.0);
    }

    let mut doc = parse_doc(content)?;
    let existing = targets_of(&doc)?.and_then(|arr| index_of(arr, alias));

    let arr = doc
        .entry("target")
        .or_insert_with(|| Item::ArrayOfTables(ArrayOfTables::new()))
        .as_array_of_tables_mut()
        .ok_or_else(|| {
            tr!(
                ko: "delegation.toml 의 target 이 [[target]] 블록 배열이 아닙니다 — 파일을 직접 고쳐 주세요",
                en: "target in delegation.toml is not an array of [[target]] blocks — please fix the file by hand"
            )
        })?;

    match existing {
        Some(i) => {
            let table = arr.get_mut(i).expect("방금 찾은 블록이 있어야 한다");
            // `alias` 는 건드리지 않는다 — 사용자가 적은 표기(대소문자)가 그대로 남는다.
            write_target(table, None, snapshot, grants);
        }
        None => {
            let mut table = Table::new();
            write_target(&mut table, Some(alias), snapshot, grants);
            arr.push(table);
        }
    }

    Ok(match_line_endings(content, doc.to_string()))
}

fn write_target(
    table: &mut Table,
    alias: Option<&str>,
    snapshot: &IdentitySnapshot,
    grants: &DelegationGrants,
) {
    if let Some(a) = alias {
        put(table, "alias", Value::from(a));
    }
    put(table, "expect_user", Value::from(snapshot.user.as_str()));
    put(table, "expect_host", Value::from(snapshot.host.as_str()));
    put(table, "expect_port", Value::from(i64::from(snapshot.port)));
    put(table, "connect", Value::from(grants.connect));
    put(table, "read", Value::from(grants.read));
    put(table, "propose", Value::from(grants.propose));
    put(table, "auto_execute", Value::from(grants.auto_execute));
    // 켤 때나 이미 적혀 있을 때만 — 모두 승인을 준 적 없는 블록은 한 글자도 바뀌지 않게.
    if grants.approve_all || table.contains_key("approve_all") {
        put(table, "approve_all", Value::from(grants.approve_all));
    }
    put(
        table,
        "vault_passphrase",
        Value::from(grants.vault_passphrase),
    );
}

// ── 파일 입출력 + 신원 스냅샷 ──

fn path_or_err() -> Result<PathBuf, String> {
    delegation_path().ok_or_else(
        || tr!(ko: "홈 디렉터리를 찾을 수 없습니다", en: "Could not find the home folder"),
    )
}

fn read_or_empty(path: &Path) -> Result<(String, bool), String> {
    match std::fs::read_to_string(path) {
        Ok(c) => Ok((c, true)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((String::new(), false)),
        Err(e) => Err(
            tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
        ),
    }
}

/// 바뀐 것이 없으면 손대지 않는다 — mtime 이 흔들리면 파일을 지켜보는 도구가 헛돈다.
fn write_if_changed(path: &Path, before: &str, existed: bool, after: String) -> Result<(), String> {
    if existed {
        if after == before {
            return Ok(());
        }
        return crate::fs_atomic::replace_through_link(path, after.as_bytes())
            .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()));
    }
    if after.trim().is_empty() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            tr!(ko: "{parent} 디렉터리를 만들지 못했습니다: {e}", en: "Could not create the folder {parent}: {e}", parent = parent.display())
        })?;
    }
    crate::fs_atomic::replace_through_link(path, format!("{NEW_FILE_HEADER}{after}").as_bytes())
        .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()))
}

fn open_error_text(e: crate::ssh::SshOpenError) -> String {
    use crate::ssh::SshOpenError as E;
    match e {
        E::PasswordRequired { message, .. }
        | E::Auth { message, .. }
        | E::Other { message, .. } => message,
        E::HostKeyUnknown { .. } | E::HostKeyChanged { .. } | E::PassphraseRequired { .. } => {
            tr!(ko: "이 별칭의 접속 정보를 해석할 수 없습니다", en: "Could not resolve the connection settings for this alias")
        }
    }
}

/// 프런트가 아니라 여기서 계산한다 — 검사([`Delegation::identity_matches`])와 한 길(`resolve_params` · `USERNAME` 폴백, `headless::connect_delegated` 와 같다)이어야 어긋나지 않는다.
fn identity_snapshot(alias: &str) -> Result<IdentitySnapshot, String> {
    let config = crate::ssh_config::load_default()?;
    if !config
        .hosts
        .iter()
        .any(|h| h.name.eq_ignore_ascii_case(alias))
    {
        return Err(tr!(
            ko: "'{alias}' 은(는) ~/.ssh/config 에 없는 별칭입니다 — 위임할 대상을 찾을 수 없습니다",
            en: "'{alias}' is not an alias in ~/.ssh/config — there is nothing to delegate to"
        ));
    }
    let username = std::env::var("USERNAME").ok();
    let params = crate::ssh::resolve_params(alias, &config.hosts, username.as_deref())
        .map_err(open_error_text)?;
    Ok(IdentitySnapshot {
        user: params.user,
        host: params.host,
        port: params.port,
    })
}

fn set_target_at(path: &Path, alias: &str, grants: &DelegationGrants) -> Result<(), String> {
    let grants = &normalize_grants(grants);
    let (before, existed) = read_or_empty(path)?;

    // 지우는 저장은 config 를 보지 않는다 — 막으면 고아 위임을 앱 안에서 지울 길이 없어진다.
    let after = if grants.any() {
        upsert_target_in_doc(&before, alias, &identity_snapshot(alias)?, grants)?
    } else {
        remove_aliases_in_doc(&before, &[alias.to_string()])?.0
    };

    write_if_changed(path, &before, existed, after)
}

// ── 명령 ──
// 쓰기는 Tauri 명령에만 있다 — MCP 에 대응 도구를 두지 않는다(AI 가 자기 위임을 넓힐 표면이 없게).

/// 프런트 `app/delegation.svelte.ts` 가 듣는 이름과 같은 값.
pub const CHANGED_EVENT: &str = "delegation-changed";

fn announce_on_ok<T>(app: &tauri::AppHandle, out: Result<T, String>) -> Result<T, String> {
    if out.is_ok() {
        use tauri::Emitter;
        let _ = app.emit(CHANGED_EVENT, ());
    }
    out
}

#[tauri::command]
pub async fn delegation_list_targets() -> Vec<DelegationTargetView> {
    tauri::async_runtime::spawn_blocking(|| {
        let known = crate::ssh_config::config_index();
        Delegation::load_default()
            .targets
            .into_iter()
            .map(|t| DelegationTargetView {
                alias_known: known
                    .as_ref()
                    .is_none_or(|i| i.contains_key(&t.alias.to_lowercase())),
                alias: t.alias,
                connect: t.connect,
                read: t.read,
                propose: t.propose,
                auto_execute: t.auto_execute,
                approve_all: t.approve_all,
                vault_passphrase: t.vault_passphrase,
                client: t.client,
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn delegation_set_target(
    app: tauri::AppHandle,
    alias: String,
    grants: DelegationGrants,
) -> Result<(), String> {
    let out = tauri::async_runtime::spawn_blocking(move || set_target_at(&path_or_err()?, &alias, &grants))
        .await
        .map_err(|e| tr!(ko: "위임을 저장하는 작업이 실패했습니다: {e}", en: "The task that saves the delegation failed: {e}"))?;
    announce_on_ok(&app, out)
}

#[tauri::command]
pub async fn delegation_rename_target(
    app: tauri::AppHandle,
    from: String,
    to: String,
) -> Result<bool, String> {
    let out = tauri::async_runtime::spawn_blocking(move || {
        let path = path_or_err()?;
        let (before, existed) = read_or_empty(&path)?;
        let (after, renamed) = rename_alias_in_doc(&before, &from, &to)?;
        write_if_changed(&path, &before, existed, after)?;
        Ok(renamed)
    })
    .await
    .map_err(|e| tr!(ko: "위임의 이름을 바꾸는 작업이 실패했습니다: {e}", en: "The task that renames the delegation failed: {e}"))?;
    announce_on_ok(&app, out)
}

#[tauri::command]
pub async fn delegation_remove_targets(
    app: tauri::AppHandle,
    aliases: Vec<String>,
) -> Result<usize, String> {
    let out = tauri::async_runtime::spawn_blocking(move || {
        let path = path_or_err()?;
        let (before, existed) = read_or_empty(&path)?;
        let (after, removed) = remove_aliases_in_doc(&before, &aliases)?;
        write_if_changed(&path, &before, existed, after)?;
        Ok(removed)
    })
    .await
    .map_err(|e| tr!(ko: "위임을 지우는 작업이 실패했습니다: {e}", en: "The task that removes the delegation failed: {e}"))?;
    announce_on_ok(&app, out)
}

pub(crate) mod database;

#[cfg(test)]
mod tests;

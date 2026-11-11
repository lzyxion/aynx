//! 에이전트 지침 라이브러리와 실제 파일의 관리 블록 (docs/log/2026-10-06-agent-instructions.md).
//!
//! 라이브러리는 instance::config_root()/instructions 에만 산다. rulesync 머리말의 필요한 부분만 읽고,
//! 모르는 최상위 칸과 그 아래 줄은 원문 그대로 돌려놓는다. 깨진 항목 하나가 나머지 목록을 가리지 않는다.
//! 본문은 사람이 쓴 글이며 Debug·오류에는 싣지 않는다. 저장과 반영은 서로 다른 명령이다.
//!
//! 파일 하나에 이 인스턴스의 관리 블록 하나만 둔다. 표시가 깨졌으면 추측해서 고치지 않고 Error 로 남긴다.
//! 블록 밖 바이트는 그대로이고, 제거 때 바로 앞 빈 줄 하나만 걷는다. 개발/릴리스 표시는 instance 가 정한다.
//! 미리 보기는 읽기만 하고 반영은 계획을 다시 계산한다. 쓰기는 같은 폴더의 임시 파일 + rename 이다.
//!
//! MCP 도구는 없다 — 다음 실행의 지침을 바꾸는 문은 사람의 Tauri 명령뿐이다. SSH 는 이미 열린 대화형 타일 연결만 빌리고, WSL 은 건너뛴다.
//! git 은 모른다(커밋·무시 정책 없음). 워크트리 자리만 crate::worktree 의 목록을 빌려 쓴다.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::i18n::tr;
use crate::projects::Project;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    Global,
    Project,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instruction {
    pub name: String,
    pub description: Option<String>,
    pub targets: Vec<String>,
    pub enabled: bool,
    pub scope: Scope,
    pub projects: Vec<String>,
    #[serde(default)]
    pub subpath: Option<String>,
    pub body: String,
    /// IPC 는 보내지 않는다 — 저장 때 기존 파일에서 다시 읽는다. 줄 끝까지 원문이다.
    #[serde(skip)]
    extra: Vec<String>,
}

impl std::fmt::Debug for Instruction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Instruction")
            .field("name", &self.name)
            .field("description", &self.description)
            .field("targets", &self.targets)
            .field("enabled", &self.enabled)
            .field("scope", &self.scope)
            .field("projects", &self.projects)
            .field("subpath", &self.subpath)
            .field("body_lines", &self.body.lines().count())
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenInstruction {
    name: String,
    reason: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionList {
    items: Vec<Instruction>,
    broken: Vec<BrokenInstruction>,
}

fn name_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 48
        && name.bytes().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-'
        })
}

fn validate_name(name: &str) -> Result<(), String> {
    if name_ok(name) {
        Ok(())
    } else {
        Err(tr!(ko: "이름은 영문 소문자·숫자·_·- 1~48자로 적으세요", en: "Use 1–48 lowercase letters, digits, _ or - for the name"))
    }
}

/// 저장·파싱이 같은 정규화를 쓴다. 정규화한 경로가 비면 루트를 뜻한다.
fn normalize_subpath(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.filter(|value| !value.is_empty()) else { return Ok(None); };
    let path = value.replace('\\', "/");
    let path = path.trim_matches('/');
    // 끝 구분자는 걷되 내부의 빈 조각은 고치지 않는다. 워크트리에 붙이는 값은 항상 상대 경로다.
    if path.contains(':') || path.chars().any(char::is_control)
        || path.chars().count() > 200
    {
        return Err(subpath_error());
    }
    if path.is_empty() { return Ok(None); }
    if path.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return Err(subpath_error());
    }
    Ok(Some(path.to_owned()))
}

fn subpath_error() -> String {
    tr!(ko: "하위 폴더는 200자 이하의 상대 경로로 적으세요. 빈 조각·.·..·:·제어 문자는 쓸 수 없습니다", en: "Use a relative subfolder path of at most 200 characters without empty segments, ., .., : or control characters")
}

fn validate_subpath(item: &mut Instruction) -> Result<(), String> {
    item.subpath = normalize_subpath(item.subpath.as_deref())?;
    if item.scope == Scope::Global && item.subpath.is_some() {
        return Err(tr!(ko: "전역 지침에는 하위 폴더를 지정할 수 없습니다", en: "Global instructions cannot specify a subfolder"));
    }
    Ok(())
}

fn header_error() -> String {
    tr!(ko: "지침 머리말의 형식이 올바르지 않습니다", en: "The instruction front matter has an invalid format")
}

/// 따옴표 밖의 YAML 주석만 걷는다. # 이 문자열 가운데 있으면 맨 글자의 일부다.
fn uncomment(value: &str) -> Result<&str, String> {
    let mut quote = None;
    let mut escaped = false;
    let mut previous_space = true;
    let mut may_quote = true;
    let mut chars = value.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        match quote {
            Some('"') => {
                if escaped {
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if c == '"' {
                    quote = None;
                }
            }
            Some('\'') => {
                if c == '\'' {
                    if chars.peek().is_some_and(|(_, c)| *c == '\'') {
                        chars.next();
                    } else {
                        quote = None;
                    }
                }
            }
            _ => {
                if c == '#' && previous_space {
                    return Ok(value[..i].trim_end());
                }
                if may_quote && (c == '"' || c == '\'') {
                    quote = Some(c);
                }
                if c == '[' || c == ',' {
                    may_quote = true;
                } else if !c.is_whitespace() {
                    may_quote = false;
                }
            }
        }
        previous_space = c.is_whitespace();
    }
    if quote.is_some() {
        Err(header_error())
    } else {
        Ok(value.trim_end())
    }
}

fn scalar(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.starts_with('"') {
        // 쓰기도 JSON 인용을 쓴다 — YAML 과 겹치는 문자열 부분 집합이다.
        serde_json::from_str::<String>(value).map_err(|_| header_error())
    } else if value.starts_with('\'') {
        let inner = value.strip_prefix('\'').and_then(|s| s.strip_suffix('\''))
            .ok_or_else(header_error)?;
        let mut chars = inner.chars().peekable();
        let mut out = String::new();
        while let Some(c) = chars.next() {
            if c == '\'' && chars.next() != Some('\'') {
                return Err(header_error());
            }
            out.push(c);
        }
        Ok(out)
    } else if value.is_empty()
        || value.chars().any(char::is_control)
        || value.contains(['[', ']', '{', '}'])
        || value.starts_with(['&', '*', '!', '|', '>'])
    {
        // * 는 targets 의 맨 값으로만 별도로 받는다(YAML alias 로 해석하지 않는다).
        Err(header_error())
    } else {
        Ok(value.to_owned())
    }
}

/// 흐름 목록의 쉼표는 따옴표 밖에서만 자른다. 중첩 목록은 이 부분 집합에 없다.
fn string_list(value: &str) -> Result<Vec<String>, String> {
    let value = value.trim();
    if value == "*" {
        return Ok(vec!["*".into()]);
    }
    if !value.starts_with('[') {
        return scalar(value).map(|s| vec![s]);
    }
    let inner = value.strip_prefix('[').and_then(|s| s.strip_suffix(']'))
        .ok_or_else(header_error)?;
    if inner.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut parts = Vec::new();
    let mut start = 0;
    let mut quote = None;
    let mut escaped = false;
    let mut chars = inner.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        match quote {
            Some('"') => {
                if escaped {
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if c == '"' {
                    quote = None;
                }
            }
            Some('\'') => {
                if c == '\'' {
                    if chars.peek().is_some_and(|(_, c)| *c == '\'') {
                        chars.next();
                    } else {
                        quote = None;
                    }
                }
            }
            _ => match c {
                '"' | '\'' if inner[start..i].trim().is_empty() => quote = Some(c),
                ',' => {
                    parts.push(scalar(&inner[start..i])?);
                    start = i + 1;
                }
                '[' | ']' => return Err(header_error()),
                _ => {}
            },
        }
    }
    if quote.is_some() {
        return Err(header_error());
    }
    parts.push(scalar(&inner[start..])?);
    Ok(parts)
}

fn target_id(id: &str) -> &str {
    match id {
        "claudecode" => "claude",
        "codexcli" => "codex",
        _ => id,
    }
}

fn rulesync_id(id: &str) -> &str {
    match id {
        "claude" => "claudecode",
        "codex" => "codexcli",
        _ => id,
    }
}

/// 본문과 모르는 최상위 블록은 해석하지 않는다. 닫는 --- 뒤부터가 본문이다.
fn parse(name: &str, text: &str) -> Result<Instruction, String> {
    parse_with_scope(name, text, Scope::Global)
}

fn parse_with_scope(name: &str, text: &str, scope: Scope) -> Result<Instruction, String> {
    validate_name(name)?;
    let mut lines = text.split_inclusive('\n');
    if lines.next().map(str::trim) != Some("---") {
        return Err(header_error());
    }
    let mut item = Instruction {
        name: name.to_owned(), description: None, targets: vec!["*".into()],
        enabled: true, scope, projects: Vec::new(), subpath: None,
        body: String::new(), extra: Vec::new(),
    };
    let mut offset = text.split_inclusive('\n').next().map_or(0, str::len);
    let mut section = "";
    let mut seen = HashSet::new();
    for raw in lines {
        let line = raw.trim_end_matches(['\r', '\n']);
        if line.trim() == "---" {
            item.body = text[offset + raw.len()..].to_owned();
            validate_subpath(&mut item)?;
            return Ok(item);
        }
        offset += raw.len();
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            item.extra.push(raw.to_owned());
            continue;
        }
        if line.starts_with(char::is_whitespace) {
            if section == "extra" {
                item.extra.push(raw.to_owned());
                continue;
            }
            if section == "agentsmd-extra" && (line.starts_with("    ") || line.trim_start().starts_with('-')) {
                item.extra.push(raw.to_owned());
                continue;
            }
            if section.starts_with("agentsmd") && line.starts_with("  ") && !line[2..].starts_with(char::is_whitespace) {
                let (key, value) = line[2..].split_once(':').ok_or_else(header_error)?;
                if key.trim() == "subprojectPath" {
                    if !seen.insert("agentsmd:subprojectPath".into()) { return Err(header_error()); }
                    let value = uncomment(value.trim())?;
                    item.subpath = if value.is_empty() { None } else { normalize_subpath(Some(&scalar(value)?))? };
                    section = "agentsmd";
                } else {
                    if !item.extra.iter().any(|line| line.trim() == "agentsmd:") {
                        item.extra.push(format!("agentsmd:{}", line_ending(text)));
                    }
                    item.extra.push(raw.to_owned());
                    section = "agentsmd-extra";
                }
                continue;
            }
            if section != "aynx" || !line.starts_with("  ")
                || line[2..].starts_with(char::is_whitespace)
            {
                return Err(header_error());
            }
            let (key, value) = line[2..].split_once(':').ok_or_else(header_error)?;
            let key = key.trim();
            let value = uncomment(value.trim())?;
            if !seen.insert(format!("aynx:{key}")) {
                return Err(header_error());
            }
            match key {
                "enabled" => item.enabled = match value {
                    "true" => true, "false" => false, _ => return Err(header_error()),
                },
                "scope" => item.scope = match scalar(value)?.as_str() {
                    "global" => Scope::Global, "project" => Scope::Project,
                    _ => return Err(tr!(ko: "지침 범위는 global 또는 project 여야 합니다", en: "The instruction scope must be global or project")),
                },
                "projects" => item.projects = string_list(value)?,
                _ => { /* 모르는 우리 칸은 아직 읽지 않는다. */ }
            }
            continue;
        }
        let (key, value) = line.split_once(':').ok_or_else(header_error)?;
        let key = key.trim();
        if !matches!(key, "targets" | "description" | "aynx" | "agentsmd") {
            section = "extra";
            item.extra.push(raw.to_owned());
            continue;
        }
        if !seen.insert(key.to_owned()) {
            return Err(header_error());
        }
        let value = uncomment(value.trim())?;
        section = "";
        match key {
            "targets" => item.targets = string_list(value)?.into_iter()
                .map(|s| target_id(&s).to_owned()).collect(),
            "description" => item.description = Some(scalar(value)?),
            "aynx" if value.is_empty() => section = "aynx",
            "agentsmd" if value.is_empty() => section = "agentsmd",
            _ => return Err(header_error()),
        }
    }
    Err(tr!(ko: "지침 머리말의 닫는 --- 줄이 없습니다", en: "The instruction front matter is missing its closing --- line"))
}

fn quoted(value: &str) -> String {
    serde_json::to_string(value).expect("문자열 직렬화")
}

fn flow(values: &[String]) -> String {
    format!("[{}]", values.iter().map(|s| quoted(s)).collect::<Vec<_>>().join(", "))
}

/// 아는 칸의 순서는 고정한다. extra 는 줄 끝을 포함한 원문이므로 그대로 끼운다.
fn serialize(item: &Instruction, newline: &str) -> String {
    let targets: Vec<String> = item.targets.iter().map(|s| rulesync_id(s).to_owned()).collect();
    let mut out = format!("---{newline}targets: {}{newline}", flow(&targets));
    if let Some(description) = &item.description {
        out.push_str(&format!("description: {}{newline}", quoted(description)));
    }
    out.push_str(&format!("aynx:{newline}  enabled: {}{newline}  scope: {}{newline}  projects: {}{newline}",
        item.enabled, if item.scope == Scope::Global { "global" } else { "project" }, flow(&item.projects)));
    let has_agents_extra = item.extra.iter().any(|line| line.trim() == "agentsmd:");
    if !has_agents_extra {
        if let Some(subpath) = &item.subpath {
            out.push_str(&format!("agentsmd:{newline}  subprojectPath: {}{newline}", quoted(subpath)));
        }
    }
    for line in &item.extra {
        out.push_str(line);
        if line.trim() == "agentsmd:" {
            if let Some(subpath) = &item.subpath {
                out.push_str(&format!("  subprojectPath: {}{newline}", quoted(subpath)));
            }
        }
        if !line.ends_with('\n') {
            out.push_str(newline);
        }
    }
    out.push_str(&format!("---{newline}"));
    out.push_str(&item.body);
    out
}

fn line_ending(text: &str) -> &'static str {
    if text.contains("\r\n") { "\r\n" } else { "\n" }
}

fn io_error(e: std::io::Error) -> String {
    tr!(ko: "지침 파일을 다루지 못했습니다: {e}", en: "Could not access the instruction file: {e}")
}

fn read_text(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_error(e)),
    }
}

fn list_at(root: &Path) -> Result<InstructionList, String> {
    let files = match std::fs::read_dir(root) {
        Ok(files) => files,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(InstructionList::default()),
        Err(e) => return Err(io_error(e)),
    };
    let mut out = InstructionList::default();
    for file in files {
        let file = file.map_err(io_error)?;
        if !file.file_type().map_err(io_error)?.is_file() {
            continue;
        }
        let name = file.file_name();
        let Some(name) = name.to_str().and_then(|s| s.strip_suffix(".md")).filter(|s| name_ok(s)) else {
            continue;
        };
        match std::fs::read_to_string(file.path()).map_err(io_error).and_then(|s| parse(name, &s)) {
            Ok(item) => out.items.push(item),
            Err(reason) => out.broken.push(BrokenInstruction { name: name.to_owned(), reason }),
        }
    }
    out.items.sort_by(|a, b| a.name.cmp(&b.name));
    out.broken.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

// ---------------------------------------------------------------------------
// 관리 블록 — 파일 I/O 를 모르는 순수 조작
// ---------------------------------------------------------------------------

#[derive(Clone, PartialEq, Eq)]
enum Edit {
    Unchanged,
    Write(String),
    Delete,
}

// 결과 글자를 Debug 에 펼치지 않는다.
impl std::fmt::Debug for Edit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unchanged => f.write_str("Unchanged"),
            Self::Write(_) => f.write_str("Write(…)") ,
            Self::Delete => f.write_str("Delete"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BlockError;

impl BlockError {
    fn reason(self) -> String {
        tr!(ko: "관리 블록 표시가 깨졌거나 블록이 둘 이상입니다. 파일을 직접 고친 뒤 다시 반영하세요", en: "The managed block markers are broken or duplicated. Fix the file before applying again")
    }
}

fn marker(line: &str, name: &str, kind: &str) -> bool {
    let prefix = format!("<!-- {name}:{kind}");
    line.trim().strip_prefix(prefix.as_str()).is_some_and(|tail| {
        tail.starts_with("-->") || tail.chars().next().is_some_and(char::is_whitespace)
    })
}

/// 표시 줄의 바이트 구간. 다른 인스턴스의 표시는 이 함수에 보이지 않는다.
fn block_range(text: &str, dev: bool) -> Result<Option<std::ops::Range<usize>>, BlockError> {
    let name = crate::instance::instruction_marker_name(dev);
    let mut begins = Vec::new();
    let mut ends = Vec::new();
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        if marker(line, name, "begin") {
            begins.push(offset);
        }
        if marker(line, name, "end") {
            ends.push((offset, offset + line.len()));
        }
        offset += line.len();
    }
    match (begins.as_slice(), ends.as_slice()) {
        ([], []) => Ok(None),
        ([begin], [(end, after)]) if begin < end => Ok(Some(*begin..*after)),
        _ => Err(BlockError),
    }
}

/// 항목 순서는 이름순이다. 프로젝트와 전역 모두 같은 합성 규칙을 쓴다.
fn compose(items: &[Instruction]) -> Option<String> {
    if items.is_empty() {
        return None;
    }
    let mut items: Vec<&Instruction> = items.iter().collect();
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Some(items.into_iter().map(|item| {
        format!("## {}\n\n{}", item.description.as_deref().unwrap_or(&item.name), item.body.trim())
    }).collect::<Vec<_>>().join("\n\n"))
}

fn normalize_newlines(text: &str, newline: &str) -> String {
    text.replace("\r\n", "\n").replace('\n', newline)
}

fn managed_block(body: &str, dev: bool, newline: &str, terminated: bool) -> String {
    let name = crate::instance::instruction_marker_name(dev);
    // 사용자 파일에 적히는 고정 표식이다 — 표시 언어를 바꿔도 블록이 바뀌지 않는다(conventions).
    format!("<!-- {name}:begin — 이 구간은 Aynx 가 덮어씁니다. 여기 고친 내용은 사라집니다 -->{newline}{}{newline}<!-- {name}:end -->{}",
        normalize_newlines(body.trim(), newline), if terminated { newline } else { "" })
}

/// 추가 때 필요한 빈 줄만 보탠다. prefix 의 공백·개행은 지우지 않는다.
fn append_separator(text: &str, newline: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let mut separator = String::new();
    if !text.ends_with('\n') {
        separator.push_str(newline);
    }
    let last = text.trim_end_matches(['\r', '\n']).rsplit('\n').next().unwrap_or("");
    // 이미 마지막 줄이 비어 있으면 추가 빈 줄은 필요 없다.
    if !text.ends_with(&format!("{newline}{newline}")) && !last.trim().is_empty() {
        separator.push_str(newline);
    }
    separator
}

/// 삭제할 때 바로 앞 빈 줄 한 줄만 걷는다. 그 앞 사람 글의 바이트는 만지지 않는다.
fn without_preceding_blank(text: &str, start: usize) -> usize {
    let prefix = &text[..start];
    let content_end = if prefix.ends_with("\r\n") {
        prefix.len() - 2
    } else if prefix.ends_with('\n') {
        prefix.len() - 1
    } else {
        return start;
    };
    let line_start = prefix[..content_end].rfind('\n').map_or(0, |i| i + 1);
    if prefix[line_start..content_end].trim().is_empty() {
        line_start
    } else {
        start
    }
}

fn apply_block(existing: Option<&str>, body: Option<&str>, dev: bool) -> Result<Edit, BlockError> {
    let text = existing.unwrap_or_default();
    let range = block_range(text, dev)?;
    let newline = line_ending(text);
    let next = match (range, body) {
        (None, None) => return Ok(Edit::Unchanged),
        (None, Some(body)) => format!("{text}{}{}", append_separator(text, newline), managed_block(body, dev, newline, true)),
        (Some(range), Some(body)) => {
            let terminated = text[..range.end].ends_with('\n');
            format!("{}{}{}", &text[..range.start], managed_block(body, dev, newline, terminated), &text[range.end..])
        }
        (Some(range), None) => {
            let start = without_preceding_blank(text, range.start);
            let next = format!("{}{}", &text[..start], &text[range.end..]);
            if next.trim().is_empty() {
                return Ok(Edit::Delete);
            }
            next
        }
    };
    if next == text {
        Ok(Edit::Unchanged)
    } else {
        Ok(Edit::Write(next))
    }
}

// ---------------------------------------------------------------------------
// 파일 자리 — 환경과 목록만 받는 계획. 디스크는 읽기만 한다.
// ---------------------------------------------------------------------------

struct PlanEnv<'a> {
    dev: bool,
    claude_global: Option<PathBuf>,
    codex_global: Option<PathBuf>,
    /// 실제 어댑터가 bare 를 뺀다. 테스트는 임시 폴더 목록을 그대로 준다.
    worktrees: &'a dyn Fn(&Path) -> Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Create,
    Update,
    Delete,
    Unchanged,
    Skipped,
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub scope: Scope,
    pub project_id: Option<String>,
    pub host: Option<String>,
    pub agent: Option<String>,
    pub action: Action,
    pub reason: Option<String>,
    pub block: Option<String>,
    /// 미리 보기 밖에는 나가지 않는다 — 실제 쓰기는 계산한 바이트·경로 그대로다.
    #[serde(skip)]
    edit: Edit,
    #[serde(skip)]
    file_path: PathBuf,
    #[serde(skip)]
    subpath: Option<String>,
    #[serde(skip)]
    owners: Vec<String>,
    #[serde(skip)]
    missing_subfolder: bool,
    #[serde(skip)]
    attempted_write: bool,
}

impl std::fmt::Debug for FileChange {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileChange")
            .field("path", &self.path)
            .field("scope", &self.scope)
            .field("project_id", &self.project_id)
            .field("host", &self.host)
            .field("agent", &self.agent)
            .field("action", &self.action)
            .field("reason", &self.reason)
            .finish()
    }
}

fn change(path: &Path, scope: Scope, project: Option<&str>, agent: Option<&str>, body: Option<&str>) -> FileChange {
    FileChange {
        path: path.to_string_lossy().into_owned(), scope,
        project_id: project.map(str::to_owned), host: None, agent: agent.map(str::to_owned),
        action: Action::Unchanged, reason: None, block: body.map(str::to_owned),
        edit: Edit::Unchanged, file_path: path.to_owned(),
        subpath: None, owners: project.into_iter().map(str::to_owned).collect(),
        missing_subfolder: false, attempted_write: false,
    }
}

fn failed(mut row: FileChange, reason: String) -> FileChange {
    row.action = Action::Error;
    row.reason = Some(reason);
    row.edit = Edit::Unchanged;
    row
}

/// 로컬·원격 모두 파일 글자 스냅숏으로 같은 판정을 한다. I/O·본문 Debug 없음.
fn plan_file_snapshot(mut row: FileChange, existing: Result<Option<String>, String>, body: Option<&str>, dev: bool) -> FileChange {
    row.block = body.map(str::to_owned);
    let existing = match existing {
        Ok(text) => text,
        Err(reason) => return failed(row, reason),
    };
    match apply_block(existing.as_deref(), body, dev) {
        Ok(edit) => {
            row.action = match &edit {
                Edit::Unchanged => Action::Unchanged,
                Edit::Write(_) if existing.is_some() => Action::Update,
                Edit::Write(_) => Action::Create,
                Edit::Delete => Action::Delete,
            };
            row.edit = edit;
            row
        }
        Err(error) => failed(row, error.reason()),
    }
}

fn plan_file(path: &Path, scope: Scope, project: Option<&str>, agent: Option<&str>, body: Option<&str>, dev: bool) -> FileChange {
    plan_file_snapshot(change(path, scope, project, agent, body), read_text(path), body, dev)
}

fn wsl_path(path: &Path) -> bool {
    let path = crate::worktree::strip_verbatim(&path.to_string_lossy()).replace('\\', "/").to_ascii_lowercase();
    ["//wsl$", "//wsl.localhost"].iter().any(|prefix| {
        path == *prefix || path.strip_prefix(*prefix).is_some_and(|tail| tail.starts_with('/'))
    })
}

/// 워크트리 목록과 별도 등록이 같은 폴더를 가리킬 때 합성은 한 번만 한다.
fn worktree_key(path: &Path) -> String {
    let path = path.to_string_lossy().replace('/', "\\");
    let path = crate::worktree::strip_verbatim(&path).replace('\\', "/");
    let path = path.trim_end_matches('/').to_owned();
    if cfg!(windows) { path.to_lowercase() } else { path }
}

fn project_path_reason(path: &Path) -> Option<String> {
    if wsl_path(path) {
        Some(tr!(ko: "WSL 경로는 1단계에서 건너뜁니다", en: "WSL paths are skipped in phase one"))
    } else if path.as_os_str().is_empty() || !path.is_absolute() {
        Some(tr!(ko: "로컬 프로젝트와 워크트리 경로는 비어 있지 않은 절대 경로여야 합니다", en: "Local project and worktree paths must be nonempty absolute paths"))
    } else if !path.is_dir() {
        Some(tr!(ko: "프로젝트 또는 워크트리 폴더가 디렉터리로 존재하지 않아 건너뜁니다", en: "The project or worktree folder is not an existing directory and is skipped"))
    } else {
        None
    }
}

fn skipped(path: &Path, project: &str, reason: String) -> FileChange {
    let mut row = change(path, Scope::Project, Some(project), None, None);
    row.action = Action::Skipped;
    row.reason = Some(reason);
    row
}

/// 두 인스턴스의 유효 블록을 빼고 사람의 가져오기 한 줄을 본다.
/// 현재 표시가 깨졌으면 Error, 다른 인스턴스의 깨진 표시는 해석하거나 고치지 않는다.
fn outside_import(text: &str, dev: bool) -> Result<bool, BlockError> {
    let mut ranges = Vec::new();
    if let Some(range) = block_range(text, dev)? {
        ranges.push(range);
    }
    if let Ok(Some(range)) = block_range(text, !dev) {
        ranges.push(range);
    }
    ranges.sort_by_key(|range| range.start);
    let mut offset = 0;
    let mut outside = String::new();
    for range in ranges {
        if range.start >= offset {
            outside.push_str(&text[offset..range.start]);
        }
        offset = offset.max(range.end);
    }
    outside.push_str(&text[offset..]);
    Ok(outside.lines().any(|line| line.trim() == "@AGENTS.md"))
}

fn claude_project_snapshot(row: FileChange, existing: Result<Option<String>, String>, other_claude: Result<bool, String>, has_body: bool, dev: bool) -> FileChange {
    if !has_body {
        return plan_file_snapshot(row, existing, None, dev);
    }
    let existing = match existing {
        Ok(text) => text,
        Err(reason) => return failed(row, reason),
    };
    let imports = match outside_import(existing.as_deref().unwrap_or_default(), dev) {
        Ok(value) => value,
        Err(error) => return failed(row, error.reason()),
    };
    let any_claude = match other_claude {
        Ok(other) => existing.is_some() || other,
        Err(reason) => return failed(row, reason),
    };
    let body = (any_claude && !imports).then_some("@AGENTS.md");
    plan_file_snapshot(row, Ok(existing), body, dev)
}

/// 로컬·SFTP 어댑터는 존재·본문 스냅숏만 모으고 판정은 이 함수가 한다.
struct ProjectSnapshot {
    directory: Result<bool, String>,
    agents: Result<Option<String>, String>,
    claude: Result<Option<String>, String>,
    other_claude: Result<bool, String>,
}

fn subfolder_missing() -> String {
    tr!(ko: "하위 폴더가 없습니다", en: "The subfolder does not exist")
}

fn project_snapshot(row: FileChange, body: Option<&str>, snapshot: ProjectSnapshot, dev: bool) -> Vec<FileChange> {
    match snapshot.directory {
        Err(reason) => return vec![failed(row, reason)],
        Ok(false) => {
            let mut row = row;
            row.action = Action::Skipped;
            row.missing_subfolder = row.subpath.is_some();
            row.reason = Some(if row.missing_subfolder { subfolder_missing() } else {
                tr!(ko: "프로젝트 또는 워크트리 폴더가 디렉터리로 존재하지 않아 건너뜁니다", en: "The project or worktree folder is not an existing directory and is skipped")
            });
            return vec![row];
        }
        Ok(true) => {}
    }
    let mut agents = row.clone();
    agents.file_path = row.file_path.join("AGENTS.md");
    agents.path = format!("{}/AGENTS.md", row.path.trim_end_matches(['/', '\\']));
    let mut claude = row;
    claude.file_path = claude.file_path.join("CLAUDE.md");
    claude.path = format!("{}/CLAUDE.md", claude.path.trim_end_matches(['/', '\\']));
    claude.agent = Some("claude".into());
    vec![
        plan_file_snapshot(agents, snapshot.agents, body, dev),
        claude_project_snapshot(claude, snapshot.claude, snapshot.other_claude, body.is_some(), dev),
    ]
}

/// 상위 CLAUDE 파일은 워크트리 경계까지만 본다. 루트도 같은 목록을 쓴다.
fn claude_directories(subpath: Option<&str>) -> Vec<String> {
    let mut paths = vec![String::new()];
    if let Some(subpath) = subpath {
        let mut prefix = String::new();
        for part in subpath.split('/') {
            if !prefix.is_empty() { prefix.push('/'); }
            prefix.push_str(part);
            paths.push(prefix.clone());
        }
    }
    paths
}

fn local_snapshot(wt: &Path, subpath: Option<&str>, has_body: bool) -> ProjectSnapshot {
    let path = subpath.map_or_else(|| wt.to_owned(), |subpath| wt.join(subpath));
    let directory = std::fs::metadata(&path).map(|meta| meta.is_dir()).or_else(|e| {
        if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) { Ok(false) } else { Err(e) }
    }).map_err(io_error);
    if !matches!(directory, Ok(true)) {
        return ProjectSnapshot { directory, agents: Ok(None), claude: Ok(None), other_claude: Ok(false) };
    }
    let other_claude = if has_body {
        claude_directories(subpath).iter().try_fold(false, |any, directory| {
            let folder = wt.join(directory);
            ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"].iter()
                .filter(|name| !(folder == path && **name == "CLAUDE.md"))
                .try_fold(any, |any, name| folder.join(name).try_exists().map(|exists| any || exists).map_err(io_error))
        })
    } else { Ok(false) };
    ProjectSnapshot { directory, agents: read_text(&path.join("AGENTS.md")), claude: read_text(&path.join("CLAUDE.md")), other_claude }
}

/// 같은 경로·subpath에 걸린 프로젝트 지침을 이름별로 한 번만 합성한다.
fn projects_subpath_body(library: &[Instruction], projects: &[&Project], subpath: Option<&str>) -> Option<String> {
    let mut items: Vec<Instruction> = library.iter().filter(|item| {
        item.enabled && item.scope == Scope::Project && item.subpath.as_deref() == subpath
            && projects.iter().any(|project| item.projects.contains(&project.id))
    }).cloned().collect();
    items.sort_by(|a, b| a.name.cmp(&b.name));
    items.dedup_by(|a, b| a.name == b.name);
    compose(&items)
}

#[cfg(test)]
fn projects_body(library: &[Instruction], projects: &[&Project]) -> Option<String> {
    projects_subpath_body(library, projects, None)
}

#[cfg(test)]
fn project_body(library: &[Instruction], project: &Project) -> Option<String> {
    projects_body(library, &[project])
}

fn project_subpaths(library: &[Instruction], projects: &[&Project], written: &written::Written) -> BTreeSet<Option<String>> {
    let mut paths = BTreeSet::from([None]);
    for project in projects {
        paths.extend(library.iter().filter(|item| item.scope == Scope::Project && item.projects.contains(&project.id))
            .map(|item| item.subpath.clone()));
        if let Some(previous) = written.get(&project.id) {
            paths.extend(previous.iter().cloned().map(Some));
        }
    }
    paths
}

fn tracked(mut row: FileChange, projects: &[&Project], subpath: Option<&str>) -> FileChange {
    row.owners = projects.iter().map(|project| project.id.clone()).collect();
    row.subpath = subpath.map(str::to_owned);
    row
}

#[cfg(test)]
fn plan(env: &PlanEnv<'_>, library: &[Instruction], projects: &[Project]) -> Vec<FileChange> {
    plan_with_written(env, library, projects, &written::Written::new())
}

fn plan_with_written(env: &PlanEnv<'_>, library: &[Instruction], projects: &[Project], written: &written::Written) -> Vec<FileChange> {
    let mut rows = Vec::new();
    for (agent, path) in [("claude", &env.claude_global), ("codex", &env.codex_global)] {
        if let Some(path) = path {
            if wsl_path(path) {
                let mut row = change(path, Scope::Global, None, Some(agent), None);
                row.action = Action::Skipped;
                row.reason = Some(tr!(ko: "WSL 경로는 1단계에서 건너뜁니다", en: "WSL paths are skipped in phase one"));
                rows.push(row);
                continue;
            }
            let items: Vec<Instruction> = library.iter().filter(|item| {
                item.enabled && item.scope == Scope::Global
                    && item.targets.iter().any(|id| id == "*" || target_id(id) == agent)
            }).cloned().collect();
            let body = compose(&items);
            rows.push(plan_file(path, Scope::Global, None, Some(agent), body.as_deref(), env.dev));
        }
    }
    let mut groups: Vec<(PathBuf, Vec<&Project>)> = Vec::new();
    let mut group_indices = HashMap::new();
    for project in projects {
        let root = Path::new(&project.path);
        if project.host.is_some() {
            rows.push(remote::no_connection(project));
            continue;
        }
        if let Some(reason) = project_path_reason(root) {
            rows.push(skipped(root, &project.id, reason));
            continue;
        }
        let mut seen = HashSet::new();
        for wt in (env.worktrees)(root) {
            let key = worktree_key(&wt);
            if !seen.insert(key.clone()) {
                continue;
            }
            if let Some(reason) = project_path_reason(&wt) {
                rows.push(skipped(&wt, &project.id, reason));
                continue;
            }
            let index = *group_indices.entry(key).or_insert_with(|| {
                groups.push((wt, Vec::new()));
                groups.len() - 1
            });
            groups[index].1.push(project);
        }
    }
    for (wt, projects) in groups {
        let project = projects[0]; // 이 경로를 처음 낸 프로젝트가 표시용 id를 갖는다.
        for subpath in project_subpaths(library, &projects, written) {
            let body = projects_subpath_body(library, &projects, subpath.as_deref());
            let path = subpath.as_deref().map_or_else(|| wt.clone(), |subpath| wt.join(subpath));
            let row = tracked(change(&path, Scope::Project, Some(&project.id), None, None), &projects, subpath.as_deref());
            rows.extend(project_snapshot(row, body.as_deref(), local_snapshot(&wt, subpath.as_deref(), body.is_some()), env.dev));
        }
    }
    rows
}


// ---------------------------------------------------------------------------
// 가져오기 — 원본은 읽기만 하고 라이브러리에 복사할 후보를 만든다.
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    pub source: String,
    pub label: String,
    pub suggested_name: String,
    pub description: Option<String>,
    pub targets: Vec<String>,
    pub scope: Scope,
    pub projects: Vec<String>,
    #[serde(default)]
    pub subpath: Option<String>,
    pub body: String,
    pub skipped: Option<String>,
}

struct ImportSource {
    path: PathBuf,
    label: String,
    name: String,
    targets: Vec<String>,
    rulesync: bool,
}

/// 둘 중 어느 표시라도 깨졌거나 두 인스턴스의 블록이 겹치면 가져오지 않는다.
/// 블록 밖 글자는 여기서 그대로 보존하고, 후보 본문을 만들 때만 줄 끝과 trim 을 정리한다.
fn strip_import_blocks(text: &str) -> Result<String, BlockError> {
    let mut ranges = Vec::new();
    for dev in [false, true] {
        if let Some(range) = block_range(text, dev)? {
            ranges.push(range);
        }
    }
    ranges.sort_by_key(|range| range.start);
    let mut offset = 0;
    let mut outside = String::new();
    for range in ranges {
        if range.start < offset {
            return Err(BlockError);
        }
        outside.push_str(&text[offset..range.start]);
        offset = range.end;
    }
    outside.push_str(&text[offset..]);
    Ok(outside)
}

fn import_slug(text: &str) -> String {
    let mut slug = String::new();
    for c in text.chars() {
        let c = c.to_ascii_lowercase();
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-' {
            slug.push(c);
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() { "imported".into() } else { slug.to_owned() }
}

fn unique_import_name(base: &str, used: &mut HashSet<String>) -> String {
    let base = &base[..base.len().min(48)]; // 슬러그는 ASCII 라 바이트 경계도 글자 경계다.
    if used.insert(base.to_owned()) {
        return base.to_owned();
    }
    for number in 2u64.. {
        let suffix = format!("-{number}");
        let name = format!("{}{suffix}", &base[..base.len().min(48 - suffix.len())]);
        if used.insert(name.clone()) {
            return name;
        }
    }
    unreachable!("지침 이름 접미사 공간")
}

fn import_file(source: ImportSource, project: Option<&Project>, used: &mut HashSet<String>) -> Option<ImportCandidate> {
    let mut candidate = ImportCandidate {
        source: source.path.to_string_lossy().into_owned(), label: source.label,
        suggested_name: String::new(), description: None, targets: source.targets,
        scope: if project.is_some() { Scope::Project } else { Scope::Global },
        projects: project.map(|p| vec![p.id.clone()]).unwrap_or_default(), subpath: None,
        body: String::new(), skipped: None,
    };
    let text = match read_text(&source.path) {
        Ok(Some(text)) => Some(text),
        Ok(None) => return None,
        Err(reason) => { candidate.skipped = Some(reason); None }
    };
    if let Some(text) = text {
        match strip_import_blocks(&text) {
            Ok(outside) => {
                if source.rulesync {
                    // 이름은 파일 이름의 슬러그다. 실패한 머리말도 원문을 잃지 않는다.
                    if let Ok(parsed) = parse_with_scope("imported", &outside, candidate.scope) {
                        candidate.subpath = parsed.subpath;
                        candidate.description = parsed.description;
                        candidate.targets = parsed.targets;
                        candidate.body = parsed.body;
                    } else {
                        candidate.body = outside;
                    }
                } else {
                    candidate.body = outside;
                }
                candidate.body = candidate.body.replace("\r\n", "\n").replace('\r', "\n").trim().to_owned();
                if candidate.body.is_empty() {
                    return None;
                }
            }
            Err(error) => candidate.skipped = Some(error.reason()),
        }
    }
    candidate.suggested_name = unique_import_name(&source.name, used);
    Some(candidate)
}

fn import_sources(env: &PlanEnv<'_>, project: Option<&Project>) -> Result<Vec<ImportSource>, String> {
    let Some(project) = project else {
        return Ok([("claude", &env.claude_global, "CLAUDE.md"), ("codex", &env.codex_global, "AGENTS.md")]
            .into_iter().filter_map(|(agent, path, label)| path.as_ref().map(|path| ImportSource {
                path: path.clone(), label: label.into(), name: format!("{agent}-global"),
                targets: vec![agent.into()], rulesync: false,
            })).collect());
    };
    if project.host.is_some() {
        return Err(tr!(ko: "원격 프로젝트는 아직 지원하지 않습니다", en: "Remote projects are not supported yet"));
    }
    let root = Path::new(&project.path);
    if let Some(reason) = project_path_reason(root) {
        return Err(reason);
    }
    let slug = import_slug(&project.name);
    let mut sources: Vec<ImportSource> = [
        ("AGENTS.md", "agents"), ("CLAUDE.md", "claude"),
        (".claude/CLAUDE.md", "claude-dir"), ("CLAUDE.local.md", "claude-local"),
    ].into_iter().map(|(label, suffix)| ImportSource {
        path: root.join(label), label: label.into(),
        name: format!("{}-{suffix}", &slug[..slug.len().min(48 - suffix.len() - 1)]),
        targets: vec!["*".into()], rulesync: false,
    }).collect();
    let rules = match std::fs::read_dir(root.join(".rulesync/rules")) {
        Ok(files) => files,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(sources),
        Err(e) => return Err(io_error(e)),
    };
    let mut rule_sources = Vec::new();
    for file in rules {
        let file = file.map_err(io_error)?;
        if !file.file_type().map_err(io_error)?.is_file() {
            continue;
        }
        let file_name = file.file_name();
        let Some(name) = file_name.to_str().and_then(|name| name.strip_suffix(".md")) else {
            continue;
        };
        rule_sources.push(ImportSource {
            path: file.path(), label: format!(".rulesync/rules/{}", file_name.to_string_lossy()),
            name: import_slug(name), targets: vec!["*".into()], rulesync: true,
        });
    }
    rule_sources.sort_by(|a, b| a.path.cmp(&b.path));
    sources.extend(rule_sources);
    Ok(sources)
}

fn import_candidates_at(root: &Path, env: &PlanEnv<'_>, project: Option<&Project>) -> Result<Vec<ImportCandidate>, String> {
    let sources = import_sources(env, project)?;
    let library = list_at(root)?;
    let mut used: HashSet<String> = library.items.into_iter().map(|item| item.name)
        .chain(library.broken.into_iter().map(|item| item.name)).collect();
    Ok(sources.into_iter().filter_map(|source| import_file(source, project, &mut used)).collect())
}

/// 새 워크트리 단일 반영은 지정한 프로젝트 하나의 지침만 합성한다.
#[cfg(test)]
fn plan_worktree(env: &PlanEnv<'_>, library: &[Instruction], project: Option<&Project>, path: &Path) -> Vec<FileChange> {
    plan_worktree_with_written(env, library, project, path, &written::Written::new())
}

fn plan_worktree_with_written(env: &PlanEnv<'_>, library: &[Instruction], project: Option<&Project>, path: &Path, written: &written::Written) -> Vec<FileChange> {
    let Some(project) = project.filter(|project| project.host.is_none()) else {
        return Vec::new();
    };
    let worktrees = |_root: &Path| vec![path.to_owned()];
    let env = PlanEnv {
        dev: env.dev, claude_global: env.claude_global.clone(), codex_global: env.codex_global.clone(),
        worktrees: &worktrees,
    };
    let has_items = library.iter().any(|item| item.enabled && item.scope == Scope::Project
        && item.projects.contains(&project.id));
    // 전역 줄은 이 명령에서 반영하지 않는다 — 방금 만든 프로젝트 워크트리 하나만 쓴다.
    let mut rows: Vec<FileChange> = plan_with_written(&env, library, std::slice::from_ref(project), written).into_iter()
        .filter(|row| row.scope == Scope::Project).collect();
    if !has_items {
        // 복사되어 온 기존 블록도 지침 없는 새 워크트리에서는 건드리지 않는다.
        for row in &mut rows {
            if row.subpath.is_none() && matches!(row.action, Action::Create | Action::Update | Action::Delete) {
                row.action = Action::Unchanged;
                row.edit = Edit::Unchanged;
            }
        }
    }
    rows
}

// ---------------------------------------------------------------------------
// 쓰기와 Tauri 명령 — 디스크·목록 실행은 전부 블로킹 풀 안이다.
// ---------------------------------------------------------------------------

/// 창이 여럿이어도 읽기-계산-쓰기 한 벌을 직렬화한다. 느린 일의 잠금도 풀 안에서 잡는다.
// 로컬·원격을 기다리는 동안 다른 반영이 기록의 제거 판정을 낡게 만들지 않도록 전체 작업도 직렬화한다.
static PLAN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static FILE_LOCK: Mutex<()> = Mutex::new(());

fn write_atomic(path: &Path, contents: &str, create_parent: bool) -> Result<(), String> {
    // 같은 바이트면 생략 — 글자로 읽지 않는다(깨진 UTF-8 기록 파일도 덮어써 고칠 수 있게).
    if std::fs::read(path).ok().as_deref() == Some(contents.as_bytes()) {
        return Ok(());
    }
    let parent = path.parent().ok_or_else(|| io_error(std::io::ErrorKind::NotFound.into()))?;
    // 프로젝트 폴더가 계획 뒤 사라져도 쓰기가 되살리지 않는다.
    if create_parent {
        std::fs::create_dir_all(parent).map_err(io_error)?;
    }
    // 링크 자리에 새 파일이 서는 예전 동작 그대로 — 링크를 따라가는 쪽은 `replace_through_link`.
    crate::fs_atomic::write_atomic(path, contents.as_bytes()).map_err(io_error)
}

fn remove_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_error(e)),
    }
}

fn save_at(root: &Path, mut item: Instruction, previous_name: Option<&str>) -> Result<Instruction, String> {
    validate_name(&item.name)?;
    validate_subpath(&mut item)?;
    if let Some(name) = previous_name {
        validate_name(name)?;
    }
    let path = root.join(format!("{}.md", item.name));
    if previous_name != Some(item.name.as_str()) && path.try_exists().map_err(io_error)? {
        return Err(tr!(ko: "이미 있는 지침 이름입니다", en: "This instruction name already exists"));
    }
    let previous_path = previous_name.map(|name| root.join(format!("{name}.md")));
    let previous_text = match &previous_path {
        Some(path) => read_text(path)?,
        None => None,
    };
    // 클라이언트가 extra 를 보낸 적은 없다. 저장소의 기존 파일만 그 원문을 결정한다.
    item.extra = match (previous_name, &previous_text) {
        (Some(name), Some(text)) => parse(name, text)?.extra,
        _ => Vec::new(),
    };
    item.targets = item.targets.into_iter().map(|s| target_id(&s).to_owned()).collect();
    let newline = previous_text.as_deref().map_or("\n", line_ending);
    item.body = normalize_newlines(&item.body, newline);
    let text = serialize(&item, newline);
    // IPC 로 온 글자도 파일과 같은 파서를 거친다 — 쓰고 난 뒤 못 읽는 항목은 만들지 않는다.
    let saved = parse(&item.name, &text)?;
    // 앱 소유 라이브러리 저장은 프로젝트 범위 반영과 별개다.
    std::fs::create_dir_all(root).map_err(io_error)?;
    write_atomic(&path, &text, false)?;
    if let Some(previous) = previous_path.filter(|previous| *previous != path) {
        remove_file(&previous)?;
    }
    Ok(saved)
}

fn delete_at(root: &Path, name: &str) -> Result<(), String> {
    validate_name(name)?;
    remove_file(&root.join(format!("{name}.md")))
}

/// 파일 하나 실패해도 다음 줄을 쓴다. 미리 보기의 Error·Skipped·Unchanged 는 쓰기가 없다.
fn apply_changes(rows: &mut [FileChange]) {
    for row in rows {
        row.attempted_write = matches!(row.edit, Edit::Write(_));
        let result = match &row.edit {
            Edit::Write(text) => write_atomic(&row.file_path, text, row.scope == Scope::Global),
            Edit::Delete => remove_file(&row.file_path),
            Edit::Unchanged => continue,
        };
        if let Err(reason) = result {
            row.action = Action::Error;
            row.reason = Some(reason);
            row.edit = Edit::Unchanged;
        }
    }
}

fn library_root() -> Result<PathBuf, String> {
    crate::instance::config_root().map(|root| root.join("instructions"))
        .ok_or_else(|| tr!(ko: "지침 설정 폴더를 찾을 수 없습니다", en: "Could not locate the instruction settings folder"))
}

/// 목록 어댑터만 git 을 안다. 곁 파일을 넘기지 않아 미리 보기 때 목록 정리 쓰기도 없다.
fn local_worktrees(repo: &Path) -> Vec<PathBuf> {
    match crate::worktree::list_blocking(repo, None) {
        Ok(items) => items.into_iter().filter(|item| !item.bare).map(|item| PathBuf::from(item.path)).collect(),
        Err(_) => vec![repo.to_owned()],
    }
}

#[cfg(test)]
fn plan_at(root: &Path, projects_path: &Path, env: &PlanEnv<'_>) -> Result<Vec<FileChange>, String> {
    let library = list_at(root)?;
    let projects = crate::projects::load_file(projects_path).projects;
    Ok(plan(env, &library.items, &projects))
}

/// 디스크 부분은 블로킹 풀에서 완결하고 std 잠금을 푼 뒤 원격을 기다린다.
async fn current_plan(app: &tauri::AppHandle, apply: bool) -> Result<Vec<FileChange>, String> {
    let _guard = PLAN_LOCK.lock().await;
    let (mut rows, library, projects, written) = blocking(move || {
        let root = library_root()?;
        let projects_path = crate::projects::projects_path()
            .ok_or_else(|| tr!(ko: "프로젝트 설정 폴더를 찾을 수 없습니다", en: "Could not locate the project settings folder"))?;
        let library = list_at(&root)?.items;
        let projects = crate::projects::load_file(&projects_path).projects;
        let local: Vec<Project> = projects.iter().filter(|project| project.host.is_none()).cloned().collect();
        let written = written::load(&written::path()?)?;
        let mut rows = plan_with_written(&current_env(), &library, &local, &written);
        if apply { apply_changes(&mut rows); }
        if apply { written::persist(&rows, false)?; }
        Ok((rows, library, projects, written))
    }).await?;
    for projects in remote::host_groups(&projects) {
        rows.extend(remote::host(app, &library, &projects, &written, apply).await);
    }
    if apply {
        rows = blocking(move || { written::persist(&rows, true)?; Ok(rows) }).await?;
    }
    Ok(rows)
}

fn current_env() -> PlanEnv<'static> {
    PlanEnv {
        dev: crate::instance::DEV,
        claude_global: crate::claude_usage::claude_home().map(|home| home.join("CLAUDE.md")),
        codex_global: crate::codex_mcp::codex_home().map(|home| home.join("AGENTS.md")),
        worktrees: &local_worktrees,
    }
}

#[cfg(test)]
fn apply_worktree_at(root: &Path, projects_path: &Path, env: &PlanEnv<'_>, project_id: &str, path: &Path) -> Result<Vec<FileChange>, String> {
    apply_worktree_recorded_at(root, projects_path, env, project_id, path, &root.with_file_name("instructions-written.json"))
}

fn apply_worktree_recorded_at(root: &Path, projects_path: &Path, env: &PlanEnv<'_>, project_id: &str, path: &Path, written_path: &Path) -> Result<Vec<FileChange>, String> {
    let projects = crate::projects::load_file(projects_path).projects;
    let project = projects.iter().find(|project| project.id == project_id);
    if project.is_none_or(|project| project.host.is_some()) {
        return Ok(Vec::new());
    }
    let library = list_at(root)?;
    let written = written::load(written_path)?;
    let mut rows = plan_worktree_with_written(env, &library.items, project, path, &written);
    apply_changes(&mut rows);
    written::persist_at(written_path, &rows, false)?;
    Ok(rows)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        f()
    }).await.map_err(|e| tr!(ko: "지침 작업이 실패했습니다: {e}", en: "The instruction task failed: {e}"))?
}

/// 없는 라이브러리는 빈 목록이다. 폴더 읽기 실패는 빈 목록인 척하지 않는다.
#[tauri::command]
pub async fn instructions_list() -> Result<InstructionList, String> {
    blocking(|| list_at(&library_root()?)).await
}

#[tauri::command]
pub async fn instruction_save(item: Instruction, previous_name: Option<String>) -> Result<Instruction, String> {
    blocking(move || save_at(&library_root()?, item, previous_name.as_deref())).await
}

#[tauri::command]
pub async fn instruction_delete(name: String) -> Result<(), String> {
    blocking(move || delete_at(&library_root()?, &name)).await
}

#[tauri::command]
pub async fn instructions_preview(app: tauri::AppHandle) -> Result<Vec<FileChange>, String> {
    current_plan(&app, false).await
}

#[tauri::command]
pub async fn instructions_apply(app: tauri::AppHandle) -> Result<Vec<FileChange>, String> {
    // 클라이언트의 지난 미리 보기를 받지 않는다 — 로컬·원격을 모두 다시 읽는다.
    current_plan(&app, true).await
}

#[tauri::command]
pub async fn instructions_import_candidates(project_id: Option<String>) -> Result<Vec<ImportCandidate>, String> {
    blocking(move || {
        let project = match project_id {
            Some(id) => {
                let path = crate::projects::projects_path()
                    .ok_or_else(|| tr!(ko: "프로젝트 설정 폴더를 찾을 수 없습니다", en: "Could not locate the project settings folder"))?;
                Some(crate::projects::load_file(&path).projects.into_iter().find(|project| project.id == id)
                    .ok_or_else(|| tr!(ko: "프로젝트를 찾을 수 없습니다", en: "Could not find the project"))?)
            }
            None => None,
        };
        import_candidates_at(&library_root()?, &current_env(), project.as_ref())
    }).await
}

#[tauri::command]
pub async fn instructions_apply_worktree(project_id: String, path: String) -> Result<Vec<FileChange>, String> {
    let _guard = PLAN_LOCK.lock().await;
    blocking(move || {
        let projects_path = crate::projects::projects_path()
            .ok_or_else(|| tr!(ko: "프로젝트 설정 폴더를 찾을 수 없습니다", en: "Could not locate the project settings folder"))?;
        apply_worktree_recorded_at(&library_root()?, &projects_path, &current_env(), &project_id, Path::new(&path), &written::path()?)
    }).await
}

mod written;
pub(crate) mod remote;

#[cfg(test)]
mod tests;

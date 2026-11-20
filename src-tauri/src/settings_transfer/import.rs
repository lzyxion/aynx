//! **가져오기 판정 하나** — 묶음 ↔ 지금 설정을 비교해 미리 보기 줄(`PreviewCategory`)과 쓸 파일(`Write`)을 **한 함수**
//! ([`plan`])로 만든다. 미리 보기는 선택 없이([`ImportChoices::none`]) 불러 줄만 쓰고, 적용은 사람이 고른 선택으로 같은 함수를
//! 다시 불러 파일을 쓴다 — 둘이 다른 판정을 할 자리가 없다.
//!
//! 줄의 상태는 셋 — `new`(이 PC 에 없음) · `changed`(있는데 값이 다름) · `same`. 선택은 범주마다:
//! - 고름/안 고름(`categories`) — 안 고른 범주는 쓰지 않는다.
//! - 다른 값(`conflict`) — `overwrite`(덮기 · 기본) · `skip`(건너뛰기) · `both`(둘 다 — 이름 있는 목록만, 새 id 로 하나 더).
//! - AI 권한(`aiMode`) — `asIs`(파일 값 그대로 · 기본) · `off`(위임 블록을 들이지 않음 · `[automation] auto_approve = false`).
//!   위임 블록의 신원 스냅샷은 그대로 옮긴다(맞지 않으면 기존 규칙대로 끔으로 읽힌다). 옛 묶음의 외부 MCP 칸 `side_chat_no_ask`(2026-11-20
//!   걷은 사이드 채팅 '묻지 않기')는 어느 쪽이든 들이지 않는다.
//! - 프로젝트 폴더 고르기(`remap` — 프로젝트 id → 이 PC 의 폴더).
//!
//! `~/.ssh/config` 는 **새 별칭의 블록만 덧붙인다**(같은 이름이 있으면 그 블록은 그대로 — `hosts` 의 다른 값은 `sessions.toml` 의
//! 앱 설정뿐이다).

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use toml_edit::{ArrayOfTables, DocumentMut, Item, Table};

use super::catalog::{self, AI_MCP_KEY};
use super::export::{parse_toml, read_opt, read_text_opt};
use super::{Bundle, Roots};
use crate::i18n::tr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Conflict {
    #[default]
    Overwrite,
    Skip,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
pub(crate) enum AiMode {
    #[default]
    #[serde(rename = "asIs")]
    AsIs,
    #[serde(rename = "off")]
    Off,
}

/// 사람이 미리 보기에서 고른 것.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportChoices {
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub conflict: BTreeMap<String, Conflict>,
    #[serde(default)]
    pub ai_mode: AiMode,
    #[serde(default)]
    pub remap: BTreeMap<String, String>,
}

impl ImportChoices {
    /// 아무 범주도 고르지 않음 — 미리 보기(쓰기 없음).
    pub(crate) fn none() -> Self {
        Self::default()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewItem {
    pub key: String,
    pub label: String,
    /// `new` · `changed` · `same`
    pub status: &'static str,
    /// AI 권한 블록인가 — [Off 로 들이기]면 들이지 않는다(개수에서도 빠진다).
    pub ai_grant: bool,
    /// 덧붙임 표시 — `command`(ssh 블록에 ProxyCommand 같은 명령 줄이 있음).
    pub note: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingFolder {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCategory {
    pub id: &'static str,
    pub items: Vec<PreviewItem>,
    /// 다른 값일 때 고를 수 있는 것(`overwrite` · `skip` · `both`).
    pub choices: Vec<&'static str>,
    pub missing_folders: Vec<MissingFolder>,
}

/// 쓸 파일 한 장(전체 교체).
#[derive(Debug, Clone)]
pub(crate) struct Write {
    pub path: PathBuf,
    pub bytes: Vec<u8>,
    /// 묶음 경로 꼴 이름(무엇을 다시 읽을지 — `ImportDone::touched`).
    pub label: String,
    /// 파일 옆 OS 잠금을 잡고 쓴다(테마 프로필 · 아티스트 — 같은 잠금을 쓰는 저장 경로가 있다).
    pub locked: bool,
}

pub(crate) struct Plan {
    pub categories: Vec<PreviewCategory>,
    pub writes: Vec<Write>,
    /// 실제로 바꾸는 줄 수.
    pub changed: usize,
}

const BOTH: &[&str] = &["overwrite", "skip", "both"];
const TWO: &[&str] = &["overwrite", "skip"];

struct Ctx<'a> {
    roots: &'a Roots,
    choices: &'a ImportChoices,
    cats: Vec<PreviewCategory>,
    writes: Vec<Write>,
    changed: usize,
}

impl Ctx<'_> {
    fn cat(&mut self, id: &'static str, choices: &'static [&'static str]) -> &mut PreviewCategory {
        if let Some(i) = self.cats.iter().position(|c| c.id == id) {
            return &mut self.cats[i];
        }
        self.cats.push(PreviewCategory { id, items: Vec::new(), choices: choices.to_vec(), missing_folders: Vec::new() });
        self.cats.last_mut().expect("방금 넣었다")
    }

    fn selected(&self, id: &str) -> bool {
        self.choices.categories.iter().any(|c| c == id)
    }

    fn conflict(&self, id: &str) -> Conflict {
        self.choices.conflict.get(id).copied().unwrap_or_default()
    }

    fn ai_off(&self) -> bool {
        self.choices.ai_mode == AiMode::Off
    }

    /// 줄 하나를 적고, 이 줄을 실제로 쓸지 돌려준다(쓰면 개수에 더한다).
    fn item(&mut self, cat: &'static str, choices: &'static [&'static str], item: PreviewItem) -> bool {
        let write = self.selected(cat)
            && !(item.ai_grant && self.ai_off())
            && match item.status {
                "new" => true,
                "changed" => self.conflict(cat) != Conflict::Skip,
                _ => false,
            };
        if write {
            self.changed += 1;
        }
        self.cat(cat, choices).items.push(item);
        write
    }

    fn write(&mut self, path: PathBuf, bytes: Vec<u8>, label: &str, locked: bool) {
        self.writes.push(Write { path, bytes, label: label.to_string(), locked });
    }
}

fn status(cur: Option<bool>) -> &'static str {
    match cur {
        None => "new",
        Some(true) => "same",
        Some(false) => "changed",
    }
}

fn item(key: String, label: String, status: &'static str) -> PreviewItem {
    PreviewItem { key, label, status, ai_grant: false, note: None }
}

fn utf8<'b>(bundle: &'b Bundle, path: &str) -> Result<Option<&'b str>, String> {
    match bundle.files.get(path) {
        None => Ok(None),
        Some(b) => std::str::from_utf8(b)
            .map(Some)
            .map_err(|_| tr!(ko: "묶음 안의 {path} 가 글자 파일이 아닙니다", en: "{path} in the bundle is not a text file")),
    }
}

fn toml_of(bundle: &Bundle, path: &str) -> Result<Option<DocumentMut>, String> {
    let Some(text) = utf8(bundle, path)? else { return Ok(None) };
    text.parse::<DocumentMut>()
        .map(Some)
        .map_err(|e| tr!(ko: "묶음 안의 {path} 를 읽지 못했습니다: {e}", en: "Could not read {path} in the bundle: {e}"))
}

fn json_of(bundle: &Bundle, path: &str) -> Result<Option<Json>, String> {
    let Some(text) = utf8(bundle, path)? else { return Ok(None) };
    serde_json::from_str(text)
        .map(Some)
        .map_err(|e| tr!(ko: "묶음 안의 {path} 를 읽지 못했습니다: {e}", en: "Could not read {path} in the bundle: {e}"))
}

/// toml 항목을 비교할 수 있는 값으로(주석 · 순서 · 꼴 무시).
fn canon(item: &Item) -> Option<toml::Value> {
    let mut doc = DocumentMut::new();
    doc.insert("x", item.clone());
    toml::from_str::<toml::Table>(&doc.to_string()).ok()?.remove("x")
}

fn canon_table(t: &Table) -> Option<toml::Value> {
    canon(&Item::Table(t.clone()))
}

fn short_hex() -> String {
    let mut b = [0u8; 3];
    let _ = getrandom::fill(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// 겹치지 않는 새 id(`<id>-<6hex>`).
fn fresh_id(base: &str, taken: &dyn Fn(&str) -> bool) -> String {
    loop {
        let id = format!("{base}-{}", short_hex());
        if !taken(&id) {
            return id;
        }
    }
}

pub(crate) fn plan(roots: &Roots, bundle: &Bundle, choices: &ImportChoices) -> Result<Plan, String> {
    let mut ctx = Ctx { roots, choices, cats: Vec::new(), writes: Vec::new(), changed: 0 };
    plan_hosts(&mut ctx, bundle)?;
    plan_delegation(&mut ctx, bundle)?;
    plan_settings(&mut ctx, bundle)?;
    plan_json_list(&mut ctx, bundle, "config/db-connections.json", "db", None, "name", BOTH)?;
    plan_db_folders(&mut ctx, bundle)?;
    plan_projects(&mut ctx, bundle)?;
    plan_json_list(&mut ctx, bundle, "config/tab-templates.json", "templates", Some("templates"), "name", BOTH)?;
    plan_json_list(&mut ctx, bundle, "config/snippets.json", "keys", Some("snippets"), "name", BOTH)?;
    plan_profiles(&mut ctx, bundle)?;
    plan_files(&mut ctx, bundle)?;
    plan_artists(&mut ctx, bundle)?;
    let order = |id: &str| catalog::CATEGORIES.iter().position(|c| *c == id).unwrap_or(usize::MAX);
    ctx.cats.sort_by_key(|c| order(c.id));
    Ok(Plan { categories: ctx.cats, writes: ctx.writes, changed: ctx.changed })
}

// ---------------------------------------------------------------------------
// 호스트 — `~/.ssh/config` 는 새 블록만 덧붙이고, 앱 설정(`sessions.toml`)은 덮기 · 건너뛰기
// ---------------------------------------------------------------------------

fn has_command_line(block: &str) -> bool {
    block.lines().any(|l| {
        let w = l.trim_start().split(|c: char| c.is_whitespace() || c == '=').next().unwrap_or("");
        ["proxycommand", "localcommand", "remotecommand", "knownhostscommand", "permitlocalcommand"]
            .iter()
            .any(|k| w.eq_ignore_ascii_case(k))
    })
}

fn find_key<'t>(table: &'t dyn toml_edit::TableLike, name: &str) -> Option<&'t str> {
    table.iter().map(|(k, _)| k).find(|k| k.eq_ignore_ascii_case(name))
}

fn plan_hosts(ctx: &mut Ctx<'_>, bundle: &Bundle) -> Result<(), String> {
    const CAT: &str = "hosts";
    let Some(text) = utf8(bundle, catalog::SSH_HOSTS)? else { return Ok(()) };
    let incoming = crate::config_edit::concrete_host_blocks(text);
    let config_path = ctx.roots.ssh.join("config");
    let current_config = read_text_opt(&config_path)?.unwrap_or_default();
    let current_hosts = crate::ssh_config::parse(&current_config).hosts;
    let exists = |n: &str| current_hosts.iter().any(|h| h.name.eq_ignore_ascii_case(n));

    let meta_path = ctx.roots.ssh.join("sessions.toml");
    let meta_text = read_text_opt(&meta_path)?;
    let mut meta_doc = meta_text.as_deref().map_or_else(|| Some(DocumentMut::new()), parse_toml).ok_or_else(|| {
        tr!(ko: "~/.ssh/sessions.toml 을 읽지 못했습니다 — 파일을 직접 확인해 주세요", en: "Could not read ~/.ssh/sessions.toml — please check the file")
    })?;
    let inc_meta = toml_of(bundle, catalog::SSH_META)?.unwrap_or_default();
    let inc_hosts = inc_meta.get("hosts").and_then(Item::as_table_like);

    let mut append: Vec<String> = Vec::new();
    let mut meta_changed = false;
    let mut seen: Vec<String> = Vec::new();
    for block in &incoming {
        let label = block.names.join(" ");
        if block.names.iter().any(|n| seen.iter().any(|s| s.eq_ignore_ascii_case(n))) {
            continue; // 묶음 안에서 같은 이름이 또 나옴 — 첫 블록만
        }
        seen.extend(block.names.iter().cloned());
        let is_new = !block.names.iter().any(|n| exists(n));
        // 앱 설정(`[hosts.<별칭>]`) — 이름마다.
        let metas: Vec<(String, Item)> = block
            .names
            .iter()
            .filter_map(|n| inc_hosts.and_then(|t| find_key(t, n).and_then(|k| t.get(k)).map(|v| (n.clone(), v.clone()))))
            .collect();
        let cur_hosts = meta_doc.get("hosts").and_then(Item::as_table_like);
        let meta_same = metas.iter().all(|(n, v)| {
            cur_hosts.and_then(|t| find_key(t, n).and_then(|k| t.get(k))).is_some_and(|c| canon(c) == canon(v))
        });
        let st = if is_new { "new" } else if meta_same { "same" } else { "changed" };
        let mut it = item(format!("host:{label}"), label, st);
        // 명령 줄 경고는 **새로 덧붙일 블록**에만 — 이미 있는 블록은 `~/.ssh/config` 에 쓰지 않는다(2026-11-17 사용자 — 같음 줄에 경고가 떴다).
        if is_new && has_command_line(&block.text) {
            it.note = Some("command");
        }
        if !ctx.item(CAT, TWO, it) {
            continue;
        }
        if is_new {
            append.push(block.text.clone());
        }
        for (n, v) in metas {
            let hosts = meta_doc
                .entry("hosts")
                .or_insert_with(|| {
                    let mut t = Table::new();
                    t.set_implicit(true);
                    Item::Table(t)
                })
                .as_table_like_mut()
                .ok_or_else(|| tr!(ko: "sessions.toml 의 hosts 가 표가 아닙니다", en: "hosts in sessions.toml is not a table"))?;
            let key = find_key(&*hosts, &n).map(str::to_string).unwrap_or(n);
            hosts.insert(&key, v);
            meta_changed = true;
        }
    }

    // 그룹 아이콘 · 색(`[groups."<경로>"]`).
    if let Some(groups) = inc_meta.get("groups").and_then(Item::as_table_like) {
        for (path, v) in groups.iter() {
            let cur = meta_doc.get("groups").and_then(Item::as_table_like).and_then(|t| t.get(path)).map(|c| canon(c) == canon(v));
            if ctx.item(CAT, TWO, item(format!("group:{path}"), path.to_string(), status(cur))) {
                let groups = meta_doc
                    .entry("groups")
                    .or_insert_with(|| {
                        let mut t = Table::new();
                        t.set_implicit(true);
                        Item::Table(t)
                    })
                    .as_table_like_mut()
                    .ok_or_else(|| tr!(ko: "sessions.toml 의 groups 가 표가 아닙니다", en: "groups in sessions.toml is not a table"))?;
                groups.insert(path, v.clone());
                meta_changed = true;
            }
        }
    }

    if !append.is_empty() {
        let refs: Vec<&str> = append.iter().map(String::as_str).collect();
        let added = crate::config_edit::append_blocks_text(&current_config, &refs);
        // 이미 있는 바이트는 한 글자도 바꾸지 않는다 — 뒤에 붙이기만.
        ctx.write(config_path, format!("{current_config}{added}").into_bytes(), catalog::SSH_HOSTS, false);
    }
    if meta_changed {
        let rendered = crate::sessions_meta::match_line_endings(meta_text.as_deref().unwrap_or(""), meta_doc.to_string());
        ctx.write(meta_path, rendered.into_bytes(), catalog::SSH_META, false);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// AI 권한 — `delegation.toml` 의 `[[target]]`(별칭) · `[[database]]`(id)
// ---------------------------------------------------------------------------

/// 배열 표(`[[x]]`)를 열쇠로 맞춰 합친다 — 바뀐 것이 있으면 `true`.
#[allow(clippy::too_many_arguments)]
fn merge_aot(
    ctx: &mut Ctx<'_>,
    cat: &'static str,
    choices: &'static [&'static str],
    cur: &mut DocumentMut,
    inc: &DocumentMut,
    key: &str,
    id_field: &str,
    prefix: &str,
    ai_grant: bool,
    label_field: Option<&str>,
    fix: &dyn Fn(&mut Table),
) -> Result<bool, String> {
    let Some(inc_arr) = inc.get(key).and_then(Item::as_array_of_tables) else { return Ok(false) };
    let mut changed = false;
    for t in inc_arr.iter() {
        let Some(id) = t.get(id_field).and_then(Item::as_str).map(str::to_string) else { continue };
        let label = label_field.and_then(|f| t.get(f)).and_then(Item::as_str).unwrap_or(&id).to_string();
        let same_id = |a: &str| if ai_grant && id_field == "alias" { a.eq_ignore_ascii_case(&id) } else { a == id };
        let pos = cur.get(key).and_then(Item::as_array_of_tables).and_then(|arr| {
            arr.iter().position(|c| c.get(id_field).and_then(Item::as_str).is_some_and(same_id))
        });
        let cur_same = pos.map(|i| {
            let arr = cur.get(key).and_then(Item::as_array_of_tables).expect("위에서 찾았다");
            canon_table(arr.get(i).expect("위치")) == canon_table(t)
        });
        let mut it = item(format!("{prefix}:{id}"), label, status(cur_same));
        it.ai_grant = ai_grant;
        if !ctx.item(cat, choices, it) {
            continue;
        }
        let mut table = t.clone();
        table.decor_mut().clear();
        fix(&mut table);
        let arr = cur
            .entry(key)
            .or_insert_with(|| Item::ArrayOfTables(ArrayOfTables::new()))
            .as_array_of_tables_mut()
            .ok_or_else(|| tr!(ko: "{key} 가 [[{key}]] 블록 배열이 아닙니다", en: "{key} is not an array of [[{key}]] blocks"))?;
        match pos {
            Some(_) if ctx.conflict(cat) == Conflict::Both => {
                let taken = |x: &str| arr.iter().any(|c| c.get(id_field).and_then(Item::as_str) == Some(x));
                let new_id = fresh_id(&id, &taken);
                table.insert(id_field, toml_edit::value(new_id));
                arr.push(table);
            }
            Some(i) => *arr.get_mut(i).expect("위치") = table,
            None => arr.push(table),
        }
        changed = true;
    }
    Ok(changed)
}

fn plan_delegation(ctx: &mut Ctx<'_>, bundle: &Bundle) -> Result<(), String> {
    let Some(inc) = toml_of(bundle, catalog::DELEGATION)? else { return Ok(()) };
    let path = ctx.roots.home.join("delegation.toml");
    let before = read_text_opt(&path)?;
    let mut cur = before.as_deref().map_or_else(|| Some(DocumentMut::new()), parse_toml).ok_or_else(|| {
        tr!(ko: "delegation.toml 을 읽지 못했습니다 — 파일을 직접 확인해 주세요", en: "Could not read delegation.toml — please check the file")
    })?;
    let a = merge_aot(ctx, "ai", TWO, &mut cur, &inc, "target", "alias", "target", true, None, &|_| {})?;
    let b = merge_aot(ctx, "ai", TWO, &mut cur, &inc, "database", "id", "database", true, None, &|_| {})?;
    if a || b {
        let rendered = crate::sessions_meta::match_line_endings(before.as_deref().unwrap_or(""), cur.to_string());
        ctx.write(path, rendered.into_bytes(), catalog::DELEGATION, false);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// settings.toml — 칸 단위(덮기 · 건너뛰기) · `[ai]` 의 외부 MCP 서버는 이름 단위
// ---------------------------------------------------------------------------

fn plan_settings(ctx: &mut Ctx<'_>, bundle: &Bundle) -> Result<(), String> {
    let Some(inc) = toml_of(bundle, catalog::SETTINGS)? else { return Ok(()) };
    let path = ctx.roots.config.join("settings.toml");
    let before = read_text_opt(&path)?;
    let mut cur = before.as_deref().map_or_else(|| Some(DocumentMut::new()), parse_toml).ok_or_else(|| {
        tr!(ko: "settings.toml 을 읽지 못했습니다 — 파일을 직접 확인해 주세요", en: "Could not read settings.toml — please check the file")
    })?;
    let mut changed = false;
    let ai_off = ctx.ai_off();

    for (key, inc_item) in inc.iter() {
        let Some(cat) = catalog::section_category(key) else { continue };
        if key == "ai" {
            // general 이 갖는 `[ai]` 의 나머지 칸 — mcp_servers 를 빼고 비교한다.
            let strip = |item: Option<&Item>| -> Option<Table> {
                let mut t = item?.as_table()?.clone();
                t.remove(AI_MCP_KEY);
                (!t.is_empty()).then_some(t)
            };
            if let Some(inc_rest) = strip(Some(inc_item)) {
                let cur_rest = strip(cur.get("ai"));
                let st = status(cur_rest.as_ref().map(|c| canon_table(c) == canon_table(&inc_rest)));
                if ctx.item(cat, TWO, item("settings:ai".into(), "[ai]".into(), st)) {
                    let mcp = cur.get("ai").and_then(Item::as_table).and_then(|t| t.get(AI_MCP_KEY)).cloned();
                    let mut table = inc_rest.clone();
                    if let Some(m) = mcp {
                        table.insert(AI_MCP_KEY, m);
                    }
                    cur.insert("ai", Item::Table(table));
                    changed = true;
                }
            }
            // 외부 MCP 서버 — 이름 단위.
            if let Some(servers) = inc_item.as_table().and_then(|t| t.get(AI_MCP_KEY)).and_then(Item::as_array_of_tables) {
                let mut ai_doc = DocumentMut::new();
                if let Some(m) = cur.get("ai").and_then(Item::as_table).and_then(|t| t.get(AI_MCP_KEY)) {
                    ai_doc.insert(AI_MCP_KEY, m.clone());
                }
                let mut inc_doc = DocumentMut::new();
                inc_doc.insert(AI_MCP_KEY, Item::ArrayOfTables(servers.clone()));
                // 옛 묶음의 `side_chat_no_ask`(사이드 채팅에서 묻지 않기 — 2026-11-20 걷은 칸 · 묻지 않기는 채팅의 모드가 정한다)는 늘 뺀다.
                let fix = |t: &mut Table| {
                    t.remove("side_chat_no_ask");
                };
                if merge_aot(ctx, "mcp", TWO, &mut ai_doc, &inc_doc, AI_MCP_KEY, "name", "mcp", false, None, &fix)? {
                    let ai = cur
                        .entry("ai")
                        .or_insert_with(|| Item::Table(Table::new()))
                        .as_table_mut()
                        .ok_or_else(|| tr!(ko: "settings.toml 의 [ai] 가 표가 아닙니다", en: "[ai] in settings.toml is not a table"))?;
                    if let Some(m) = ai_doc.remove(AI_MCP_KEY) {
                        ai.insert(AI_MCP_KEY, m);
                    }
                    changed = true;
                }
            }
            continue;
        }
        let cur_same = cur.get(key).map(|c| canon(c) == canon(inc_item));
        let label = if inc_item.is_array_of_tables() { format!("[[{key}]]") } else { format!("[{key}]") };
        if ctx.item(cat, TWO, item(format!("settings:{key}"), label, status(cur_same))) {
            let mut v = inc_item.clone();
            if key == "automation" && ai_off {
                if let Some(t) = v.as_table_mut() {
                    t.insert("auto_approve", toml_edit::value(false));
                }
            }
            cur.insert(key, v);
            changed = true;
        }
    }
    if changed {
        let rendered = crate::sessions_meta::match_line_endings(before.as_deref().unwrap_or(""), cur.to_string());
        ctx.write(path, rendered.into_bytes(), catalog::SETTINGS, false);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// JSON 목록 — id 단위(덮기 · 건너뛰기 · 둘 다)
// ---------------------------------------------------------------------------

/// `field` 가 있으면 `{field: [...]}` 안의 목록, 없으면 문서가 곧 배열.
fn list_mut<'j>(doc: &'j mut Json, field: Option<&str>) -> Option<&'j mut Vec<Json>> {
    match field {
        Some(f) => doc.as_object_mut()?.entry(f).or_insert_with(|| Json::Array(Vec::new())).as_array_mut(),
        None => doc.as_array_mut(),
    }
}

fn list_ref<'j>(doc: &'j Json, field: Option<&str>) -> Option<&'j Vec<Json>> {
    match field {
        Some(f) => doc.get(f)?.as_array(),
        None => doc.as_array(),
    }
}

/// 합친 문서 — 바뀐 것이 없으면 `None`. `on_write` 는 실제로 들이는 항목마다 부른다(프로젝트 폴더 고르기).
#[allow(clippy::too_many_arguments)]
fn merge_json_list(
    ctx: &mut Ctx<'_>,
    cat: &'static str,
    choices: &'static [&'static str],
    cur: Option<Json>,
    inc: &Json,
    field: Option<&str>,
    label_field: &str,
    prefix: &str,
    on_write: &mut dyn FnMut(&mut Json, &mut Vec<MissingFolder>),
) -> Result<Option<Json>, String> {
    let Some(inc_list) = list_ref(inc, field) else { return Ok(None) };
    let fresh = cur.is_none();
    let mut doc = cur.unwrap_or_else(|| match field {
        Some(_) => {
            // 새 파일 — 받은 문서의 다른 칸(판 등)은 그대로, 목록만 비워 시작한다.
            let mut d = inc.clone();
            if let Some(obj) = d.as_object_mut() {
                obj.remove("active");
            }
            d
        }
        None => Json::Array(Vec::new()),
    });
    if fresh {
        if let Some(l) = list_mut(&mut doc, field) {
            l.clear();
        }
    }
    let mut changed = false;
    let mut missing = Vec::new();
    for inc_item in inc_list {
        let Some(id) = inc_item.get("id").and_then(Json::as_str).map(str::to_string) else { continue };
        let label = inc_item.get(label_field).and_then(Json::as_str).unwrap_or(&id).to_string();
        let list = list_mut(&mut doc, field)
            .ok_or_else(|| tr!(ko: "목록 파일의 모양이 올바르지 않습니다", en: "The list file has an unexpected shape"))?;
        let pos = list.iter().position(|c| c.get("id").and_then(Json::as_str) == Some(id.as_str()));
        let st = status(pos.map(|i| list[i] == *inc_item));
        if !ctx.item(cat, choices, item(format!("{prefix}:{id}"), label, st)) {
            continue;
        }
        let mut v = inc_item.clone();
        on_write(&mut v, &mut missing);
        let list = list_mut(&mut doc, field).expect("위에서 봤다");
        match pos {
            Some(_) if ctx.conflict(cat) == Conflict::Both => {
                let taken = |x: &str| list.iter().any(|c| c.get("id").and_then(Json::as_str) == Some(x));
                let new_id = fresh_id(&id, &taken);
                if let Some(o) = v.as_object_mut() {
                    o.insert("id".into(), Json::String(new_id));
                }
                list.push(v);
            }
            Some(i) => list[i] = v,
            None => list.push(v),
        }
        changed = true;
    }
    ctx.cat(cat, choices).missing_folders.extend(missing);
    Ok(changed.then_some(doc))
}

fn current_json(ctx: &Ctx<'_>, name: &str) -> Result<Option<Json>, String> {
    let path = ctx.roots.config.join(name);
    match read_opt(&path)? {
        None => Ok(None),
        Some(b) => serde_json::from_slice(&b).map(Some).map_err(|e| {
            tr!(ko: "{name} 을 읽지 못했습니다 — 파일을 직접 확인해 주세요: {e}", en: "Could not read {name} — please check the file: {e}")
        }),
    }
}

fn pretty(v: &Json) -> Vec<u8> {
    let mut s = serde_json::to_string_pretty(v).unwrap_or_default();
    s.push('\n');
    s.into_bytes()
}

fn plan_json_list(
    ctx: &mut Ctx<'_>,
    bundle: &Bundle,
    path: &str,
    cat: &'static str,
    field: Option<&str>,
    label_field: &str,
    choices: &'static [&'static str],
) -> Result<(), String> {
    let Some(inc) = json_of(bundle, path)? else { return Ok(()) };
    let name = path.strip_prefix("config/").expect("config 경로");
    let cur = current_json(ctx, name)?;
    let prefix = name.trim_end_matches(".json");
    if let Some(doc) = merge_json_list(ctx, cat, choices, cur, &inc, field, label_field, prefix, &mut |_, _| {})? {
        if path == "config/db-connections.json" {
            // 받은 것을 믿지 않는다 — 연결 꼴(엔진 · TLS 모드 · 비밀번호 칸 없음)을 지나야 쓴다.
            serde_json::from_value::<Vec<crate::db::conns::DbConn>>(doc.clone())
                .map_err(|e| tr!(ko: "DB 연결 목록의 모양이 올바르지 않습니다: {e}", en: "The database connection list has an unexpected shape: {e}"))?;
        }
        ctx.write(ctx.roots.config.join(name), pretty(&doc), path, false);
    }
    Ok(())
}

fn plan_db_folders(ctx: &mut Ctx<'_>, bundle: &Bundle) -> Result<(), String> {
    const CAT: &str = "db";
    let Some(Json::Object(inc)) = json_of(bundle, "config/db-folders.json")? else { return Ok(()) };
    let mut cur = match current_json(ctx, "db-folders.json")? {
        Some(Json::Object(m)) => m,
        _ => serde_json::Map::new(),
    };
    let mut changed = false;
    for (path, v) in &inc {
        let st = status(cur.get(path).map(|c| c == v));
        if ctx.item(CAT, TWO, item(format!("folder:{path}"), path.clone(), st)) {
            cur.insert(path.clone(), v.clone());
            changed = true;
        }
    }
    if changed {
        ctx.write(ctx.roots.config.join("db-folders.json"), pretty(&Json::Object(cur)), "config/db-folders.json", false);
    }
    Ok(())
}

fn plan_projects(ctx: &mut Ctx<'_>, bundle: &Bundle) -> Result<(), String> {
    let Some(inc) = json_of(bundle, "config/projects.json")? else { return Ok(()) };
    let cur = current_json(ctx, "projects.json")?;
    let remap = ctx.choices.remap.clone();
    let mut fix = |v: &mut Json, missing: &mut Vec<MissingFolder>| {
        let id = v.get("id").and_then(Json::as_str).unwrap_or("").to_string();
        if let Some(path) = remap.get(&id) {
            if let Some(o) = v.as_object_mut() {
                o.insert("path".into(), Json::String(path.clone()));
            }
        }
        let local = v.get("host").is_none_or(Json::is_null);
        let path = v.get("path").and_then(Json::as_str).unwrap_or("");
        if local && !path.is_empty() && !std::path::Path::new(path).is_dir() {
            missing.push(MissingFolder {
                id,
                name: v.get("name").and_then(Json::as_str).unwrap_or("").to_string(),
                path: path.to_string(),
            });
        }
    };
    // 미리 보기에서도 폴더를 보이게 — 고르지 않은 범주에서도 같은 판정을 한 번 돌린다.
    if !ctx.selected("projects") {
        if let Some(list) = list_ref(&inc, Some("projects")) {
            let cur_list = cur.as_ref().and_then(|c| list_ref(c, Some("projects")));
            let mut missing = Vec::new();
            for p in list {
                // 이 PC 에 똑같이 있는 프로젝트는 들어오는 것이 없다 — 폴더 안내도 없다(2026-11-17 사용자 — 같음 줄에 경고가 떴다).
                if cur_list.is_some_and(|l| l.contains(p)) {
                    continue;
                }
                let mut v = p.clone();
                fix(&mut v, &mut missing);
            }
            ctx.cat("projects", BOTH).missing_folders.extend(missing);
        }
    }
    if let Some(doc) = merge_json_list(ctx, "projects", BOTH, cur, &inc, Some("projects"), "name", "project", &mut fix)? {
        serde_json::from_value::<crate::projects::ProjectsFile>(doc.clone())
            .map_err(|e| tr!(ko: "프로젝트 목록의 모양이 올바르지 않습니다: {e}", en: "The project list has an unexpected shape: {e}"))?;
        ctx.write(ctx.roots.config.join("projects.json"), pretty(&doc), "config/projects.json", false);
    }
    Ok(())
}

/// 테마 프로필 — 더하기만(지금 고른 프로필 `active` 는 바꾸지 않는다).
fn plan_profiles(ctx: &mut Ctx<'_>, bundle: &Bundle) -> Result<(), String> {
    let Some(inc) = json_of(bundle, "config/theme-profiles.json")? else { return Ok(()) };
    let cur = current_json(ctx, "theme-profiles.json")?;
    if let Some(doc) =
        merge_json_list(ctx, "appearance", BOTH, cur, &inc, Some("profiles"), "name", "profile", &mut |_, _| {})?
    {
        ctx.write(ctx.roots.config.join("theme-profiles.json"), pretty(&doc), "config/theme-profiles.json", true);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 파일 그대로 — 월페이퍼 · 아바타 · 터미널 테마 · 지침
// ---------------------------------------------------------------------------

fn plan_files(ctx: &mut Ctx<'_>, bundle: &Bundle) -> Result<(), String> {
    let mut names_inc: Option<serde_json::Map<String, Json>> = None;
    for (path, bytes) in &bundle.files {
        let Some(cat) = catalog::category_of(path) else { continue };
        let rel = path.strip_prefix("config/").unwrap_or(path);
        let is_file_kind = (cat == "appearance" && rel != "theme-profiles.json") || cat == "instructions";
        if !is_file_kind {
            continue;
        }
        if rel == "app-icons/names.json" {
            names_inc = serde_json::from_slice::<Json>(bytes).ok().and_then(|v| v.as_object().cloned());
            continue;
        }
        let target = rel.split('/').fold(ctx.roots.config.clone(), |p, seg| p.join(seg));
        let cur = read_opt(&target)?;
        let st = status(cur.as_ref().map(|c| c == bytes));
        let label = rel.rsplit('/').next().unwrap_or(rel).to_string();
        let choices = TWO;
        if ctx.item(cat, choices, item(format!("file:{rel}"), label, st)) {
            ctx.write(target, bytes.clone(), path, false);
        }
    }
    // 아바타 이름 — 이 PC 에 이름이 없는 것만 더한다(줄로 세지 않는다 — 그림의 곁 정보).
    if let Some(inc) = names_inc {
        if ctx.selected("appearance") {
            let path = ctx.roots.config.join("app-icons").join("names.json");
            let mut cur = read_opt(&path)?
                .and_then(|b| serde_json::from_slice::<Json>(&b).ok())
                .and_then(|v| v.as_object().cloned())
                .unwrap_or_default();
            let mut added = false;
            for (k, v) in inc {
                if crate::app_icon::user::is_user_id(&k) && v.is_string() && !cur.contains_key(&k) {
                    cur.insert(k, v);
                    added = true;
                }
            }
            if added {
                ctx.write(path, pretty(&Json::Object(cur)), "config/app-icons/names.json", false);
            }
        }
    }
    // 지우는 일은 없다 — 이 PC 에만 있는 파일은 그대로 남는다.
    Ok(())
}

/// 아티스트 — `[[artist]]` id 단위(덮기 · 건너뛰기). 권한 없는 프로필이다.
fn plan_artists(ctx: &mut Ctx<'_>, bundle: &Bundle) -> Result<(), String> {
    let Some(inc) = toml_of(bundle, "config/orchestration-artists.toml")? else { return Ok(()) };
    let path = ctx.roots.config.join("orchestration-artists.toml");
    let before = read_text_opt(&path)?;
    let mut cur = before.as_deref().map_or_else(|| Some(DocumentMut::new()), parse_toml).ok_or_else(|| {
        tr!(ko: "orchestration-artists.toml 을 읽지 못했습니다", en: "Could not read orchestration-artists.toml")
    })?;
    if merge_aot(ctx, "artists", TWO, &mut cur, &inc, "artist", "id", "artist", false, Some("name"), &|_| {})? {
        let rendered = crate::sessions_meta::match_line_endings(before.as_deref().unwrap_or(""), cur.to_string());
        ctx.write(path, rendered.into_bytes(), "config/orchestration-artists.toml", true);
    }
    Ok(())
}

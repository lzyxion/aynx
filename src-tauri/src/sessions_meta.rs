//! `~/.ssh/sessions.toml` — 호스트 표시 · 동작 메타데이터(색 · 그룹 · 태그 …). `~/.ssh/config` 를 보강만 한다.
//! 파일이 없거나 깨져도 오류가 아니라 경고 — 메타데이터만 비운다.
//!
//! 병합 우선순위: `hosts.<별칭>` > `presets.<preset>` > `[defaults]`. 예외 `forwards` · `forward_agent` 는 호스트 블록에서만 읽는다.
//! 호스트는 구체 이름으로만(글롭 없음) · 대소문자 무시로 맞춘다.
//!
//! 쓰기는 `toml_edit` 로 `[hosts."<별칭>"]` 의 해당 키만 갈아 끼운다 — 사람이 적은 주석 · 키 순서 · 들여쓰기를 보존한다.
//! 편집 폼은 병합하지 않은 원본 값([`SessionsMeta::raw_host`])으로 채운다 — 병합값을 채우면 저장 순간 상속이 끊긴다.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use toml_edit::{Array, DocumentMut, Item, Table, TableLike, Value};

use crate::i18n::tr;

/// 호스트별 포트 포워딩 프리셋 한 줄 — 접속하면 자동으로 연다. 인라인 테이블 배열로 쓴다(`put` 이 값만 다룬다).
/// 옛 줄은 `kind` 가 없다 = 로컬 — 그래서 `kind` 와 종류마다 빠지는 두 칸이 `#[serde(default)]` 다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ForwardPreset {
    #[serde(default)]
    pub kind: crate::port_forward::ForwardKind,
    /// 내 PC 의 `127.0.0.1:<이 포트>` — 로컬 · 동적은 듣는 포트, 원격은 서버에서 온 연결을 이어 줄 포트.
    pub local_port: u16,
    /// 원격 서버에서 본 호스트 이름. 로컬만 쓴다.
    #[serde(default)]
    pub remote_host: String,
    /// 로컬: 목적지 포트 · 원격: 서버가 `127.0.0.1` 에서 들을 포트 · 동적: 안 쓴다(0).
    #[serde(default)]
    pub remote_port: u16,
}

/// 호스트 하나에 대해 세 계층을 병합한 최종 메타데이터. 프런트로 이 모양 그대로 나간다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct HostMeta {
    /// CSS 색 문자열 그대로. 앱은 해석하지 않는다.
    pub color: Option<String>,
    pub icon: Option<String>,
    /// `"prod/web"` 같은 경로 문자열 — 중첩 테이블이 아니다.
    pub group: Option<String>,
    pub tags: Vec<String>,
    pub scrollback: Option<u32>,
    pub on_connect: Option<String>,
    /// 아직 파싱 · 병합만 하고 소비하는 곳이 없다.
    pub identity: Option<String>,
    /// 세션 로깅 — 원시 바이트를 그대로 파일에 남긴다(비밀번호 에코 · 토큰까지). 기본 끔(`None` = 끔) → docs/invariants.md 전문 5.
    pub log: Option<bool>,
    /// 셸 통합 주입. `None` 과 `Some(true)` 는 같다 — `Some(false)` 만 옵트아웃이고 그때는 서버에 아무것도 심지 않는다.
    /// 끄더라도 이미 심어진 파일을 앱이 지우지는 않는다.
    pub shell_integration: Option<bool>,
    /// tmux 로 접속(기본 끔). 켜면 셸 통합을 주입하지 않고 `on_connect` 도 실행되지 않는다 — 첫 입력 한 줄을 tmux 명령이 쓴다.
    pub tmux: Option<bool>,
    /// 상속하지 않는다 — 상속이 곧 포트 충돌이라 호스트 자기 블록에서만 읽는다([`apply`] 를 타지 않는다).
    pub forwards: Vec<ForwardPreset>,
    /// `~/.ssh/config` 의 `ForwardAgent` 를 이 호스트에서 덮어쓴다(`None` = config 를 따른다).
    /// 상속하지 않는다 — 켜면 그 서버가 내 에이전트로 서명할 수 있어 무리 전체에 한꺼번에 켜는 자리를 두지 않는다(→ 전문 12).
    pub forward_agent: Option<bool>,
    /// 에이전트 활성화 — 접속할 때(사람 타일 · 빠른 접속 제외) 서버에 에이전트용 파일(훅 · PATH 심 · 추가 인자 키)을 심는가. 이 스위치가 곧 심어도 된다는 동의다.
    /// 기본 끔 — `Some(true)` 만 켬. 상속한다. 옛 키 `remote_hooks` 도 같은 뜻으로 읽는다(저장은 `agent`).
    pub agent: Option<bool>,
    /// 원격 에이전트 추가 인자(에이전트 id → 한 줄). 키별로 상속하고, 빈 문자열 = 붙이지 않음으로 위 계층을 덮는다.
    /// 로컬 전역 `[ai.args]` 는 원격에 번지지 않는다.
    pub agent_args: BTreeMap<String, String>,
    /// `agent_args` 의 키별 출처 — `color_from` 과 같은 규칙.
    pub agent_args_from: BTreeMap<String, MetaLayer>,
    /// `color` 가 온 위 계층 — 호스트 자기 값이거나 값이 없으면 `None`. [`SessionsMeta::resolve`] 만 채운다.
    pub color_from: Option<MetaLayer>,
    pub icon_from: Option<MetaLayer>,
}

/// 상속값의 출처 계층. 프런트로는 `{"kind":"defaults"}` / `{"kind":"preset","name":"prod"}` 로 나간다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", content = "name", rename_all = "lowercase")]
pub enum MetaLayer {
    Defaults,
    Preset(String),
}

/// 그룹 경로(`[groups."prod/web"]`) 자체의 메타데이터 — 폴더 자신의 얼굴에만 쓰고 호스트에 내려가지 않는다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GroupMeta {
    /// 이모지 또는 `svg:…` 문자열. 앱은 해석하지 않는다.
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

/// TOML 테이블 하나의 원본 블록 — 필드가 모두 `Option` 이어야 "적지 않음" 과 "빈 값으로 덮어씀" 이 갈린다.
#[derive(Debug, Clone, Default, serde::Deserialize)]
struct MetaBlock {
    color: Option<String>,
    icon: Option<String>,
    group: Option<String>,
    tags: Option<Vec<String>>,
    scrollback: Option<u32>,
    on_connect: Option<String>,
    identity: Option<String>,
    log: Option<bool>,
    shell_integration: Option<bool>,
    tmux: Option<bool>,
    agent: Option<bool>,
    /// 옛 이름 — `agent` 가 없을 때만 같은 뜻으로 읽는다. 지우면 옛 파일의 켬이 사라진다.
    remote_hooks: Option<bool>,
    agent_args: Option<BTreeMap<String, String>>,
    /// `forwards` · `forward_agent` · `preset` 은 `[hosts.*]` 에서만 읽는다 — 다른 테이블에 있으면 경고한다.
    forwards: Option<Vec<ForwardPreset>>,
    forward_agent: Option<bool>,
    preset: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
struct RawFile {
    #[serde(default)]
    defaults: MetaBlock,
    #[serde(default)]
    presets: BTreeMap<String, MetaBlock>,
    #[serde(default)]
    hosts: BTreeMap<String, MetaBlock>,
}

#[derive(Debug, Clone, Default)]
pub struct SessionsMeta {
    defaults: MetaBlock,
    presets: BTreeMap<String, MetaBlock>,
    /// 키는 소문자로 접은 별칭.
    hosts: BTreeMap<String, MetaBlock>,
}

impl SessionsMeta {
    pub fn load_default() -> (Self, Vec<String>) {
        let Ok(path) = sessions_path() else {
            return (
                Self::default(),
                vec![
                    tr!(ko: "홈 디렉터리를 찾을 수 없습니다 — sessions.toml 을 읽지 않았습니다", en: "Could not find the home folder — sessions.toml was not read"),
                ],
            );
        };

        match std::fs::read_to_string(&path) {
            Ok(content) => Self::parse(&content),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Self::default(), Vec::new()),
            Err(e) => (
                Self::default(),
                vec![
                    tr!(ko: "{path} 읽기 실패 — 메타데이터 없이 진행합니다: {e}", en: "Could not read {path} — going on without metadata: {e}", path = path.display()),
                ],
            ),
        }
    }

    /// TOML 이 깨졌으면 빈 메타데이터 + 경고 한 줄(부분 복구는 하지 않는다).
    pub fn parse(content: &str) -> (Self, Vec<String>) {
        let raw: RawFile = match toml::from_str(content) {
            Ok(raw) => raw,
            Err(e) => {
                return (
                    Self::default(),
                    vec![tr!(
                        ko: "sessions.toml 을 해석할 수 없습니다 — 메타데이터를 무시합니다: {why}",
                        en: "Could not parse sessions.toml — ignoring the metadata: {why}",
                        why = flatten(&e.to_string()),
                    )],
                );
            }
        };

        let mut warnings = Vec::new();

        if raw.defaults.preset.is_some() {
            warnings.push(tr!(ko: "sessions.toml: [defaults] 의 preset 키는 무시됩니다", en: "sessions.toml: the preset key under [defaults] is ignored"));
        }
        for name in raw
            .presets
            .iter()
            .filter(|(_, b)| b.preset.is_some())
            .map(|(n, _)| n)
        {
            warnings.push(tr!(
                ko: "sessions.toml: [presets.{name}] 의 preset 키는 무시됩니다 — 프리셋은 중첩되지 않습니다",
                en: "sessions.toml: the preset key under [presets.{name}] is ignored — presets do not nest"
            ));
        }

        if raw.defaults.forwards.is_some() {
            warnings.push(tr!(
                ko: "sessions.toml: [defaults] 의 forwards 키는 무시됩니다 — 포워딩은 호스트마다 적습니다",
                en: "sessions.toml: the forwards key under [defaults] is ignored — forwards are written per host"
            ));
        }
        for name in raw
            .presets
            .iter()
            .filter(|(_, b)| b.forwards.is_some())
            .map(|(n, _)| n)
        {
            warnings.push(tr!(
                ko: "sessions.toml: [presets.{name}] 의 forwards 키는 무시됩니다 — 포워딩은 호스트마다 적습니다",
                en: "sessions.toml: the forwards key under [presets.{name}] is ignored — forwards are written per host"
            ));
        }

        if raw.defaults.forward_agent.is_some() {
            warnings.push(tr!(
                ko: "sessions.toml: [defaults] 의 forward_agent 키는 무시됩니다 — 에이전트 포워딩은 호스트마다 켭니다",
                en: "sessions.toml: the forward_agent key under [defaults] is ignored — agent forwarding is enabled per host"
            ));
        }
        for name in raw
            .presets
            .iter()
            .filter(|(_, b)| b.forward_agent.is_some())
            .map(|(n, _)| n)
        {
            warnings.push(tr!(
                ko: "sessions.toml: [presets.{name}] 의 forward_agent 키는 무시됩니다 — 에이전트 포워딩은 호스트마다 켭니다",
                en: "sessions.toml: the forward_agent key under [presets.{name}] is ignored — agent forwarding is enabled per host"
            ));
        }

        let mut hosts: BTreeMap<String, MetaBlock> = BTreeMap::new();
        for (name, block) in raw.hosts {
            if let Some(preset) = &block.preset {
                if !raw.presets.contains_key(preset) {
                    warnings.push(tr!(
                        ko: "sessions.toml: [hosts.{name}] 이 없는 preset '{preset}' 을 참조합니다 — 무시합니다",
                        en: "sessions.toml: [hosts.{name}] refers to a preset '{preset}' that does not exist — ignoring it"
                    ));
                }
            }
            let key = name.to_lowercase();
            if hosts.contains_key(&key) {
                warnings.push(tr!(
                    ko: "sessions.toml: [hosts.{name}] 은 대소문자만 다른 항목과 겹칩니다 — 먼저 나온 쪽을 씁니다",
                    en: "sessions.toml: [hosts.{name}] collides with an entry that differs only in case — the first one wins"
                ));
                continue;
            }
            hosts.insert(key, block);
        }

        (
            Self {
                defaults: raw.defaults,
                presets: raw.presets,
                hosts,
            },
            warnings,
        )
    }

    pub fn resolve(&self, host_name: &str) -> HostMeta {
        let mut meta = HostMeta::default();
        apply(&mut meta, &self.defaults);
        note_layer(&mut meta, &self.defaults, Some(MetaLayer::Defaults));

        let Some(block) = self.hosts.get(&host_name.to_lowercase()) else {
            return meta;
        };
        if let Some((name, preset)) = block
            .preset
            .as_ref()
            .and_then(|n| self.presets.get(n).map(|p| (n, p)))
        {
            apply(&mut meta, preset);
            note_layer(&mut meta, preset, Some(MetaLayer::Preset(name.clone())));
        }
        apply(&mut meta, block);
        note_layer(&mut meta, block, None);
        meta.forwards = block.forwards.clone().unwrap_or_default();
        meta.forward_agent = block.forward_agent;
        meta
    }
}

impl SessionsMeta {
    /// 호스트 자기 테이블에 적힌 값만(병합하지 않는다). 편집 폼은 반드시 이쪽으로 채운다 — 상속값을 채우면 저장할 때 상속이 끊긴다.
    pub fn raw_host(&self, host_name: &str) -> HostMeta {
        let mut meta = HostMeta::default();
        if let Some(block) = self.hosts.get(&host_name.to_lowercase()) {
            apply(&mut meta, block);
            meta.forwards = block.forwards.clone().unwrap_or_default();
            meta.forward_agent = block.forward_agent;
        }
        meta
    }
}

/// 적힌 키만 덮어쓴다. `tags` 는 통째로 교체한다. `forwards` · `forward_agent` 는 상속하지 않아 여기 없다.
fn apply(meta: &mut HostMeta, block: &MetaBlock) {
    if let Some(v) = &block.color {
        meta.color = Some(v.clone());
    }
    if let Some(v) = &block.icon {
        meta.icon = Some(v.clone());
    }
    if let Some(v) = &block.group {
        meta.group = Some(v.clone());
    }
    if let Some(v) = &block.tags {
        meta.tags = v.clone();
    }
    if let Some(v) = block.scrollback {
        meta.scrollback = Some(v);
    }
    if let Some(v) = &block.on_connect {
        meta.on_connect = Some(v.clone());
    }
    if let Some(v) = &block.identity {
        meta.identity = Some(v.clone());
    }
    if let Some(v) = block.log {
        meta.log = Some(v);
    }
    if let Some(v) = block.shell_integration {
        meta.shell_integration = Some(v);
    }
    if let Some(v) = block.tmux {
        meta.tmux = Some(v);
    }
    if let Some(v) = block.agent.or(block.remote_hooks) {
        meta.agent = Some(v);
    }
    // 빈 문자열도 값이다(= 붙이지 않음).
    if let Some(map) = &block.agent_args {
        for (id, line) in map {
            meta.agent_args.insert(id.clone(), line.clone());
        }
    }
}

/// `layer` 가 `None` 이면 호스트 자기 값 — 출처를 지운다.
fn note_layer(meta: &mut HostMeta, block: &MetaBlock, layer: Option<MetaLayer>) {
    if let Some(map) = &block.agent_args {
        for id in map.keys() {
            match &layer {
                Some(l) => {
                    meta.agent_args_from.insert(id.clone(), l.clone());
                }
                None => {
                    meta.agent_args_from.remove(id);
                }
            }
        }
    }
    if block.color.is_some() {
        meta.color_from = layer.clone();
    }
    if block.icon.is_some() {
        meta.icon_from = layer;
    }
}

fn flatten(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ── 쓰기 — `[hosts."<별칭>"]` 국소 편집 ──

pub fn sessions_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".ssh").join("sessions.toml"))
        .ok_or_else(
            || tr!(ko: "홈 디렉터리를 찾을 수 없습니다", en: "Could not find the home folder"),
        )
}

/// 파일을 새로 만들 때만 얹는다 — 이미 있는 파일에는 덧붙이지 않는다.
const NEW_FILE_HEADER: &str = "\
# ~/.ssh/sessions.toml — 호스트 표시·동작 메타데이터 (aynx 전용, ssh 는 이 파일을 모릅니다)
# 앱에서 고칠 수 있지만 손으로 적은 주석·순서는 그대로 보존됩니다.

";

/// GUI 폼에서 올라오는 호스트 메타데이터 패치. `None` 은 "그대로 두기" 가 아니라 키 삭제다 — 매 저장이 이 키들의 완전한 상태다.
/// 빈 문자열 · 빈 배열도 삭제로 본다. 폼에 없는 키(`preset` · `identity`)는 건드리지 않는다.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(default)]
pub struct HostMetaPatch {
    pub color: Option<String>,
    pub icon: Option<String>,
    pub group: Option<String>,
    pub tags: Option<Vec<String>>,
    pub scrollback: Option<u32>,
    pub on_connect: Option<String>,
    /// `false` 도 키 삭제다 — 상속을 이 호스트에서만 끊으려면 파일에 직접 `log = false` 를 적는다.
    pub log: Option<bool>,
    /// 여기는 `false` 가 `shell_integration = false` 로 그대로 적힌다(폼이 기본 · 켬 · 끔 세 값). 상속으로 되돌리기는 `None`.
    pub shell_integration: Option<bool>,
    /// `log` 와 같은 규칙 — `false` 도 키 삭제다.
    pub tmux: Option<bool>,
    /// 빈 목록은 키 삭제다.
    pub forwards: Option<Vec<ForwardPreset>>,
    /// `shell_integration` 과 같은 규칙 — `false` 도 그대로 적힌다(config 의 `yes` 를 끄는 값). `None` = config 를 따른다.
    pub forward_agent: Option<bool>,
    /// `true` · `false` 를 그대로 적고(`false` 는 위 계층의 켬을 덮는 값) `None` 은 키 삭제. 저장할 때 옛 키 `remote_hooks` 는 늘 지운다.
    #[serde(alias = "remote_hooks")]
    pub agent: Option<bool>,
    /// 호스트 자기 블록에 적을 에이전트별 한 줄. 빈 맵 · `None` 은 키 삭제 · 줄이 `parse_args` 에 어긋나면 저장하지 않는다.
    pub agent_args: Option<BTreeMap<String, String>>,
}

/// `port_forward::validate` 에 더해 한 호스트 안에서 같은 자리([`bind_slot`])를 두 번 잡으면 거절한다.
pub(crate) fn validate_forwards(list: &[ForwardPreset]) -> Result<Vec<ForwardPreset>, String> {
    use crate::port_forward::ForwardKind;
    let mut out: Vec<ForwardPreset> = Vec::with_capacity(list.len());
    for f in list {
        let (host, remote_port) =
            crate::port_forward::validate(f.kind, f.local_port, &f.remote_host, f.remote_port)?;
        let next = ForwardPreset {
            kind: f.kind,
            local_port: f.local_port,
            remote_host: host,
            remote_port,
        };
        if out.iter().any(|p| bind_slot(p) == bind_slot(&next)) {
            return Err(if next.kind == ForwardKind::Remote {
                tr!(
                    ko: "원격 포트 {port} 이 두 번 적혀 있습니다 — 한 호스트에서 같은 서버 포트를 두 번 열 수 없습니다",
                    en: "The remote port {port} appears twice — a host cannot open the same server port twice",
                    port = next.remote_port,
                )
            } else {
                tr!(
                    ko: "로컬 포트 {port} 이 두 번 적혀 있습니다 — 한 호스트에서 같은 포트를 두 번 열 수 없습니다",
                    en: "The local port {port} appears twice — a host cannot open the same local port twice",
                    port = next.local_port,
                )
            });
        }
        out.push(next);
    }
    Ok(out)
}

/// `(서버 쪽인가, 포트)` — 로컬 · 동적은 내 PC 의 `local_port` 를 함께 쓰고 원격은 서버의 `remote_port` 를 잡는다.
fn bind_slot(f: &ForwardPreset) -> (bool, u16) {
    match f.kind {
        crate::port_forward::ForwardKind::Remote => (true, f.remote_port),
        _ => (false, f.local_port),
    }
}

/// 로컬이면 `kind` 를 적지 않는다 — 예전 앱이 읽어도 뜻이 같게. 원격 · 동적은 쓰지 않는 칸을 뺀다.
fn forward_value(f: &ForwardPreset) -> Value {
    use crate::port_forward::ForwardKind;
    let mut table = toml_edit::InlineTable::new();
    match f.kind {
        ForwardKind::Local => {}
        ForwardKind::Remote => {
            table.insert("kind", Value::from("remote"));
        }
        ForwardKind::Dynamic => {
            table.insert("kind", Value::from("dynamic"));
        }
    }
    table.insert("local_port", Value::from(i64::from(f.local_port)));
    if f.kind == ForwardKind::Local {
        table.insert("remote_host", Value::from(f.remote_host.as_str()));
    }
    if f.kind != ForwardKind::Dynamic {
        table.insert("remote_port", Value::from(i64::from(f.remote_port)));
    }
    Value::InlineTable(table)
}

/// 각 필드의 `None` 이 곧 키 삭제다.
struct Desired {
    color: Option<Value>,
    icon: Option<Value>,
    group: Option<Value>,
    tags: Option<Value>,
    scrollback: Option<Value>,
    on_connect: Option<Value>,
    log: Option<Value>,
    shell_integration: Option<Value>,
    tmux: Option<Value>,
    forwards: Option<Value>,
    forward_agent: Option<Value>,
    agent: Option<Value>,
    agent_args: Option<Value>,
}

impl Desired {
    fn is_all_empty(&self) -> bool {
        self.color.is_none()
            && self.icon.is_none()
            && self.group.is_none()
            && self.tags.is_none()
            && self.scrollback.is_none()
            && self.on_connect.is_none()
            && self.log.is_none()
            && self.shell_integration.is_none()
            && self.tmux.is_none()
            && self.forwards.is_none()
            && self.forward_agent.is_none()
            && self.agent.is_none()
            && self.agent_args.is_none()
    }
}

fn clean(v: Option<&String>) -> Option<String> {
    v.map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// `forwards` · `agent_args` 만 거절할 수 있다 — 실패하면 파일에는 한 글자도 닿지 않는다.
fn normalize(patch: &HostMetaPatch) -> Result<Desired, String> {
    let tags = patch.tags.as_ref().map(|list| {
        list.iter()
            .map(|t| t.trim())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
    });

    let forwards = match patch.forwards.as_deref() {
        None => None,
        Some([]) => None,
        Some(list) => Some(Value::Array(
            validate_forwards(list)?.iter().map(forward_value).collect(),
        )),
    };

    // 줄은 접속 때 쓰는 그 규칙(`parse_args`)으로 검사한다 — 저장과 실행이 같은 규칙.
    let agent_args = match &patch.agent_args {
        None => None,
        Some(map) if map.is_empty() => None,
        Some(map) => {
            let mut table = toml_edit::InlineTable::new();
            for (id, line) in map {
                let Some(display) = crate::agent_args::display_of(id) else {
                    return Err(tr!(ko: "모르는 에이전트입니다: {id}", en: "Unknown agent: {id}"));
                };
                let line = line.trim();
                crate::agent_args::parse_args(line).map_err(|e| {
                    tr!(
                        ko: "{display} 추가 인자: {why}",
                        en: "{display} extra arguments: {why}",
                        why = e.message()
                    )
                })?;
                table.insert(id, Value::from(line));
            }
            Some(Value::InlineTable(table))
        }
    };

    Ok(Desired {
        color: clean(patch.color.as_ref()).map(Value::from),
        icon: clean(patch.icon.as_ref()).map(Value::from),
        group: clean(patch.group.as_ref()).map(Value::from),
        // 빈 배열은 키 삭제다 — `tags = []` 로 상속을 끊으려면 파일을 직접 고친다.
        tags: tags
            .filter(|list| !list.is_empty())
            .map(|list| Value::Array(list.into_iter().collect::<Array>())),
        scrollback: patch
            .scrollback
            .filter(|n| *n > 0)
            .map(|n| Value::from(i64::from(n))),
        on_connect: clean(patch.on_connect.as_ref()).map(Value::from),
        log: patch.log.filter(|v| *v).map(Value::from),
        shell_integration: patch.shell_integration.map(Value::from),
        tmux: patch.tmux.filter(|v| *v).map(Value::from),
        forwards,
        forward_agent: patch.forward_agent.map(Value::from),
        agent: patch.agent.map(Value::from),
        agent_args,
    })
}

/// 이미 있던 줄은 장식(앞뒤 공백 · 줄 끝 주석)을 물려받아 값만 바뀐다.
fn put(table: &mut dyn TableLike, key: &str, new: Option<Value>) {
    let Some(mut new) = new else {
        table.remove(key);
        return;
    };
    match table.get_mut(key).and_then(Item::as_value_mut) {
        Some(old) => {
            *new.decor_mut() = old.decor().clone();
            *old = new;
        }
        None => {
            table.insert(key, Item::Value(new));
        }
    }
}

/// 주석은 바로 뒤 항목의 앞 장식이라, 헤더를 지우면 그 위의 사람 주석(파일 머리글일 수도)이 함께 사라진다 — 그런 테이블은 비워만 둔다.
fn has_leading_comment(hosts: &dyn TableLike, key: &str) -> bool {
    let prefix = |d: &toml_edit::Decor| {
        d.prefix()
            .and_then(|p| p.as_str())
            .is_some_and(|s| s.contains('#'))
    };
    let on_table = hosts
        .get(key)
        .and_then(Item::as_table)
        .is_some_and(|t| prefix(t.decor()));
    // 인라인 형태(`[hosts]` 아래 `web = { … }`)면 주석은 키 쪽 장식에 붙는다.
    let on_key = hosts.key(key).is_some_and(|k| prefix(k.leaf_decor()));
    on_table || on_key
}

/// toml_edit 은 줄바꿈을 늘 `\n` 으로 찍는다 — 원본이 CRLF 였으면 되돌린다.
pub(crate) fn match_line_endings(original: &str, rendered: String) -> String {
    if original.contains("\r\n") && !rendered.contains("\r\n") {
        rendered.replace('\n', "\r\n")
    } else {
        rendered
    }
}

/// 대소문자 무시로 기존 키를 찾아 원래 표기로 쓴다 — 아니면 `[hosts.WEB]` 와 `web` 으로 테이블이 갈라진다.
fn existing_key(hosts: &dyn TableLike, name: &str) -> Option<String> {
    let target = name.to_lowercase();
    hosts
        .iter()
        .map(|(k, _)| k.to_string())
        .find(|k| k.to_lowercase() == target)
}

/// `[hosts."<name>"]` 의 우리 키만 갈아 끼운 문서 전체. 다른 테이블 · 주석 · 키 순서 · 폼에 없는 키는 그대로다.
pub(crate) fn patch_document(
    content: &str,
    name: &str,
    patch: &HostMetaPatch,
) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(tr!(ko: "별칭이 비어 있습니다", en: "The alias is empty"));
    }

    let mut doc = content.parse::<DocumentMut>().map_err(|e| {
        tr!(
            ko: "sessions.toml 을 해석할 수 없어 저장하지 않았습니다 — 파일을 직접 고쳐 주세요: {why}",
            en: "sessions.toml could not be parsed, so nothing was saved — please fix the file by hand: {why}",
            why = flatten(&e.to_string()),
        )
    })?;

    let desired = normalize(patch)?;

    if desired.is_all_empty() && doc.get("hosts").is_none() {
        return Ok(content.to_string());
    }

    let hosts = doc
        .entry("hosts")
        .or_insert_with(|| {
            let mut t = Table::new();
            // `[hosts]` 헤더 없이 `[hosts.<별칭>]` 만 찍힌다.
            t.set_implicit(true);
            Item::Table(t)
        })
        .as_table_like_mut()
        .ok_or_else(|| tr!(ko: "sessions.toml 의 hosts 가 테이블이 아닙니다 — 파일을 직접 고쳐 주세요", en: "hosts in sessions.toml is not a table — please fix the file by hand"))?;

    let key = existing_key(hosts, name).unwrap_or_else(|| name.to_string());
    if desired.is_all_empty() && hosts.get(&key).is_none() {
        return Ok(content.to_string());
    }

    {
        let table = hosts
            .entry(&key)
            .or_insert_with(|| Item::Table(Table::new()))
            .as_table_like_mut()
            .ok_or_else(|| {
                tr!(ko: "sessions.toml 의 [hosts.{key}] 이 테이블이 아닙니다 — 파일을 직접 고쳐 주세요", en: "[hosts.{key}] in sessions.toml is not a table — please fix the file by hand")
            })?;

        put(table, "color", desired.color);
        put(table, "icon", desired.icon);
        put(table, "group", desired.group);
        put(table, "tags", desired.tags);
        put(table, "scrollback", desired.scrollback);
        put(table, "on_connect", desired.on_connect);
        put(table, "log", desired.log);
        put(table, "shell_integration", desired.shell_integration);
        put(table, "tmux", desired.tmux);
        put(table, "forwards", desired.forwards);
        put(table, "forward_agent", desired.forward_agent);
        put(table, "agent", desired.agent);
        put(table, "remote_hooks", None);
        put(table, "agent_args", desired.agent_args);
    }

    let empty = hosts
        .get(&key)
        .and_then(Item::as_table_like)
        .is_some_and(|t| t.is_empty());
    if empty && !has_leading_comment(hosts, &key) {
        hosts.remove(&key);
    }

    Ok(match_line_endings(content, doc.to_string()))
}

/// 결과가 원본과 같으면 파일에 손대지 않는다(mtime 이 흔들리지 않게).
pub(crate) fn set_host_meta_at(
    path: &Path,
    name: &str,
    patch: &HostMetaPatch,
) -> Result<(), String> {
    let (content, existed) = match std::fs::read_to_string(path) {
        Ok(c) => (c, true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (String::new(), false),
        Err(e) => {
            return Err(
                tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
            )
        }
    };

    let patched = patch_document(&content, name, patch)?;

    if !existed {
        if patched.trim().is_empty() {
            return Ok(());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| tr!(ko: "{parent} 디렉터리를 만들지 못했습니다: {e}", en: "Could not create the folder {parent}: {e}", parent = parent.display()))?;
        }
        return std::fs::write(path, format!("{NEW_FILE_HEADER}{patched}"))
            .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()));
    }

    if patched == content {
        return Ok(());
    }
    std::fs::write(path, patched.as_bytes())
        .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()))
}

pub(crate) fn get_host_meta_at(path: &Path, name: &str) -> HostMeta {
    let Ok(content) = std::fs::read_to_string(path) else {
        return HostMeta::default();
    };
    SessionsMeta::parse(&content).0.raw_host(name)
}

/// 호스트 삭제의 메타 쪽 — `preset` · `identity` 를 포함한 그 호스트 테이블 전체를 지운다.
pub(crate) fn remove_host_document(content: &str, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(tr!(ko: "별칭이 비어 있습니다", en: "The alias is empty"));
    }

    let mut doc = content.parse::<DocumentMut>().map_err(|e| {
        tr!(
            ko: "sessions.toml 을 해석할 수 없어 저장하지 않았습니다 — 파일을 직접 고쳐 주세요: {why}",
            en: "sessions.toml could not be parsed, so nothing was saved — please fix the file by hand: {why}",
            why = flatten(&e.to_string()),
        )
    })?;

    let Some(hosts) = doc.get_mut("hosts").and_then(|i| i.as_table_like_mut()) else {
        return Ok(content.to_string());
    };
    let Some(key) = existing_key(hosts, name) else {
        return Ok(content.to_string());
    };

    if has_leading_comment(hosts, &key) {
        if let Some(table) = hosts.get_mut(&key).and_then(Item::as_table_like_mut) {
            let keys: Vec<String> = table.iter().map(|(k, _)| k.to_string()).collect();
            for k in keys {
                table.remove(&k);
            }
        }
    } else {
        hosts.remove(&key);
    }

    let hosts_empty = doc
        .get("hosts")
        .and_then(Item::as_table_like)
        .is_some_and(|t| t.is_empty());
    if hosts_empty && !has_leading_comment(doc.as_table(), "hosts") {
        doc.remove("hosts");
    }

    Ok(match_line_endings(content, doc.to_string()))
}

/// 파일이나 테이블이 없으면 no-op(오류 아님).
pub(crate) fn remove_host_meta_at(path: &Path, name: &str) -> Result<(), String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => {
            return Err(
                tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
            )
        }
    };

    let patched = remove_host_document(&content, name)?;
    if patched == content {
        return Ok(());
    }
    std::fs::write(path, patched.as_bytes())
        .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()))
}

// ── 명령 ──

/// 편집 폼 프리필용 — 병합 결과가 아니다([`SessionsMeta::raw_host`]).
#[tauri::command]
pub async fn get_host_meta(name: String) -> HostMeta {
    tauri::async_runtime::spawn_blocking(move || match sessions_path() {
        Ok(path) => get_host_meta_at(&path, &name),
        Err(_) => HostMeta::default(),
    })
    .await
    .unwrap_or_default()
}

/// patch = 전체 교체 — `{ tmux: true }` 만 보내면 나머지 칸이 전부 지워진다. 칸 하나만 바꾸려면
/// `get_host_meta` 로 원본을 읽어 그 칸만 고친 전체를 보낸다.
#[tauri::command]
pub async fn set_host_meta(name: String, patch: HostMetaPatch) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_host_meta_at(&sessions_path()?, &name, &patch)
    })
    .await
    .map_err(|e| tr!(ko: "메타데이터를 저장하는 작업이 실패했습니다: {e}", en: "The task that saves the metadata failed: {e}"))?
}

// ── 그룹 메타데이터 — `[groups."<경로>"]` 와 경로 접두사 일괄 재작성 ──

/// 깨진 항목은 던지지 않고 건너뛴다 — 파일 전체가 깨졌으면 빈 맵.
pub(crate) fn parse_group_meta(content: &str) -> HashMap<String, GroupMeta> {
    let mut map = HashMap::new();
    let Ok(doc) = content.parse::<DocumentMut>() else {
        return map;
    };
    let Some(groups) = doc.get("groups").and_then(Item::as_table_like) else {
        return map;
    };
    for (key, item) in groups.iter() {
        let Some(table) = item.as_table_like() else {
            continue;
        };
        let text = |k: &str| {
            table
                .get(k)
                .and_then(Item::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        map.insert(
            key.to_string(),
            GroupMeta {
                icon: text("icon"),
                color: text("color"),
            },
        );
    }
    map
}

/// `icon` · `color` 두 칸은 늘 함께 온다 — 빈 값 · `None` 은 키 삭제다([`patch_document`] 와 같은 규칙).
pub(crate) fn patch_group_meta_document(
    content: &str,
    group: &str,
    icon: Option<&str>,
    color: Option<&str>,
) -> Result<String, String> {
    let group = group.trim();
    if group.is_empty() {
        return Err(tr!(ko: "그룹 경로가 비어 있습니다", en: "The group path is empty"));
    }
    let icon = icon.map(str::trim).filter(|s| !s.is_empty());
    let color = color.map(str::trim).filter(|s| !s.is_empty());
    let fields = [("icon", icon), ("color", color)];

    let mut doc = content.parse::<DocumentMut>().map_err(|e| {
        tr!(
            ko: "sessions.toml 을 해석할 수 없어 저장하지 않았습니다 — 파일을 직접 고쳐 주세요: {why}",
            en: "sessions.toml could not be parsed, so nothing was saved — please fix the file by hand: {why}",
            why = flatten(&e.to_string()),
        )
    })?;

    if icon.is_none() && color.is_none() && doc.get("groups").is_none() {
        return Ok(content.to_string());
    }

    {
        let groups = doc
            .entry("groups")
            .or_insert_with(|| {
                let mut t = Table::new();
                t.set_implicit(true);
                Item::Table(t)
            })
            .as_table_like_mut()
            .ok_or_else(|| {
                tr!(ko: "sessions.toml 의 groups 가 테이블이 아닙니다 — 파일을 직접 고쳐 주세요", en: "groups in sessions.toml is not a table — please fix the file by hand")
            })?;

        if icon.is_some() || color.is_some() {
            let table = groups
                .entry(group)
                .or_insert_with(|| Item::Table(Table::new()))
                .as_table_like_mut()
                .ok_or_else(|| {
                    tr!(
                        ko: "sessions.toml 의 [groups.\"{group}\"] 이 테이블이 아닙니다 — 파일을 직접 고쳐 주세요",
                        en: "[groups.\"{group}\"] in sessions.toml is not a table — please fix the file by hand"
                    )
                })?;
            for (key, v) in fields {
                put(table, key, v.map(Value::from));
            }
        } else if let Some(table) = groups.get_mut(group).and_then(Item::as_table_like_mut) {
            for (key, _) in fields {
                table.remove(key);
            }
        }

        let empty = groups
            .get(group)
            .and_then(Item::as_table_like)
            .is_some_and(|t| t.is_empty());
        if empty && !has_leading_comment(groups, group) {
            groups.remove(group);
        }
    }

    let groups_empty = doc
        .get("groups")
        .and_then(Item::as_table_like)
        .is_some_and(|t| t.is_empty());
    if groups_empty && !has_leading_comment(doc.as_table(), "groups") {
        doc.remove("groups");
    }

    Ok(match_line_endings(content, doc.to_string()))
}

/// 바깥 `None` = 안 걸림 · `Some(None)` = 그룹을 지운다(`to == ""` 이고 값이 정확히 `from`) · `Some(Some(new))` = 바꾼다.
fn rewrite_group_path(value: &str, from: &str, to: &str) -> Option<Option<String>> {
    if value == from {
        return Some((!to.is_empty()).then(|| to.to_string()));
    }
    // `website` 가 `web` 접두사에 걸리지 않게 `/` 경계에서만 자른다.
    let rest = value.strip_prefix(from).filter(|r| r.starts_with('/'))?;
    Some(Some(if to.is_empty() {
        rest[1..].to_string()
    } else {
        format!("{to}{rest}")
    }))
}

/// 이름 바꾸기 · 중첩 · 해제 · 해산의 단 하나의 원시 연산 — 호스트 `group` 값과 `[groups."…"]` 키를 함께 옮긴다.
/// 목적지 그룹 키가 이미 있으면 옮겨온 쪽으로 덮어쓴다 — 목적지의 낡은 메타에 가려지지 않게.
pub(crate) fn rename_group_document(content: &str, from: &str, to: &str) -> Result<String, String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() {
        return Err(
            tr!(ko: "바꿀 그룹 경로가 비어 있습니다", en: "The group path to rename is empty"),
        );
    }
    if to == from {
        return Err(
            tr!(ko: "바꿀 이름이 원래 이름과 같습니다", en: "The new name is the same as the old one"),
        );
    }
    if to.starts_with(&format!("{from}/")) {
        return Err(
            tr!(ko: "그룹을 자기 하위 경로로 옮길 수 없습니다", en: "A group cannot be moved under itself"),
        );
    }

    let mut doc = content.parse::<DocumentMut>().map_err(|e| {
        tr!(
            ko: "sessions.toml 을 해석할 수 없어 저장하지 않았습니다 — 파일을 직접 고쳐 주세요: {why}",
            en: "sessions.toml could not be parsed, so nothing was saved — please fix the file by hand: {why}",
            why = flatten(&e.to_string()),
        )
    })?;

    if let Some(hosts) = doc.get_mut("hosts").and_then(|i| i.as_table_like_mut()) {
        for (_, item) in hosts.iter_mut() {
            let Some(table) = item.as_table_like_mut() else {
                continue;
            };
            let Some(current) = table
                .get("group")
                .and_then(Item::as_str)
                .map(str::to_string)
            else {
                continue;
            };
            match rewrite_group_path(&current, from, to) {
                Some(Some(new)) => put(table, "group", Some(Value::from(new))),
                Some(None) => {
                    table.remove("group");
                }
                None => {}
            }
        }
    }

    if let Some(groups) = doc.get_mut("groups").and_then(|i| i.as_table_like_mut()) {
        let migrations: Vec<(String, Option<String>)> = groups
            .iter()
            .filter_map(|(key, _)| {
                rewrite_group_path(key, from, to).map(|new| (key.to_string(), new))
            })
            .collect();
        for (old, new) in migrations {
            let Some(item) = groups.remove(&old) else {
                continue;
            };
            if let Some(new) = new {
                groups.insert(&new, item);
            }
        }
    }

    Ok(match_line_endings(content, doc.to_string()))
}

pub(crate) fn list_group_meta_at(path: &Path) -> Result<HashMap<String, GroupMeta>, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(parse_group_meta(&content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(
            tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
        ),
    }
}

pub(crate) fn set_group_meta_at(
    path: &Path,
    group: &str,
    icon: Option<&str>,
    color: Option<&str>,
) -> Result<(), String> {
    let (content, existed) = match std::fs::read_to_string(path) {
        Ok(c) => (c, true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (String::new(), false),
        Err(e) => {
            return Err(
                tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
            )
        }
    };

    let patched = patch_group_meta_document(&content, group, icon, color)?;

    if !existed {
        if patched.trim().is_empty() {
            return Ok(());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| tr!(ko: "{parent} 디렉터리를 만들지 못했습니다: {e}", en: "Could not create the folder {parent}: {e}", parent = parent.display()))?;
        }
        return std::fs::write(path, format!("{NEW_FILE_HEADER}{patched}"))
            .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()));
    }

    if patched == content {
        return Ok(());
    }
    std::fs::write(path, patched.as_bytes())
        .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()))
}

pub(crate) fn rename_group_at(path: &Path, from: &str, to: &str) -> Result<(), String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // 파일이 없어도 잘못된 입력(빈 from · 순환)은 거절한다.
            rename_group_document("", from, to)?;
            return Ok(());
        }
        Err(e) => {
            return Err(
                tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
            )
        }
    };

    let patched = rename_group_document(&content, from, to)?;
    if patched == content {
        return Ok(());
    }
    std::fs::write(path, patched.as_bytes())
        .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()))
}

// ── 그룹 명령 ──

#[tauri::command]
pub async fn list_group_meta() -> Result<HashMap<String, GroupMeta>, String> {
    tauri::async_runtime::spawn_blocking(|| list_group_meta_at(&sessions_path()?))
        .await
        .map_err(|e| tr!(ko: "그룹 정보를 읽는 작업이 실패했습니다: {e}", en: "The task that reads the group information failed: {e}"))?
}

#[tauri::command]
pub async fn set_group_meta(
    path: String,
    icon: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_group_meta_at(&sessions_path()?, &path, icon.as_deref(), color.as_deref())
    })
    .await
    .map_err(|e| tr!(ko: "그룹 정보를 저장하는 작업이 실패했습니다: {e}", en: "The task that saves the group information failed: {e}"))?
}

#[tauri::command]
pub async fn rename_group(from: String, to: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        rename_group_at(&sessions_path()?, &from, &to)
    })
    .await
    .map_err(|e| tr!(ko: "그룹 이름을 바꾸는 작업이 실패했습니다: {e}", en: "The task that renames the group failed: {e}"))?
}

#[cfg(test)]
mod tests;

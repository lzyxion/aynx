//! 관문의 **정적 파일** — exe 에 박힌 같은 프런트 빌드를 내고, `tauri.conf.json` 의 CSP 를 헤더로 붙인다.
//!
//! - 파일: `AppHandle::asset_resolver().get(path)` 하나(릴리스 = exe 안 자산 · 개발 빌드 = 디스크 `build/` — tauri 가 가른다).
//!   **경로는 여기서 먼저 걸러 낸다**([`safe_asset_path`]) — 개발 빌드의 tauri 는 `..` 를 걷지 않고 디스크를 읽는다.
//! - CSP: 출처는 `app.config().app.security.csp` 하나. tauri 가 자기 프로토콜로 낼 때 하는 일 중 우리에게 필요한 것 —
//!   **인라인 `<script>`(SvelteKit 부트스트랩)의 sha256 해시를 `script-src` 에 붙이기** — 를 [`inline_script_hashes`] 가 직접 한다.
//!   `Asset::csp_header` 는 쓰지 않는다: 릴리스에서만 오고(개발 빌드는 `None`), tauri 의 웹뷰 초기화 스크립트 해시 100여 개가 섞여
//!   브라우저에는 뜻이 없다. 해시는 우리가 **실제로 내는 바이트**에서 뽑으므로 릴리스(tauri 가 다시 직렬화한 HTML)·개발 모두 맞는다.
//!   설정의 `ipc:`·`asset:` 출처는 브라우저에선 닿을 곳이 없어 무해하고, `/ws` 는 같은 출처(`'self'` — CSP3 는 wss 를 포함)다.

use std::collections::HashMap;

use sha2::{Digest, Sha256};
use tauri::utils::config::{Csp, CspDirectiveSources};

/// 요청 경로 → 자산 열쇠. `/` = `index.html`. 허용 글자 밖·빈 조각·`.`·`..`·512자 초과는 `None`(404).
///
/// 빌드 산출물의 이름은 `[A-Za-z0-9._~-]` 와 `/` 뿐이다(SvelteKit 해시 이름) — 퍼센트 인코딩·역슬래시·`:` 는 받을 까닭이 없다.
pub(crate) fn safe_asset_path(path: &str) -> Option<String> {
    let rest = path.strip_prefix('/')?;
    if rest.is_empty() {
        return Some("index.html".to_string());
    }
    if rest.len() > 512
        || !rest
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'~' | b'-' | b'/'))
    {
        return None;
    }
    let trimmed = rest.strip_suffix('/').unwrap_or(rest);
    if trimmed
        .split('/')
        .any(|seg| seg.is_empty() || seg == "." || seg == "..")
    {
        return None;
    }
    Some(trimmed.to_string())
}

/// HTML 의 인라인 `<script>`(`src` 없는 것, 내용이 빈 것 제외)마다 `'sha256-<base64>'` — 브라우저가 CSP 해시를 재는 것과 같은
/// 바이트(태그 사이 원문 + 줄 끝 CRLF·CR → LF, tauri `normalize_script_for_csp` 와 같은 규칙).
pub(crate) fn inline_script_hashes(html: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase(); // ASCII 만 바꾸므로 바이트 위치가 같다
    let mut hashes = Vec::new();
    let mut at = 0;
    while let Some(found) = lower[at..].find("<script") {
        let tag_start = at + found;
        let after_name = tag_start + "<script".len();
        // `<scripts>` 같은 다른 이름은 건너뛴다.
        if !lower[after_name..].starts_with(|c: char| c == '>' || c.is_ascii_whitespace() || c == '/') {
            at = after_name;
            continue;
        }
        let Some(tag_end) = lower[after_name..].find('>').map(|i| after_name + i) else {
            break;
        };
        let attrs = &lower[after_name..tag_end];
        let body_start = tag_end + 1;
        let Some(body_end) = lower[body_start..].find("</script").map(|i| body_start + i) else {
            break;
        };
        let has_src = attrs
            .split(|c: char| c.is_ascii_whitespace())
            .any(|a| a == "src" || a.starts_with("src="));
        let body = &html[body_start..body_end];
        if !has_src && !body.is_empty() {
            let normalized = body.replace("\r\n", "\n").replace('\r', "\n");
            let digest = Sha256::digest(normalized.as_bytes());
            hashes.push(format!("'sha256-{}'", data_encoding::BASE64.encode(&digest)));
        }
        at = body_end;
    }
    hashes
}

/// 설정 CSP + 인라인 스크립트 해시 → 헤더 값. 지시어는 이름순(결정적 — 시험·비교용). `script-src` 가 없으면 `default-src` 를
/// 물려받아 만든 뒤 해시를 더한다(브라우저가 하는 것과 같은 바닥).
pub(crate) fn gateway_csp(csp: &Csp, script_hashes: &[String]) -> String {
    let mut map: HashMap<String, CspDirectiveSources> = csp.clone().into();
    if !script_hashes.is_empty() {
        let base = map.get("default-src").cloned().unwrap_or_default();
        map.entry("script-src".to_string())
            .or_insert(base)
            .extend(script_hashes.to_vec());
    }
    let mut directives: Vec<(String, Vec<String>)> = map
        .into_iter()
        .map(|(k, v)| {
            let sources: Vec<String> = v.into();
            (k, sources.into_iter().filter(|s| !s.is_empty()).collect())
        })
        .collect();
    directives.sort_by(|a, b| a.0.cmp(&b.0));
    directives
        .into_iter()
        .map(|(k, v)| if v.is_empty() { k } else { format!("{k} {}", v.join(" ")) })
        .collect::<Vec<_>>()
        .join("; ")
}

/// `Cache-Control` — HTML 은 저장 안 함(CSP·부트스트랩이 빌드마다 바뀐다), 해시 이름 자산은 오래, 나머지는 매번 확인.
pub(crate) fn cache_control(path: &str, is_html: bool) -> &'static str {
    if is_html {
        "no-store"
    } else if path.starts_with("_app/immutable/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    }
}

// ── 원격 창(R1a-3) ──────────────────────────────────────────────────────────

/// 폴리필 경로 — 앱 셸의 첫 스크립트.
pub(crate) const POLYFILL_PATH: &str = "/remote/polyfill.js";
/// 원격의 `convertFileSrc` 가 가리키는 경로(`?path=<절대 경로>`).
pub(crate) const ASSET_PATH: &str = "/remote/asset";
/// 원격 창 ws 경로(`?t=<부팅 표>`).
pub(crate) const WS_PATH: &str = "/remote/ws";

/// HTML 속성 값 이스케이프(`"` `&` `<` `>` `'`).
fn attr_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            c => out.push(c),
        }
    }
    out
}

/// 앱 셸에 원격 부팅을 끼운다 — `<head>` 바로 뒤(다른 어떤 스크립트보다 먼저)에 부팅 값(`<meta>` — 스크립트가 아니라 CSP 해시가
/// 필요 없다)과 폴리필(외부 파일 — `script-src 'self'`). 동기 스크립트라 SvelteKit 의 모듈보다 먼저 돈다. `<head>` 가 없으면 `None`.
pub(crate) fn inject_remote_boot(html: &str, boot_json: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut at = 0;
    let head_end = loop {
        let i = at + lower[at..].find("<head")?;
        let after = i + "<head".len();
        if lower[after..].starts_with(|c: char| c == '>' || c.is_ascii_whitespace()) {
            break after + lower[after..].find('>')? + 1;
        }
        at = after;
    };
    let mut out = String::with_capacity(html.len() + boot_json.len() + 160);
    out.push_str(&html[..head_end]);
    out.push_str("<meta name=\"aynx-remote\" content=\"");
    out.push_str(&attr_escape(boot_json));
    out.push_str("\"><script src=\"");
    out.push_str(POLYFILL_PATH);
    out.push_str("\"></script>");
    out.push_str(&html[head_end..]);
    Some(out)
}

/// 이 PC 의 경로 구분자·목록 구분자 — `@tauri-apps/api/path` 의 `sep()`·`delimiter()` 가 폴리필에서 읽는다.
pub(crate) fn path_separators() -> (&'static str, &'static str) {
    #[cfg(windows)]
    return ("\\", ";");
    #[cfg(not(windows))]
    return ("/", ":");
}

/// 쿼리 문자열에서 `name` 의 값(퍼센트 디코딩 · UTF-8). 없거나 둘 이상이면 `None`.
pub(crate) fn query_param(query: Option<&str>, name: &str) -> Option<String> {
    let mut found = None;
    for pair in query?.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if k == name {
            if found.is_some() {
                return None;
            }
            let v = v.replace('+', " ");
            found = Some(percent_encoding::percent_decode_str(&v).decode_utf8().ok()?.into_owned());
        }
    }
    found
}

/// `/remote/asset` 의 경로 → 내줄 파일과 내용 종류. **절대 경로 · `..` 없음 · 래스터 그림 확장자**만(월페이퍼가 받는 것 —
/// `wallpaper.rs` 의 목록과 같다). 스코프 판정(`asset_protocol_scope`)은 부르는 쪽이 이 뒤에 한다. SVG 는 받지 않는다(스크립트).
pub(crate) fn asset_request(raw: &str) -> Option<(std::path::PathBuf, &'static str)> {
    use std::path::{Component, Path};
    if raw.is_empty() || raw.len() > 4096 || raw.contains('\0') {
        return None;
    }
    let path = Path::new(raw);
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return None;
    }
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => return None,
    };
    Some((path.to_path_buf(), mime))
}

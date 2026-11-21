//! 랜덤 월페이퍼 — konachan.net 에서 16:9 · 1920×1080 이상인 그림 하나를 받아 온다.
//!
//! - 응답 JSON 의 주소는 남이 정한 글자다 — API · 다운로드 · 리다이렉트 모두 [`allowed_url`] 을 지나야 연다.
//! - 확장자는 응답을 믿지 않고 받은 바이트의 머리로 정한다.

use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Url;

use crate::i18n::tr;

const API_URL: &str = "https://konachan.net/post.json";

/// 저쪽이 파일을 다른 호스트로 옮기면 받기가 "허용되지 않은 주소" 로 실패한다 — 그때 확인하고 더한다(짐작으로 미리 넓히지 않는다).
const ALLOWED_HOSTS: [&str; 1] = ["konachan.net"];

/// 저쪽 태그 동작에 기대지 않고 [`candidates`] 가 다시 거른다.
const TAGS: &str = "width:>=1920 height:>=1080 ratio:16:9 rating:safe order:random";

const PAGE: u32 = 40;

const MIN_WIDTH: u32 = 1920;
const MIN_HEIGHT: u32 = 1080;

/// 상대 ±2% — 1366×768 류 반올림 해상도까지 받고 16:10 · 21:9 는 섞이지 않는다.
const RATIO_TOLERANCE: f64 = 0.02;

/// 일반 상한(50MB)보다 낮게 — 네트워크로 받아 메모리에 통째로 든다.
const MAX_DOWNLOAD: u64 = 30 * 1024 * 1024;

const MAX_LIST: u64 = 4 * 1024 * 1024;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const LIST_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);

/// 처음 포함.
const ATTEMPTS: usize = 2;

const MAX_REDIRECTS: usize = 3;

const USER_AGENT: &str = concat!("aynx/", env!("CARGO_PKG_VERSION"));

pub(super) struct Fetched {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq)]
struct Candidate {
    id: u64,
    url: Url,
}

/// 쓰는 칸만.
#[derive(Debug, serde::Deserialize)]
struct Post {
    id: u64,
    width: u32,
    height: u32,
    #[serde(default)]
    file_url: Option<String>,
    #[serde(default)]
    jpeg_url: Option<String>,
    #[serde(default)]
    file_size: Option<u64>,
    #[serde(default)]
    rating: Option<String>,
}

// ── 순수 함수 ──

fn big_enough(width: u32, height: u32) -> bool {
    width >= MIN_WIDTH && height >= MIN_HEIGHT
}

fn is_16_9(width: u32, height: u32) -> bool {
    if width == 0 || height == 0 {
        return false;
    }
    let ratio = f64::from(width) / f64::from(height);
    (ratio / (16.0 / 9.0) - 1.0).abs() <= RATIO_TOLERANCE
}

fn allowed_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h))
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

fn parse_allowed(raw: &str) -> Option<Url> {
    Url::parse(raw).ok().filter(allowed_url)
}

fn exceeds(cap: u64, declared: Option<u64>, received: u64) -> bool {
    declared.is_some_and(|n| n > cap) || received > cap
}

fn sniff_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn source_page(id: u64) -> String {
    format!("https://konachan.net/post/show/{id}")
}

fn list_url() -> Url {
    Url::parse_with_params(
        API_URL,
        &[("limit", PAGE.to_string().as_str()), ("tags", TAGS)],
    )
    .expect("API_URL 은 상수다")
}

fn candidate(post: &Post) -> Option<Candidate> {
    if !big_enough(post.width, post.height) || !is_16_9(post.width, post.height) {
        return None;
    }
    if post.rating.as_deref() != Some("s") {
        return None;
    }
    if post.file_size.is_some_and(|n| n > MAX_DOWNLOAD) {
        return None;
    }
    let raw = post
        .file_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .or(post.jpeg_url.as_deref())?;
    Some(Candidate {
        id: post.id,
        url: parse_allowed(raw)?,
    })
}

/// 모양이 틀린 글은 하나씩 건너뛴다. 최상위가 배열이 아니면 `None`.
fn candidates(json: &[u8]) -> Option<Vec<Candidate>> {
    let list: Vec<serde_json::Value> = serde_json::from_slice(json).ok()?;
    Some(
        list.into_iter()
            .filter_map(|v| serde_json::from_value::<Post>(v).ok())
            .filter_map(|p| candidate(&p))
            .collect(),
    )
}

// ── 네트워크 ──

/// 전용 클라이언트 — 리다이렉트 정책이 메신저 것과 달라 따로 둔다.
fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            attempt.error("too many redirects")
        } else if allowed_url(attempt.url()) {
            attempt.follow()
        } else {
            // 3xx 를 그대로 돌려받는다 → 아래 상태 검사가 실패로 만든다.
            attempt.stop()
        }
    });
    let built = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(policy)
        .build()
        .map_err(|e| tr!(ko: "HTTP 클라이언트를 만들지 못했습니다: {e}", en: "Could not create the HTTP client: {e}"))?;
    Ok(CLIENT.get_or_init(|| built))
}

fn net_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        tr!(ko: "konachan.net 응답이 너무 늦어 그만뒀습니다", en: "konachan.net took too long to respond")
    } else {
        let e = e.without_url();
        tr!(ko: "konachan.net 에 접속하지 못했습니다: {e}", en: "Could not reach konachan.net: {e}")
    }
}

async fn get_capped(url: Url, timeout: Duration, cap: u64) -> Result<Vec<u8>, String> {
    let too_big = || {
        tr!(
            ko: "받을 파일이 너무 큽니다 (최대 {max}MB)",
            en: "The file is too large (maximum {max}MB)",
            max = cap / (1024 * 1024)
        )
    };
    let mut res = client()?
        .get(url)
        .timeout(timeout)
        .send()
        .await
        .map_err(net_error)?;
    if !allowed_url(res.url()) {
        return Err(
            tr!(ko: "허용되지 않은 주소로 넘어가려 했습니다", en: "Refused a redirect to a disallowed address"),
        );
    }
    let status = res.status();
    if !status.is_success() {
        let code = status.as_u16();
        return Err(
            tr!(ko: "konachan.net 이 거절했습니다 (HTTP {code})", en: "konachan.net refused the request (HTTP {code})"),
        );
    }
    let declared = res.content_length();
    if exceeds(cap, declared, 0) {
        return Err(too_big());
    }
    let mut buf: Vec<u8> = Vec::with_capacity(declared.unwrap_or(0).min(cap) as usize);
    while let Some(chunk) = res.chunk().await.map_err(net_error)? {
        if exceeds(cap, None, (buf.len() + chunk.len()) as u64) {
            return Err(too_big());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

/// n > 0. 목록이 이미 `order:random` 이라 엄밀할 필요는 없다 — 난수 실패면 첫 번째.
fn pick_index(n: usize) -> usize {
    let mut buf = [0u8; 4];
    if getrandom::fill(&mut buf).is_err() {
        return 0;
    }
    u32::from_le_bytes(buf) as usize % n
}

pub(super) async fn fetch() -> Result<Fetched, String> {
    let mut chosen = None;
    for _ in 0..ATTEMPTS {
        let json = get_capped(list_url(), LIST_TIMEOUT, MAX_LIST).await?;
        let list = candidates(&json).ok_or_else(|| {
            tr!(ko: "konachan.net 응답을 해석하지 못했습니다", en: "Could not parse the response from konachan.net")
        })?;
        if !list.is_empty() {
            let i = pick_index(list.len());
            chosen = list.into_iter().nth(i);
            break;
        }
    }
    let Candidate { id, url } = chosen.ok_or_else(|| {
        tr!(
            ko: "조건(16:9 · 1920×1080 이상)에 맞는 그림을 찾지 못했습니다 — 잠시 뒤 다시 눌러 보세요",
            en: "No image matched (16:9, 1920×1080 or larger) — try again in a moment"
        )
    })?;

    let bytes = get_capped(url, DOWNLOAD_TIMEOUT, MAX_DOWNLOAD).await?;
    let ext = sniff_ext(&bytes).ok_or_else(|| {
        tr!(ko: "받은 파일이 그림(JPEG·PNG·WebP)이 아닙니다", en: "The downloaded file is not an image (JPEG, PNG, WebP)")
    })?;
    Ok(Fetched {
        bytes,
        ext,
        source: source_page(id),
    })
}

#[cfg(test)]
mod tests;

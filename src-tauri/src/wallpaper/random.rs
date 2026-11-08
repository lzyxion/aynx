//! 랜덤 월페이퍼 — konachan.net 에서 **16:9 · 1920×1080 이상**인 그림 하나를 받아 온다
//! (docs/log/2026-10-01-random-wallpaper.md).
//!
//! ```text
//!  GET https://konachan.net/post.json?limit=40&tags=<TAGS>      (Moebooru 글 목록, JSON 배열)
//!    → candidates(): 크기·비율·등급·파일 크기·주소(허용 호스트) 로 거른다
//!    → 하나를 무작위로 골라 file_url(없으면 jpeg_url) 을 받는다 (상한·형식 확인)
//!    → 바이트 + 확장자 + 원본 게시물 주소  ──→  wallpaper.rs 의 set_bytes (고른 파일과 같은 저장 길)
//! ```
//!
//! ## 안전장치
//!
//! - **호스트 허용 목록** [`ALLOWED_HOSTS`] — API 와 다운로드 주소 모두 https · 기본 포트 · 사용자
//!   정보 없이 이 목록의 호스트일 때만 연다. 리다이렉트도 같은 판정([`allowed_url`])을 지나야
//!   따라간다 — 응답 JSON 은 남이 정한 글자라, 그 안의 주소로 아무 데나 가게 두지 않는다.
//! - **크기 상한** [`MAX_DOWNLOAD`] — `Content-Length` 로 한 번, 받는 동안 누적으로 한 번 더
//!   ([`exceeds`]). 목록 응답에도 따로 상한([`MAX_LIST`])이 있다.
//! - **시간 상한** — 접속 [`CONNECT_TIMEOUT`] · 목록 [`LIST_TIMEOUT`] · 그림 [`DOWNLOAD_TIMEOUT`].
//! - **형식 확인** — 확장자를 응답에서 믿지 않고 받은 바이트의 머리([`sniff_ext`])로 정한다
//!   (jpg/png/webp 만). 이름은 그 뒤 wallpaper.rs 가 내용 해시로 짓는다.
//! - 버튼을 눌렀을 때만 불린다 — 자동 갱신·백그라운드 요청은 없다.

use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Url;

use crate::i18n::tr;

/// 목록 API.
const API_URL: &str = "https://konachan.net/post.json";

/// 열어도 되는 호스트. 2026-10-01 에 API 를 불러 본 결과 `file_url`·`jpeg_url`·`sample_url`·
/// `preview_url` 이 전부 `konachan.net` 아래였다(별도 정적 파일 호스트 없음, 리다이렉트도 없음).
/// 나중에 저쪽이 파일을 다른 호스트로 옮기면 받기가 "허용되지 않은 주소" 로 실패한다 —
/// 그때 확인하고 여기에 더한다(짐작으로 미리 넓히지 않는다).
const ALLOWED_HOSTS: [&str; 1] = ["konachan.net"];

/// 검색 태그 (Moebooru 문법). `ratio:16:9` 는 konachan 이 받아 주는 태그라(확인: 50건 전부 16:9)
/// 한 번에 거의 다 맞는 글이 온다. 그래도 저쪽 동작에 기대지 않고 [`candidates`] 가 다시 거른다.
/// `rating:safe` — konachan.net 은 원래 safe 만 보이는 미러지만 명시해 둔다.
const TAGS: &str = "width:>=1920 height:>=1080 ratio:16:9 rating:safe order:random";

/// 한 번에 받는 글 수. 응답 하나가 글당 약 2.5KB 라 40건이면 100KB 남짓이다.
const PAGE: u32 = 40;

/// 최소 해상도 (원본 기준).
const MIN_WIDTH: u32 = 1920;
const MIN_HEIGHT: u32 = 1080;

/// 16:9 허용 오차 (상대 ±2%). 1920×1080·2560×1440·3840×2160 같은 정확한 16:9 와,
/// 1366×768(1.7786)·1600×900 류의 반올림 해상도까지 받는다. 16:10(1.6, −10%)·21:9(2.33)는
/// 한참 밖이라 오차를 이 정도로 두어도 섞이지 않는다 — `cover` 배치에서 잘림이 눈에 안 띄는 선.
const RATIO_TOLERANCE: f64 = 0.02;

/// 받을 그림의 크기 상한. 일반 월페이퍼 상한(50MB, wallpaper.rs)보다 낮게 — 네트워크로 받는
/// 것이라 메모리에 통째로 든다. 확인 당시 100건 중 가장 큰 것이 약 27MB 였다.
const MAX_DOWNLOAD: u64 = 30 * 1024 * 1024;

/// 목록 응답의 크기 상한 — 40건이면 100KB 남짓이라 넉넉히.
const MAX_LIST: u64 = 4 * 1024 * 1024;

/// 접속(TCP+TLS) 상한.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// 목록 요청 전체 상한.
const LIST_TIMEOUT: Duration = Duration::from_secs(20);
/// 그림 받기 전체 상한 — 30MB 를 느린 회선에서도 받을 수 있게.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);

/// 후보가 없을 때 목록을 다시 부르는 횟수(처음 포함).
const ATTEMPTS: usize = 2;

/// 리다이렉트를 따라가는 최대 횟수 (허용 호스트 안에서만).
const MAX_REDIRECTS: usize = 3;

/// 요청 머리의 User-Agent — 앱 이름과 판.
const USER_AGENT: &str = concat!("aynx/", env!("CARGO_PKG_VERSION"));

/// 받아 온 결과.
pub(super) struct Fetched {
    pub bytes: Vec<u8>,
    /// 사본 확장자 — 바이트 머리로 정한 것.
    pub ext: &'static str,
    /// 원본 게시물 주소 (`https://konachan.net/post/show/<id>`).
    pub source: String,
}

/// 목록에서 고른 하나.
#[derive(Debug, Clone, PartialEq)]
struct Candidate {
    id: u64,
    url: Url,
}

/// 목록 응답의 글 하나에서 쓰는 칸만. 필드 이름은 2026-10-01 실제 응답으로 확인했다.
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

// ---------------------------------------------------------------------------
// 순수 함수 (유닛 테스트 대상)
// ---------------------------------------------------------------------------

/// 1920×1080 이상인가.
fn big_enough(width: u32, height: u32) -> bool {
    width >= MIN_WIDTH && height >= MIN_HEIGHT
}

/// 16:9 에서 상대 ±[`RATIO_TOLERANCE`] 안인가.
fn is_16_9(width: u32, height: u32) -> bool {
    if width == 0 || height == 0 {
        return false;
    }
    let ratio = f64::from(width) / f64::from(height);
    (ratio / (16.0 / 9.0) - 1.0).abs() <= RATIO_TOLERANCE
}

/// 열어도 되는 주소인가 — https · 허용 호스트 · 기본 포트 · 사용자 정보 없음.
fn allowed_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h))
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

/// 글자 → 허용 주소. 해석되지 않거나 허용 밖이면 `None`.
fn parse_allowed(raw: &str) -> Option<Url> {
    Url::parse(raw).ok().filter(allowed_url)
}

/// 크기 상한을 넘는가 — `Content-Length`(있으면)와 지금까지 받은 양 둘 다로 본다.
fn exceeds(cap: u64, declared: Option<u64>, received: u64) -> bool {
    declared.is_some_and(|n| n > cap) || received > cap
}

/// 받은 바이트의 머리로 형식을 정한다 — jpg · png · webp 만.
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

/// 원본 게시물 주소.
fn source_page(id: u64) -> String {
    format!("https://konachan.net/post/show/{id}")
}

/// 목록 요청 주소 (태그는 `Url` 이 인코딩한다).
fn list_url() -> Url {
    Url::parse_with_params(
        API_URL,
        &[("limit", PAGE.to_string().as_str()), ("tags", TAGS)],
    )
    .expect("API_URL 은 상수다")
}

/// 글 하나가 후보가 되는가 — 크기·비율·등급(`s`)·알려진 파일 크기·받을 주소(허용 호스트).
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

/// 목록 JSON → 후보들. 모양이 틀린 글은 하나씩 건너뛴다(한 글 때문에 전체를 버리지 않는다).
/// 최상위가 배열이 아니면 `None`.
fn candidates(json: &[u8]) -> Option<Vec<Candidate>> {
    let list: Vec<serde_json::Value> = serde_json::from_slice(json).ok()?;
    Some(
        list.into_iter()
            .filter_map(|v| serde_json::from_value::<Post>(v).ok())
            .filter_map(|p| candidate(&p))
            .collect(),
    )
}

// ---------------------------------------------------------------------------
// 네트워크
// ---------------------------------------------------------------------------

/// 이 기능 전용 클라이언트 — 리다이렉트 정책·User-Agent·접속 상한이 메신저 것과 달라 따로 둔다.
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

/// reqwest 오류 → 짧은 문구.
fn net_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        tr!(ko: "konachan.net 응답이 너무 늦어 그만뒀습니다", en: "konachan.net took too long to respond")
    } else {
        let e = e.without_url();
        tr!(ko: "konachan.net 에 접속하지 못했습니다: {e}", en: "Could not reach konachan.net: {e}")
    }
}

/// `url` 을 받아 바이트로 — 상태·최종 주소·크기 상한을 본다.
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

/// 0..n 사이 무작위 하나 (n > 0). 고르는 데 OS 난수를 쓴다 — 목록이 이미 `order:random` 이라
/// 엄밀할 필요는 없고, 실패하면 첫 번째.
fn pick_index(n: usize) -> usize {
    let mut buf = [0u8; 4];
    if getrandom::fill(&mut buf).is_err() {
        return 0;
    }
    u32::from_le_bytes(buf) as usize % n
}

/// 목록을 불러 후보 하나를 고르고 받는다.
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

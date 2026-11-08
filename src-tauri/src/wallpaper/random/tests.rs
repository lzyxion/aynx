use super::*;

// ── 크기·비율 ────────────────────────────────────────────────────────────

#[test]
fn ratio_accepts_16_9_and_rounded_variants() {
    for (w, h) in [
        (1920, 1080),
        (2560, 1440),
        (3840, 2160),
        (1366, 768),
        (1600, 900),
        (5120, 2880),
    ] {
        assert!(is_16_9(w, h), "{w}x{h}");
    }
}

#[test]
fn ratio_rejects_other_shapes() {
    for (w, h) in [
        (1920, 1200),
        (2560, 1080),
        (3440, 1440),
        (1080, 1920),
        (4831, 3237),
        (1, 0),
        (0, 1),
    ] {
        assert!(!is_16_9(w, h), "{w}x{h}");
    }
}

#[test]
fn ratio_tolerance_edge() {
    // 16:9 = 1.7778. +2% ≈ 1.8133, −2% ≈ 1.7422.
    assert!(is_16_9(1813, 1000));
    assert!(!is_16_9(1815, 1000));
    assert!(is_16_9(1743, 1000));
    assert!(!is_16_9(1741, 1000));
}

#[test]
fn size_floor_is_1920_by_1080() {
    assert!(big_enough(1920, 1080));
    assert!(big_enough(3840, 2160));
    assert!(!big_enough(1919, 1080));
    assert!(!big_enough(1920, 1079));
    assert!(!big_enough(1600, 900));
}

// ── 호스트 허용 ───────────────────────────────────────────────────────────

#[test]
fn allowed_urls() {
    assert!(parse_allowed("https://konachan.net/image/abc/Konachan.com%20-%201.jpg").is_some());
    assert!(parse_allowed("https://konachan.net:443/post.json").is_some()); // 기본 포트는 Url 이 접는다
    assert!(allowed_url(&list_url()));
}

#[test]
fn disallowed_urls() {
    for raw in [
        "http://konachan.net/image/a.jpg",         // https 만
        "https://konachan.com/image/a.jpg",        // 다른 도메인
        "https://evil.example/konachan.net/a.jpg", // 경로에 끼운 이름
        "https://konachan.net.evil.example/a.jpg", // 접미 속임
        "https://sub.konachan.net/a.jpg",          // 하위 호스트도 목록 밖
        "https://konachan.net:8443/a.jpg",         // 다른 포트
        "https://user:pw@konachan.net/a.jpg",      // 사용자 정보
        "file:///C:/Windows/win.ini",
        "not a url",
        "",
    ] {
        assert!(parse_allowed(raw).is_none(), "{raw}");
    }
}

// ── 크기 상한 ─────────────────────────────────────────────────────────────

#[test]
fn cap_checks_declared_and_received() {
    let cap = 100;
    assert!(!exceeds(cap, None, 0));
    assert!(!exceeds(cap, Some(100), 100));
    assert!(exceeds(cap, Some(101), 0)); // Content-Length 만으로 거절
    assert!(exceeds(cap, None, 101)); // 머리가 없거나 거짓이어도 누적으로 거절
    assert!(exceeds(cap, Some(10), 101));
    assert_eq!(MAX_DOWNLOAD, 30 * 1024 * 1024);
}

// ── 형식 확인 ─────────────────────────────────────────────────────────────

#[test]
fn sniff_known_formats() {
    assert_eq!(sniff_ext(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]), Some("jpg"));
    assert_eq!(sniff_ext(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"), Some("png"));
    assert_eq!(sniff_ext(b"RIFF\x10\0\0\0WEBPVP8 "), Some("webp"));
}

#[test]
fn sniff_rejects_others() {
    assert_eq!(sniff_ext(b""), None);
    assert_eq!(sniff_ext(b"<!DOCTYPE html><html>"), None); // 오류 페이지
    assert_eq!(sniff_ext(b"<svg xmlns="), None);
    assert_eq!(sniff_ext(b"GIF89a"), None); // 이 길에서는 받지 않는다
    assert_eq!(sniff_ext(b"RIFF\0\0\0\0WAVE"), None);
    assert_eq!(sniff_ext(b"RIFF"), None);
}

// ── 목록 → 후보 ───────────────────────────────────────────────────────────

fn post_json(
    id: u64,
    w: u32,
    h: u32,
    file_url: Option<&str>,
    jpeg_url: Option<&str>,
    size: u64,
    rating: &str,
) -> serde_json::Value {
    serde_json::json!({
        "id": id, "width": w, "height": h,
        "file_url": file_url, "jpeg_url": jpeg_url,
        "file_size": size, "rating": rating,
        "tags": "sky", "md5": "x"
    })
}

#[test]
fn candidates_filter_everything() {
    let ok = "https://konachan.net/image/a/1.png";
    let list = serde_json::json!([
        post_json(1, 1920, 1080, Some(ok), None, 1000, "s"), // 남는다
        post_json(2, 1920, 1200, Some(ok), None, 1000, "s"), // 16:10
        post_json(3, 1600, 900, Some(ok), None, 1000, "s"),  // 작다
        post_json(4, 2560, 1440, Some(ok), None, 1000, "q"), // 등급
        post_json(5, 2560, 1440, Some(ok), None, MAX_DOWNLOAD + 1, "s"), // 너무 크다
        post_json(
            6,
            2560,
            1440,
            Some("https://evil.example/a.png"),
            None,
            1,
            "s"
        ), // 호스트
        post_json(
            7,
            3840,
            2160,
            None,
            Some("https://konachan.net/jpeg/7.jpg"),
            1,
            "s"
        ), // jpeg_url 로 폴백
        post_json(
            8,
            3840,
            2160,
            Some(""),
            Some("https://konachan.net/jpeg/8.jpg"),
            1,
            "s"
        ), // 빈 file_url 도 폴백
        post_json(9, 3840, 2160, None, None, 1, "s"),        // 주소 없음
        serde_json::json!({"id": 10, "width": "wide"}),      // 모양이 틀림 → 건너뜀
    ]);
    let got = candidates(list.to_string().as_bytes()).expect("배열");
    let ids: Vec<u64> = got.iter().map(|c| c.id).collect();
    assert_eq!(ids, vec![1, 7, 8]);
    assert_eq!(got[1].url.as_str(), "https://konachan.net/jpeg/7.jpg");
}

#[test]
fn candidates_rejects_non_array() {
    assert!(candidates(b"{\"success\":false}").is_none());
    assert!(candidates(b"not json").is_none());
    assert_eq!(candidates(b"[]"), Some(vec![]));
}

#[test]
fn list_url_encodes_tags() {
    let url = list_url();
    assert_eq!(url.host_str(), Some("konachan.net"));
    assert_eq!(url.path(), "/post.json");
    let tags = url
        .query_pairs()
        .find(|(k, _)| k == "tags")
        .map(|(_, v)| v.into_owned());
    assert_eq!(tags.as_deref(), Some(TAGS));
    assert!(!url.as_str().contains(' '));
}

#[test]
fn source_page_shape() {
    assert_eq!(source_page(402477), "https://konachan.net/post/show/402477");
}

#[test]
fn pick_index_in_range() {
    for n in [1, 2, 7, 40] {
        for _ in 0..20 {
            assert!(pick_index(n) < n);
        }
    }
}

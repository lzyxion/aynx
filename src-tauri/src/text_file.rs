//! 문서 보기 타일이 받는 파일 한 장 — 로컬 · 원격 읽기가 같은 모양을 돌려주게 조립을 한 곳에 둔다.
//!
//! [`TextFile`] 에는 `Debug` 를 붙이지 않는다 — 파일 내용이 로그 · 오류 문구에 실리는 길을 타입에서 막는다.

use serde::Serialize;
use sha1::{Digest, Sha1};

use crate::i18n::tr;

/// 두 읽기 모두 앞 이만큼만 읽는다(통째로 읽고 자르지 않는다).
pub(crate) const VIEW_MAX_BYTES: u64 = 2 * 1024 * 1024;

/// 프런트 `browser/preview.ts` 의 `PREVIEW_MAX_BYTES` 와 같은 값. 통째로 옮기는 길이라 잘라 읽을 수 없다 — 잘린 그림은 그림이 아니다.
pub(crate) const PREVIEW_MAX_BYTES: u64 = 20 * 1024 * 1024;

pub(crate) fn preview_too_large(shown: &str) -> String {
    tr!(
        ko: "{shown} 은(는) 너무 커서 미리 보지 않습니다",
        en: "{shown} is too large to preview",
    )
}

/// 이미지 타일 전용 — 프런트 `image/read-plan.ts` 의 `IMAGE_MAX_BYTES` 와 같은 값.
pub(crate) const IMAGE_MAX_BYTES: u64 = 1024 * 1024 * 1024;

pub(crate) fn image_too_large(shown: &str) -> String {
    tr!(
        ko: "{shown} 은(는) 너무 커서 열지 않습니다",
        en: "{shown} is too large to open",
    )
}

/// 이 안에 NUL 이 있으면 이진 파일로 본다(git 과 같은 규칙).
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

/// **`Debug` 를 붙이지 않는다**(모듈 주석).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub(crate) text: String,
    /// 파일 **전체** 크기 — 잘렸으면 읽은 양보다 크다.
    pub(crate) size: u64,
    pub(crate) truncated: bool,
    pub(crate) binary: bool,
    pub(crate) lossy: bool,
    /// 충돌 확인 키(불투명) — 프런트는 비교만 한다.
    pub(crate) version: String,
}

/// 끝에서 쪼개진 UTF-8 글자의 바이트 수 — 상한 자리에서 자른 글자를 lossy 로 세면 멀쩡한 파일에 lossy 띠가 뜬다.
fn split_tail_len(bytes: &[u8]) -> usize {
    for back in 1..=bytes.len().min(3) {
        let byte = bytes[bytes.len() - back];
        if byte & 0b1100_0000 == 0b1000_0000 {
            continue;
        }
        let need = match byte {
            b if b & 0b1110_0000 == 0b1100_0000 => 2,
            b if b & 0b1111_0000 == 0b1110_0000 => 3,
            b if b & 0b1111_1000 == 0b1111_0000 => 4,
            _ => 1, // ASCII 거나 선두가 될 수 없는 바이트 — 쪼개진 것이 아니다
        };
        return if need > back { back } else { 0 };
    }
    0
}

/// `size` 가 읽은 양보다 작으면(읽는 사이 파일이 자랐다) 읽은 양을 크기로 삼는다.
pub(crate) fn assemble(bytes: &[u8], size: u64) -> TextFile {
    let read = bytes.len() as u64;
    let size = size.max(read);
    let truncated = size > read;
    let version = version_of(bytes, size);

    let sniff = &bytes[..bytes.len().min(BINARY_SNIFF_BYTES)];
    if sniff.contains(&0) {
        return TextFile {
            text: String::new(),
            size,
            truncated,
            binary: true,
            lossy: false,
            version,
        };
    }

    let body = if truncated {
        &bytes[..bytes.len() - split_tail_len(bytes)]
    } else {
        bytes
    };
    let (text, lossy) = match String::from_utf8_lossy(body) {
        std::borrow::Cow::Borrowed(text) => (text.to_string(), false),
        std::borrow::Cow::Owned(text) => (text, true),
    };
    TextFile {
        text,
        size,
        truncated,
        binary: false,
        lossy,
        version,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 읽기와 저장이 **같은 함수**를 지나야 "저장이 돌려준 version == 다음 읽기의 version" 이 성립한다.
pub(crate) fn version_of(bytes: &[u8], size: u64) -> String {
    let size = size.max(bytes.len() as u64);
    format!("{}:{size}", hex(&Sha1::digest(bytes)))
}

// ---------------------------------------------------------------------------
// 저장
// ---------------------------------------------------------------------------

/// 파일 내용을 싣지 않으므로(version 은 해시다) [`TextFile`] 과 달리 `Debug` 를 붙여도 된다.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    pub(crate) version: String,
    pub(crate) size: u64,
}

pub(crate) fn saved(bytes: &[u8]) -> SavedFile {
    SavedFile {
        version: version_of(bytes, bytes.len() as u64),
        size: bytes.len() as u64,
    }
}

/// 상한을 넘는 글을 받아 두면 다음 열기에서 잘린 보기로만 열려 다시 편집할 수 없다.
pub(crate) fn check_save_size(text: &str) -> Result<(), String> {
    let len = text.len() as u64;
    if len > VIEW_MAX_BYTES {
        return Err(tr!(
            ko: "저장할 내용이 너무 큽니다 ({len} 바이트) — 편집 저장은 {max} 바이트까지입니다",
            en: "The content is too large to save ({len} bytes) — saving an edit supports up to {max} bytes",
            max = VIEW_MAX_BYTES
        ));
    }
    Ok(())
}

/// 전체가 상한을 넘으면 **다르다**(편집 가능한 파일은 상한 이하였다).
pub(crate) fn matches_expected(head: &[u8], size: u64, expected: &str) -> bool {
    size <= VIEW_MAX_BYTES && head.len() as u64 >= size && version_of(head, size) == expected
}

/// 원자적 교체용 같은 폴더의 임시 이름 — 점으로 시작해 목록에서 숨고, 프로세스 · 호출마다 달라 두 저장이 같은 임시 파일을 밟지 않는다.
pub(crate) fn save_temp_name(name: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
    format!(".{name}.aynx-save-{}-{serial}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_utf8_is_whole_and_clean() {
        let file = assemble("안녕\nhello".as_bytes(), 12);
        assert_eq!(file.text, "안녕\nhello");
        assert_eq!(file.size, 12);
        assert!(!file.truncated && !file.binary && !file.lossy);
    }

    #[test]
    fn nul_in_first_8k_is_binary_with_empty_text() {
        let mut bytes = b"abc".to_vec();
        bytes.push(0);
        let file = assemble(&bytes, 4);
        assert!(file.binary);
        assert_eq!(file.text, "");
        assert!(!file.lossy);
    }

    #[test]
    fn nul_after_8k_is_not_binary() {
        let mut bytes = vec![b'a'; BINARY_SNIFF_BYTES];
        bytes.push(0);
        let file = assemble(&bytes, bytes.len() as u64);
        assert!(!file.binary);
    }

    #[test]
    fn invalid_utf8_is_lossy() {
        let file = assemble(&[b'a', 0xff, b'b'], 3);
        assert!(file.lossy);
        assert_eq!(file.text, "a\u{fffd}b");
    }

    #[test]
    fn truncated_when_file_is_bigger_than_read() {
        let file = assemble(b"abc", 10);
        assert!(file.truncated);
        assert_eq!(file.size, 10);
    }

    #[test]
    fn size_never_below_bytes_read() {
        let file = assemble(b"abcdef", 3);
        assert_eq!(file.size, 6);
        assert!(!file.truncated);
    }

    #[test]
    fn split_char_at_cut_is_not_lossy() {
        let mut bytes = b"ab".to_vec();
        bytes.extend_from_slice(&[0xED, 0x95]);
        let file = assemble(&bytes, 100);
        assert!(file.truncated);
        assert!(!file.lossy);
        assert_eq!(file.text, "ab");
    }

    #[test]
    fn split_char_without_truncation_is_lossy() {
        let file = assemble(&[b'a', 0xED, 0x95], 3);
        assert!(file.lossy);
    }

    #[test]
    fn split_tail_len_cases() {
        assert_eq!(split_tail_len(b""), 0);
        assert_eq!(split_tail_len(b"abc"), 0);
        assert_eq!(split_tail_len("한".as_bytes()), 0);
        assert_eq!(split_tail_len(&[b'a', 0xED]), 1);
        assert_eq!(split_tail_len(&[b'a', 0xED, 0x95]), 2);
        assert_eq!(split_tail_len(&[0xF0, 0x9F, 0x98]), 3);
        assert_eq!(split_tail_len("😀".as_bytes()), 0);
    }

    #[test]
    fn version_is_stable_and_tracks_content_and_size() {
        let a = assemble(b"hello", 5);
        let b = assemble(b"hello", 5);
        assert_eq!(a.version, b.version);
        assert_eq!(a.version, "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d:5");
        assert_ne!(a.version, assemble(b"hellp", 5).version);
        assert_ne!(a.version, assemble(b"hello", 9).version);
    }

    #[test]
    fn saved_version_equals_the_next_read_version() {
        let bytes = "새 내용
"
        .as_bytes();
        let saved = saved(bytes);
        let read = assemble(bytes, bytes.len() as u64);
        assert_eq!(saved.version, read.version);
        assert_eq!(saved.size, bytes.len() as u64);
    }

    #[test]
    fn matches_expected_cases() {
        let v = assemble(b"hello", 5).version;
        assert!(matches_expected(b"hello", 5, &v));
        assert!(!matches_expected(b"hellp", 5, &v));
        assert!(!matches_expected(b"hello", 9, &v));
        let big = vec![b'x'; VIEW_MAX_BYTES as usize];
        let big_v = version_of(&big, VIEW_MAX_BYTES + 1);
        assert!(!matches_expected(&big, VIEW_MAX_BYTES + 1, &big_v));
    }

    #[test]
    fn save_size_limit() {
        assert!(check_save_size("abc").is_ok());
        let exact = "x".repeat(VIEW_MAX_BYTES as usize);
        assert!(check_save_size(&exact).is_ok());
        assert!(check_save_size(&format!("{exact}y")).is_err());
    }

    #[test]
    fn save_temp_names_are_hidden_and_distinct() {
        let a = save_temp_name("a.md");
        let b = save_temp_name("a.md");
        assert!(a.starts_with(".a.md.aynx-save-"), "{a}");
        assert_ne!(a, b);
    }

    #[test]
    fn serializes_camel_case() {
        let json = serde_json::to_value(assemble(b"x", 1)).unwrap();
        for key in ["text", "size", "truncated", "binary", "lossy", "version"] {
            assert!(json.get(key).is_some(), "{key}");
        }
    }
}

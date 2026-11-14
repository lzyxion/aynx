//! **문서 보기 타일이 받는 파일 한 장** — 로컬(`local_read_text`)과 원격(`sftp_read_text`)이
//! 같은 모양을 돌려주도록 조립을 여기 한 곳에 둔다.
//!
//! ```text
//!   읽은 바이트(앞 VIEW_MAX_BYTES 까지) + 파일 전체 크기
//!        │
//!        └─ assemble ─→ TextFile { text, size, truncated, binary, lossy, version }
//! ```
//!
//! 읽기 자체는 두 명령이 각자 한다 — 로컬은 `std::fs`, 원격은 SFTP 핸들이라 공유할 것이
//! 없다. 두 쪽 모두 **앞 [`VIEW_MAX_BYTES`] 만** 읽는다(큰 파일을 통째로 읽고 자르지 않는다).
//!
//! ## 내용은 밖으로 새지 않는다
//!
//! [`TextFile`] 에는 `Debug` 를 붙이지 않는다 — 파일 내용이 로그·오류 문구에 실리는 길을
//! 타입에서 막는다. 프런트로 가는 직렬화 하나만 연다.

use serde::Serialize;
use sha1::{Digest, Sha1};

use crate::i18n::tr;

/// 보기용으로 읽는 최대 바이트 (2 MiB). 넘으면 앞부분만 보이고 `truncated` 가 참이다.
pub(crate) const VIEW_MAX_BYTES: u64 = 2 * 1024 * 1024;

/// 파일 타일 **미리 보기 패널**이 바이트로 받아 가는 파일의 상한 (docs/log/2026-10-07-file-tile-dolphin.md "10").
/// 프런트 `browser/preview.ts` 의 `PREVIEW_MAX_BYTES` 와 같은 값 — 넘으면 프런트가 아예 묻지 않고("너무 커서 미리 보지
/// 않음"), 여기서도 한 번 더 막는다(목록을 읽은 뒤 파일이 커졌을 수 있다). 그림 한 장을 IPC 로 통째로 옮기는 길이라
/// 문서 보기(2 MiB 앞부분)와 달리 잘라 읽을 수 없다 — 잘린 그림은 그림이 아니다.
pub(crate) const PREVIEW_MAX_BYTES: u64 = 20 * 1024 * 1024;

/// 상한을 넘은 파일의 거절 문구 (로컬 · 원격 공용)
pub(crate) fn preview_too_large(shown: &str) -> String {
    tr!(
        ko: "{shown} 은(는) 너무 커서 미리 보지 않습니다",
        en: "{shown} is too large to preview",
    )
}

/// **이미지 타일**이 조각 단위로 받아 가는 그림의 상한(1 GiB) — `local_read_image` · `sftp_read_image` 에만 쓴다.
/// 미리 보기 패널 · `*_read_preview` 의 [`PREVIEW_MAX_BYTES`] 는 그대로다. 프런트 `image/read-plan.ts` 의 `IMAGE_MAX_BYTES` 와
/// 같은 값 — 넘으면 프런트가 묻지 않고, 여기서도 읽는 도중 한 번 더 막는다(그사이 파일이 커졌을 수 있다).
pub(crate) const IMAGE_MAX_BYTES: u64 = 1024 * 1024 * 1024;

/// [`IMAGE_MAX_BYTES`] 를 넘은 그림의 거절 문구 (로컬 · 원격 공용)
pub(crate) fn image_too_large(shown: &str) -> String {
    tr!(
        ko: "{shown} 은(는) 너무 커서 열지 않습니다",
        en: "{shown} is too large to open",
    )
}

/// 이진 판정에 보는 앞부분 (8 KiB) — 그 안에 NUL 이 있으면 이진 파일로 본다(git 과 같은 규칙).
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

/// 문서 보기 타일이 받는 값. **`Debug` 를 붙이지 않는다**(모듈 주석).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    /// UTF-8 로 푼 내용(아닌 바이트는 대체 문자). 이진이면 `""`.
    pub(crate) text: String,
    /// 파일 **전체** 크기 — 잘렸으면 읽은 양보다 크다.
    pub(crate) size: u64,
    /// [`VIEW_MAX_BYTES`] 에서 잘렸는가.
    pub(crate) truncated: bool,
    /// 앞 8 KiB 에 NUL 이 있었는가.
    pub(crate) binary: bool,
    /// UTF-8 이 아닌 바이트가 있었는가 (잘린 끝에서 쪼개진 글자 하나는 세지 않는다).
    pub(crate) lossy: bool,
    /// 충돌 확인 키(불투명) — `sha1(읽은 바이트) hex` + `:` + 전체 크기. 프런트는 비교만 한다.
    pub(crate) version: String,
}

/// 끝에서 **쪼개진 UTF-8 글자**의 바이트 수 (0~3).
///
/// 2 MiB 자리에서 자르면 한글 한 글자(3바이트)가 둘로 갈릴 수 있다 — 그것을 "UTF-8 이
/// 아니다" 로 세면 멀쩡한 파일에 lossy 띠가 뜬다. 그래서 잘린 경우에만 이 꼬리를 떼고 푼다.
fn split_tail_len(bytes: &[u8]) -> usize {
    // 뒤에서 최대 3바이트 안에 선두 바이트를 찾는다 (이어짐 바이트는 10xxxxxx).
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

/// 읽은 바이트와 파일 전체 크기로 [`TextFile`] 을 짓는다 (순수 함수).
///
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

/// [`TextFile::version`] 의 계산 한 곳 — 읽기([`assemble`])와 저장(충돌 확인·새 version)이
/// **같은 함수**를 지나야 "저장이 돌려준 version == 다음 읽기의 version" 이 성립한다.
///
/// `size` 가 읽은 양보다 작으면 읽은 양을 쓴다([`assemble`] 의 규칙과 같다).
pub(crate) fn version_of(bytes: &[u8], size: u64) -> String {
    let size = size.max(bytes.len() as u64);
    format!("{}:{size}", hex(&Sha1::digest(bytes)))
}

// ---------------------------------------------------------------------------
// 저장 (문서 편집 E1 — docs/log/2026-09-27-doc-edit.md "R — 저장 명령")
// ---------------------------------------------------------------------------

/// 저장이 돌려주는 값 — **새 내용의** `version`(다음 저장의 `expectedVersion`)과 크기.
/// 파일 내용을 싣지 않으므로(version 은 해시다) [`TextFile`] 과 달리 `Debug` 를 붙여도 된다.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    pub(crate) version: String,
    pub(crate) size: u64,
}

/// 방금 쓴 바이트의 [`SavedFile`] — 다시 읽지 않고 계산한다(쓴 것이 곧 디스크의 내용이다).
pub(crate) fn saved(bytes: &[u8]) -> SavedFile {
    SavedFile {
        version: version_of(bytes, bytes.len() as u64),
        size: bytes.len() as u64,
    }
}

/// 저장할 글이 상한([`VIEW_MAX_BYTES`])을 넘는가 — 넘으면 거절 문구.
///
/// 편집은 잘리지 않은 파일(= 2 MiB 이하)에서만 시작하므로, 넘는 글은 편집 중에 불어난
/// 것이다. 그 크기를 받아 두면 다음 열기에서 잘린 보기로만 열려 다시 편집할 수 없다.
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

/// 디스크의 지금 내용(앞 [`VIEW_MAX_BYTES`] 와 전체 크기)이 편집을 시작할 때의 `expected` 와
/// 같은가. 전체가 상한을 넘으면 **다르다**(편집 가능한 파일은 상한 이하였다).
pub(crate) fn matches_expected(head: &[u8], size: u64, expected: &str) -> bool {
    size <= VIEW_MAX_BYTES && head.len() as u64 >= size && version_of(head, size) == expected
}

/// 원자적 교체에 쓰는 **같은 폴더의 임시 파일 이름** — `.{이름}.aynx-save-{pid}-{번호}`.
///
/// 점으로 시작해 목록에서 숨고, 프로세스·호출마다 달라 두 저장이 같은 임시 파일을 밟지
/// 않는다(만들 때는 늘 "새로 만들기 전용" 이라 남의 파일을 덮지도 않는다).
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
        // "한" = ED 95 9C — 앞 두 바이트만 읽고 잘렸다.
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
        // 읽은 것보다 파일이 크다(상한에서 잘렸다) — 같다고 보지 않는다.
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

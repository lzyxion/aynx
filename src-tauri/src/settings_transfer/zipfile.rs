//! **설정 묶음의 zip 한 장** — `flate2` 위의 작은 구현(zip 크레이트를 들이지 않는다). 받은 파일은 믿지 않는다:
//! 경로 탈출 · 크기 상한(압축 폭탄은 풀면서 상한 + 1 바이트에서 멈춘다) · 암호화 · zip64 · 모르는 압축 방식 · CRC 오류는 거절.
//! 경로를 디스크에 풀지 않는다 — 이름과 바이트만 돌려주고 어디에 쓸지는 허용 목록(`catalog`)이 정한다.

use std::io::{Read, Write};

use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::{Compression, Crc};

use crate::i18n::tr;

pub(crate) const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
pub(crate) const MAX_ENTRIES: usize = 4096;
/// 풀린 크기 — `wallpaper.rs` 의 월페이퍼 상한보다 넉넉해야 한다.
pub(crate) const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
pub(crate) const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

const LOCAL_SIG: u32 = 0x0403_4b50;
const CENTRAL_SIG: u32 = 0x0201_4b50;
const END_SIG: u32 = 0x0605_4b50;
/// 일반 목적 비트 11 — 이름이 UTF-8.
const FLAG_UTF8: u16 = 0x0800;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Entry {
    pub name: String,
    pub bytes: Vec<u8>,
}

pub(crate) fn safe_entry_path(name: &str) -> Result<&str, String> {
    let bad = || tr!(ko: "묶음 안의 경로가 올바르지 않습니다: {name}", en: "The bundle has an unsafe path: {name}");
    if name.is_empty() || name.len() > 512 || name.contains('\\') || name.contains(':') || name.starts_with('/') {
        return Err(bad());
    }
    if name.chars().any(char::is_control) {
        return Err(bad());
    }
    if name.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..") {
        return Err(bad());
    }
    Ok(name)
}

fn dos_time_date(now: chrono::DateTime<chrono::Local>) -> (u16, u16) {
    use chrono::{Datelike, Timelike};
    let year = now.year().clamp(1980, 2107) as u16;
    let date = ((year - 1980) << 9) | ((now.month() as u16) << 5) | now.day() as u16;
    let time = ((now.hour() as u16) << 11) | ((now.minute() as u16) << 5) | (now.second() as u16 / 2);
    (time, date)
}

fn put16(out: &mut Vec<u8>, v: u16) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn put32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

/// 항목들을 zip 한 장의 바이트로 만든다(deflate). 이름은 [`safe_entry_path`] 를 통과해야 한다.
pub(crate) fn write(entries: &[Entry]) -> Result<Vec<u8>, String> {
    let (time, date) = dos_time_date(chrono::Local::now());
    let mut out = Vec::new();
    let mut central = Vec::new();
    if entries.len() > MAX_ENTRIES {
        return Err(tr!(ko: "담을 파일이 너무 많습니다", en: "There are too many files to bundle"));
    }
    for e in entries {
        safe_entry_path(&e.name)?;
        let too_big = || tr!(ko: "파일이 너무 큽니다: {name}", en: "A file is too large: {name}", name = e.name);
        if e.bytes.len() as u64 > MAX_ENTRY_BYTES {
            return Err(too_big());
        }
        let mut crc = Crc::new();
        crc.update(&e.bytes);
        let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&e.bytes).map_err(|err| err.to_string())?;
        let packed = enc.finish().map_err(|err| err.to_string())?;
        let offset = u32::try_from(out.len()).map_err(|_| too_big())?;
        let name = e.name.as_bytes();
        let fields = |buf: &mut Vec<u8>| {
            put16(buf, 20); // 풀 때 필요한 판
            put16(buf, FLAG_UTF8);
            put16(buf, 8); // deflate
            put16(buf, time);
            put16(buf, date);
            put32(buf, crc.sum());
            put32(buf, packed.len() as u32);
            put32(buf, e.bytes.len() as u32);
            put16(buf, name.len() as u16);
            put16(buf, 0); // 덧붙임 칸 없음
        };
        put32(&mut out, LOCAL_SIG);
        fields(&mut out);
        out.extend_from_slice(name);
        out.extend_from_slice(&packed);

        put32(&mut central, CENTRAL_SIG);
        put16(&mut central, 20); // 만든 판
        fields(&mut central);
        put16(&mut central, 0); // 주석 길이
        put16(&mut central, 0); // 시작 디스크
        put16(&mut central, 0); // 내부 속성
        put32(&mut central, 0); // 외부 속성
        put32(&mut central, offset);
        central.extend_from_slice(name);
    }
    let cd_offset = out.len() as u32;
    let cd_size = central.len() as u32;
    out.extend_from_slice(&central);
    put32(&mut out, END_SIG);
    put16(&mut out, 0);
    put16(&mut out, 0);
    put16(&mut out, entries.len() as u16);
    put16(&mut out, entries.len() as u16);
    put32(&mut out, cd_size);
    put32(&mut out, cd_offset);
    put16(&mut out, 0);
    Ok(out)
}

fn rd16(b: &[u8], at: usize) -> Option<u16> {
    b.get(at..at + 2).map(|s| u16::from_le_bytes([s[0], s[1]]))
}

fn rd32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn broken() -> String {
    tr!(ko: "zip 파일이 아니거나 깨졌습니다", en: "This is not a zip file, or it is damaged")
}

/// zip 한 장을 읽어 항목들을 돌려준다(폴더 항목은 건너뜀). 머리말의 거절 규칙을 모두 본다.
pub(crate) fn read(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(tr!(ko: "파일이 너무 큽니다", en: "The file is too large"));
    }
    // 끝 레코드 — 주석(최대 65535)을 넘어 뒤에서 찾는다.
    let min = bytes.len().saturating_sub(22 + 65_535);
    let end = (min..=bytes.len().saturating_sub(22))
        .rev()
        .find(|&i| rd32(bytes, i) == Some(END_SIG))
        .ok_or_else(broken)?;
    let count = rd16(bytes, end + 10).ok_or_else(broken)? as usize;
    let cd_size = rd32(bytes, end + 12).ok_or_else(broken)? as usize;
    let cd_offset = rd32(bytes, end + 16).ok_or_else(broken)? as usize;
    if count > MAX_ENTRIES {
        return Err(tr!(ko: "묶음 안의 파일이 너무 많습니다", en: "The bundle has too many files"));
    }
    if cd_offset.checked_add(cd_size).is_none_or(|e| e > end) {
        return Err(broken());
    }
    let mut at = cd_offset;
    let mut total: u64 = 0;
    let mut out: Vec<Entry> = Vec::new();
    for _ in 0..count {
        if rd32(bytes, at) != Some(CENTRAL_SIG) {
            return Err(broken());
        }
        let flags = rd16(bytes, at + 8).ok_or_else(broken)?;
        let method = rd16(bytes, at + 10).ok_or_else(broken)?;
        let crc = rd32(bytes, at + 16).ok_or_else(broken)?;
        let csize = rd32(bytes, at + 20).ok_or_else(broken)?;
        let usize_ = rd32(bytes, at + 24).ok_or_else(broken)?;
        let name_len = rd16(bytes, at + 28).ok_or_else(broken)? as usize;
        let extra_len = rd16(bytes, at + 30).ok_or_else(broken)? as usize;
        let comment_len = rd16(bytes, at + 32).ok_or_else(broken)? as usize;
        let local = rd32(bytes, at + 42).ok_or_else(broken)? as usize;
        let name_bytes = bytes.get(at + 46..at + 46 + name_len).ok_or_else(broken)?;
        at += 46 + name_len + extra_len + comment_len;

        if flags & 0x0001 != 0 || flags & 0x0040 != 0 {
            return Err(tr!(ko: "암호가 걸린 zip 은 읽지 않습니다", en: "Encrypted zip files are not supported"));
        }
        if csize == u32::MAX || usize_ == u32::MAX {
            return Err(tr!(ko: "zip64 묶음은 읽지 않습니다", en: "zip64 bundles are not supported"));
        }
        let name = std::str::from_utf8(name_bytes).map_err(|_| broken())?.to_string();
        if name.ends_with('/') {
            continue; // 폴더 항목 — 담긴 것이 없다
        }
        safe_entry_path(&name)?;
        if out.iter().any(|e| e.name == name) {
            return Err(tr!(ko: "묶음 안에 같은 경로가 둘 있습니다: {name}", en: "The bundle has the same path twice: {name}"));
        }
        if u64::from(usize_) > MAX_ENTRY_BYTES {
            return Err(tr!(ko: "묶음 안의 파일이 너무 큽니다: {name}", en: "A file in the bundle is too large: {name}"));
        }
        total += u64::from(usize_);
        if total > MAX_TOTAL_BYTES {
            return Err(tr!(ko: "묶음을 풀면 너무 큽니다", en: "The bundle is too large once unpacked"));
        }

        if rd32(bytes, local) != Some(LOCAL_SIG) {
            return Err(broken());
        }
        let lname = rd16(bytes, local + 26).ok_or_else(broken)? as usize;
        let lextra = rd16(bytes, local + 28).ok_or_else(broken)? as usize;
        let start = local + 30 + lname + lextra;
        let data = bytes.get(start..start + csize as usize).ok_or_else(broken)?;
        let plain = match method {
            0 => data.to_vec(),
            8 => {
                let mut buf = Vec::new();
                DeflateDecoder::new(data)
                    .take(u64::from(usize_) + 1)
                    .read_to_end(&mut buf)
                    .map_err(|_| broken())?;
                buf
            }
            _ => return Err(tr!(ko: "모르는 압축 방식입니다: {name}", en: "Unknown compression method: {name}")),
        };
        if plain.len() as u64 != u64::from(usize_) {
            return Err(broken());
        }
        let mut check = Crc::new();
        check.update(&plain);
        if check.sum() != crc {
            return Err(broken());
        }
        out.push(Entry { name, bytes: plain });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, bytes: &[u8]) -> Entry {
        Entry { name: name.into(), bytes: bytes.to_vec() }
    }

    #[test]
    fn round_trips() {
        let entries = vec![entry("manifest.json", b"{}"), entry("config/settings.toml", "[app]\nx = \"한글\"\n".as_bytes())];
        let zip = write(&entries).unwrap();
        assert_eq!(read(&zip).unwrap(), entries);
    }

    #[test]
    fn rejects_escaping_paths() {
        for bad in ["../x", "a/../b", "/abs", "C:/win", "a\\b", "", "a//b", "./a", "a/\u{1}"] {
            assert!(safe_entry_path(bad).is_err(), "{bad:?}");
        }
        assert!(safe_entry_path("config/app-icons/user-1.png").is_ok());
        // 쓰는 쪽도 막는다 — 탈출 이름은 묶음에 들어가지 못한다.
        assert!(write(&[entry("../evil", b"x")]).is_err());
    }

    /// 다른 도구가 만든 zip 의 탈출 이름도 읽기에서 막힌다(이름만 바꿔 끼운 바이트).
    #[test]
    fn read_rejects_escaping_entry() {
        let zip = write(&[entry("aa/evil", b"x")]).unwrap();
        let patched: Vec<u8> = {
            let mut z = zip.clone();
            let needle = b"aa/evil";
            let mut i = 0;
            while i + needle.len() <= z.len() {
                if &z[i..i + needle.len()] == needle {
                    z[i..i + needle.len()].copy_from_slice(b"../evil");
                }
                i += 1;
            }
            z
        };
        assert!(read(&patched).is_err());
    }

    #[test]
    fn rejects_garbage_and_bad_crc() {
        assert!(read(b"not a zip").is_err());
        let mut zip = write(&[entry("a.txt", b"hello hello hello")]).unwrap();
        // CRC 칸(로컬 머리 14..18)과 중앙 목록 CRC 를 같이 깨면 내용 검증에서 걸린다.
        let cd = zip.len() - 22 - (46 + 5);
        zip[cd + 16] ^= 0xff;
        assert!(read(&zip).is_err());
    }

    #[test]
    fn rejects_duplicate_names() {
        let zip = write(&[entry("a", b"1"), entry("a", b"2")]).unwrap();
        assert!(read(&zip).is_err());
    }
}

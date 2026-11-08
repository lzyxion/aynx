//! **PostgreSQL 결과 칸 → [`Cell`]** — tokio-postgres 는 결과를 늘 **바이너리 형식**으로 받는다. 형마다 크레이트 기능(chrono·
//! uuid·serde_json …)을 켜는 대신 바이너리 표현을 여기서 직접 푼다(쿼리 타일 7단계 — 새 의존 없음). 모두 **순수 함수**이고
//! **패닉하지 않는다** — 모양이 어긋난 바이트·모르는 형은 `‹형 이름›` 글자로 떨어진다.
//!
//! | 형 | 칸 |
//! | --- | --- |
//! | bool | 참/거짓 |
//! | int2 · int4 · int8 · oid · xid · cid | 정수(±2^53 밖이면 `value::to_json` 이 문자열로) |
//! | float4 · float8 | 실수(NaN · ±무한은 문자열) — float4 는 짧은 표기를 거쳐 f64 로(0.1 → 0.1) |
//! | numeric | **문자열**(정밀도 보존 — base-10000 자리를 직접 펼친다 · NaN · ±Infinity) |
//! | text · varchar · bpchar · name · unknown · xml · json · citext · 열거형 | 글자 |
//! | jsonb · jsonpath | 글자(판 바이트 1 을 뗀다) |
//! | uuid | `8-4-4-4-12` 글자 |
//! | date · time · timetz · timestamp · timestamptz · interval | ISO 꼴 글자(PG 기본 출력과 같은 모양 · `infinity` · BC) — timestamptz 는 **UTC**(`+00`) |
//! | bytea | 바이트(`$bytes`) |
//! | inet · cidr · macaddr · macaddr8 · money · pg_lsn · tid · "char" · bit · varbit · point | PG 텍스트 꼴 글자 |
//! | 배열 | PG 텍스트 꼴 `{…}`(요소를 같은 규칙으로 — 풀 수 없는 요소가 있으면 `‹int4[]›` 처럼) |
//! | 도메인 | 바탕 형의 규칙 |
//! | 그 밖(범위 · 복합 · 기하 대부분 · 확장 형) | `‹형 이름›` |

use std::borrow::Cow;
use std::fmt::Write as _;

use tokio_postgres::types::{FromSql, Kind, Type};

use super::value::Cell;

/// 아무 형이나 받는 날 바이트 — 형별 해석은 [`decode`] 가 한다(`FromSql` 의 형 검사를 지나기 위한 껍데기).
pub(crate) struct Raw<'a>(pub Option<&'a [u8]>);

impl<'a> FromSql<'a> for Raw<'a> {
    fn from_sql(_: &Type, raw: &'a [u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        Ok(Raw(Some(raw)))
    }
    fn from_sql_null(_: &Type) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        Ok(Raw(None))
    }
    fn accepts(_: &Type) -> bool {
        true
    }
}

// 잘 알려진 형 OID(pg_type.dat — 판을 넘어 고정이다).
const BOOL: u32 = 16;
const BYTEA: u32 = 17;
const CHAR: u32 = 18;
const NAME: u32 = 19;
const INT8: u32 = 20;
const INT2: u32 = 21;
const INT4: u32 = 23;
const REGPROC: u32 = 24;
const TEXT: u32 = 25;
const OID: u32 = 26;
const TID: u32 = 27;
const XID: u32 = 28;
const CID: u32 = 29;
const JSON: u32 = 114;
const XML: u32 = 142;
const POINT: u32 = 600;
const CIDR: u32 = 650;
const FLOAT4: u32 = 700;
const FLOAT8: u32 = 701;
const UNKNOWN: u32 = 705;
const MACADDR8: u32 = 774;
const MONEY: u32 = 790;
const MACADDR: u32 = 829;
const INET: u32 = 869;
const BPCHAR: u32 = 1042;
const VARCHAR: u32 = 1043;
const DATE: u32 = 1082;
const TIME: u32 = 1083;
const TIMESTAMP: u32 = 1114;
const TIMESTAMPTZ: u32 = 1184;
const INTERVAL: u32 = 1186;
const TIMETZ: u32 = 1266;
const BIT: u32 = 1560;
const VARBIT: u32 = 1562;
const NUMERIC: u32 = 1700;
const REGPROCEDURE: u32 = 2202;
const REGOPER: u32 = 2203;
const REGOPERATOR: u32 = 2204;
const REGCLASS: u32 = 2205;
const REGTYPE: u32 = 2206;
const UUID: u32 = 2950;
const PG_LSN: u32 = 3220;
const JSONB: u32 = 3802;
const REGNAMESPACE: u32 = 4089;
const REGROLE: u32 = 4096;
const JSONPATH: u32 = 4072;
const XID8: u32 = 5069;

/// 컬럼 형 이름 — 배열은 `int4[]`(PG 내부 이름 `_int4` 대신).
pub(crate) fn type_label(ty: &Type) -> String {
    match ty.kind() {
        Kind::Array(elem) => format!("{}[]", elem.name()),
        _ => ty.name().to_string(),
    }
}

fn unsupported(ty: &Type) -> Cell<'static> {
    Cell::Text(Cow::Owned(format!("‹{}›", type_label(ty))))
}

/// 칸 하나를 푼다 — NULL 은 `raw = None`.
pub(crate) fn decode<'a>(ty: &Type, raw: Option<&'a [u8]>) -> Cell<'a> {
    let Some(b) = raw else {
        return Cell::Null;
    };
    match ty.kind() {
        Kind::Domain(base) => return decode(base, raw),
        Kind::Enum(_) => return text(b),
        Kind::Array(elem) => {
            return match array_text(elem, b) {
                Some(s) => Cell::Text(Cow::Owned(s)),
                None => unsupported(ty),
            }
        }
        Kind::Simple => {}
        _ => return unsupported(ty),
    }
    match ty.oid() {
        BOOL => b.first().map_or_else(|| unsupported(ty), |&v| Cell::Bool(v != 0)),
        BYTEA => Cell::Bytes(b),
        _ => match scalar(ty, b) {
            Some(Scalar::Int(i)) => Cell::Int(i),
            Some(Scalar::Float(f)) => Cell::Float(f),
            Some(Scalar::Text(s)) => Cell::Text(s),
            None => unsupported(ty),
        },
    }
}

/// 바이트·참거짓 밖의 값 — 배열 요소의 글자 꼴도 같은 자리에서 만든다.
enum Scalar<'a> {
    Int(i64),
    Float(f64),
    Text(Cow<'a, str>),
}

fn be<const N: usize>(b: &[u8]) -> Option<[u8; N]> {
    b.get(..N)?.try_into().ok()
}

fn exact<const N: usize>(b: &[u8]) -> Option<[u8; N]> {
    if b.len() == N {
        be::<N>(b)
    } else {
        None
    }
}

fn scalar<'a>(ty: &Type, b: &'a [u8]) -> Option<Scalar<'a>> {
    let owned = |s: String| Some(Scalar::Text(Cow::Owned(s)));
    match ty.oid() {
        INT2 => Some(Scalar::Int(i16::from_be_bytes(exact(b)?) as i64)),
        INT4 => Some(Scalar::Int(i32::from_be_bytes(exact(b)?) as i64)),
        INT8 => Some(Scalar::Int(i64::from_be_bytes(exact(b)?))),
        OID | XID | CID | REGPROC | REGPROCEDURE | REGOPER | REGOPERATOR | REGCLASS | REGTYPE | REGNAMESPACE
        | REGROLE => Some(Scalar::Int(u32::from_be_bytes(exact(b)?) as i64)),
        XID8 => owned(u64::from_be_bytes(exact(b)?).to_string()),
        FLOAT4 => {
            let f = f32::from_be_bytes(exact(b)?);
            // f32 → f64 를 그대로 넓히면 0.1 이 0.10000000149… 가 된다 — 짧은 표기를 거친다.
            Some(Scalar::Float(if f.is_finite() {
                f.to_string().parse().unwrap_or(f as f64)
            } else {
                f as f64
            }))
        }
        FLOAT8 => Some(Scalar::Float(f64::from_be_bytes(exact(b)?))),
        NUMERIC => owned(numeric(b)?),
        TEXT | VARCHAR | BPCHAR | NAME | UNKNOWN | XML | JSON => Some(Scalar::Text(String::from_utf8_lossy(b))),
        JSONB | JSONPATH => match b.split_first() {
            Some((1, rest)) => Some(Scalar::Text(String::from_utf8_lossy(rest))),
            _ => None,
        },
        CHAR => owned(match b.first() {
            Some(&c) if c.is_ascii() && c != 0 => (c as char).to_string(),
            Some(&0) | None => String::new(),
            Some(&c) => format!("\\{c:03o}"),
        }),
        UUID => owned(uuid(exact::<16>(b)?)),
        DATE => owned(date(i32::from_be_bytes(exact(b)?))),
        TIME => owned(time_of_day(i64::from_be_bytes(exact(b)?))?),
        TIMETZ => {
            let us = i64::from_be_bytes(be(b)?);
            let zone = i32::from_be_bytes(be(b.get(8..)?)?);
            if b.len() != 12 {
                return None;
            }
            owned(format!("{}{}", time_of_day(us)?, offset(-zone)))
        }
        TIMESTAMP => owned(timestamp(i64::from_be_bytes(exact(b)?), false)),
        TIMESTAMPTZ => owned(timestamp(i64::from_be_bytes(exact(b)?), true)),
        INTERVAL => {
            if b.len() != 16 {
                return None;
            }
            let us = i64::from_be_bytes(be(b)?);
            let days = i32::from_be_bytes(be(&b[8..])?);
            let months = i32::from_be_bytes(be(&b[12..])?);
            owned(interval(months, days, us))
        }
        INET | CIDR => owned(inet(b, ty.oid() == CIDR)?),
        MACADDR => owned(mac(exact::<6>(b)?.as_slice())),
        MACADDR8 => owned(mac(exact::<8>(b)?.as_slice())),
        // money 는 lc_monetary 에 따라 소수 자리가 다르다 — 흔한 두 자리로 보인다(기호 없이).
        MONEY => owned(fixed2(i64::from_be_bytes(exact(b)?))),
        PG_LSN => {
            let v = u64::from_be_bytes(exact(b)?);
            owned(format!("{:X}/{:X}", v >> 32, v & 0xffff_ffff))
        }
        TID => {
            if b.len() != 6 {
                return None;
            }
            let block = u32::from_be_bytes(be(b)?);
            let off = u16::from_be_bytes(be(&b[4..])?);
            owned(format!("({block},{off})"))
        }
        BIT | VARBIT => owned(bits(b)?),
        POINT => {
            if b.len() != 16 {
                return None;
            }
            let x = f64::from_be_bytes(be(b)?);
            let y = f64::from_be_bytes(be(&b[8..])?);
            owned(format!("({x},{y})"))
        }
        // 확장 형인데 바이너리 형식이 글자 그대로인 것(citext 의 send 는 textsend).
        _ if ty.name() == "citext" => Some(Scalar::Text(String::from_utf8_lossy(b))),
        _ => None,
    }
}

/// numeric 바이너리 → 글자. `ndigits i16 · weight i16 · sign u16 · dscale u16 · digits[ndigits] i16(base 10000)`.
pub(crate) fn numeric(b: &[u8]) -> Option<String> {
    let ndigits = i16::from_be_bytes(be(b)?);
    let weight = i16::from_be_bytes(be(b.get(2..)?)?) as i32;
    let sign = u16::from_be_bytes(be(b.get(4..)?)?);
    let dscale = u16::from_be_bytes(be(b.get(6..)?)?) as usize;
    match sign {
        0xC000 => return Some("NaN".into()),
        0xD000 => return Some("Infinity".into()),
        0xF000 => return Some("-Infinity".into()),
        0x0000 | 0x4000 => {}
        _ => return None,
    }
    if ndigits < 0 || b.len() != 8 + ndigits as usize * 2 {
        return None;
    }
    let digits: Vec<i32> = (0..ndigits as usize)
        .map(|i| i16::from_be_bytes([b[8 + i * 2], b[9 + i * 2]]) as i32)
        .collect();
    if digits.iter().any(|d| !(0..10_000).contains(d)) {
        return None;
    }
    let digit = |i: i32| -> i32 {
        if i >= 0 && (i as usize) < digits.len() {
            digits[i as usize]
        } else {
            0
        }
    };
    let mut s = String::new();
    if sign == 0x4000 {
        s.push('-');
    }
    if weight < 0 {
        s.push('0');
    } else {
        for i in 0..=weight {
            let d = digit(i);
            if i == 0 {
                let _ = write!(s, "{d}");
            } else {
                let _ = write!(s, "{d:04}");
            }
        }
    }
    if dscale > 0 {
        s.push('.');
        let mut frac = String::new();
        let mut i = weight + 1;
        while frac.len() < dscale {
            let _ = write!(frac, "{:04}", digit(i));
            i += 1;
        }
        frac.truncate(dscale);
        s.push_str(&frac);
    }
    Some(s)
}

fn uuid(b: [u8; 16]) -> String {
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

/// PG 기원(2000-01-01) 에서 센 날 → (년, 월, 일) — 하워드 히넌트의 `civil_from_days`.
fn civil(days_since_2000: i64) -> (i64, u32, u32) {
    let z = days_since_2000 + 10_957 + 719_468; // 1970 기원 → 0000-03-01 기원
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 날짜 꼴 `YYYY-MM-DD` — 서기 0년 이하는 `0044-03-15 BC`(PG 와 같다).
fn ymd(days: i64) -> (String, bool) {
    let (y, m, d) = civil(days);
    if y <= 0 {
        (format!("{:04}-{m:02}-{d:02}", 1 - y), true)
    } else {
        (format!("{y:04}-{m:02}-{d:02}"), false)
    }
}

pub(crate) fn date(days: i32) -> String {
    match days {
        i32::MAX => "infinity".into(),
        i32::MIN => "-infinity".into(),
        _ => {
            let (s, bc) = ymd(days as i64);
            if bc {
                format!("{s} BC")
            } else {
                s
            }
        }
    }
}

const US_PER_DAY: i64 = 86_400_000_000;

/// `HH:MM:SS[.ffffff]`(끝 0 은 뗀다 — PG 출력과 같다). 24:00:00 까지(PG time 의 범위).
fn hms(us: i64) -> String {
    let secs = us / 1_000_000;
    let frac = us % 1_000_000;
    let mut s = format!("{:02}:{:02}:{:02}", secs / 3600, secs / 60 % 60, secs % 60);
    if frac != 0 {
        let f = format!("{frac:06}");
        s.push('.');
        s.push_str(f.trim_end_matches('0'));
    }
    s
}

fn time_of_day(us: i64) -> Option<String> {
    (0..=US_PER_DAY).contains(&us).then(|| hms(us))
}

/// 시간대 꼴 `+09` · `-03:30` · `+05:45:30` — `east` 는 UTC 동쪽 초.
fn offset(east: i32) -> String {
    let sign = if east < 0 { '-' } else { '+' };
    let a = east.unsigned_abs();
    let (h, m, s) = (a / 3600, a / 60 % 60, a % 60);
    match (m, s) {
        (0, 0) => format!("{sign}{h:02}"),
        (_, 0) => format!("{sign}{h:02}:{m:02}"),
        _ => format!("{sign}{h:02}:{m:02}:{s:02}"),
    }
}

pub(crate) fn timestamp(us: i64, tz: bool) -> String {
    match us {
        i64::MAX => return "infinity".into(),
        i64::MIN => return "-infinity".into(),
        _ => {}
    }
    let days = us.div_euclid(US_PER_DAY);
    let rest = us.rem_euclid(US_PER_DAY);
    let (d, bc) = ymd(days);
    let mut s = format!("{d} {}", hms(rest));
    if tz {
        s.push_str("+00");
    }
    if bc {
        s.push_str(" BC");
    }
    s
}

/// PG 기본(`postgres`) 꼴 — `1 year 2 mons 3 days 04:05:06.5` · 모두 0 이면 `00:00:00` · 단수는 정확히 1 일 때만(`-1 days` — PG 와 같다).
pub(crate) fn interval(months: i32, days: i32, us: i64) -> String {
    let mut parts: Vec<String> = Vec::new();
    let (y, mo) = (months / 12, months % 12);
    let unit = |n: i64, one: &str, many: &str| format!("{n} {}", if n == 1 { one } else { many });
    if y != 0 {
        parts.push(unit(y as i64, "year", "years"));
    }
    if mo != 0 {
        parts.push(unit(mo as i64, "mon", "mons"));
    }
    if days != 0 {
        parts.push(unit(days as i64, "day", "days"));
    }
    if us != 0 || parts.is_empty() {
        let neg = us < 0;
        let a = us.unsigned_abs();
        let secs = a / 1_000_000;
        let frac = a % 1_000_000;
        let mut t = format!("{}{:02}:{:02}:{:02}", if neg { "-" } else { "" }, secs / 3600, secs / 60 % 60, secs % 60);
        if frac != 0 {
            let f = format!("{frac:06}");
            t.push('.');
            t.push_str(f.trim_end_matches('0'));
        }
        parts.push(t);
    }
    parts.join(" ")
}

/// inet/cidr — `family(2=v4 · 3=v6) · bits · is_cidr · nb · 주소`. inet 은 꽉 찬 마스크면 `/n` 을 뗀다.
fn inet(b: &[u8], is_cidr: bool) -> Option<String> {
    let (&family, rest) = b.split_first()?;
    let (&bits, rest) = rest.split_first()?;
    let (_, rest) = rest.split_first()?;
    let (&nb, addr) = rest.split_first()?;
    if addr.len() != nb as usize {
        return None;
    }
    let (text, full) = match family {
        2 if nb == 4 => (std::net::Ipv4Addr::from(<[u8; 4]>::try_from(addr).ok()?).to_string(), 32),
        3 if nb == 16 => (std::net::Ipv6Addr::from(<[u8; 16]>::try_from(addr).ok()?).to_string(), 128),
        _ => return None,
    };
    Some(if is_cidr || bits != full {
        format!("{text}/{bits}")
    } else {
        text
    })
}

fn mac(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect::<Vec<_>>().join(":")
}

fn fixed2(cents: i64) -> String {
    let neg = cents < 0;
    let a = cents.unsigned_abs();
    format!("{}{}.{:02}", if neg { "-" } else { "" }, a / 100, a % 100)
}

fn bits(b: &[u8]) -> Option<String> {
    let n = i32::from_be_bytes(be(b)?);
    let data = &b[4..];
    if n < 0 || data.len() != (n as usize).div_ceil(8) {
        return None;
    }
    Some((0..n as usize).map(|i| if data[i / 8] & (0x80 >> (i % 8)) != 0 { '1' } else { '0' }).collect())
}

/// 배열 요소 하나의 글자 꼴 — 풀 수 없으면 `None`(배열 전체가 `‹…[]›` 로).
fn element_text(ty: &Type, b: &[u8]) -> Option<(String, bool)> {
    let base = match ty.kind() {
        Kind::Domain(base) => base,
        _ => ty,
    };
    if matches!(base.kind(), Kind::Enum(_)) {
        return Some((String::from_utf8_lossy(b).into_owned(), true));
    }
    if !matches!(base.kind(), Kind::Simple) {
        return None;
    }
    match base.oid() {
        BOOL => Some(((if *b.first()? != 0 { "t" } else { "f" }).to_string(), false)),
        BYTEA => Some((format!("\\x{}", b.iter().map(|x| format!("{x:02x}")).collect::<String>()), true)),
        _ => match scalar(base, b)? {
            Scalar::Int(i) => Some((i.to_string(), false)),
            Scalar::Float(f) => Some((float_text(f), false)),
            Scalar::Text(s) => Some((s.into_owned(), true)),
        },
    }
}

fn float_text(f: f64) -> String {
    if f.is_nan() {
        "NaN".into()
    } else if f.is_infinite() {
        (if f > 0.0 { "Infinity" } else { "-Infinity" }).into()
    } else {
        f.to_string()
    }
}

/// 배열 요소를 PG 텍스트 꼴로 감싼다 — 비었거나 특수 글자·공백이 있거나 `NULL` 이면 큰따옴표(안의 `"`·`\` 는 백슬래시).
fn quote_element(s: &str) -> String {
    let needs = s.is_empty()
        || s.eq_ignore_ascii_case("NULL")
        || s.chars().any(|c| matches!(c, '{' | '}' | ',' | '"' | '\\') || c.is_whitespace());
    if !needs {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        if c == '"' || c == '\\' {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    out
}

/// 배열 바이너리 → PG 텍스트 꼴. `ndim i32 · flags i32 · elem oid u32 · (len i32 · lbound i32)×ndim · (len i32 · 바이트)…`.
pub(crate) fn array_text(elem: &Type, b: &[u8]) -> Option<String> {
    let ndim = i32::from_be_bytes(be(b)?);
    if !(0..=6).contains(&ndim) {
        return None;
    }
    if ndim == 0 {
        return Some("{}".into());
    }
    let mut at = 12usize;
    let mut dims = Vec::with_capacity(ndim as usize);
    let mut lbounds = Vec::with_capacity(ndim as usize);
    for _ in 0..ndim {
        let len = i32::from_be_bytes(be(b.get(at..)?)?);
        let lb = i32::from_be_bytes(be(b.get(at + 4..)?)?);
        if len < 0 {
            return None;
        }
        dims.push(len as usize);
        lbounds.push(lb);
        at += 8;
    }
    let total = dims.iter().try_fold(1usize, |acc, &d| acc.checked_mul(d))?;
    let mut items = Vec::with_capacity(total.min(1 << 16));
    for _ in 0..total {
        let len = i32::from_be_bytes(be(b.get(at..)?)?);
        at += 4;
        if len < 0 {
            items.push("NULL".to_string());
            continue;
        }
        let end = at.checked_add(len as usize)?;
        let (s, quotable) = element_text(elem, b.get(at..end)?)?;
        items.push(if quotable { quote_element(&s) } else { s });
        at = end;
    }
    if at != b.len() {
        return None;
    }
    let mut out = String::new();
    if lbounds.iter().any(|&l| l != 1) {
        for (d, l) in dims.iter().zip(&lbounds) {
            let _ = write!(out, "[{}:{}]", l, *l as i64 + *d as i64 - 1);
        }
        out.push('=');
    }
    let mut it = items.into_iter();
    nest(&dims, &mut it, &mut out);
    Some(out)
}

fn nest(dims: &[usize], items: &mut impl Iterator<Item = String>, out: &mut String) {
    out.push('{');
    for i in 0..dims[0] {
        if i > 0 {
            out.push(',');
        }
        if dims.len() == 1 {
            out.push_str(&items.next().unwrap_or_default());
        } else {
            nest(&dims[1..], items, out);
        }
    }
    out.push('}');
}

fn text(b: &[u8]) -> Cell<'_> {
    Cell::Text(String::from_utf8_lossy(b))
}

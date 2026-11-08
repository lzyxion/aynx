//! 결과 칸 → JSON — **엔진 공통 꼴**. 엔진은 제 값을 [`Cell`] 로 옮기고, 화면(6단계)은 이 꼴 하나만 안다.
//!
//! | 값 | JSON |
//! | --- | --- |
//! | NULL · 참/거짓 | `null` · `true`/`false` 그대로 |
//! | 정수 | 절댓값 < 2^53 이면 number, 밖이면 **문자열**(JS 가 자리를 잃지 않게) |
//! | 실수 | number — NaN·±무한은 문자열 `"NaN"`·`"Infinity"`·`"-Infinity"` |
//! | 글자 | 문자열 — [`CELL_MAX`] 바이트를 넘으면 글자 경계에서 자르고 `cellTruncated` |
//! | 바이트 | `{"$bytes": 길이, "hex": "앞 64바이트의 16진"}` |
//!
//! PG 의 numeric·날짜처럼 정밀도를 잃는 값은 엔진이 [`Cell::Text`] 로 넘긴다(`pg_value`).

use std::borrow::Cow;

use serde_json::{json, Value};

/// 칸 하나의 글자 상한(바이트).
pub(crate) const CELL_MAX: usize = 8 * 1024;
/// 바이트 칸에서 16진으로 보여 줄 앞부분.
pub(crate) const BYTES_PREVIEW: usize = 64;
/// JS `Number.MAX_SAFE_INTEGER + 1` = 2^53.
const SAFE_LIMIT: i64 = 1 << 53;

/// 엔진이 넘기는 칸 하나.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Cell<'a> {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(Cow<'a, str>),
    Bytes(&'a [u8]),
}

/// 칸 하나를 JSON 으로 — `(값, 글자를 잘랐나)`.
pub(crate) fn to_json(cell: Cell<'_>) -> (Value, bool) {
    match cell {
        Cell::Null => (Value::Null, false),
        Cell::Bool(b) => (Value::Bool(b), false),
        Cell::Int(i) if i > -SAFE_LIMIT && i < SAFE_LIMIT => (json!(i), false),
        Cell::Int(i) => (Value::String(i.to_string()), false),
        Cell::Float(f) if f.is_nan() => (json!("NaN"), false),
        Cell::Float(f) if f.is_infinite() => (json!(if f > 0.0 { "Infinity" } else { "-Infinity" }), false),
        Cell::Float(f) => (json!(f), false),
        Cell::Text(t) => {
            if t.len() <= CELL_MAX {
                (Value::String(t.into_owned()), false)
            } else {
                let mut cut = CELL_MAX;
                while !t.is_char_boundary(cut) {
                    cut -= 1;
                }
                (Value::String(t[..cut].to_string()), true)
            }
        }
        Cell::Bytes(b) => (json!({ "$bytes": b.len(), "hex": hex(&b[..b.len().min(BYTES_PREVIEW)]) }), false),
    }
}

fn hex(b: &[u8]) -> String {
    const D: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for &x in b {
        s.push(D[(x >> 4) as usize] as char);
        s.push(D[(x & 0xf) as usize] as char);
    }
    s
}

/// 칸 JSON 하나가 응답에서 차지하는 대략의 바이트(구분 쉼표 하나 포함) — 응답 상한을 잴 때.
pub(crate) fn approx_len(v: &Value) -> usize {
    serde_json::to_string(v).map_or(16, |s| s.len()) + 1
}

/// SQLite 칸 → [`Cell`]. 글자가 UTF-8 이 아니면 대체 글자로(SQLite 는 검사하지 않고 담는다).
pub(crate) fn from_sqlite(v: rusqlite::types::ValueRef<'_>) -> Cell<'_> {
    use rusqlite::types::ValueRef;
    match v {
        ValueRef::Null => Cell::Null,
        ValueRef::Integer(i) => Cell::Int(i),
        ValueRef::Real(f) => Cell::Float(f),
        ValueRef::Text(t) => Cell::Text(String::from_utf8_lossy(t)),
        ValueRef::Blob(b) => Cell::Bytes(b),
    }
}

/// SQLite 칸의 저장 종류 이름 — 컬럼 `type` 칸(첫 NULL 아닌 값의 것. SQLite 는 칸마다 종류가 다를 수 있다).
pub(crate) fn sqlite_storage_class(v: rusqlite::types::ValueRef<'_>) -> Option<&'static str> {
    use rusqlite::types::ValueRef;
    match v {
        ValueRef::Null => None,
        ValueRef::Integer(_) => Some("integer"),
        ValueRef::Real(_) => Some("real"),
        ValueRef::Text(_) => Some("text"),
        ValueRef::Blob(_) => Some("blob"),
    }
}

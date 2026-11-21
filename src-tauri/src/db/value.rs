//! 결과 칸 → JSON — 엔진 공통 꼴이고 화면은 이 꼴 하나만 안다.
//! PG 의 numeric · 날짜처럼 정밀도를 잃는 값은 엔진이 [`Cell::Text`] 로 넘긴다(`pg_value`).

use std::borrow::Cow;

use serde_json::{json, Value};

pub(crate) const CELL_MAX: usize = 8 * 1024;
pub(crate) const BYTES_PREVIEW: usize = 64;
/// 2^53 — 밖의 정수는 JS 가 자리를 잃지 않게 문자열로 준다.
const SAFE_LIMIT: i64 = 1 << 53;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Cell<'a> {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(Cow<'a, str>),
    Bytes(&'a [u8]),
}

/// `(값, 글자를 잘랐나)`.
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

/// 구분 쉼표 하나를 포함한다.
pub(crate) fn approx_len(v: &Value) -> usize {
    serde_json::to_string(v).map_or(16, |s| s.len()) + 1
}

/// SQLite 는 UTF-8 을 검사하지 않고 담는다 — 깨진 글자는 대체 글자로.
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

/// SQLite 는 칸마다 저장 종류가 다를 수 있다 — 컬럼 `type` 은 첫 NULL 아닌 값의 것이다.
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

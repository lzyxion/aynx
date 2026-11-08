//! **MySQL · MariaDB 칸 → [`Cell`]**(쿼리 타일 8단계) — mysql_async 의 [`Value`] 와 컬럼 정의(형 · 플래그 · 문자셋 · 소수 자리)로
//! 푼다. **순수**이고 패닉하지 않는다. 사용자 문장은 늘 prepare(바이너리 프로토콜)를 지나므로 정수·실수·날짜는 형이 붙은
//! 값으로 오지만, 글자 프로토콜(`Value::Bytes`)로 와도 같은 꼴이 나오게 둘 다 받는다.
//!
//! | 형 | JSON |
//! | --- | --- |
//! | TINYINT … BIGINT | number(±2^53 밖은 문자열) — `BIGINT UNSIGNED` 의 i64 밖 값도 문자열 |
//! | FLOAT · DOUBLE | number(FLOAT 는 f32 의 가장 짧은 글자 그대로 — `0.1` 이 `0.10000000149…` 가 되지 않게) |
//! | DECIMAL | 문자열(자리 보존) |
//! | DATE · DATETIME · TIMESTAMP | `YYYY-MM-DD[ HH:MM:SS[.f…]]`(소수 자리는 컬럼의 fsp — 서버 글자 출력과 같다 · `0000-00-00` 도 그대로) |
//! | TIME | `[-]HH:MM:SS[.f…]`(일수는 시간에 더한다 — `838:59:59`) |
//! | YEAR | number |
//! | BIT(n) | 비트 글자 `0101…`(n 자리 — PG `bit` 과 같은 꼴) |
//! | JSON | 문자열(서버가 낸 글자 그대로) |
//! | CHAR · VARCHAR · TEXT · ENUM · SET | 문자열(UTF-8 이 아닌 바이트는 대체 글자) |
//! | BINARY · VARBINARY · BLOB(문자셋 binary = 63) | `{"$bytes", "hex"}` |
//! | GEOMETRY · VECTOR · 모르는 형 | `‹형 이름›` |

use std::borrow::Cow;

use mysql_async::consts::{ColumnFlags, ColumnType};
use mysql_async::{Column, Value};

use super::value::Cell;

/// 문자셋 번호 63 = `binary`(바이트 그대로 — 글자가 아니다).
const BINARY_CHARSET: u16 = 63;

fn is_binary(col: &Column) -> bool {
    col.character_set() == BINARY_CHARSET
}

/// 컬럼 형 이름(소문자 — `int unsigned` · `varchar` · `blob` …). 결과 컬럼 `type` 칸.
pub(crate) fn type_label(col: &Column) -> String {
    use ColumnType::*;
    let flags = col.flags();
    let bin = is_binary(col);
    let base = match col.column_type() {
        MYSQL_TYPE_TINY => "tinyint",
        MYSQL_TYPE_SHORT => "smallint",
        MYSQL_TYPE_INT24 => "mediumint",
        MYSQL_TYPE_LONG => "int",
        MYSQL_TYPE_LONGLONG => "bigint",
        MYSQL_TYPE_FLOAT => "float",
        MYSQL_TYPE_DOUBLE => "double",
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => "decimal",
        MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE => "date",
        MYSQL_TYPE_TIME | MYSQL_TYPE_TIME2 => "time",
        MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 => "datetime",
        MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2 => "timestamp",
        MYSQL_TYPE_YEAR => "year",
        MYSQL_TYPE_BIT => "bit",
        MYSQL_TYPE_JSON => "json",
        MYSQL_TYPE_NULL => "null",
        MYSQL_TYPE_GEOMETRY => "geometry",
        MYSQL_TYPE_VECTOR => "vector",
        MYSQL_TYPE_ENUM => "enum",
        MYSQL_TYPE_SET => "set",
        MYSQL_TYPE_STRING if flags.contains(ColumnFlags::ENUM_FLAG) => "enum",
        MYSQL_TYPE_STRING if flags.contains(ColumnFlags::SET_FLAG) => "set",
        MYSQL_TYPE_STRING => if bin { "binary" } else { "char" },
        MYSQL_TYPE_VARCHAR | MYSQL_TYPE_VAR_STRING => if bin { "varbinary" } else { "varchar" },
        MYSQL_TYPE_TINY_BLOB | MYSQL_TYPE_MEDIUM_BLOB | MYSQL_TYPE_LONG_BLOB | MYSQL_TYPE_BLOB => {
            if bin {
                "blob"
            } else {
                "text"
            }
        }
        MYSQL_TYPE_TYPED_ARRAY | MYSQL_TYPE_UNKNOWN => "unknown",
    };
    let numeric = matches!(
        col.column_type(),
        MYSQL_TYPE_TINY
            | MYSQL_TYPE_SHORT
            | MYSQL_TYPE_INT24
            | MYSQL_TYPE_LONG
            | MYSQL_TYPE_LONGLONG
            | MYSQL_TYPE_FLOAT
            | MYSQL_TYPE_DOUBLE
            | MYSQL_TYPE_DECIMAL
            | MYSQL_TYPE_NEWDECIMAL
    );
    if numeric && flags.contains(ColumnFlags::UNSIGNED_FLAG) {
        format!("{base} unsigned")
    } else {
        base.to_string()
    }
}

/// 소수 자리(fsp) — 컬럼 정의의 `decimals`(0..=6). 그 밖(31 = 고정 안 됨 — 식의 값)이면 `None`(마이크로초가 있을 때만 6자리).
fn fsp(col: &Column) -> Option<usize> {
    let d = col.decimals() as usize;
    (d <= 6).then_some(d)
}

fn frac(us: u32, fsp: Option<usize>) -> String {
    let digits = match fsp {
        Some(d) => d,
        None if us == 0 => 0,
        None => 6,
    };
    if digits == 0 {
        return String::new();
    }
    let s = format!("{:06}", us.min(999_999));
    format!(".{}", &s[..digits])
}

/// 날짜·일시 글자 — 서버의 글자 출력과 같은 꼴.
/// 값은 `Value::Date` 의 칸 그대로(년 · 월 · 일 · 시 · 분 · 초 · 마이크로초).
pub(crate) fn date_text(col: &Column, (y, mo, d, h, mi, s, us): (u16, u8, u8, u8, u8, u8, u32)) -> String {
    use ColumnType::*;
    let date = format!("{y:04}-{mo:02}-{d:02}");
    if matches!(col.column_type(), MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE) {
        return date;
    }
    format!("{date} {h:02}:{mi:02}:{s:02}{}", frac(us, fsp(col)))
}

/// 시간(TIME) 글자 — 일수는 시간에 더한다(`-838:59:59` 까지).
pub(crate) fn time_text(col: &Column, neg: bool, days: u32, h: u8, mi: u8, s: u8, us: u32) -> String {
    let hours = u64::from(days) * 24 + u64::from(h);
    let sign = if neg { "-" } else { "" };
    format!("{sign}{hours:02}:{mi:02}:{s:02}{}", frac(us, fsp(col)))
}

/// BIT(n) — 큰 끝 바이트를 n 자리 비트 글자로(PG `bit` 과 같은 꼴). n 을 모르면 바이트 전체.
pub(crate) fn bit_text(bytes: &[u8], width: u32) -> String {
    let all: String = bytes.iter().map(|b| format!("{b:08b}")).collect();
    let w = width as usize;
    if w == 0 || w >= all.len() {
        // 너비가 바이트보다 크면(드물다) 앞을 0 으로 채운다.
        return format!("{all:0>w$}");
    }
    all[all.len() - w..].to_string()
}

fn int_cell(v: i128) -> Cell<'static> {
    match i64::try_from(v) {
        Ok(i) => Cell::Int(i),
        Err(_) => Cell::Text(Cow::Owned(v.to_string())),
    }
}

fn unknown(col: &Column) -> Cell<'static> {
    Cell::Text(Cow::Owned(format!("‹{}›", type_label(col))))
}

/// 칸 하나 — `None`(값 자리가 비었다 — 일어나지 않아야 한다)은 NULL 로 본다.
pub(crate) fn decode<'a>(col: &Column, v: Option<&'a Value>) -> Cell<'a> {
    use ColumnType::*;
    let Some(v) = v else {
        return Cell::Null;
    };
    let ty = col.column_type();
    match v {
        Value::NULL => Cell::Null,
        // YEAR · 정수 형은 숫자 그대로(±2^53 밖은 `to_json` 이 문자열로).
        Value::Int(i) => Cell::Int(*i),
        Value::UInt(u) => int_cell(i128::from(*u)),
        // FLOAT(f32) — f64 로 넓히면 0.1 이 0.10000000149… 가 된다. f32 의 가장 짧은 글자를 f64 로 다시 읽는다.
        Value::Float(f) => Cell::Float(f.to_string().parse::<f64>().unwrap_or(f64::from(*f))),
        Value::Double(f) => Cell::Float(*f),
        Value::Date(y, mo, d, h, mi, s, us) => Cell::Text(Cow::Owned(date_text(col, (*y, *mo, *d, *h, *mi, *s, *us)))),
        Value::Time(neg, days, h, mi, s, us) => Cell::Text(Cow::Owned(time_text(col, *neg, *days, *h, *mi, *s, *us))),
        Value::Bytes(b) => match ty {
            MYSQL_TYPE_GEOMETRY | MYSQL_TYPE_VECTOR | MYSQL_TYPE_TYPED_ARRAY | MYSQL_TYPE_UNKNOWN => unknown(col),
            MYSQL_TYPE_BIT => Cell::Text(Cow::Owned(bit_text(b, col.column_length()))),
            // 글자 프로토콜로 온 숫자 — 글자를 숫자로(못 읽으면 글자 그대로).
            MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_INT24 | MYSQL_TYPE_LONG | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_YEAR => {
                let t = String::from_utf8_lossy(b);
                match t.trim().parse::<i128>() {
                    Ok(n) => int_cell(n),
                    Err(_) => Cell::Text(Cow::Owned(t.into_owned())),
                }
            }
            MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => {
                let t = String::from_utf8_lossy(b);
                match t.trim().parse::<f64>() {
                    Ok(f) => Cell::Float(f),
                    Err(_) => Cell::Text(Cow::Owned(t.into_owned())),
                }
            }
            // DECIMAL · 날짜(글자 프로토콜) · JSON(문자셋은 binary 로 오지만 글자다) — 글자 그대로.
            MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL | MYSQL_TYPE_JSON | MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE | MYSQL_TYPE_TIME
            | MYSQL_TYPE_TIME2 | MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 | MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2
            | MYSQL_TYPE_NULL => Cell::Text(String::from_utf8_lossy(b)),
            // 글자·바이트 — 문자셋 binary(63)면 바이트, 아니면 글자(연결 문자셋 utf8mb4).
            MYSQL_TYPE_ENUM | MYSQL_TYPE_SET | MYSQL_TYPE_STRING | MYSQL_TYPE_VARCHAR | MYSQL_TYPE_VAR_STRING | MYSQL_TYPE_TINY_BLOB
            | MYSQL_TYPE_MEDIUM_BLOB | MYSQL_TYPE_LONG_BLOB | MYSQL_TYPE_BLOB => {
                if is_binary(col) {
                    Cell::Bytes(b)
                } else {
                    Cell::Text(String::from_utf8_lossy(b))
                }
            }
        },
    }
}

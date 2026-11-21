//! **MySQL · MariaDB 칸 → [`Cell`]** — **순수**이고 패닉하지 않는다. 사용자 문장은 늘 prepare(바이너리 프로토콜)를 지나지만,
//! 글자 프로토콜(`Value::Bytes`)로 와도 같은 꼴이 나오게 둘 다 받는다. 날짜 · 시간 글자는 서버의 글자 출력과 같은 꼴이다.

use std::borrow::Cow;

use mysql_async::consts::{ColumnFlags, ColumnType};
use mysql_async::{Column, Value};

use super::value::Cell;

/// 문자셋 번호 63 = `binary`(글자가 아니다).
const BINARY_CHARSET: u16 = 63;

fn is_binary(col: &Column) -> bool {
    col.character_set() == BINARY_CHARSET
}

/// 결과 컬럼 `type` 칸.
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

/// 31(고정 안 됨 — 식의 값)이면 `None` — 마이크로초가 있을 때만 6자리.
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

pub(crate) fn date_text(col: &Column, (y, mo, d, h, mi, s, us): (u16, u8, u8, u8, u8, u8, u32)) -> String {
    use ColumnType::*;
    let date = format!("{y:04}-{mo:02}-{d:02}");
    if matches!(col.column_type(), MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE) {
        return date;
    }
    format!("{date} {h:02}:{mi:02}:{s:02}{}", frac(us, fsp(col)))
}

/// 일수는 시간에 더한다(`-838:59:59` 까지).
pub(crate) fn time_text(col: &Column, neg: bool, days: u32, h: u8, mi: u8, s: u8, us: u32) -> String {
    let hours = u64::from(days) * 24 + u64::from(h);
    let sign = if neg { "-" } else { "" };
    format!("{sign}{hours:02}:{mi:02}:{s:02}{}", frac(us, fsp(col)))
}

/// PG `bit` 과 같은 꼴. n 을 모르면 바이트 전체.
pub(crate) fn bit_text(bytes: &[u8], width: u32) -> String {
    let all: String = bytes.iter().map(|b| format!("{b:08b}")).collect();
    let w = width as usize;
    if w == 0 || w >= all.len() {
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

/// `None`(값 자리가 비었다 — 일어나지 않아야 한다)은 NULL 로 본다.
pub(crate) fn decode<'a>(col: &Column, v: Option<&'a Value>) -> Cell<'a> {
    use ColumnType::*;
    let Some(v) = v else {
        return Cell::Null;
    };
    let ty = col.column_type();
    match v {
        Value::NULL => Cell::Null,
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
            // JSON 은 문자셋 binary 로 오지만 글자다.
            MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL | MYSQL_TYPE_JSON | MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE | MYSQL_TYPE_TIME
            | MYSQL_TYPE_TIME2 | MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 | MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2
            | MYSQL_TYPE_NULL => Cell::Text(String::from_utf8_lossy(b)),
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

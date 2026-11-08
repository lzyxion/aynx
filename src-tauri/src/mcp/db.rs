//! **DB 도구**(쿼리 타일 3단계 3a · 3b — docs/log/2026-10-13-db-write-mcp-design.md B-4 · B-6 · D6 · D7) — `list_db_connections` · 구조 넷
//! (`db_list_schemas` · `db_list_objects` · `db_describe_table` · `db_get_definition`) · `db_query`(읽기 전용) · `create_db_write_plan`(3b — 쓰기
//! **작업안 초안**을 저장할 뿐, 실행 · 승인은 없다).
//!
//! 불변식:
//! - **DB 평면에는 `crate::db::ai` 로만 닿는다**(시험 `mcp_reaches_db_only_through_ai_facade`) — 타일 연결 표 · 서버 op · 쓰기 전환에 닿는
//!   길이 없다.
//! - **권한 판정이 먼저다** — 도구 호출마다 `delegation.toml` 을 새로 읽고(`tools_call` 의 `load_delegation`) 연결마다 단계 + 신원 스냅샷을
//!   본다(`ai::authorize`). 끔(또는 스냅샷 어긋남)인 연결은 **없는 연결과 같은 말**을 한다 · 목록에도 없다.
//! - **AI 의 쓰기는 작업안뿐이다**(3b) — `create_db_write_plan` 은 'Ask' 연결에만, 사전 검증(`crate::db::ai_plan::check` — 2단계 쓰기
//!   스크립트 규칙)을 지난 문장 목록을 **초안으로 저장**한다(연결 · 트랜잭션을 열지 않는다). 검토 요청 · 기다림 · 결과 읽기는 셸 작업안과 같은
//!   도구다. 승인 · 실행 · 취소는 MCP 에 없고(Tauri 명령뿐), DB 작업안은 연결이 'YOLO' 일 때만 자동 승인된다(`operations::approval`). 실행 모듈
//!   `db::ai_write` 는 이 파일에서 닿지 않는다(시험 `mcp_reaches_db_only_through_ai_facade`). 권한을 고치는 도구도 없다(위임 편집은 Tauri 명령뿐).
//! - **비밀번호 · 주소 · 사용자 이름 · 파일 경로를 돌려주지 않는다** — `list_db_connections` 는 이름 · 엔진 · DB 이름 · 경유 여부 · 단계만
//!   (근거: AI 가 SQL 을 쓰는 데 주소는 필요 없고, 연결 목록은 사용자의 기반 시설 지도라 모델 제공자로 보낼 까닭이 없다 — 호스트 위임의
//!   `get_auto_approval_policy` 가 별칭을 내보내지 않는 것과 같은 규칙).
//! - **감사**: 연결에 닿는 도구(구조 넷 · `db_query`)는 호출마다 한 줄(`audit` `db_read` — 도구 · 연결 · SQL/인자 · 행 수 · ms · 결과 코드).
//!   **결과 값은 남기지 않는다.** 권한에서 거절된 호출도 `denied` 로 남긴다.
//! - 이 도구들은 **컨텍스트 잠금 앞**에서 갈라진다(`rpc::tools_call`) — 최대 60초 + 여유를 자는 동안 거울 갱신을 막지 않게.

use std::sync::Arc;
use std::time::Instant;

use serde_json::{json, Value};

use crate::audit::{AuditDbRead, AuditRecord};
use crate::db::ai::{self, AiDb, AiRequest, DbAiLevel, DbConn, DefTarget, Denied};
use crate::delegation::Delegation;

/// MCP 요청이 들고 가는 DB 뒷면 — 없으면(시험 · DB 를 모르는 서버) DB 도구가 목록에 없고 연결도 없다.
#[derive(Clone, Default)]
pub(crate) struct DbEnv {
    backend: Option<Arc<dyn AiDb>>,
}

impl DbEnv {
    pub(crate) fn none() -> DbEnv {
        DbEnv { backend: None }
    }

    pub(crate) fn new(backend: Arc<dyn AiDb>) -> DbEnv {
        DbEnv { backend: Some(backend) }
    }
}

/// DB 도구 이름 전부. 쓰기는 **작업안 초안** 하나(`create_db_write_plan` — 3b)뿐이고, 그것도 실행하지 않는다.
pub(crate) const DB_TOOLS: [&str; 7] = [
    "list_db_connections",
    "db_list_schemas",
    "db_list_objects",
    "db_describe_table",
    "db_get_definition",
    "db_query",
    WRITE_PLAN_TOOL,
];

/// 쓰기 작업안 초안 도구(3b) — 'Ask' 연결이 하나라도 있을 때만 목록에 실린다.
pub(crate) const WRITE_PLAN_TOOL: &str = "create_db_write_plan";

pub(crate) fn is_db_tool(name: &str) -> bool {
    DB_TOOLS.contains(&name)
}

/// 권한이 끔이 아닌 연결들과 그 단계(파일 순서).
fn shared(d: &Delegation, backend: &dyn AiDb) -> Vec<(DbConn, DbAiLevel)> {
    backend
        .connections()
        .into_iter()
        .filter(|c| d.database(&c.id).is_some())
        .map(|c| {
            let vt = c.via.as_deref().and_then(|v| backend.via_target(v));
            let level = d.db_level(&c, vt.as_deref());
            (c, level)
        })
        .filter(|(_, l)| *l != DbAiLevel::Off)
        .collect()
}

/// 가장 높은 단계 — `tools/list` 가 어떤 DB 도구를 실을지 정한다(끔이면 하나도 없다).
pub(crate) fn max_level(d: &Delegation, env: &DbEnv) -> DbAiLevel {
    match &env.backend {
        Some(b) => shared(d, b.as_ref()).into_iter().map(|(_, l)| l).max().unwrap_or(DbAiLevel::Off),
        None => DbAiLevel::Off,
    }
}

fn conn_id_prop() -> Value {
    json!({ "type": "string", "description": "the connId from list_db_connections" })
}

/// DB 도구의 스키마 — 단계에 맞춰: 끔 = 없음 · 구조만 = 목록 + 구조 넷 · 읽기 전용 이상 = + `db_query`.
pub(crate) fn tool_schemas(max: DbAiLevel) -> Vec<Value> {
    if max == DbAiLevel::Off {
        return Vec::new();
    }
    let mut tools = vec![
        json!({
            "name": "list_db_connections",
            "description": "Lists the database connections the user has shared with AI in the aynx app — a connection whose AI permission is Off is not listed at all. \
    Each item: connId (pass it to the other db_* tools), name, engine (postgres | mysql | mariadb | sqlite), database (the database name, when one is set), throughSsh (true = reached through an SSH jump host), \
    and aiLevel — 'schema' (Schema: schemas, objects, table structure and DDL — no rows ever leave), 'read' (Read: also db_query), 'approve' (Ask: also create_db_write_plan — you propose, a person approves in the app, the app runs it) \
    or 'all' (YOLO: like 'approve', but while the user's auto-approval switch is on a write plan for this connection is approved **at once, without a person** — be deliberate). \
    Addresses, ports, user names, file paths and passwords are never returned. The user sets the AI permission per connection in the app; this server cannot change it. \
    You work on a separate AI-only connection that is always read-only — never the user's query tile, its write mode or its open transaction.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }),
        json!({
            "name": "db_list_schemas",
            "description": "The schema names of one connection (PostgreSQL schemas, MySQL/MariaDB databases, SQLite attached databases). Needs AI permission 'Schema' or higher. Read-only; returns names only (no rows).",
            "inputSchema": {
                "type": "object",
                "properties": { "connId": conn_id_prop() },
                "required": ["connId"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "db_list_objects",
            "description": "The objects of one schema: kind (table, view, matview, foreign, function, procedure, sequence, type), name, and for functions the argument list and return type. \
    Needs 'Schema' or higher. At most 500 objects (objectsCapped:true when cut). Read-only; names and signatures only (no rows).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connId": conn_id_prop(),
                    "schema": { "type": "string", "description": "the schema name from db_list_schemas (omit for the default schema)" }
                },
                "required": ["connId"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "db_describe_table",
            "description": "The structure of one table or view: columns (name, type, nullable, default), indexes, constraints, foreign keys, the foreign keys that reference it, triggers and partitions. \
    Needs 'Schema' or higher. Read-only; structure only (no rows).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connId": conn_id_prop(),
                    "schema": { "type": "string", "description": "the schema name (omit for the default schema)" },
                    "table": { "type": "string", "description": "the table or view name from db_list_objects" }
                },
                "required": ["connId", "table"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "db_get_definition",
            "description": "The definition (DDL text) of one object — it is shown, never run. kind: table, view, matview, foreign, function, procedure, trigger, index, sequence, type or constraint. \
    `reconstructed:true` means the engine has no stored text and the app rebuilt it from the catalog. Needs 'Schema' or higher. At most 64 KiB (truncated:true when cut).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connId": conn_id_prop(),
                    "kind": { "type": "string", "description": "table | view | matview | foreign | function | procedure | trigger | index | sequence | type | constraint" },
                    "name": { "type": "string", "description": "the object name" },
                    "schema": { "type": "string", "description": "the schema name (omit for the default schema)" },
                    "table": { "type": "string", "description": "the table a trigger or constraint belongs to (PostgreSQL needs it)" },
                    "args": { "type": "string", "description": "for a PostgreSQL function or procedure, the argument list from db_list_objects (tells overloads apart)" }
                },
                "required": ["connId", "kind", "name"],
                "additionalProperties": false
            }
        }),
    ];
    if max >= DbAiLevel::Read {
        tools.push(json!({
            "name": "db_query",
            "description": "Runs **read-only** SQL on one connection whose AI permission is 'Read' or higher and returns the rows. \
    ⚠️ The rows you read are sent to your model provider — ask only for what you need (filter, aggregate, count) instead of dumping tables. \
    Always read-only, whatever the user's own tile is doing: it runs on a separate AI-only connection, every statement must start with a read-only keyword \
    (PostgreSQL: SELECT, WITH, VALUES, TABLE, EXPLAIN, SHOW · MySQL/MariaDB: also DESCRIBE/DESC · SQLite: SELECT, WITH, VALUES, EXPLAIN, read-only PRAGMA), \
    and it runs inside a READ ONLY transaction — writes, DDL, transaction control and session changes are refused. (EXPLAIN ANALYZE really runs the query.) \
    Several statements separated by ';' run as one read-only script (one READ ONLY transaction, stops at the first error; script:true with per-statement results). \
    Limits: maxRows 50 by default, 500 at most (per statement); each cell is cut at 1 KiB (cellTruncated:true); the whole response at 256 KiB (truncated:true); timeoutSeconds 15 by default, 60 at most; one AI query per connection at a time. \
    Returns columns [{name, type}], rows (arrays in column order), rowCount, truncated, cellTruncated, elapsedMs. Integers beyond ±2^53 come back as strings, binary cells as {\"$bytes\": length, \"hex\": first bytes}. \
    Every call is recorded in the app's audit log (the SQL, row count and timing — not the values).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connId": conn_id_prop(),
                    "sql": { "type": "string", "description": "read-only SQL in the connection's dialect (one statement, or several separated by ';'), at most 64 KiB" },
                    "maxRows": { "type": "number", "description": "row limit per statement (50 by default, 500 at most)" },
                    "timeoutSeconds": { "type": "number", "description": "time limit in seconds (15 by default, 60 at most)" }
                },
                "required": ["connId", "sql"],
                "additionalProperties": false
            }
        }));
    }
    if max >= DbAiLevel::Approve {
        tools.push(json!({
            "name": WRITE_PLAN_TOOL,
            "description": "Saves a **database write task plan (draft)** for one connection whose AI permission is 'Ask' or higher. **This tool changes no data and opens no connection** — it only stores the plan. \
    Then call request_execution(operationId) so the user reviews it in the app; **only a person approves it there** — unless the connection's aiLevel is 'all' (YOLO) and auto-approval is on: then it is approved and run right away with no review — and the app itself runs it after approval. \
    Wait with wait_for_operation (about 5 minutes in total, then hand the turn back), then read the outcome with get_operation_results. \
    The app runs all statements **in one transaction on a separate write connection** (never the user's query tile): if a statement fails, the run is cancelled or times out, \
    or the affected rows of all statements together exceed maxAffected, **everything is rolled back before commit**. If the commit's answer is lost the outcome is 'unknown' and the app does not retry. \
    Right before running, the app checks again that the connection's AI permission is still 'Ask' or higher and that the connection still points at the same server — otherwise nothing runs. \
    statements: one SQL statement per item (1..20, 64 KiB together) in the connection's dialect — each is checked now (rejected here = no plan is made): \
    no transaction control (BEGIN/COMMIT/ROLLBACK/SAVEPOINT, SET autocommit), no MySQL/MariaDB DDL or LOCK TABLES (they commit implicitly — not allowed in a plan), no PostgreSQL statements that cannot run in a transaction (VACUUM, CREATE INDEX CONCURRENTLY …). \
    maxAffected is **required**: the most rows the statements together may change. Count first with db_query (SELECT count(*) … WHERE …) and pass that number. \
    Only INSERT/UPDATE/DELETE/MERGE/REPLACE report affected rows — DDL, TRUNCATE and WITH … are not counted (the review card marks them). \
    The result holds, per statement, the affected rows, time and up to 20 returned rows (RETURNING). Values are recorded nowhere but the result; the audit log keeps the SQL and row counts.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connId": conn_id_prop(),
                    "statements": { "type": "array", "items": { "type": "string" }, "description": "SQL statements, one per item, run in order in one transaction (1..20)" },
                    "summary": { "type": "string", "description": "required — plain text for the person approving it: what this does and why, in their language (300 characters at most, no markup)" },
                    "effect": { "type": "string", "enum": ["read", "write", "delete"], "description": "required — the strongest effect (DELETE/DROP/TRUNCATE = delete); the app classifies each statement itself and flags a weaker declaration" },
                    "maxAffected": { "type": "integer", "description": "required — the most rows all statements together may change (0..10000000); over it, everything is rolled back" },
                    "title": { "type": "string", "description": "a short title the person sees on the review card" },
                    "reason": { "type": "string", "description": "optional — why, only when there is a reason beyond the summary; kept in the run record and shown when the person expands the card" },
                    "timeoutSeconds": { "type": "integer", "description": "time limit per statement in seconds (30 by default, 300 at most)" },
                    "idempotencyKey": { "type": "string", "description": "a unique token per request — calling again with the same key returns the same plan instead of a new one" }
                },
                "required": ["connId", "statements", "maxAffected", "summary", "effect"],
                "additionalProperties": false
            }
        }));
    }
    tools
}

/// 그 연결의 **지금** 단계(끔 · 스냅샷 어긋남 · 없는 연결 = 끔) — `get_operation_results` 가 DB 결과의 행을 실을지 정한다.
pub(crate) fn level_of(d: &Delegation, env: &DbEnv, conn_id: &str) -> DbAiLevel {
    let Some(b) = &env.backend else {
        return DbAiLevel::Off;
    };
    shared(d, b.as_ref()).into_iter().find(|(c, _)| c.id == conn_id).map(|(_, l)| l).unwrap_or(DbAiLevel::Off)
}

/// `create_db_write_plan` — 권한 판정('Ask') → 사전 검증 → **초안 저장**(실행 · 연결 없음). 답은 `create_execution_plan` 과 같은 꼴.
pub(crate) fn create_write_plan(
    args: Option<&Value>,
    d: &Delegation,
    env: &DbEnv,
    ops: &crate::operations::OperationStore,
    requested_by: Option<String>,
) -> Result<Value, String> {
    use crate::operations;
    let args = args.ok_or("Arguments are required")?;
    let id = str_arg(Some(args), "connId").map(str::trim).filter(|s| !s.is_empty()).ok_or("The connId argument is missing")?;
    let id: String = id.chars().take(64).collect();
    let Some(b) = &env.backend else {
        return Err(unknown_conn(&id));
    };
    let Some(conn) = b.connections().into_iter().find(|c| c.id == id) else {
        return Err(unknown_conn(&id));
    };
    let vt = conn.via.as_deref().and_then(|v| b.via_target(v));
    let grant = match ai::authorize(d, &conn, vt.as_deref(), DbAiLevel::Approve) {
        Ok(g) => g,
        Err(Denied::Off) => return Err(unknown_conn(&id)),
        Err(Denied::Below(have)) => {
            let name = have.name();
            return Err(format!(
                "This connection's AI permission is '{name}' — a write plan needs 'Ask'. Only the user can change it, in the app \
                 (database connection form › AI permission, or the dock's right-click menu)."
            ));
        }
    };
    // 승인 요약(필수) — 권한 판정 뒤(권한 밖이면 연결이 없는 것처럼 답하는 규칙을 이 인자가 앞질러 흘리지 않게).
    let (summary, effect) = super::plan::declaration_args(args)?;
    let raw = args.get("statements").and_then(Value::as_array).ok_or("A statements array is required (one SQL statement per item)")?;
    let mut statements = Vec::with_capacity(raw.len());
    for (i, v) in raw.iter().enumerate() {
        let s = v.as_str().ok_or_else(|| format!("statements[{i}] is not a string"))?;
        statements.push(s.to_string());
    }
    let max_affected = crate::db::ai_plan::max_affected(args.get("maxAffected"))?;
    let timeout_seconds = crate::db::ai_plan::stmt_timeout(args.get("timeoutSeconds"))?;
    let checked = crate::db::ai_plan::check(&statements, crate::db::ai_plan::dialect_of(conn.engine))?;
    let text = |k: &str| opt_string(Some(args), k).map(|s| s.chars().take(4096).collect::<String>());
    let (title, reason, key) = (text("title"), text("reason"), text("idempotencyKey"));
    let plan = operations::DbPlan {
        conn_id: conn.id.clone(),
        conn_name: conn.name.clone(),
        engine: engine_name(&conn).to_string(),
        database: conn.database.clone(),
        through_ssh: conn.via.is_some(),
        statements: checked
            .into_iter()
            .map(|c| operations::DbPlanStmt { sql: c.text, keyword: c.keyword, counted: c.counted, uncounted: c.uncounted })
            .collect(),
        max_affected,
        timeout_seconds,
        identity: Some(grant.identity()),
    };
    let operation_id = operations::new_operation_id().ok_or("No randomness source to make a task plan id")?;
    let op = {
        let mut map = ops.lock().map_err(|_| "Could not lock the task plan store".to_string())?;
        if let Some(k) = key.as_deref() {
            if let Some(existing) = operations::find_by_idempotency_key(&map, k) {
                return Ok(super::plan_reply(existing.clone()));
            }
        }
        operations::create_db_plan(&mut map, operation_id.clone(), plan, title, reason, operations::now_ms(), key);
        let decl = operations::Declaration { summary, effect, requested_by, target_labels: Default::default() };
        operations::declare(&mut map, &operation_id, decl).ok_or("internal: the saved task plan vanished")?
    };
    Ok(super::plan_reply(op))
}

fn str_arg<'a>(args: Option<&'a Value>, key: &str) -> Option<&'a str> {
    args.and_then(|a| a.get(key)).and_then(Value::as_str)
}

fn opt_string(args: Option<&Value>, key: &str) -> Option<String> {
    str_arg(args, key).map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned)
}

fn num_arg(args: Option<&Value>, key: &str) -> Option<u64> {
    args.and_then(|a| a.get(key)).and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f.max(0.0) as u64)))
}

fn unknown_conn(id: &str) -> String {
    format!("Unknown database connection '{id}' — call list_db_connections for the connections shared with AI")
}

/// 도구 이름 · 인자 → 요청과 감사 글자.
fn request_of(name: &str, args: Option<&Value>) -> Result<(AiRequest, String), String> {
    let schema = opt_string(args, "schema");
    let schema_note = schema.as_deref().map(|s| format!(" schema={s}")).unwrap_or_default();
    Ok(match name {
        "db_list_schemas" => (AiRequest::Schemas, name.to_string()),
        "db_list_objects" => (AiRequest::Objects { schema }, format!("{name}{schema_note}")),
        "db_describe_table" => {
            let table = opt_string(args, "table").ok_or("The table argument is missing")?;
            let note = format!("{name}{schema_note} table={table}");
            (AiRequest::Describe { schema, table }, note)
        }
        "db_get_definition" => {
            let kind = opt_string(args, "kind").ok_or("The kind argument is missing")?;
            let obj = opt_string(args, "name").ok_or("The name argument is missing")?;
            let note = format!("{name} kind={kind}{schema_note} name={obj}");
            let target = DefTarget {
                schema,
                kind,
                name: obj,
                table: opt_string(args, "table"),
                args: str_arg(args, "args").map(str::to_owned),
            };
            (AiRequest::Definition(target), note)
        }
        "db_query" => {
            let sql = str_arg(args, "sql").map(str::to_owned).filter(|s| !s.trim().is_empty()).ok_or("The sql argument is missing")?;
            let (max_rows, timeout_ms) = ai::clamp_query(num_arg(args, "maxRows"), num_arg(args, "timeoutSeconds"));
            (AiRequest::Query { sql: sql.clone(), max_rows, timeout_ms }, sql)
        }
        other => return Err(format!("Unknown tool: {other}")),
    })
}

fn engine_name(c: &DbConn) -> &'static str {
    crate::delegation::database::engine_str(c.engine)
}

/// `list_db_connections` — 권한이 끔이 아닌 연결만(비밀 · 주소 없음).
fn list(d: &Delegation, env: &DbEnv) -> Value {
    let Some(b) = &env.backend else {
        return json!([]);
    };
    let items: Vec<Value> = shared(d, b.as_ref())
        .into_iter()
        .map(|(c, level)| {
            let mut v = json!({
                "connId": c.id,
                "name": c.name,
                "engine": engine_name(&c),
                "throughSsh": c.via.is_some(),
                "aiLevel": level.as_str(),
            });
            if let Some(db) = &c.database {
                v["database"] = json!(db);
            }
            v
        })
        .collect();
    json!(items)
}

/// DB 도구 하나 — 판정 → 뒷면 → 감사.
pub(crate) fn call(name: &str, args: Option<&Value>, d: &Delegation, env: &DbEnv) -> Result<Value, String> {
    if name == "list_db_connections" {
        return Ok(list(d, env));
    }
    let id = str_arg(args, "connId").map(str::trim).filter(|s| !s.is_empty()).ok_or("The connId argument is missing")?;
    let id: String = id.chars().take(64).collect();
    let (req, command) = request_of(name, args)?;
    let Some(b) = &env.backend else {
        return Err(unknown_conn(&id));
    };
    let conn = b.connections().into_iter().find(|c| c.id == id);
    let started = Instant::now();
    let audit = |engine: &str, rows: Option<u64>, outcome: &str| {
        let read = AuditDbRead {
            tool: name.to_string(),
            conn_id: id.clone(),
            engine: engine.to_string(),
            rows,
            elapsed_ms: started.elapsed().as_millis() as u64,
            outcome: outcome.to_string(),
        };
        b.audit(AuditRecord::db_read(command.clone(), read, crate::operations::now_ms()));
    };
    let Some(conn) = conn else {
        audit("", None, "denied");
        return Err(unknown_conn(&id));
    };
    let vt = conn.via.as_deref().and_then(|v| b.via_target(v));
    let grant = match ai::authorize(d, &conn, vt.as_deref(), req.needs()) {
        Ok(g) => g,
        Err(why) => {
            audit(engine_name(&conn), None, "denied");
            return Err(match why {
                Denied::Off => unknown_conn(&id),
                Denied::Below(have) => format!(
                    "This connection's AI permission is '{}' — {name} needs '{}' or higher. Only the user can change it, in the app \
                     (database connection form › AI permission).",
                    have.name(),
                    DbAiLevel::Read.name()
                ),
            });
        }
    };
    match b.run(&grant, req) {
        Ok(out) => {
            audit(engine_name(&conn), out.rows, "ok");
            let mut v = out.value;
            if let Some(o) = v.as_object_mut() {
                o.insert("connId".into(), json!(id));
            }
            Ok(v)
        }
        Err(e) => {
            audit(engine_name(&conn), None, "error");
            Err(e)
        }
    }
}

use super::*;
use serde_json::{json, Value};
use std::io::Write;

const U1: &str = "11111111-2222-4333-8444-555555555555";
const X1: &str = "01a07989-25f8-7e72-99aa-000000000001";
const X2: &str = "01a07989-25f8-7e72-99aa-000000000002";

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = std::env::temp_dir().join(format!("aynx-usage-{}-{tag}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn write_lines(path: &Path, vs: &[Value]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let s: String = vs.iter().map(|v| v.to_string() + "\n").collect();
    std::fs::write(path, s).unwrap();
}

fn append(path: &Path, s: &str) {
    let mut f = std::fs::OpenOptions::new().append(true).open(path).unwrap();
    f.write_all(s.as_bytes()).unwrap();
}

/// 지금 시각의 RFC 3339 (오늘로 버킷된다).
fn now_ts() -> String {
    chrono::Local::now().to_rfc3339()
}

fn old_ts() -> String {
    "2020-01-02T03:04:05.000Z".into()
}

// ---- 합성 픽스처 — 줄의 **모양**만 본떴다 ----

fn c_asst(mid: &str, rid: &str, ts: &str, input: u64, cw: u64, cr: u64, out: u64) -> Value {
    json!({"type": "assistant", "timestamp": ts, "requestId": rid, "isSidechain": false,
           "message": {"id": mid, "model": "claude-x", "content": [{"type": "text", "text": "지어낸 본문 \"usage\""}],
                       "usage": {"input_tokens": input, "cache_creation_input_tokens": cw, "cache_read_input_tokens": cr, "output_tokens": out}}})
}

fn c_user(ts: &str) -> Value {
    json!({"type": "user", "timestamp": ts, "cwd": "C:\\w", "message": {"role": "user", "content": "hi"}})
}

fn x_meta(id: &str, fork: Option<&str>) -> Value {
    let mut pl = json!({"id": id, "cwd": "C:\\w", "timestamp": "2026-09-20T00:00:00.000Z", "source": "cli", "base_instructions": {"text": "긴 지침"}});
    if let Some(f) = fork {
        pl["forked_from_id"] = json!(f);
    }
    json!({"type": "session_meta", "timestamp": "2026-09-20T00:00:00.000Z", "payload": pl})
}

fn xu(input: u64, cached: u64, out: u64) -> Value {
    json!({"input_tokens": input, "cached_input_tokens": cached, "cache_write_input_tokens": 0,
           "output_tokens": out, "reasoning_output_tokens": 0, "total_tokens": input + out})
}

fn x_tc(ts: &str, total: (u64, u64, u64), last: (u64, u64, u64), limits: Option<Value>) -> Value {
    let mut pl = json!({"type": "token_count", "info": {"total_token_usage": xu(total.0, total.1, total.2),
                        "last_token_usage": xu(last.0, last.1, last.2), "model_context_window": 1000}});
    if let Some(l) = limits {
        pl["rate_limits"] = l;
    }
    json!({"type": "event_msg", "timestamp": ts, "payload": pl})
}

fn x_tur(ts: &str, rid: &str, u: (u64, u64, u64)) -> Value {
    json!({"type": "token_usage_record", "timestamp": ts,
           "payload": {"response_id": rid, "usage": xu(u.0, u.1, u.2), "turn_token_usage": xu(0, 0, 0), "thread_token_usage": xu(0, 0, 0)}})
}

fn rl(pct: f64, minutes: u64, id: &str) -> Value {
    json!({"limit_id": id, "primary": {"used_percent": pct, "window_minutes": minutes, "resets_at": 1_900_000_000}, "secondary": null, "plan_type": "plus"})
}

fn one(path: &Path, src: &'static UsageSource) -> FileUsage {
    let st = sessions::stamp(path.to_path_buf()).unwrap();
    let mut e = Entry::fresh("t");
    catch_up(&mut e, &st, src);
    e.usage
}

fn sum(u: &FileUsage) -> Tokens {
    let mut t = Tokens::default();
    for v in u.days().values() {
        t.add(v);
    }
    t
}

#[test]
fn claude_dedupes_by_message_and_request_taking_the_max_per_field() {
    let d = temp_dir("c-dedupe");
    let f = d.join("p").join(format!("{U1}.jsonl"));
    let ts = now_ts();
    write_lines(
        &f,
        &[
            c_user(&ts),
            c_asst("m1", "r1", &ts, 10, 100, 1000, 1),
            c_asst("m1", "r1", &ts, 10, 100, 1000, 7), // 스트리밍 — 출력이 자랐다
            c_asst("m1", "r1", &ts, 10, 100, 1000, 7),
            c_asst("m2", "r2", &ts, 5, 0, 50, 3),
        ],
    );
    let t = sum(&one(&f, &CLAUDE_USAGE));
    assert_eq!(
        t,
        Tokens {
            input: 15,
            cache_read: 1050,
            cache_write: 100,
            output: 10
        }
    );
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn claude_conversation_includes_subagent_files_and_buckets_by_day() {
    let d = temp_dir("c-sub");
    let root = d.join("projects");
    let proj = root.join("C--w");
    let main = proj.join(format!("{U1}.jsonl"));
    let (now, old) = (now_ts(), old_ts());
    write_lines(
        &main,
        &[
            c_user(&now),
            c_asst("m1", "r1", &now, 1, 0, 0, 1),
            c_asst("m0", "r0", &old, 100, 0, 0, 0),
        ],
    );
    write_lines(
        &proj.join(U1).join("subagents").join("agent-a.jsonl"),
        &[c_asst("s1", "q1", &now, 10, 0, 0, 10)],
    );
    write_lines(
        &proj
            .join(U1)
            .join("subagents")
            .join("workflows")
            .join("wf_1")
            .join("agent-b.jsonl"),
        &[c_asst("s2", "q2", &now, 0, 0, 0, 5)],
    );
    let claude = sessions::target("claude").unwrap();
    let r = scan(&[(claude, vec![root])]);
    let c = r.conversations.iter().find(|c| c.id == U1).unwrap();
    assert_eq!(c.total, 127);
    assert_eq!(
        (c.today, c.week),
        (27, 27),
        "옛 날짜의 100 은 오늘·7일에 들지 않는다"
    );
    assert!(c.subagents && !c.forked);
    assert_eq!(r.files, 3);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn a_deleted_conversation_drops_out_of_the_totals_and_the_cache() {
    // 지난 대화 지우기(`agent_sessions::delete`) 뒤 — 캐시에 누적이 남아 있어도 사라진 파일은 세지 않고, `forget` 이 캐시에서도 뺀다.
    let d = temp_dir("c-del");
    let root = d.join("projects");
    let proj = root.join("C--w");
    let main = proj.join(format!("{U1}.jsonl"));
    let now = now_ts();
    write_lines(&main, &[c_user(&now), c_asst("m1", "r1", &now, 1, 0, 0, 1)]);
    let sub = proj.join(U1).join("subagents").join("agent-a.jsonl");
    write_lines(&sub, &[c_asst("s1", "q1", &now, 10, 0, 0, 10)]);
    let claude = sessions::target("claude").unwrap();
    let r = scan(&[(claude, vec![root.clone()])]);
    assert_eq!(r.conversations.iter().find(|c| c.id == U1).unwrap().total, 22);
    std::fs::remove_file(&main).unwrap();
    std::fs::remove_dir_all(proj.join(U1)).unwrap();
    // forget 전에도 합계에는 없다(대화는 있는 파일에서만 짓는다).
    let r = scan(&[(claude, vec![root.clone()])]);
    assert!(r.conversations.iter().all(|c| c.id != U1));
    assert!(CACHE.lock().unwrap().contains_key(&main), "캐시에는 아직 남아 있다");
    forget(&main, Some(&proj.join(U1)));
    let cache = CACHE.lock().unwrap();
    assert!(!cache.contains_key(&main) && !cache.contains_key(&sub));
    drop(cache);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn incremental_reads_only_appended_lines_and_keeps_partial_lines_for_later() {
    let d = temp_dir("inc");
    let f = d.join(format!("{U1}.jsonl"));
    let ts = now_ts();
    write_lines(&f, &[c_asst("m1", "r1", &ts, 1, 0, 0, 1)]);
    let mut e = Entry::fresh("claude");
    catch_up(&mut e, &sessions::stamp(f.clone()).unwrap(), &CLAUDE_USAGE);
    assert_eq!(sum(&e.usage).total(), 2);
    let first_offset = e.offset;

    // 반쯤 적힌 줄 — 세지 않고 자리도 옮기지 않는다
    let line = c_asst("m2", "r2", &ts, 10, 0, 0, 10).to_string();
    let (a, b) = line.split_at(line.len() / 2);
    append(&f, a);
    catch_up(&mut e, &sessions::stamp(f.clone()).unwrap(), &CLAUDE_USAGE);
    assert_eq!(sum(&e.usage).total(), 2);
    assert_eq!(e.offset, first_offset);

    append(&f, &format!("{b}\n"));
    catch_up(&mut e, &sessions::stamp(f.clone()).unwrap(), &CLAUDE_USAGE);
    assert_eq!(sum(&e.usage).total(), 22, "마저 적힌 줄을 읽었다");

    // 줄어든 파일 — 처음부터 다시
    write_lines(&f, &[c_asst("m9", "r9", &ts, 0, 0, 0, 4)]);
    catch_up(&mut e, &sessions::stamp(f.clone()).unwrap(), &CLAUDE_USAGE);
    assert_eq!(sum(&e.usage).total(), 4);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn codex_counts_cumulative_deltas_and_ignores_the_forks_inherited_total() {
    let d = temp_dir("x-fork");
    let ts = now_ts();
    // 포크: 첫 누적 1000(부모 몫 900 + 이 응답 100) → 이 파일의 몫은 100 + 50 = 150
    let fork = d.join("fork.jsonl");
    write_lines(
        &fork,
        &[
            x_meta(X2, Some(X1)),
            x_tc(&ts, (1000, 0, 0), (100, 0, 0), None),
            x_tc(&ts, (1000, 0, 0), (100, 0, 0), None), // 같은 누적의 되풀이 — 0
            x_tc(&ts, (1030, 0, 20), (30, 0, 20), None),
        ],
    );
    let u = one(&fork, &CODEX_USAGE);
    assert!(u.forked);
    assert_eq!(u.meta_id.as_deref(), Some(X2));
    assert_eq!(sum(&u).total(), 150);

    // 누적이 줄었다(다시 이어 띄움) → 새 구간은 그 줄의 last 부터
    let reset = d.join("reset.jsonl");
    write_lines(
        &reset,
        &[
            x_meta(X1, None),
            x_tc(&ts, (100, 0, 0), (100, 0, 0), None),
            x_tc(&ts, (500, 0, 0), (400, 0, 0), None),
            x_tc(&ts, (70, 0, 0), (70, 0, 0), None),
        ],
    );
    assert_eq!(sum(&one(&reset, &CODEX_USAGE)).total(), 570);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn codex_prefers_usage_records_per_epoch_and_splits_cached_input() {
    let d = temp_dir("x-tur");
    let ts = now_ts();
    let f = d.join("r.jsonl");
    write_lines(
        &f,
        &[
            x_meta(X1, None),
            // 구간 1: 응답 기록 앞의 누적 차 40 + 응답 기록 둘(100 · 60) — 기록 뒤의 누적 차는 세지 않는다
            x_tc(&ts, (40, 0, 0), (40, 0, 0), None),
            x_tur(&ts, "resp-1", (80, 30, 20)),
            x_tc(&ts, (140, 30, 20), (100, 30, 20), None),
            x_tur(&ts, "resp-2", (50, 0, 10)),
            x_tur(&ts, "resp-2", (50, 0, 10)), // 같은 응답 — 한 번
            x_tc(&ts, (200, 30, 30), (60, 0, 10), None),
            // 구간 2(옛 CLI 로 다시 이음 — 응답 기록 없음): 누적 차만
            x_tc(&ts, (25, 0, 5), (25, 0, 5), None),
            x_tc(&ts, (45, 0, 5), (20, 0, 0), None),
        ],
    );
    let t = sum(&one(&f, &CODEX_USAGE));
    assert_eq!(t.total(), 40 + 100 + 60 + 45 + 5);
    assert_eq!(t.cache_read, 30, "캐시 몫은 입력에서 빼 캐시 읽기로");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn codex_limits_take_the_latest_codex_window_and_skip_other_limit_ids() {
    let d = temp_dir("x-lim");
    let root = d.join("sessions");
    let f1 = root
        .join("2026")
        .join("09")
        .join("20")
        .join(format!("rollout-a-{X1}.jsonl"));
    let f2 = root
        .join("2026")
        .join("09")
        .join("21")
        .join(format!("rollout-b-{X2}.jsonl"));
    write_lines(
        &f1,
        &[
            x_meta(X1, None),
            x_tc(
                "2026-09-21T10:00:00.000Z",
                (1, 0, 0),
                (1, 0, 0),
                Some(rl(55.0, 10080, "codex")),
            ),
        ],
    );
    write_lines(
        &f2,
        &[
            x_meta(X2, None),
            x_tc(
                "2026-09-21T09:00:00.000Z",
                (1, 0, 0),
                (1, 0, 0),
                Some(rl(40.0, 10080, "codex")),
            ),
            x_tc(
                "2026-09-21T11:00:00.000Z",
                (1, 0, 0),
                (1, 0, 0),
                Some(rl(0.0, 10080, "base_model_inference")),
            ),
        ],
    );
    let s = codex_rollout_limits(&Layout::DateTree, &[root]).unwrap();
    assert_eq!(s.windows.len(), 1);
    assert_eq!(
        s.windows[0].used_percent, 55.0,
        "줄 시각이 가장 늦은 codex 창"
    );
    assert_eq!(s.windows[0].window_minutes, Some(10080));
    assert_eq!(s.windows[0].resets_at, Some(1_900_000_000));
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn scan_joins_codex_files_with_the_same_id_and_reports_forks() {
    let d = temp_dir("x-scan");
    let root = d.join("sessions");
    let ts = now_ts();
    let day = root.join("2026").join("09").join("26");
    write_lines(
        &day.join(format!("rollout-a-{X1}.jsonl")),
        &[x_meta(X1, None), x_tc(&ts, (10, 0, 0), (10, 0, 0), None)],
    );
    write_lines(
        &day.join(format!("rollout-b-{X1}_{X2}.jsonl")),
        &[
            x_meta(X2, Some(X1)),
            x_tc(&ts, (510, 0, 0), (7, 0, 0), None),
        ],
    );
    write_lines(
        &day.join(format!("rollout-c-{X2}.jsonl")),
        &[
            x_meta(X2, Some(X1)),
            x_tc(&ts, (900, 0, 0), (3, 0, 0), None),
        ],
    );
    let codex = sessions::target("codex").unwrap();
    let r = scan(&[(codex, vec![root])]);
    let a = r.conversations.iter().find(|c| c.id == X1).unwrap();
    let b = r.conversations.iter().find(|c| c.id == X2).unwrap();
    assert_eq!((a.total, a.forked), (10, false));
    assert_eq!(
        (b.total, b.today, b.forked),
        (10, 10, true),
        "같은 id 의 두 파일을 제 몫만 더한다"
    );
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn lines_without_needles_are_not_parsed_and_bad_lines_are_skipped() {
    let mut u = FileUsage::default();
    let finders: Vec<memchr::memmem::Finder<'_>> = CLAUDE_USAGE
        .needles
        .iter()
        .map(|n| memchr::memmem::Finder::new(n.as_bytes()))
        .collect();
    assert!(!wanted(
        &finders,
        br#"{"type":"user","message":{"content":"x"}}"#
    ));
    claude_line(&mut u, b"{not json");
    claude_line(
        &mut u,
        br#"{"type":"assistant","message":{"id":"m","usage":"weird"}}"#,
    );
    assert!(u.keyed.is_empty());
}

// ---- 기간 요약 ----

/// 로컬 날짜의 한낮 — 픽스처 줄의 시각(버킷이 그 날짜에 떨어진다).
fn ts_on(d: Day) -> String {
    use chrono::TimeZone;
    let date = chrono::NaiveDate::from_num_days_from_ce_opt(d).unwrap();
    chrono::Local
        .from_local_datetime(&date.and_hms_opt(12, 0, 0).unwrap())
        .single()
        .unwrap()
        .to_rfc3339()
}

fn c_asst_m(mid: &str, ts: &str, model: &str, cr: u64, out: u64) -> Value {
    let mut v = c_asst(mid, "r", ts, 1, 2, cr, out);
    v["message"]["model"] = json!(model);
    v
}

fn x_turn(ts: &str, model: &str) -> Value {
    json!({"type": "turn_context", "timestamp": ts, "payload": {"cwd": "C:/w", "model": model}})
}

/// 픽스처 둘: Claude 대화 둘(모델 둘 · 서브에이전트) + Codex 대화 하나(턴 중 모델 바뀜).
fn summary_fixture(
    tag: &str,
    today: Day,
) -> (PathBuf, Vec<(&'static SessionTarget, Vec<PathBuf>)>) {
    let d = temp_dir(tag);
    let croot = d.join("projects");
    let proj = croot.join("C--w");
    write_lines(
        &proj.join(format!("{U1}.jsonl")),
        &[
            c_asst_m("a1", &ts_on(today), "claude-opus-5-20260101", 100, 10),
            c_asst_m("a2", &ts_on(today - 1), "claude-opus-5-20260101", 50, 5),
            c_asst_m("a3", &ts_on(today - 40), "claude-sonnet-5", 7, 3),
            c_asst_m("a0", &ts_on(today), "<synthetic>", 0, 0),
        ],
    );
    write_lines(
        &proj.join(U1).join("subagents").join("agent-x.jsonl"),
        &[c_asst_m("s1", &ts_on(today), "claude-haiku-5", 20, 2)],
    );
    let other = "22222222-2222-4222-8222-222222222222";
    write_lines(
        &proj.join(format!("{other}.jsonl")),
        &[c_asst_m(
            "b1",
            &ts_on(today - 2),
            "claude-opus-5-20260101",
            30,
            3,
        )],
    );
    let xroot = d.join("sessions");
    let t = ts_on(today);
    write_lines(
        &xroot
            .join("2026")
            .join("09")
            .join("26")
            .join(format!("rollout-a-{X1}.jsonl")),
        &[
            x_meta(X1, None),
            x_turn(&t, "gpt-6-codex"),
            x_tc(&t, (100, 40, 10), (100, 40, 10), None),
            x_turn(&t, "gpt-6-mini"),
            x_tc(&t, (150, 40, 20), (50, 0, 10), None),
        ],
    );
    let c = sessions::target("claude").unwrap();
    let x = sessions::target("codex").unwrap();
    (d, vec![(c, vec![croot]), (x, vec![xroot])])
}

#[test]
fn summary_sums_agree_across_days_buckets_and_models() {
    let today = super::today();
    let (d, src) = summary_fixture("sum", today);
    let s = summarize(&src, Some(30), None, today);
    assert_eq!(s.daily.len(), 30);
    assert_eq!(s.daily.last().unwrap().date, s.today);
    let by_days: u64 = s.daily.iter().map(|x| x.total).sum();
    let by_buckets: u64 = s
        .buckets
        .iter()
        .filter(|b| b.date >= s.start)
        .map(|x| x.total)
        .sum();
    let by_models: u64 = s.models.iter().map(|x| x.total).sum();
    assert_eq!(
        (by_days, by_buckets),
        (by_models, by_models),
        "날짜 = 칸 = 모델"
    );
    // 에이전트별 합도 같은 값
    let per_agent: u64 = ["claude", "codex"]
        .iter()
        .map(|a| {
            s.buckets
                .iter()
                .filter(|b| b.agent == *a && b.date >= s.start)
                .map(|b| b.total)
                .sum::<u64>()
        })
        .sum();
    assert_eq!(per_agent, by_days);
    // 40일 전의 sonnet 은 30일 기간 밖 · synthetic 은 없다
    assert!(s
        .models
        .iter()
        .all(|m| m.model != "claude-sonnet-5" && !m.model.starts_with('<')));
    assert_eq!(s.agents, vec!["claude", "codex"]);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn summary_models_carry_codex_turn_models_and_distinct_conversations() {
    let today = super::today();
    let (d, src) = summary_fixture("models", today);
    let s = summarize(&src, Some(7), None, today);
    let m = |name: &str| s.models.iter().find(|m| m.model == name).cloned().unwrap();
    assert_eq!(m("gpt-6-codex").total, 110, "턴의 모델로 — 첫 기록은 last");
    assert_eq!(m("gpt-6-mini").total, 60, "모델이 바뀐 뒤의 누적 차");
    assert_eq!(m("gpt-6-codex").tokens.cache_read, 40);
    let opus = m("claude-opus-5-20260101");
    assert_eq!(opus.conversations, 2, "서로 다른 대화 둘");
    assert_eq!(
        m("claude-haiku-5").conversations,
        1,
        "서브에이전트는 부모 대화로 센다"
    );
    // 거르개 — Codex 만
    let x = summarize(&src, Some(7), Some("codex"), today);
    assert!(x.buckets.iter().all(|b| b.agent == "codex"));
    assert_eq!(x.daily.iter().map(|d| d.total).sum::<u64>(), 170);
    // 7일 기간이어도 잔디의 35일과 그 칸이 온다(그제의 opus 는 7일 안 · 40일 전 sonnet 은 35일 밖)
    assert_eq!(s.recent.len(), 35);
    assert_eq!(s.recent.last().unwrap().date, s.today);
    assert!(s.buckets.iter().all(|b| b.model != "claude-sonnet-5"));
    assert_eq!(x.agents, vec!["claude", "codex"], "칩은 거르개와 무관");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn summary_streak_prior_average_and_whole_history() {
    let today = super::today();
    let (d, src) = summary_fixture("streak", today);
    let s = summarize(&src, Some(7), Some("claude"), today);
    assert_eq!(s.streak, 3, "오늘 · 어제 · 그제");
    // 기록 시작(40일 전) 뒤의 앞 7일: 어제 1+2+50+5=58 · 그제 1+2+30+3=36 · 나머지 0
    assert_eq!(s.prior_days, 7);
    assert!((s.prior_avg.unwrap() - 94.0 / 7.0).abs() < 1e-9);
    let all = summarize(&src, None, Some("claude"), today);
    assert_eq!(all.start, all.first_day.clone().unwrap());
    assert_eq!(all.daily.len(), 41);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn summary_without_records_is_empty_not_invented() {
    let d = temp_dir("empty");
    let c = sessions::target("claude").unwrap();
    let today = super::today();
    let s = summarize(&[(c, vec![d.join("none")])], Some(30), None, today);
    assert!(
        s.first_day.is_none() && s.agents.is_empty() && s.buckets.is_empty() && s.models.is_empty()
    );
    assert_eq!((s.streak, s.prior_avg, s.daily.len()), (0, None, 30));
    let _ = std::fs::remove_dir_all(&d);
}

// ---- 원격 판이 빌려 쓰는 것 (docs/log/2026-09-27-remote-conversations.md "2단계") ----

fn bytes_of(vs: &[Value]) -> Vec<u8> {
    vs.iter()
        .map(|v| {
            v.to_string()
                + "
"
        })
        .collect::<String>()
        .into_bytes()
}

#[test]
fn feeding_lines_in_pieces_counts_the_same_as_reading_the_whole_file() {
    let ts = now_ts();
    let vs = vec![
        c_user(&ts),
        c_asst("m1", "r1", &ts, 10, 100, 1000, 1),
        c_asst("m1", "r1", &ts, 10, 100, 1000, 7),
        c_asst("m2", "r2", &ts, 5, 0, 50, 3),
        c_asst("m3", "r3", &old_ts(), 1, 2, 3, 4),
    ];
    let d = temp_dir("feed");
    let f = d.join("p").join(format!("{U1}.jsonl"));
    write_lines(&f, &vs);
    let whole = one(&f, &CLAUDE_USAGE);
    let bytes = bytes_of(&vs);
    // 아무 자리에서나 잘라 먹여도(끝의 반쯤 온 줄은 먹지 않고 다음 조각이 그 자리부터) 같은 수
    for cut in [1usize, 17, 200, bytes.len() / 2, bytes.len() - 1] {
        let mut u = FileUsage::default();
        let mut at = 0usize;
        for piece_end in [cut, bytes.len()] {
            let n = feed_lines("claude", &mut u, &bytes[at..piece_end.max(at)]);
            at += n as usize;
        }
        assert_eq!(at, bytes.len(), "끝까지 먹었다 ({cut})");
        assert_eq!(sum(&u), sum(&whole), "잘린 자리 {cut}");
        assert_eq!(file_tokens(&u), sum(&whole));
    }
    assert_eq!(
        feed_lines("claude", &mut FileUsage::default(), b"{\"half"),
        0,
        "줄바꿈이 없으면 먹지 않는다"
    );
    assert!(needles_of("claude").contains(&"\"usage\""));
    assert!(needles_of("codex").contains(&"token_count"));
    assert!(needles_of("nope").is_empty());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn summaries_add_files_from_several_sources_and_codex_limits_come_from_bytes() {
    let ts = now_ts();
    let mut a = FileUsage::default();
    feed_lines(
        "claude",
        &mut a,
        &bytes_of(&[c_asst("m1", "r1", &ts, 10, 0, 0, 5)]),
    );
    let mut b = FileUsage::default();
    feed_lines(
        "claude",
        &mut b,
        &bytes_of(&[c_asst("m9", "r9", &ts, 100, 0, 0, 50)]),
    );
    let today = today();
    let one_src = summarize_files(vec![("claude", "a".into(), &a)], Some(7), None, today);
    let both = summarize_files(
        vec![("claude", "a".into(), &a), ("claude", "b".into(), &b)],
        Some(7),
        None,
        today,
    );
    assert_eq!(one_src.daily.last().unwrap().total, 15);
    assert_eq!(
        both.daily.last().unwrap().total,
        165,
        "이 PC 와 서버의 몫이 한 잔디로 더해진다"
    );
    assert_eq!(both.models[0].conversations, 2);
    assert!(both.remote.is_empty());

    let tail = bytes_of(&[
        x_tc(
            "2026-09-20T00:00:01.000Z",
            (10, 0, 1),
            (10, 0, 1),
            Some(rl(12.0, 300, "codex")),
        ),
        x_tc(
            "2026-09-20T00:00:09.000Z",
            (20, 0, 2),
            (10, 0, 1),
            Some(rl(40.0, 300, "codex")),
        ),
    ]);
    let (at, w) = codex_limits_in(&tail).expect("한도가 있다");
    assert_eq!(w[0].used_percent, 40.0, "가장 늦은 줄");
    assert!(at > 0);
    let l = remote_codex_limits(Some((at, w)));
    assert_eq!((l.agent, l.seen, l.windows.len()), ("codex", true, 1));
    assert!(remote_codex_limits(None).windows.is_empty());
}

use super::*;
use serde_json::json;

const U1: &str = "11111111-2222-4333-8444-555555555555";
const X1: &str = "01a07989-25f8-7e72-99aa-000000000001";

fn lines(vs: &[Value]) -> Vec<u8> {
    let mut s = String::new();
    for v in vs {
        s.push_str(&v.to_string());
        s.push('\n');
    }
    s.into_bytes()
}

const LISTING: &str = "N 1727400000\nH /home/deploy\nC /home/deploy/.claude/projects\nX /home/deploy/.codex/sessions\n\
c 2048 1727399990.5000000000 /home/deploy/.claude/projects/-home-deploy-api/11111111-2222-4333-8444-555555555555.jsonl\n\
x 900 1727399000 /home/deploy/.codex/sessions/2026/09/27/rollout-2026-09-27T10-00-00-01a07989-25f8-7e72-99aa-000000000001.jsonl\n\
c 10 1727300000 /home/deploy/.claude/projects/deep/sub/x.jsonl\n\
c 10 1727300000 /etc/passwd.jsonl\n\
c 10 1727300000 /home/deploy/.claude/projects/a/../../x.jsonl\n\
x 10 1727300000 /home/deploy/.codex/sessions/2026/09/27/notrollout.jsonl\n\
c bad 1 /home/deploy/.claude/projects/a/b.jsonl\n\
i 300 1727399999 /home/deploy/.codex/session_index.jsonl\n";

#[test]
fn listing_parses_gnu_find_lines_and_keeps_only_well_shaped_paths_under_the_roots() {
    let l = parse_listing(LISTING).expect("머리 줄이 다 있다");
    assert_eq!(l.now_s, Some(1727400000));
    assert_eq!(l.home.as_deref(), Some("/home/deploy"));
    assert_eq!(
        l.files.len(),
        2,
        "루트 밖 · 깊이가 다른 것 · `..` · rollout 이 아닌 것 · 숫자가 아닌 것은 버린다"
    );
    assert_eq!(l.files[0].agent, "claude", "mtime 내림차순");
    assert_eq!(l.files[0].mtime_ms, 1727399990500);
    assert_eq!(l.files[0].size, 2048);
    assert_eq!(l.files[1].agent, "codex");
    assert_eq!(
        l.index.as_ref().map(|i| i.path.as_str()),
        Some("/home/deploy/.codex/session_index.jsonl")
    );
}

#[test]
fn listing_accepts_stat_fallback_integers_and_paths_with_spaces() {
    let out = "N 5\nH /root\nC /root/.claude/projects\nX /root/.codex/sessions\n\
c 10 1700000000 /root/.claude/projects/-root-my-repo/11111111-2222-4333-8444-555555555555.jsonl\n\
c 11 1700000001 /root/.claude/projects/with space/11111111-2222-4333-8444-555555555556.jsonl\n";
    let l = parse_listing(out).unwrap();
    assert_eq!(l.files.len(), 2);
    assert_eq!(
        l.files[0].path,
        "/root/.claude/projects/with space/11111111-2222-4333-8444-555555555556.jsonl"
    );
    assert_eq!(l.files[1].mtime_ms, 1700000000000);
}

#[test]
fn listing_without_roots_is_not_a_listing_and_the_file_cap_holds() {
    assert!(
        parse_listing("N 1\nH /root\n").is_none(),
        "루트 줄이 없으면(스크립트가 못 돌았다) 목록이 아니다"
    );
    let mut out = String::from("N 1\nH /r\nC /r/c\nX /r/x\n");
    for i in 0..(MAX_FILES + 20) {
        out.push_str(&format!("c 1 {i} /r/c/p/{i}.jsonl\n"));
    }
    let l = parse_listing(&out).unwrap();
    assert_eq!(l.files.len(), MAX_FILES);
    assert_eq!(
        l.files[0].mtime_ms,
        ((MAX_FILES + 19) as i64) * 1000,
        "가장 최근 것이 남는다"
    );
}

#[test]
fn commands_quote_every_path_and_stay_inside_sh_c() {
    let items = vec![
        FetchItem {
            path: "/r/it's here.jsonl".into(),
            head: 65536,
            tail: 100,
        },
        FetchItem {
            path: "/r/b.jsonl".into(),
            head: 0,
            tail: 262144,
        },
    ];
    let cmd = fetch_command("@@n", &items);
    assert!(cmd.starts_with("sh -c '"), "{cmd}");
    // 바깥 인용을 한 번 벗기면 안쪽 명령의 경로는 다시 인용되어 있다
    assert!(cmd.contains("head -c 65536"), "{cmd}");
    assert!(cmd.contains("tail -c 100"), "{cmd}");
    assert!(
        !cmd.contains("head -c 0"),
        "앞을 안 읽는 파일에 head 를 부르지 않는다"
    );
    let inner = crate::ssh::sh_quote("/r/it's here.jsonl");
    assert!(
        cmd.contains(&inner.replace('\'', r"'\''")),
        "경로가 안쪽에서 인용되고 바깥 인용이 한 번 더 감싼다: {cmd}"
    );
    let ex = exists_command(&["/a b".into(), "/c'd".into()]);
    assert!(ex.starts_with("sh -c '"));
    assert!(list_command().starts_with("sh -c '"));
    assert!(list_command().contains(&format!("head -n {MAX_FILES}")));
}

#[test]
fn fetch_item_matches_the_local_ranges() {
    let f = |agent, size| Listed {
        agent,
        size,
        mtime_ms: 0,
        path: "/x.jsonl".into(),
    };
    let small = fetch_item(&f("claude", 1000));
    assert_eq!(
        (small.head, small.tail),
        (64 * 1024, 0),
        "앞보다 작으면 앞 한 번이 전부"
    );
    let mid = fetch_item(&f("claude", 64 * 1024 + 10));
    assert_eq!(
        (mid.head, mid.tail),
        (64 * 1024, 10),
        "꼬리는 앞과 겹치지 않는다"
    );
    let big = fetch_item(&f("codex", 10 * 1024 * 1024));
    assert_eq!((big.head, big.tail), (128 * 1024, 64 * 1024));
    let idx = fetch_item(&f("index", 10));
    assert_eq!((idx.head, idx.tail), (0, INDEX_TAIL_BYTES));
}

#[test]
fn batches_respect_file_and_byte_caps_but_always_take_one() {
    let many: Vec<Listed> = (0..100)
        .map(|i| Listed {
            agent: "claude",
            size: 1_000_000,
            mtime_ms: i,
            path: format!("/p/{i}.jsonl"),
        })
        .collect();
    let b = next_batch(&many);
    assert!(b.len() <= BATCH_MAX_FILES);
    let bytes: u64 = b.iter().map(|(_, it)| item_bound(it)).sum();
    assert!(bytes <= BATCH_MAX_BYTES, "{bytes}");
    let small: Vec<Listed> = (0..100)
        .map(|i| Listed {
            agent: "claude",
            size: 100,
            mtime_ms: i,
            path: format!("/p/{i}.jsonl"),
        })
        .collect();
    assert_eq!(next_batch(&small).len(), BATCH_MAX_FILES);
    assert_eq!(next_batch(&many[..1]).len(), 1);
}

fn framed(nonce: &str, parts: &[(usize, &str, &[u8])], end: bool) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, which, body) in parts {
        out.extend_from_slice(format!("\n{nonce} {i} {which}\n").as_bytes());
        out.extend_from_slice(body);
    }
    if end {
        out.extend_from_slice(format!("\n{nonce} END\n").as_bytes());
    }
    out
}

#[test]
fn fetch_output_splits_on_markers_and_drops_our_injected_newline() {
    let out = framed(
        "@@n",
        &[
            (0, "H", b"{\"a\":1}\n{\"b\""),
            (0, "T", b"x\"}\n{\"c\":3}\n"),
            (1, "H", b""),
        ],
        true,
    );
    let (got, complete) = parse_fetch("@@n", &out);
    assert!(complete);
    assert_eq!(
        got[&0].head.as_deref(),
        Some(&b"{\"a\":1}\n{\"b\""[..]),
        "앞의 잘린 끝줄이 우리가 넣은 줄바꿈으로 온전해지지 않는다"
    );
    assert_eq!(got[&0].tail.as_deref(), Some(&b"x\"}\n{\"c\":3}\n"[..]));
    assert_eq!(got[&1].head.as_deref(), Some(&b""[..]));
}

#[test]
fn a_cut_off_fetch_drops_the_last_partial_piece() {
    let out = framed(
        "@@n",
        &[(0, "H", b"{\"a\":1}\n"), (1, "H", b"{\"half")],
        false,
    );
    let (got, complete) = parse_fetch("@@n", &out);
    assert!(!complete);
    assert!(got.contains_key(&0));
    assert!(!got.contains_key(&1), "끝나지 않은 조각은 믿지 않는다");
    let it = FetchItem {
        path: "/x".into(),
        head: 10,
        tail: 0,
    };
    assert!(fetched_whole(&it, &got[&0]));
    assert!(!fetched_whole(&FetchItem { tail: 5, ..it }, &got[&0]));
}

fn claude_lines(cwd: &str) -> Vec<Value> {
    vec![
        json!({"type":"user","cwd":cwd,"timestamp":"2026-09-27T01:00:00Z","gitBranch":"main","message":{"content":"health check 타임아웃 원인 추적"}}),
        json!({"type":"assistant","cwd":cwd,"message":{"model":"claude-opus","content":[]}}),
    ]
}

#[test]
fn remote_bytes_go_through_the_same_parser_as_local_files() {
    let f = Listed {
        agent: "claude",
        size: 500,
        mtime_ms: 1,
        path: format!("/r/c/-p/{U1}.jsonl"),
    };
    let (p, tokens) = parse_fetched(
        &f,
        Fetched {
            head: Some(lines(&claude_lines("/srv/api"))),
            tail: None,
        },
    );
    let p = p.expect("대화다");
    assert_eq!(p.id, U1);
    assert_eq!(p.cwd, "/srv/api");
    assert_eq!(tokens, None, "Claude 토큰은 싣지 않는다");
    let t = local::target("claude").unwrap();
    let rec = local::record(t, &p, 1, None, true);
    assert_eq!(rec.title, "health check 타임아웃 원인 추적");
    assert_eq!(rec.branch.as_deref(), Some("main"));
}

#[test]
fn codex_tail_gives_the_last_cumulative_tokens() {
    let meta = json!({"type":"session_meta","payload":{"id":X1,"cwd":"/srv/api","timestamp":"2026-09-27T01:00:00Z","source":"cli"}});
    let turn = json!({"type":"turn_context","payload":{"model":"gpt-5"}});
    let prompt = json!({"type":"event_msg","payload":{"type":"user_message","message":"마이그레이션 롤백 계획"}});
    let tc = |i: u64, o: u64| json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":i,"cached_input_tokens":i/2,"output_tokens":o}}}});
    let head = lines(&[meta, turn, prompt, tc(10, 1)]);
    // 머리보다 긴 파일 — 꼬리의 첫 줄은 잘린 줄로 버려진다
    let mut tail = b"partial line\n".to_vec();
    tail.extend(lines(&[tc(80_000, 8_000)]));
    let f = Listed {
        agent: "codex",
        size: 200 * 1024,
        mtime_ms: 1,
        path: format!("/r/x/2026/09/27/rollout-a-{X1}.jsonl"),
    };
    let (p, tokens) = parse_fetched(
        &f,
        Fetched {
            head: Some(head),
            tail: Some(tail),
        },
    );
    assert_eq!(p.expect("대화다").id, X1);
    assert_eq!(tokens, Some(88_000));
}

#[test]
fn index_tail_drops_its_first_partial_line_only_when_cut() {
    let body = lines(&[json!({"id":X1,"thread_name":"배포 스크립트 dry-run"})]);
    let whole = Listed {
        agent: "index",
        size: body.len() as u64,
        mtime_ms: 1,
        path: "/r/session_index.jsonl".into(),
    };
    assert_eq!(
        parse_index(
            &whole,
            Fetched {
                head: None,
                tail: Some(body.clone())
            }
        )
        .get(X1)
        .map(String::as_str),
        Some("배포 스크립트 dry-run")
    );
    let cut = Listed {
        size: INDEX_TAIL_BYTES + 5,
        ..whole
    };
    let mut t = b"{\"id\":\"cut".to_vec();
    t.push(b'\n');
    t.extend(body);
    assert_eq!(
        parse_index(
            &cut,
            Fetched {
                head: None,
                tail: Some(t)
            }
        )
        .len(),
        1
    );
}

fn cache_with(files: Vec<(Listed, Option<Parsed>)>) -> HostCache {
    let mut c = HostCache::default();
    for (f, p) in files {
        c.files.insert(
            f.path.clone(),
            Entry {
                size: f.size,
                mtime_ms: f.mtime_ms,
                agent: f.agent,
                parsed: p.map(Arc::new),
                tokens: None,
                usage: None,
                limits: None,
            },
        );
    }
    c
}

fn parsed(id: &str, cwd: &str) -> Parsed {
    let f = Listed {
        agent: "claude",
        size: 1,
        mtime_ms: 1,
        path: format!("/r/c/p/{id}.jsonl"),
    };
    parse_fetched(
        &f,
        Fetched {
            head: Some(lines(&claude_lines(cwd))),
            tail: None,
        },
    )
    .0
    .unwrap()
}

#[test]
fn rows_shift_mtime_by_the_server_clock_and_skip_unread_and_duplicate_files() {
    let a = Listed {
        agent: "claude",
        size: 1,
        mtime_ms: 1_000_000,
        path: format!("/r/c/p/{U1}.jsonl"),
    };
    let b = Listed {
        agent: "claude",
        size: 1,
        mtime_ms: 900_000,
        path: format!("/r/c/q/{U1}.jsonl"),
    };
    let unread = Listed {
        agent: "claude",
        size: 2,
        mtime_ms: 800_000,
        path: "/r/c/p/z.jsonl".into(),
    };
    let listing = Listing {
        now_s: Some(2_000),
        home: None,
        files: vec![a.clone(), b.clone(), unread.clone()],
        index: None,
    };
    let mut c = cache_with(vec![
        (a, Some(parsed(U1, "/srv/api"))),
        (b, Some(parsed(U1, "/srv/api"))),
    ]);
    c.exists.insert("/srv/api".into(), false);
    // 이 PC 는 서버보다 5초 빠르다
    let rows = rows_of("dev-01", &c, &listing, 5_000);
    assert_eq!(
        rows.len(),
        1,
        "같은 대화는 가장 최근 파일 하나 · 아직 못 읽은 파일은 없다"
    );
    assert_eq!(rows[0].session.updated_at, 1_005_000);
    assert_eq!(rows[0].host, "dev-01");
    assert!(!rows[0].session.cwd_exists);
    assert!(pending(&c, &listing).iter().any(|f| f.path == unread.path));
}

#[test]
fn launch_spec_comes_from_the_cache_only() {
    let a = Listed {
        agent: "claude",
        size: 1,
        mtime_ms: 1,
        path: format!("/r/c/p/{U1}.jsonl"),
    };
    let mut c = cache_with(vec![(a, Some(parsed(U1, "/srv/api")))]);
    let t = local::target("claude").unwrap();
    let s = launch_from_cache(&c, t, &U1.to_uppercase(), "resume").unwrap();
    assert_eq!(s.cwd, "/srv/api");
    assert_eq!(s.command, format!("claude --resume {U1}"));
    assert_eq!(
        launch_from_cache(&c, t, U1, "fork").unwrap().command,
        format!("claude --resume {U1} --fork-session")
    );
    assert!(
        launch_from_cache(&c, t, "11111111-2222-4333-8444-000000000000", "resume").is_err(),
        "캐시에 없는 대화"
    );
    assert!(launch_from_cache(&c, t, "not-a-uuid; rm -rf /", "resume").is_err());
    assert!(launch_from_cache(&c, t, U1, "exec").is_err());
    c.exists.insert("/srv/api".into(), false);
    assert!(
        launch_from_cache(&c, t, U1, "resume").is_err(),
        "폴더가 없다고 안 대화"
    );
}

// ---- 2단계 — 토큰 셈 · 전체 사용량 읽기 · 원격 기록 보기 ----

fn now_ts() -> String {
    chrono::Local::now().to_rfc3339()
}

/// Claude 응답 줄(사용량) — 본문에 `pad` 만큼 글자를 넣어 줄 길이를 바꾼다.
fn c_resp(mid: &str, input: u64, out: u64, pad: usize) -> Value {
    json!({"type":"assistant","timestamp":now_ts(),"requestId":format!("r-{mid}"),"cwd":"/srv/api",
           "message":{"id":mid,"model":"claude-opus","content":[{"type":"text","text":"x".repeat(pad)}],
                      "usage":{"input_tokens":input,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":out}}})
}

/// 도구 출력처럼 바늘이 없는 큰 줄.
fn c_tool_out(pad: usize) -> Value {
    json!({"type":"user","cwd":"/srv/api","message":{"content":[{"type":"tool_result","tool_use_id":"t","content":"y".repeat(pad)}]}})
}

fn whole_tokens(agent: &str, bytes: &[u8]) -> u64 {
    let mut u = crate::agent_usage::FileUsage::default();
    crate::agent_usage::feed_lines(agent, &mut u, bytes);
    crate::agent_usage::file_tokens(&u).total()
}

#[test]
fn a_file_that_fits_in_the_head_is_counted_from_those_bytes_and_a_big_one_is_not() {
    let mut vs = claude_lines("/srv/api");
    vs.push(c_resp("m1", 100, 20, 10));
    vs.push(c_resp("m2", 1000, 200, 10));
    let body = lines(&vs);
    let f = Listed {
        agent: "claude",
        size: body.len() as u64,
        mtime_ms: 1,
        path: format!("/r/c/p/{U1}.jsonl"),
    };
    let it = fetch_item(&f);
    let got = Fetched {
        head: Some(body.clone()),
        tail: None,
    };
    let (u, limits) = usage_from_fetch(&f, &it, &got);
    let u = u.expect("머리 한 번에 다 왔다 — 센다");
    assert_eq!(u.offset, f.size);
    assert_eq!(crate::agent_usage::file_tokens(&u.file).total(), 1320);
    assert!(limits.is_none());
    // 머리보다 큰 파일 — 머리 · 꼬리 사이를 모르므로 세지 않는다
    let big = Listed {
        size: 10 * 1024 * 1024,
        ..f.clone()
    };
    let (u, _) = usage_from_fetch(
        &big,
        &fetch_item(&big),
        &Fetched {
            head: Some(body.clone()),
            tail: Some(body),
        },
    );
    assert!(u.is_none());
    // Codex 꼬리의 요금제 한도
    let rl = json!({"type":"event_msg","timestamp":"2026-09-27T01:00:00Z","payload":{"type":"token_count","info":null,
                    "rate_limits":{"limit_id":"codex","primary":{"used_percent":42.0,"window_minutes":300,"resets_at":1_900_000_000}}}});
    let x = Listed {
        agent: "codex",
        size: 300 * 1024,
        mtime_ms: 1,
        path: format!("/r/x/2026/09/27/rollout-a-{X1}.jsonl"),
    };
    let (_, limits) = usage_from_fetch(
        &x,
        &fetch_item(&x),
        &Fetched {
            head: Some(Vec::new()),
            tail: Some(lines(&[rl])),
        },
    );
    assert_eq!(limits.expect("한도").1[0].used_percent, 42.0);
}

#[test]
fn counted_usage_carries_over_when_the_file_grows_and_drops_when_it_was_rewritten() {
    let f = Listed {
        agent: "claude",
        size: 100,
        mtime_ms: 1,
        path: "/r/c/p/a.jsonl".into(),
    };
    let entry = |size, mtime| Entry {
        size,
        mtime_ms: mtime,
        agent: "claude",
        parsed: None,
        tokens: None,
        usage: Some(RemoteUsage {
            offset: 100,
            broken: true,
            stalls: 3,
            ..RemoteUsage::fresh()
        }),
        limits: None,
    };
    let grown = Listed {
        size: 150,
        mtime_ms: 2,
        ..f.clone()
    };
    let u = carried_usage(Some(entry(100, 1)), &grown).expect("자랐다 — 이어 센다");
    assert_eq!(
        (u.offset, u.broken, u.stalls),
        (100, false, 0),
        "자란 파일은 다시 조른다"
    );
    assert!(
        carried_usage(
            Some(entry(100, 1)),
            &Listed {
                size: 50,
                ..f.clone()
            }
        )
        .is_none(),
        "줄었다"
    );
    assert!(
        carried_usage(
            Some(entry(100, 1)),
            &Listed {
                mtime_ms: 9,
                ..f.clone()
            }
        )
        .is_none(),
        "같은 크기 · 다른 mtime = 다시 쓴 파일"
    );
    assert!(carried_usage(
        Some(entry(100, 1)),
        &Listed {
            agent: "codex",
            ..f.clone()
        }
    )
    .is_none());
    assert!(carried_usage(None, &f).is_none());
}

/// 서버의 `awk` 가 하는 일을 흉내 낸다 — 조각의 온전한 줄 중 바늘이 든 것 + 온전한 줄의 바이트([`usage_command`]).
fn fake_usage_server(
    nonce: &str,
    files: &HashMap<String, Vec<u8>>,
    items: &[UsageItem],
) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, it) in items.iter().enumerate() {
        let file = &files[&it.path];
        let from = (it.start as usize).min(file.len());
        let to = ((it.start + it.len) as usize).min(file.len());
        let chunk = &file[from..to];
        let whole = chunk.iter().rposition(|b| *b == b'\n').map_or(0, |p| p + 1);
        out.extend_from_slice(format!("\n{nonce} {i} U\n").as_bytes());
        for line in chunk[..whole].split_inclusive(|b| *b == b'\n') {
            if crate::agent_usage::needles_of(it.agent)
                .iter()
                .any(|n| memchr::memmem::find(line, n.as_bytes()).is_some())
            {
                out.extend_from_slice(line);
            }
        }
        out.extend_from_slice(format!("\n{nonce} {i} E {whole}\n").as_bytes());
    }
    out.extend_from_slice(format!("\n{nonce} END\n").as_bytes());
    out
}

#[test]
fn full_usage_read_in_pieces_counts_the_same_as_the_whole_file() {
    let mut vs = claude_lines("/srv/api");
    for i in 0..40 {
        vs.push(c_resp(
            &format!("m{i}"),
            10 + i,
            1 + i,
            if i % 7 == 0 { 3000 } else { 40 },
        ));
        vs.push(c_tool_out(if i % 5 == 0 { 5000 } else { 100 }));
    }
    let body = lines(&vs);
    let path = format!("/r/c/p/{U1}.jsonl");
    let f = Listed {
        agent: "claude",
        size: body.len() as u64,
        mtime_ms: 1,
        path: path.clone(),
    };
    let listing = Listing {
        now_s: None,
        home: None,
        files: vec![f.clone()],
        index: None,
    };
    let mut c = cache_with(vec![(f.clone(), Some(parsed(U1, "/srv/api")))]);
    // 작은 조각에서 시작 — 한 줄(3 KB)이 조각보다 길면 조각이 자란다
    c.files.get_mut(&path).unwrap().usage = Some(RemoteUsage {
        chunk: 1000,
        ..RemoteUsage::fresh()
    });
    let files: HashMap<String, Vec<u8>> = [(path.clone(), body.clone())].into();
    let mut rounds = 0;
    loop {
        let batch = usage_batch(&usage_pending(&c, &listing));
        if batch.is_empty() {
            break;
        }
        rounds += 1;
        assert!(rounds < 200, "끝나야 한다");
        let out = fake_usage_server("@@u", &files, &batch);
        let (got, complete) = parse_usage("@@u", &out);
        assert!(complete);
        apply_usage(&mut c, &batch, got);
    }
    let u = c.files[&path].usage.as_ref().unwrap();
    assert_eq!(u.offset, f.size);
    assert!(!u.broken);
    assert_eq!(
        crate::agent_usage::file_tokens(&u.file).total(),
        whole_tokens("claude", &body)
    );
    assert!(rounds > 3, "여러 조각에 걸쳐 읽었다 ({rounds})");
    let c = HostCache {
        listing: Some((Instant::now(), 0, listing)),
        ..c
    };
    let p = usage_progress("dev-01", &c);
    assert_eq!(
        (p.done_bytes, p.total_bytes, p.pending, p.complete),
        (f.size, f.size, 0, true)
    );
}

#[test]
fn a_cut_answer_shrinks_the_piece_and_repeated_stalls_stop_the_file() {
    let path = "/r/c/p/a.jsonl".to_string();
    let f = Listed {
        agent: "claude",
        size: 100 * 1024 * 1024,
        mtime_ms: 1,
        path: path.clone(),
    };
    let listing = Listing {
        now_s: None,
        home: None,
        files: vec![f.clone()],
        index: None,
    };
    let mut c = cache_with(vec![(f.clone(), Some(parsed(U1, "/srv/api")))]);
    let batch = usage_batch(&usage_pending(&c, &listing));
    assert_eq!((batch[0].start, batch[0].len), (0, USAGE_CHUNK_START));
    // 답이 잘려 끝 표식이 오지 않았다 — 조각을 줄인다
    assert_eq!(apply_usage(&mut c, &batch, HashMap::new()), 0);
    assert_eq!(
        c.files[&path].usage.as_ref().unwrap().chunk,
        USAGE_CHUNK_START / 4
    );
    for _ in 0..USAGE_STALLS_MAX {
        let b = usage_batch(&usage_pending(&c, &listing));
        if b.is_empty() {
            break;
        }
        apply_usage(&mut c, &b, HashMap::new());
    }
    assert!(
        c.files[&path].usage.as_ref().unwrap().broken,
        "거듭 나아가지 못하면 멈춘다"
    );
    assert!(usage_pending(&c, &listing).is_empty());
    // 온전한 줄이 없는 조각(한 줄이 조각보다 길다) — 조각을 늘린다
    let mut c2 = cache_with(vec![(f.clone(), Some(parsed(U1, "/srv/api")))]);
    let b = usage_batch(&usage_pending(&c2, &listing));
    apply_usage(&mut c2, &b, [(0usize, (Vec::new(), 0u64))].into());
    assert_eq!(
        c2.files[&path].usage.as_ref().unwrap().chunk,
        USAGE_CHUNK_START * 4
    );
}

#[test]
fn usage_batches_respect_the_scan_cap_and_the_command_quotes_paths_and_needles() {
    let many: Vec<UsageItem> = (0..100)
        .map(|i| UsageItem {
            path: format!("/p/{i}.jsonl"),
            agent: "claude",
            start: 0,
            len: 16 * 1024 * 1024,
        })
        .collect();
    let b = usage_batch(&many);
    assert!(b.iter().map(|i| i.len).sum::<u64>() <= USAGE_BATCH_RAW);
    assert_eq!(usage_batch(&many[..1]).len(), 1);
    let cmd = usage_command(
        "@@u",
        &[
            UsageItem {
                path: "/r/it's here.jsonl".into(),
                agent: "claude",
                start: 10,
                len: 20,
            },
            UsageItem {
                path: "/r/x.jsonl".into(),
                agent: "codex",
                start: 0,
                len: 5,
            },
        ],
    );
    assert!(cmd.starts_with("sh -c '"), "{cmd}");
    assert!(
        cmd.contains("tail -c +11") && cmd.contains("head -c 20"),
        "{cmd}"
    );
    assert!(cmd.contains("LC_ALL=C awk"), "{cmd}");
    assert!(
        cmd.contains("token_count") && cmd.contains("usage"),
        "{cmd}"
    );
    let inner = crate::ssh::sh_quote("/r/it's here.jsonl");
    assert!(cmd.contains(&inner.replace('\'', r"'\''")), "{cmd}");
    let (got, complete) = parse_usage(
        "@@u",
        b"\n@@u 0 U\n{\"usage\":1}\n\n@@u 0 E 12\n\n@@u 1 U\n\n@@u 1 E -1\n\n@@u 2 U\n{\"half",
    );
    assert!(!complete);
    assert_eq!(
        got.get(&0).map(|(b, n)| (b.as_slice(), *n)),
        Some((&b"{\"usage\":1}\n"[..], 12))
    );
    assert!(
        !got.contains_key(&1),
        "조각 끝 표식이 없던 파일은 받지 않는다"
    );
    assert!(!got.contains_key(&2), "잘린 파일");
}

#[test]
fn coverage_counts_what_is_counted_and_what_waits_for_the_full_read() {
    use chrono::Datelike;
    let alias = "cov-test-host";
    let small = Listed {
        agent: "claude",
        size: 10,
        mtime_ms: 3,
        path: "/r/c/p/s.jsonl".into(),
    };
    let big = Listed {
        agent: "claude",
        size: 1000,
        mtime_ms: 2,
        path: "/r/c/p/b.jsonl".into(),
    };
    let xbig = Listed {
        agent: "codex",
        size: 500,
        mtime_ms: 1,
        path: "/r/x/2026/09/27/rollout-x.jsonl".into(),
    };
    let mut c = cache_with(vec![
        (small.clone(), Some(parsed(U1, "/srv/api"))),
        (
            big.clone(),
            Some(parsed("11111111-2222-4333-8444-000000000009", "/srv/api")),
        ),
        (
            xbig.clone(),
            Some(parsed("11111111-2222-4333-8444-000000000008", "/srv/api")),
        ),
    ]);
    let mut done = RemoteUsage::fresh();
    crate::agent_usage::feed_lines("claude", &mut done.file, &lines(&[c_resp("m1", 7, 3, 1)]));
    done.offset = 10;
    c.files.get_mut(&small.path).unwrap().usage = Some(done);
    let mut half = RemoteUsage::fresh();
    crate::agent_usage::feed_lines("claude", &mut half.file, &lines(&[c_resp("m2", 70, 30, 1)]));
    half.offset = 400;
    c.files.get_mut(&big.path).unwrap().usage = Some(half);
    c.listing = Some((
        Instant::now(),
        42,
        Listing {
            now_s: None,
            home: None,
            files: vec![small, big, xbig],
            index: None,
        },
    ));
    with_hosts(|h| h.insert(key_of(alias), c));
    let today = chrono::Local::now().date_naive().num_days_from_ce();
    let (tokens, cov) =
        with_usage_files(&[alias.to_string(), "never-read".into()], |files, cov| {
            let s = crate::agent_usage::summarize_files(files, Some(7), None, today);
            (s.daily.last().unwrap().total, cov)
        });
    assert_eq!(tokens, 110, "다 센 파일 + 센 데까지의 큰 파일");
    assert_eq!(
        (
            cov[0].counted,
            cov[0].pending_claude,
            cov[0].pending_codex,
            cov[0].pending_bytes
        ),
        (1, 1, 1, 600 + 500)
    );
    assert_eq!(cov[0].read_at, Some(42));
    assert_eq!(
        (cov[1].host.as_str(), cov[1].read_at),
        ("never-read", None),
        "읽은 적 없는 호스트는 빈 덮개"
    );
    with_hosts(|h| h.remove(&key_of(alias)));
}

/// 서버의 창 명령이 하는 일 — `"<크기> <시작>\n"` + `[시작, 끝)`.
fn fake_view_server(file: &[u8], before: Option<u64>, window: u64) -> Vec<u8> {
    let s = file.len() as u64;
    let e = before.map_or(s, |b| b.min(s));
    let st = e.saturating_sub(window);
    let mut out = format!("{s} {st}\n").into_bytes();
    out.extend_from_slice(&file[st as usize..e as usize]);
    out
}

/// 원격 판의 한 쪽 — 명령과 같은 창 늘리기(작은 첫 창에서 시작해 모자라면 네 배).
fn remote_page(
    file: &[u8],
    before: Option<u64>,
    limit: usize,
    first: u64,
) -> crate::agent_transcript::TranscriptPage {
    let parse = local::target("claude").unwrap().transcript;
    let mut window = first;
    loop {
        let out = fake_view_server(file, before, window);
        let (size, start, data) = parse_view(&out, before).unwrap();
        match crate::agent_transcript::page_in_window(size, start, data, before, limit, parse)
            .unwrap()
        {
            crate::agent_transcript::WindowPage::Page(p) => return p,
            crate::agent_transcript::WindowPage::NeedMore => window *= 4,
        }
    }
}

fn texts(p: &crate::agent_transcript::TranscriptPage) -> Vec<String> {
    p.items
        .iter()
        .map(|i| match &i.tool {
            Some(t) => format!("{}:{}", t.name, t.output.clone().unwrap_or_default()),
            None => i.text.clone().unwrap_or_default(),
        })
        .collect()
}

#[test]
fn remote_paging_through_small_windows_matches_reading_the_whole_file() {
    let mut vs = Vec::new();
    for i in 0..60 {
        vs.push(
            json!({"type":"user","origin":{"kind":"human"},"message":{"content":format!("q{i}")}}),
        );
        vs.push(json!({"type":"assistant","message":{"content":[{"type":"thinking","thinking":"비밀","signature":"s"},
            {"type":"tool_use","id":format!("t{i}"),"name":"Read","input":{"file_path":format!("f{i}")}}]}}));
        vs.push(json!({"type":"attachment","attachment":{"blob":"z".repeat(if i % 9 == 0 { 70_000 } else { 500 })}}));
        vs.push(json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":format!("t{i}"),"content":format!("out{i}")}]}}));
        vs.push(json!({"type":"assistant","message":{"content":[{"type":"text","text":format!("a{i}")}]}}));
    }
    let file = lines(&vs);
    // 기준 — 파일 전체를 한 창으로(맨 앞에서 시작 — 늘 끝까지 읽는다)
    let reference = |before| remote_page(&file, before, 7, file.len() as u64 + 1);
    let mut before = None;
    let mut pages = 0;
    let mut all: Vec<String> = Vec::new();
    loop {
        let p = remote_page(&file, before, 7, 4096);
        let r = reference(before);
        assert_eq!(texts(&p), texts(&r), "작은 창에서 시작해도 같은 쪽");
        assert_eq!(p.cursor, r.cursor);
        let mut these = texts(&p);
        these.append(&mut all);
        all = these;
        pages += 1;
        match p.cursor {
            Some(c) => {
                assert_eq!(file[c as usize - 1], b'\n', "커서는 줄의 시작");
                before = Some(c);
            }
            None => break,
        }
    }
    assert!(pages > 5, "{pages}");
    assert_eq!(all.len(), 180, "사람 · 도구 · 에이전트 × 60 — 생각은 없다");
    assert_eq!(all[0], "q0");
    assert_eq!(all[1], "Read:out0", "쪽 경계가 호출과 결과를 가르지 않는다");
    assert!(all.iter().all(|t| !t.contains("비밀")));
}

#[test]
fn view_output_must_be_whole_and_the_command_quotes_the_path() {
    let file = b"{\"a\":1}\n{\"b\":2}\n";
    let out = fake_view_server(file, None, 5);
    let (size, start, data) = parse_view(&out, None).unwrap();
    assert_eq!((size, start, data), (16, 11, &file[11..]));
    let mut cut = out.clone();
    cut.pop();
    assert!(parse_view(&cut, None).is_err(), "창보다 적게 왔다 — 잘렸다");
    assert!(parse_view(b"garbage", None).is_err());
    let small = fake_view_server(file, Some(8), 100);
    let (_, st, d) = parse_view(&small, Some(8)).unwrap();
    assert_eq!((st, d), (0, &file[..8]));
    // 커서가 파일보다 크면 창은 파일 끝에서 끝나고, 리더가 그 커서를 거절한다
    let big = fake_view_server(file, Some(999), 100);
    let (size, st, d) = parse_view(&big, Some(999)).unwrap();
    let parse = local::target("claude").unwrap().transcript;
    assert!(crate::agent_transcript::page_in_window(size, st, d, Some(999), 5, parse).is_err());
    let cmd = view_command("/r/it's.jsonl", Some(42), 512);
    assert!(
        cmd.starts_with("sh -c '") && cmd.contains("e=42") && cmd.contains("512"),
        "{cmd}"
    );
    assert!(view_command("/r/a.jsonl", None, 1).contains("e=$s"));
    let inner = crate::ssh::sh_quote("/r/it's.jsonl");
    assert!(cmd.contains(&inner.replace('\'', r"'\''")), "{cmd}");
}

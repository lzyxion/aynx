use super::*;

const H1: &str = "1111111111111111111111111111111111111111";
const H2: &str = "2222222222222222222222222222222222222222";

/// 이름 → 값 표를 정렬된 모양으로(비교용).
fn sorted<V: Clone>(m: &HashMap<String, V>) -> std::collections::BTreeMap<String, V> {
    m.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
}

#[test]
fn ref_lines_and_small_parsers() {
    let r = parse_ref_line(&format!("refs/heads/feat/x\t{H1}\t1700000000\tfix: a\tb\r")).unwrap();
    assert_eq!(
        (r.name.as_str(), r.time, r.subject.as_str()),
        ("feat/x", 1_700_000_000, "fix: a\tb")
    );
    assert!(
        parse_ref_line(&format!("refs/tags/v1\t{H1}\t1\tx")).is_none(),
        "태그는 아니다"
    );
    assert!(parse_ref_line("refs/heads/x\tnothash\t1\tx").is_none());
    assert!(parse_ref_line(&format!("refs/heads/x\t{H1}\tnope\tx")).is_none());
    assert_eq!(
        parse_ref_line(&format!("refs/heads/x\t{H1}\t5"))
            .unwrap()
            .subject,
        "",
        "제목 없음"
    );

    assert_eq!(parse_left_right("3\t5\n"), Some((3, 5)));
    assert_eq!(parse_left_right(""), None);
    assert_eq!(parse_left_right("1 2 3"), None);

    let line = format!("{H1} {H2} Kim Jin <k@x.io> 1700000123 +0900\tbranch: Created from feat-a");
    assert_eq!(
        parse_reflog_file_line(&line),
        Some((1_700_000_123, "branch: Created from feat-a".into()))
    );
    assert_eq!(parse_reflog_file_line("broken"), None);
    assert_eq!(
        created_from("branch: Created from HEAD").as_deref(),
        Some("HEAD")
    );
    assert_eq!(created_from("branch: Reset to main"), None);
    assert_eq!(created_from("branch: Created from "), None);
}

fn rl(name: &str, time: i64) -> RefLine {
    RefLine {
        name: name.into(),
        head: H1.into(),
        time,
        subject: String::new(),
    }
}

#[test]
fn select_keeps_main_and_caps() {
    let mut refs: Vec<RefLine> = (0..MAX_BRANCHES + 5)
        .map(|i| rl(&format!("b{i}"), 10_000 - i as i64))
        .collect();
    refs.push(rl("main", 1));
    refs.push(rl("b0", 9)); // 겹친 줄
    let (out, cut) = select_refs(&refs, Some("main"));
    assert!(cut);
    assert_eq!(out.len(), MAX_BRANCHES);
    assert_eq!(
        out.last().unwrap().name,
        "main",
        "주 브랜치는 늘 넣는다(마지막 자리를 내준다)"
    );
    assert_eq!(out.iter().filter(|r| r.name == "b0").count(), 1);
    let (small, cut) = select_refs(&refs[..3], Some("nope"));
    assert_eq!((small.len(), cut), (3, false));
}

#[test]
fn z_parsers_and_merge() {
    let ns =
        "M\0src/a.ts\0R087\0old/b.ts\0new/b.ts\0A\0aynx-end\0D\0gone.txt\0C100\0x\0y\0T\0link\0";
    let list = parse_name_status(&mut ns.split('\0'));
    let got: Vec<(char, &str, Option<&str>)> = list
        .iter()
        .map(|f| (f.status, f.path.as_str(), f.old_path.as_deref()))
        .collect();
    assert_eq!(
        got,
        vec![
            ('M', "src/a.ts", None),
            ('R', "new/b.ts", Some("old/b.ts")),
            ('A', "aynx-end", None), // 경로 칸의 같은 글자는 파일 이름이다
            ('D', "gone.txt", None),
            ('A', "y", Some("x")),
            ('M', "link", None),
        ]
    );
    // 끝 표식 — 레코드 자리에서 멈추고 뒤는 남긴다.
    let mut it = "M\0a\0aynx-end\0after\0".split('\0');
    assert_eq!(parse_name_status(&mut it).len(), 1);
    assert_eq!(it.next(), Some("after"));

    let num = "3\t1\tsrc/a.ts\0".to_string() + "-\t-\timg.png\0" + "5\t2\t\0old/b.ts\0new/b.ts\0";
    let counts = parse_numstat(&mut num.split('\0'));
    assert_eq!(
        sorted(&counts).into_iter().collect::<Vec<_>>(),
        vec![
            ("img.png".to_string(), None),
            ("new/b.ts".to_string(), Some((5, 2))),
            ("src/a.ts".to_string(), Some((3, 1))),
        ]
    );

    let st =
        " M src/a.ts\0R  new.ts\0old.ts\0?? dir/n.txt\0!! target/x\0D  gone\0A  added\0UU both\0";
    let s = parse_status_z(&mut st.split('\0'));
    let got: Vec<(char, &str, Option<&str>)> = s
        .iter()
        .map(|f| (f.status, f.path.as_str(), f.old_path.as_deref()))
        .collect();
    assert_eq!(
        got,
        vec![
            ('M', "src/a.ts", None),
            ('R', "new.ts", Some("old.ts")),
            ('A', "dir/n.txt", None),
            ('D', "gone", None),
            ('A', "added", None),
            ('M', "both", None),
        ]
    );

    let ul = parse_untracked_lines(&mut "3\tdir/n.txt\0-\tbin.dat\0\tempty\0aynx-end\0".split('\0'));
    assert_eq!(
        sorted(&ul).into_iter().collect::<Vec<_>>(),
        vec![("dir/n.txt".to_string(), 3)]
    );

    let (files, cut) = merge_files(
        s,
        &HashMap::from([("src/a.ts".to_string(), Some((2, 1)))]),
        &ul,
    );
    assert!(!cut);
    assert_eq!((files[0].added, files[0].deleted), (Some(2), Some(1)));
    assert_eq!(
        (files[2].path.as_str(), files[2].added, files[2].deleted),
        ("dir/n.txt", Some(3), Some(0))
    );
    assert_eq!(files[3].added, None, "모름");
    let many: Vec<NameStatus> = (0..MAX_FILES + 1)
        .map(|i| NameStatus {
            status: 'M',
            path: format!("f{i}"),
            old_path: None,
        })
        .collect();
    let (files, cut) = merge_files(many, &HashMap::new(), &HashMap::new());
    assert!(cut && files.len() == MAX_FILES);
}

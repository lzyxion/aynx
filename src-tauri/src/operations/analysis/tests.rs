use super::*;

fn eff(cmd: &str) -> Computed {
    analyze_command(cmd).effect
}

#[test]
fn mockup_read_pipeline() {
    let a = analyze_command("du -ah /var/log/nginx | sort -rh | head -n 10");
    assert_eq!(a.effect, Computed::Read);
    assert_eq!(a.programs, vec!["du", "sort", "head"]);
    assert!(!a.sudo);
    assert_eq!(a.cause, None);
    assert!(!mismatch(Effect::Read, a.effect));
}

/// 칩 줄의 낱말마다 효과 — 화면이 이것으로 색을 고른다(삭제 = 실패색 · 쓰기 = 경고색).
#[test]
fn tokens_carry_the_effect_that_colors_them() {
    let a = analyze_command("du -ah /var/log | sort -rh | head -n 10");
    assert!(a.tokens.iter().all(|t| t.effect == Computed::Read));
    assert_eq!(a.tokens.iter().map(|t| t.text.as_str()).collect::<Vec<_>>(), ["du", "sort", "head"]);
    let b = analyze_command("sudo find /var/log -name '*.gz' -delete && mv a b | tee out > log.txt");
    let got: Vec<(&str, Computed)> = b.tokens.iter().map(|t| (t.text.as_str(), t.effect)).collect();
    assert_eq!(
        got,
        [("find -delete", Computed::Delete), ("mv", Computed::Write), ("tee", Computed::Write), (">", Computed::Write)]
    );
    let c = analyze_command("ls $(cat x) 2>/dev/null");
    assert!(c.tokens.iter().any(|t| t.text == "$()" && t.effect == Computed::Unknown));
    assert!(!c.tokens.iter().any(|t| t.text == ">"), "/dev/null 은 쓰기가 아니다");
}

#[test]
fn mockup_sudo_find_delete() {
    let a = analyze_command(r#"sudo find /var/log -name "*.gz" -mtime +7 -delete"#);
    assert_eq!(a.effect, Computed::Delete);
    assert!(a.sudo);
    assert_eq!(a.programs, vec!["find"]);
    assert_eq!(a.cause.as_deref(), Some("find -delete"));
    assert!(mismatch(Effect::Read, a.effect));
    assert!(mismatch(Effect::Write, a.effect));
    assert!(!mismatch(Effect::Delete, a.effect));
}

#[test]
fn find_exec_rm_and_read_find() {
    assert_eq!(eff(r"find /tmp -name '*.log' -exec rm -f {} \;"), Computed::Delete);
    assert_eq!(analyze_command(r"find /tmp -exec rm {} +").cause.as_deref(), Some("find -exec rm"));
    assert_eq!(eff("find /etc -name '*.conf'"), Computed::Read);
    assert_eq!(eff("find . -type f -exec grep -l foo {} ;"), Computed::Read);
}

#[test]
fn redirects_write_except_dev_null_and_fd_dup() {
    assert_eq!(eff("echo hi > /etc/motd"), Computed::Write);
    assert_eq!(analyze_command("echo hi >> out.txt").cause.as_deref(), Some(">"));
    assert_eq!(eff("ls /nope 2>/dev/null"), Computed::Read);
    assert_eq!(eff("ls /nope 2>&1 | head"), Computed::Read);
    assert_eq!(eff("ls &> /dev/null"), Computed::Read);
    assert_eq!(eff("ls &> list.txt"), Computed::Write);
    // 따옴표 안의 `>` 는 리다이렉트가 아니다.
    assert_eq!(eff("grep '>' file.txt"), Computed::Read);
    assert_eq!(eff("cat < input.txt"), Computed::Read);
}

#[test]
fn destructive_and_write_programs() {
    assert_eq!(eff("rm -rf /srv/app/cache"), Computed::Delete);
    assert_eq!(eff("/bin/rm x"), Computed::Delete);
    assert_eq!(eff("dd if=/dev/zero of=/dev/sda"), Computed::Delete);
    assert_eq!(eff("truncate -s 0 app.log"), Computed::Delete);
    assert_eq!(eff("mkfs.ext4 /dev/sdb1"), Computed::Delete);
    assert_eq!(eff("mv a b"), Computed::Write);
    assert_eq!(eff("chmod 600 key"), Computed::Write);
    assert_eq!(eff("chown root:root f"), Computed::Write);
    assert_eq!(eff("echo x | tee /etc/x"), Computed::Write);
    assert_eq!(eff("sed -i 's/a/b/' f"), Computed::Write);
    assert_eq!(eff("sed -ri 's/a/b/' f"), Computed::Write);
    assert_eq!(eff("sed -n '1,5p' f"), Computed::Read);
    assert_eq!(eff("systemctl restart nginx"), Computed::Write);
    assert_eq!(eff("systemctl status nginx"), Computed::Read);
    assert_eq!(eff("git status && git log -1"), Computed::Read);
    assert_eq!(eff("git reset --hard HEAD~1"), Computed::Delete);
    assert_eq!(eff("git pull"), Computed::Write);
    assert_eq!(eff("docker ps -a"), Computed::Read);
    assert_eq!(eff("docker system prune -f"), Computed::Delete);
    assert_eq!(eff("kubectl get pods"), Computed::Read);
    assert_eq!(eff("kubectl delete pod x"), Computed::Delete);
    assert_eq!(eff("curl -s https://x/health"), Computed::Read);
    assert_eq!(eff("curl -X POST https://x"), Computed::Write);
    assert_eq!(eff("curl -sSLo out https://x"), Computed::Write);
    assert_eq!(eff("tar -tzf a.tgz"), Computed::Read);
    assert_eq!(eff("tar -xzf a.tgz"), Computed::Write);
    assert_eq!(eff("journalctl -u nginx --since today"), Computed::Read);
    assert_eq!(eff("journalctl --vacuum-time=7d"), Computed::Delete);
}

#[test]
fn unknown_and_opaque_are_not_read() {
    assert_eq!(eff("my-script.sh --go"), Computed::Unknown);
    assert_eq!(eff("bash -c 'ls'"), Computed::Unknown);
    assert_eq!(eff("ls $(cat list)"), Computed::Unknown);
    assert_eq!(eff("echo `id`"), Computed::Unknown);
    assert_eq!(eff("bash <<EOF\nls\nEOF"), Computed::Unknown);
    assert_eq!(eff("echo 'unterminated"), Computed::Unknown);
    assert_eq!(eff(""), Computed::Unknown);
    // 확인 필요는 비교에서 쓰기와 같다 — 읽기 선언은 다름, 쓰기 선언은 같음.
    assert!(mismatch(Effect::Read, Computed::Unknown));
    assert!(!mismatch(Effect::Write, Computed::Unknown));
}

#[test]
fn wrappers_and_sudo() {
    let a = analyze_command("sudo -u www-data ls /srv");
    assert!(a.sudo);
    assert_eq!(a.effect, Computed::Read);
    assert_eq!(a.programs, vec!["ls"]);
    assert_eq!(eff("FOO=1 env BAR=2 nice -n 5 timeout 10 rm x"), Computed::Delete);
    assert_eq!(eff("cat list | xargs rm"), Computed::Delete);
    assert_eq!(eff("ls | xargs -I {} echo {}"), Computed::Read);
    assert!(analyze_command("ls && sudo rm x").sudo);
    assert_eq!(eff("(cd /srv && rm -r old)"), Computed::Delete);
    assert_eq!(eff("ls # rm -rf /"), Computed::Read, "주석은 명령이 아니다");
}

#[test]
fn validate_command_counts_for_effect() {
    let a = analyze_plan("ls", Some("rm marker"));
    assert_eq!(a.effect, Computed::Delete);
    assert_eq!(a.programs, vec!["ls"], "프로그램 목록은 본 명령의 것만");
}

fn stmt(sql: &str) -> DbPlanStmt {
    let keyword = sql.split_whitespace().next().unwrap_or("").to_ascii_uppercase();
    DbPlanStmt { sql: sql.into(), keyword, counted: true, uncounted: false }
}

#[test]
fn db_delete_with_and_without_where() {
    let a = analyze_db(&[stmt("DELETE FROM users WHERE last_login < now() - interval '1 year'")]);
    assert_eq!(a.effect, Computed::Delete);
    assert_eq!(a.statements[0].table.as_deref(), Some("users"));
    assert_eq!(a.statements[0].where_clause, Some(true));
    assert_eq!(a.cause.as_deref(), Some("DELETE users"));
    assert!(mismatch(Effect::Write, a.effect));

    let b = analyze_db(&[stmt("DELETE FROM users")]);
    assert_eq!(b.statements[0].where_clause, Some(false));
    // 하위 질의 안의 WHERE 는 바깥 WHERE 가 아니다.
    let c = analyze_db(&[stmt("DELETE FROM t USING (SELECT id FROM s WHERE x = 1) q")]);
    assert_eq!(c.statements[0].where_clause, Some(false));
    // 문자열 안의 WHERE 도 아니다.
    let d = analyze_db(&[stmt("UPDATE \"public\".\"t\" SET note = 'where'")]);
    assert_eq!(d.statements[0].where_clause, Some(false));
    assert_eq!(d.statements[0].table.as_deref(), Some("\"public\".\"t\""));
    assert_eq!(d.effect, Computed::Write);
}

#[test]
fn db_keywords_and_tables() {
    let a = analyze_db(&[
        stmt("INSERT INTO audit_log (a) VALUES (1)"),
        stmt("UPDATE ONLY accounts SET x = 1 WHERE id = 2"),
        stmt("TRUNCATE TABLE sessions"),
    ]);
    assert_eq!(a.effect, Computed::Delete);
    assert_eq!(a.cause.as_deref(), Some("TRUNCATE sessions"));
    assert_eq!(a.statements[0].table.as_deref(), Some("audit_log"));
    assert_eq!(a.statements[0].where_clause, None);
    assert_eq!(a.statements[1].table.as_deref(), Some("accounts"));
    assert_eq!(a.statements[1].where_clause, Some(true));
    assert_eq!(analyze_db(&[stmt("DROP TABLE IF EXISTS old_t")]).statements[0].table.as_deref(), Some("old_t"));
    assert_eq!(analyze_db(&[stmt("ALTER TABLE t ADD COLUMN c int")]).effect, Computed::Write);
    let w = analyze_db(&[stmt("WITH gone AS (DELETE FROM q WHERE done RETURNING id) SELECT count(*) FROM gone")]);
    assert_eq!(w.effect, Computed::Delete);
    assert_eq!(w.statements[0].keyword, "DELETE");
}

#[test]
fn summary_is_cleaned_and_clipped() {
    assert_eq!(clean_summary("  로그 \n 크기를\t본다  ").as_deref(), Some("로그 크기를 본다"));
    assert_eq!(clean_summary("a\u{202e}b\u{0007}c").as_deref(), Some("abc"));
    assert_eq!(clean_summary(" \n\t "), None);
    let long = "가".repeat(400);
    let c = clean_summary(&long).unwrap();
    assert_eq!(c.chars().count(), SUMMARY_MAX_CHARS);
    assert!(c.ends_with('…'));
    assert_eq!(Effect::parse("delete"), Some(Effect::Delete));
    assert_eq!(Effect::parse("remove"), None);
}

/// 실제 AI 가 낸 긴 진단 한 줄 — 전부 읽기다(`openssl s_client` · `curl -o /dev/null` · `timeout` 감싸개).
const LONG: &str = r#"date -u; echo "-- curl verbose"; curl -sv -m 10 -o /dev/null https://vpn.example.com/ 2>&1 | grep -E "^\*|^< HTTP" | grep -vE "CAfile|CApath|^\*   Trying" | head -20; echo "-- no-verify"; curl -sk -m 10 -o /dev/null -w "insecure=%{http_code} ssl_verify=%{ssl_verify_result}\n" https://vpn.example.com/; echo "-- SNI"; curl -sk -m 10 -o /dev/null -w "x=%{http_code}\n" --resolve monitor.example.com:443:203.0.113.10 https://monitor.example.com/; echo "-- openssl"; echo | timeout 10 openssl s_client -connect 203.0.113.10:443 -servername vpn.example.com 2>&1 | grep -E "subject|issuer|Verify return""#;

#[test]
fn curl_output_to_dev_null_is_not_a_write() {
    assert_eq!(eff("curl -o /dev/null https://x"), Computed::Read);
    assert_eq!(eff("curl --output /dev/null https://x"), Computed::Read);
    assert_eq!(eff("curl --output=/dev/null https://x"), Computed::Read);
    assert_eq!(eff("curl -sSo /dev/null -w '%{http_code}' https://x"), Computed::Read);
    // 그 밖은 그대로 쓰기.
    assert_eq!(eff("curl -o out.html https://x"), Computed::Write);
    assert_eq!(eff("curl --output=out https://x"), Computed::Write);
    assert_eq!(eff("curl -O https://x/f"), Computed::Write);
    assert_eq!(eff("curl -d a=1 -o /dev/null https://x"), Computed::Write);
    assert_eq!(eff("curl -X POST -o /dev/null https://x"), Computed::Write);
    assert_eq!(eff("curl -dso /dev/null https://x"), Computed::Write, "묶음의 나머지 글자(d)는 여전히 본다");
}

#[test]
fn openssl_branch() {
    assert_eq!(eff("openssl s_client -connect h:443 -servername h"), Computed::Read);
    assert_eq!(eff("openssl x509 -in c.pem -noout -text"), Computed::Read);
    assert_eq!(eff("openssl version"), Computed::Read);
    assert_eq!(eff("openssl dgst -sha256 f"), Computed::Read);
    let w = analyze_command("openssl x509 -in c.pem -out c.der");
    assert_eq!((w.effect, w.cause.as_deref()), (Computed::Write, Some("openssl -out")));
    assert_eq!(eff("openssl req -new -keyout k.pem"), Computed::Write);
    assert_eq!(eff("openssl dgst -out=x f"), Computed::Write);
    let u = analyze_command("openssl req -new -key k.pem");
    assert_eq!((u.effect, u.cause.as_deref()), (Computed::Unknown, Some("openssl req")));
    assert_eq!(eff("openssl rsa -in k"), Computed::Unknown);
    assert_eq!(eff("openssl"), Computed::Unknown);
}

#[test]
fn nc_tcpdump_whois() {
    assert_eq!(eff("nc -z -w 3 h 22"), Computed::Read);
    assert_eq!(eff("nc -zv h 22"), Computed::Read);
    assert_eq!(eff("ncat -vz h 443"), Computed::Read);
    assert_eq!(eff("nc h 25"), Computed::Unknown);
    assert_eq!(eff("netcat -l 9000"), Computed::Unknown);
    assert_eq!(eff("tcpdump -i eth0 -c 10 port 443"), Computed::Read);
    let t = analyze_command("tcpdump -i eth0 -w cap.pcap");
    assert_eq!((t.effect, t.cause.as_deref()), (Computed::Write, Some("tcpdump -w")));
    assert_eq!(eff("whois example.com"), Computed::Read);
}

#[test]
fn long_diagnostic_one_liner_is_read() {
    let a = analyze_plan(LONG, None);
    assert_eq!(a.effect, Computed::Read, "{a:?}");
    assert_eq!(a.cause, None);
    assert!(!mismatch(Effect::Read, a.effect));
    assert_eq!(a.lines.len(), 9);
    assert!(a.lines.iter().all(|l| l.effect == Computed::Read && l.cause.is_none()));
    let quiet: Vec<bool> = a.lines.iter().map(|l| l.quiet).collect();
    assert_eq!(quiet, [false, true, false, true, false, true, false, true, false]);
    assert!(a.lines[..8].iter().all(|l| l.sep.as_deref() == Some(";")));
    assert_eq!(a.lines[8].sep, None);
    assert!(a.lines[8].text.starts_with("echo | timeout 10 openssl"));
    println!("{}", serde_json::to_string_pretty(&a).unwrap());
}

fn texts(cmd: &str) -> Vec<(String, Option<String>)> {
    command_lines(cmd).into_iter().map(|l| (l.text, l.sep)).collect()
}

fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

#[test]
fn lines_are_lossless() {
    let cases = [
        LONG,
        "a && b || c",
        "ls; pwd;",
        "sleep 9 & ls",
        "a;; b",
        "; ls; pwd",
        "ls\n\n# note; x\npwd\n",
        "echo \"a; b\"; ls",
        "x=$(a; b) && echo $x",
        "(cd x; ls) && pwd",
        "ls | wc -l; cmd 2>&1 | tee /dev/null; a |& b",
        "{ a; b; } && c",
        "echo a \\\n  b; pwd",
        "cat <<'EOF' > /etc/x\na; b && c\n  EOF\nEOF\nls",
        "cat <<-X | wc -l\n\tq\n\tX\nrm f",
        "cat <<A <<B\n1\nA\n2\nB\nls",
        "grep x <<< \"a;b\"; ls",
    ];
    // 읽기가 아닌 한 줄 명령도 한 줄로 온다 — 그때도 글자를 잃지 않는다.
    let singles = ["rm -rf /tmp/x", "sudo find /var/log -name \"*.gz\" -delete;", "echo x > f &", "make |& tee log"];
    for c in singles {
        let lines = command_lines(c);
        assert_eq!(lines.len(), 1, "{c:?} → {lines:?}");
        let joined = format!("{}{}", lines[0].text, lines[0].sep.as_deref().unwrap_or(""));
        assert_eq!(squash(c), squash(&joined), "{c:?}");
    }
    for c in cases {
        let lines = command_lines(c);
        assert!(lines.len() >= 2, "{c:?} → {lines:?}");
        let joined: String = lines.iter().map(|l| format!("{}{}", l.text, l.sep.as_deref().unwrap_or(""))).collect();
        assert_eq!(squash(c), squash(&joined), "{c:?}");
    }
}

/// 줄마다 표시된 글자(코드 포인트로 잘라)와 그 효과 — 줄 차례대로 이어서.
fn marked(cmd: &str) -> Vec<(String, Computed)> {
    command_lines(cmd)
        .iter()
        .flat_map(|l| {
            let cs: Vec<char> = l.text.chars().collect();
            l.marks.iter().map(move |m| (cs[m.start..m.end].iter().collect::<String>(), m.effect)).collect::<Vec<_>>()
        })
        .collect()
}

fn mk(v: &[(&str, Computed)]) -> Vec<(String, Computed)> {
    v.iter().map(|(t, e)| (t.to_string(), *e)).collect()
}

#[test]
fn line_marks_point_at_the_words_that_caused_the_effect() {
    use Computed::{Delete as D, Unknown as U, Write as W};
    assert_eq!(marked("find /var/log -name '*.gz' -mtime +30 -delete"), mk(&[("find", D), ("-delete", D)]));
    assert_eq!(marked(r#"sudo find /var/log -name "*.gz" -mtime +7 -delete"#), mk(&[("sudo", D), ("find", D), ("-delete", D)]));
    assert_eq!(marked("journalctl --vacuum-time=7d"), mk(&[("journalctl", D), ("--vacuum-time=7d", D)]));
    assert_eq!(marked("systemctl restart rsyslog"), mk(&[("systemctl", W), ("restart", W)]));
    assert_eq!(marked("curl -sSo out.txt https://x/f"), mk(&[("curl", W), ("-sSo", W)]));
    assert_eq!(marked("curl -X post https://x"), mk(&[("curl", W), ("-X", W), ("post", W)]));
    assert_eq!(marked("echo x > /etc/f"), mk(&[(">", W)]));
    assert_eq!(marked("echo x >> /etc/f"), mk(&[(">>", W)]));
    assert_eq!(marked("ls &> list.txt"), mk(&[("&>", W)]));
    assert_eq!(marked("echo $(id)"), mk(&[("$(", U)]));
    assert_eq!(marked("echo \"now $(date)\""), mk(&[("$(", U)]));
    assert_eq!(marked("echo `id`"), mk(&[("`", U), ("`", U)]), "여는 · 닫는 백틱 둘 다");
    assert_eq!(marked("rm $(cat list)"), mk(&[("rm", D), ("$(", U)]));
    assert_eq!(marked("openssl"), mk(&[("openssl", U)]));
    assert_eq!(marked("openssl req -new -key k.pem"), mk(&[("openssl", U), ("req", U)]));
    // `-out` 은 `-outform` 을 칠하지 않는다 — 근거는 적힌 `-keyout`.
    assert_eq!(marked("openssl req -outform PEM -keyout k.pem"), mk(&[("openssl", W), ("-keyout", W)]));
    assert_eq!(marked("sudo rm -rf /srv/x"), mk(&[("sudo", D), ("rm", D)]));
    assert_eq!(marked("/bin/rm x"), mk(&[("/bin/rm", D)]));
    assert_eq!(marked("cat list | xargs rm"), mk(&[("rm", D)]));
    assert_eq!(marked("sed -ri 's/a/b/' f"), mk(&[("sed", W), ("-ri", W)]));
    assert_eq!(marked("git branch -D old"), mk(&[("git", D), ("branch", D), ("-D", D)]));
    assert_eq!(marked("docker system prune -f"), mk(&[("docker", D), ("system", D), ("prune", D)]));
    assert_eq!(marked(r"find /tmp -name '*.log' -exec rm -f {} \;"), mk(&[("find", D), ("-exec", D), ("rm", D)]));
    assert_eq!(marked("my-script.sh --go"), mk(&[("my-script.sh", U)]));
}

#[test]
fn line_marks_skip_reads_quotes_and_harmless_redirects() {
    use Computed::{Delete as D, Write as W};
    // 읽기 줄 — 아무것도 칠하지 않는다(한 줄이면 줄 자체가 없다).
    assert!(command_lines(r#"echo "rm -rf /""#).is_empty());
    assert!(command_lines("grep -e '-delete' f").is_empty());
    // 따옴표 안의 `-delete` 는 글자 — 칠하는 것은 적힌 그대로의 둘째 것.
    let l = command_lines("find . -name '-delete' -delete");
    let m: Vec<(usize, usize)> = l[0].marks.iter().map(|m| (m.start, m.end)).collect();
    assert_eq!(m, [(0, 4), (23, 30)]);
    // 한 줄 안 여러 구획 — 읽기 구획(`ls`)은 두고 `tee` 만.
    assert_eq!(marked("ls -l | tee f"), mk(&[("tee", W)]));
    // fd 복제 · /dev/null 은 칠하지 않는다.
    assert_eq!(marked("rm x 2>&1 >/dev/null"), mk(&[("rm", D)]));
    assert_eq!(marked("rm x 2> /dev/null; ls >&2"), mk(&[("rm", D)]));
    // 여러 줄 — 읽기 줄은 표시가 없다.
    let ls = command_lines("uptime; journalctl --vacuum-time=7d && systemctl restart rsyslog");
    assert_eq!(ls.len(), 3);
    assert!(ls[0].marks.is_empty());
    assert_eq!(marked("uptime; journalctl --vacuum-time=7d && systemctl restart rsyslog"),
        mk(&[("journalctl", D), ("--vacuum-time=7d", D), ("systemctl", W), ("restart", W)]));
}

/// 자리는 **코드 포인트** — 한글이 앞에 있어도 프런트의 `Array.from(text)` 와 같은 자리.
#[test]
fn line_marks_use_code_point_offsets() {
    let l = command_lines("echo 한글 > /tmp/f");
    assert_eq!((l[0].marks[0].start, l[0].marks[0].end), (8, 9));
    let l = command_lines("FOO=가나다 rm x");
    assert_eq!((l[0].marks[0].start, l[0].marks[0].end), (8, 10));
    assert_eq!(marked("echo '😀 한' && rm -f \"파일 1\""), mk(&[("rm", Computed::Delete)]));
    let l = command_lines("echo '😀 한' && rm -f x");
    assert_eq!(l[1].marks[0].start, 0);
}

#[test]
fn line_splitting_rules() {
    let s = |t: &str, sep: Option<&str>| (t.to_string(), sep.map(str::to_string));
    assert_eq!(texts("a && b || c"), [s("a", Some("&&")), s("b", Some("||")), s("c", None)]);
    // 파이프 · 리다이렉트는 나누지 않는다 — 읽기 한 줄이면 줄이 없고, 읽기가 아닌 한 줄이면 그 한 줄.
    assert!(command_lines("du -ah | sort -rh | head").is_empty());
    assert!(command_lines("ls 2>&1 | head").is_empty());
    assert!(command_lines("ls &> /dev/null").is_empty());
    assert_eq!(texts("make |& tee log"), [s("make |& tee log", None)]);
    assert!(command_lines("ls >&2").is_empty());
    // 따옴표 · 치환 · 하위 셸 · 묶음 · 주석 안은 나누지 않는다.
    assert!(command_lines(r#"echo "a; b""#).is_empty());
    assert!(command_lines("echo 'a && b'").is_empty());
    assert_eq!(texts("echo $(a; b)"), [s("echo $(a; b)", None)]);
    assert_eq!(texts("echo `a; b`"), [s("echo `a; b`", None)]);
    assert!(command_lines("(cd x; ls)").is_empty());
    assert_eq!(texts("{ a; b; }"), [s("{ a; b; }", None)]);
    assert!(command_lines("ls # x; y").is_empty());
    assert!(command_lines("echo a \\\n b").is_empty(), "줄 이음은 한 줄");
    assert_eq!(texts("(cd x; ls); pwd"), [s("(cd x; ls)", Some(";")), s("pwd", None)]);
    // 백그라운드 `&` 는 나눈다 · 끝의 `;` · `&` 는 남긴다 · 빈 줄 · 끝 줄바꿈은 버린다.
    assert_eq!(texts("sleep 9 & ls"), [s("sleep 9", Some("&")), s("ls", None)]);
    assert_eq!(texts("ls; pwd;"), [s("ls", Some(";")), s("pwd", Some(";"))]);
    assert_eq!(texts("ls\n\npwd\n"), [s("ls", Some("\n")), s("pwd", None)]);
    // 주석만 있는 줄은 읽기 · 흐리게.
    let c = command_lines("# 확인\nls -l");
    assert_eq!(c.len(), 2);
    assert_eq!((c[0].effect, c[0].quiet, c[0].cause.as_deref()), (Computed::Read, true, None));
    assert!(!c[1].quiet);
    // heredoc 본문은 연 줄의 몫 — 본문 안의 줄바꿈 · `;` 에서 나누지 않고, 구분 줄 뒤 줄바꿈에서 나눈다.
    assert_eq!(texts("cat <<EOF > f\na; b\nEOF\nls"), [s("cat <<EOF > f\na; b\nEOF", Some("\n")), s("ls", None)]);
    // 본문이 오기 전 같은 줄의 `;` 도 나누지 않는다(나누면 본문이 뒤 조각으로 넘어간다).
    assert_eq!(texts("cat <<EOF; rm x\nhi\nEOF"), [s("cat <<EOF; rm x\nhi\nEOF", None)]);
    // here-string 은 본문이 없다 — 평소처럼 나눈다.
    assert_eq!(texts("grep x <<< \"$v\"; rm y"), [s("grep x <<< \"$v\"", Some(";")), s("rm y", None)]);
    // 치환 안의 heredoc 은 짝 찾기가 본문 글자에 흔들릴 수 있다 — 줄을 내지 않는다(예전 그대로).
    assert!(command_lines("echo $(cat <<X\nhi\nX\n); ls").is_empty());
    // 줄마다 효과 · quiet 는 echo/printf 뿐이고 리다이렉트가 없을 때만.
    let m = command_lines("echo '-- 지우기'; rm -rf /tmp/x; echo hi > f; printf a");
    let got: Vec<(Computed, bool)> = m.iter().map(|l| (l.effect, l.quiet)).collect();
    assert_eq!(got, [(Computed::Read, true), (Computed::Delete, false), (Computed::Write, false), (Computed::Read, true)]);
    assert_eq!(m[1].cause.as_deref(), Some("rm"));
    assert!(m.iter().all(|l| !l.over), "분석 시점엔 over 가 없다");
    // 검증 명령은 줄을 내지 않는다(DB 는 문장마다 한 줄 — `db_statements_become_lines`).
    assert!(analyze_plan("ls", Some("a; b")).lines.is_empty());
}

/// 줄의 (표시 글자 · 갈래) — `sudo` 표시를 효과 표시와 가른다.
fn kinds(cmd: &str) -> Vec<(String, Option<String>)> {
    command_lines(cmd)
        .iter()
        .flat_map(|l| {
            let cs: Vec<char> = l.text.chars().collect();
            l.marks.iter().map(move |m| (cs[m.start..m.end].iter().collect::<String>(), m.kind.clone())).collect::<Vec<_>>()
        })
        .collect()
}

/// 권한 올리기 낱말은 `sudo` 갈래로 칠한다 — 읽기 한 줄이라도 줄을 낸다(그 낱말 하나만 색).
#[test]
fn sudo_words_are_marked_even_on_read_lines() {
    let sudo = || Some("sudo".to_string());
    let l = command_lines("sudo journalctl -n 50 --no-pager");
    assert_eq!(l.len(), 1, "읽기 한 줄이라도 sudo 표시가 있으면 낸다");
    assert_eq!((l[0].effect, l[0].cause.as_deref()), (Computed::Read, None));
    assert_eq!(l[0].marks, [LineMark { start: 0, end: 4, effect: Computed::Read, kind: sudo() }]);
    // 쓰기 · 삭제 구획 — sudo 표시 + 효과 낱말(감싸개 플래그는 칠하지 않는다).
    assert_eq!(kinds("sudo -u www rm -rf /x"), [("sudo".to_string(), sudo()), ("rm".to_string(), None)]);
    assert_eq!(kinds("doas systemctl restart x"), [("doas".into(), sudo()), ("systemctl".into(), None), ("restart".into(), None)]);
    assert_eq!(kinds("pkexec ls"), [("pkexec".to_string(), sudo())]);
    // `su` 는 프로그램이자 권한 올리기 — 한 표시(sudo 갈래가 이긴다).
    assert_eq!(kinds("su -c 'id'"), [("su".to_string(), sudo())]);
    // 여러 줄 — 읽기 줄의 sudo 도.
    assert_eq!(kinds("uptime; sudo ls /root"), [("sudo".to_string(), sudo())]);
    // 따옴표 · 이스케이프로 적힌 것 · 인자 자리의 글자는 아니다.
    assert!(command_lines("'sudo' ls").is_empty());
    assert!(command_lines("\\sudo ls").is_empty());
    assert!(command_lines("echo sudo").is_empty());
    assert!(command_lines("grep sudo /var/log/auth.log").is_empty());
    // 판정은 그대로 — sudo 는 효과를 바꾸지 않는다.
    assert_eq!(analyze_command("sudo journalctl -n 50 --no-pager").effect, Computed::Read);
}

/// heredoc 본문은 표준 입력으로 가는 데이터 — 받는 프로그램이 효과를 정한다. 본문은 칠하지 않는다.
#[test]
fn heredoc_body_is_data() {
    use Computed::{Delete as D, Read as R, Unknown as U, Write as W};
    let a = analyze_command("cat <<'EOF'\nrm -rf /\n$(id)\nEOF");
    assert_eq!((a.effect, a.programs.clone()), (R, vec!["cat".to_string()]), "{a:?}");
    assert!(a.lines.is_empty(), "읽기 한 줄(본문 포함) — 두 줄 접기 그대로");
    assert_eq!(eff("cat <<EOF\nhello\nEOF"), R);
    assert_eq!(eff("cat <<-EOF\n\thello\n\tEOF"), R);
    assert_eq!(eff("cat <<\"EOF\"\n`id`\nEOF"), R, "따옴표 구분 낱말 — 본문 치환이 돌지 않는다");
    // 따옴표 없는 구분 낱말 + 본문의 치환 — 확인 필요(`$()`), 표시는 `<<` 에.
    let s = analyze_command("cat <<EOF\nuser=$(id)\nEOF");
    assert_eq!((s.effect, s.cause.as_deref()), (U, Some("$()")));
    assert_eq!(marked("cat <<EOF\nuser=$(id)\nEOF"), mk(&[("<<", U)]));
    assert_eq!(eff("cat <<EOF\n`id`\nEOF"), U);
    // 받는 프로그램이 정한다.
    assert_eq!(analyze_command("bash <<EOF\nls\nEOF").cause.as_deref(), Some("bash"));
    assert_eq!(eff("python3 <<EOF\nprint(1)\nEOF"), U);
    assert_eq!(eff("mysql -u root <<EOF\nDROP TABLE t;\nEOF"), U);
    assert_eq!(marked("tee /etc/x <<EOF\nrm -rf /\nEOF"), mk(&[("tee", W)]));
    assert_eq!(eff("tee /etc/x <<EOF\nhi\nEOF"), W);
    // 구분 줄 뒤의 명령은 명령이다 · 같은 줄의 `;` 뒤도.
    let l = command_lines("cat <<EOF\nhi; rm -rf /\nEOF\nrm x");
    assert_eq!(l.iter().map(|l| l.effect).collect::<Vec<_>>(), [R, D]);
    assert_eq!(l[1].marks.len(), 1);
    assert!(l[0].marks.is_empty(), "본문은 칠하지 않는다");
    let l = command_lines("cat <<EOF; rm x\nbody\nEOF");
    assert_eq!(l.len(), 1);
    assert_eq!((l[0].effect, l[0].cause.as_deref()), (D, Some("rm")));
    assert_eq!(marked("cat <<EOF; rm x\nbody\nEOF"), mk(&[("rm", D)]));
    // 구분 줄이 없다 · 본문이 없다 · 구분 낱말이 없다 — 확인 필요(`<<`).
    for c in ["cat <<EOF\nhi\nEO", "cat <<EOF", "cat <<", "cat << ; ls"] {
        let a = analyze_command(c);
        assert_eq!((a.effect, a.cause.as_deref()), (U, Some("<<")), "{c:?}");
    }
    assert_eq!(marked("cat <<EOF\nhi"), mk(&[("<<", U)]));
    // 여러 heredoc · CRLF 구분 줄.
    assert_eq!(eff("cat <<A <<B\nrm\nA\nrm\nB"), R);
    assert_eq!(eff("cat <<EOF\r\nhi\r\nEOF\r\n"), R);
    // here-string — 낱말은 데이터(읽기) · 안의 `$(` 는 돈다.
    assert_eq!(analyze_command("grep x <<< \"$v\"").programs, vec!["grep"]);
    assert_eq!(eff("grep x <<< \"$v\""), R);
    assert_eq!(eff("grep x <<<rm"), R);
    let h = analyze_command("grep x <<< \"$(cmd)\"");
    assert_eq!((h.effect, h.cause.as_deref()), (U, Some("$()")));
}

/// DB 작업안 — 문장마다 한 줄, 동사 · 테이블 낱말 표시, WHERE 없는 쓰기 · DROP · TRUNCATE 는 `danger`.
#[test]
fn db_statements_become_lines() {
    let a = analyze_db(&[stmt("DELETE FROM users"), stmt("  UPDATE t SET x = 1 WHERE id = 1  ")]);
    assert_eq!(a.lines.len(), 2);
    let (d, u) = (&a.lines[0], &a.lines[1]);
    assert_eq!((d.text.as_str(), d.sep.as_deref(), d.effect), ("DELETE FROM users", Some(";"), Computed::Delete));
    assert_eq!((d.cause.as_deref(), d.danger), (Some("DELETE users · WHERE 없음"), true));
    let cut = |l: &CmdLine| -> Vec<String> {
        let cs: Vec<char> = l.text.chars().collect();
        l.marks.iter().map(|m| cs[m.start..m.end].iter().collect()).collect()
    };
    assert_eq!(cut(d), ["DELETE", "users"]);
    assert_eq!((u.text.as_str(), u.effect, u.cause.as_deref(), u.danger), ("UPDATE t SET x = 1 WHERE id = 1", Computed::Write, Some("UPDATE t"), false));
    assert_eq!(cut(u), ["UPDATE", "t"]);
    // 글자를 잃지 않는다 — 카드의 원문(`store::db_plan_text`)과 공백을 빼면 같다.
    let plan_text = ["DELETE FROM users", "  UPDATE t SET x = 1 WHERE id = 1  "].map(|s| format!("{s};")).join("\n");
    let joined: String = a.lines.iter().map(|l| format!("{}{}", l.text, l.sep.as_deref().unwrap_or(""))).collect();
    assert_eq!(squash(&plan_text), squash(&joined));
    // 문자열 · 주석 안은 칠하지 않는다 — `WITH … DELETE` 는 안의 DELETE · 그 테이블.
    let w = analyze_db(&[stmt("WITH gone AS (DELETE FROM q WHERE done RETURNING id) SELECT count(*) FROM gone")]);
    assert_eq!(cut(&w.lines[0]), ["DELETE", "q"]);
    assert!(!w.lines[0].danger);
    let c = analyze_db(&[DbPlanStmt { keyword: "UPDATE".into(), ..stmt("/* DELETE x */ UPDATE \"public\".\"t\" SET note = 'DELETE users' WHERE id = 2") }]);
    assert_eq!(cut(&c.lines[0]), ["UPDATE", "\"public\".\"t\""]);
    // 한글이 앞에 있어도 코드 포인트 자리.
    let k = analyze_db(&[stmt("UPDATE 사용자 SET 이름 = '가' WHERE id = 1")]);
    assert_eq!(cut(&k.lines[0]), ["UPDATE", "사용자"]);
    // DROP · TRUNCATE 는 danger · 읽기 문장은 표시 · 근거 없음.
    let x = analyze_db(&[stmt("TRUNCATE TABLE sessions"), stmt("DROP TABLE IF EXISTS old_t"), stmt("SELECT 1"), stmt("INSERT INTO a (b) VALUES (1)")]);
    let got: Vec<(bool, Option<&str>)> = x.lines.iter().map(|l| (l.danger, l.cause.as_deref())).collect();
    assert_eq!(got, [(true, Some("TRUNCATE sessions")), (true, Some("DROP old_t")), (false, None), (false, Some("INSERT a"))]);
    assert!(x.lines[2].marks.is_empty());
    assert_eq!(cut(&x.lines[3]), ["INSERT", "a"]);
    assert!(x.lines.iter().all(|l| !l.over), "분석 시점엔 over 가 없다");
    println!("{}", serde_json::to_string(&a.lines).unwrap());
}

/// 보고용 — 실제 JSON(`--nocapture` 로 본다).
#[test]
fn print_sample_lines_json() {
    for c in [
        "sudo journalctl -n 50 --no-pager",
        "cat <<'EOF'\na\nb\nEOF",
        "cat <<'EOF' > /dev/null\n점검 메모 — 2026-10-24\nline; two && three\nEOF\nwc -l /var/log/syslog",
        r#"sudo find /var/log -name "*.gz" -mtime +7 -delete"#,
    ] {
        println!("JSON {c:?} => {}", serde_json::to_string(&analyze_command(c)).unwrap());
    }
    let a = analyze_db(&[stmt("DELETE FROM users"), stmt("UPDATE t SET x=1 WHERE id=1")]);
    println!("JSON db => {}", serde_json::to_string(&a.lines).unwrap());
    for s in ["DELETE FROM sessions", "UPDATE accounts SET plan = 'pro' WHERE id = 42"] {
        println!("JSON db1 {s:?} => {}", serde_json::to_string(&analyze_db(&[stmt(s)])).unwrap());
    }
}

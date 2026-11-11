# 보안 제약 (불변 — 사용자 명시)

[`CLAUDE.md`](../CLAUDE.md) 의 "보안 제약" 한 줄 요약의 전문이다. 요약과 어긋나면 여기 문장이 기준이다.
이 절들은 사용자가 명시한 불변이다 — 바꾸려면 사용자 결정이 필요하다.

<a id="inv-1"></a>
## 1. Aynx 세션 서버의 MCP 등록 범위

- **Aynx 세션 서버는 CLI 전역에 등록하지 않는다 — Aynx 가 띄우는 로컬 AI 타일과 감싸개가 있는 로컬 셸 타일(PowerShell · Git Bash · 셸 통합 켬 — 그 셸에서 친 `claude` · `codex`)에만 실리고 MCP 토큰은 사용자 CLI 설정 파일에 없다** → [docs/log/2026-10-03-mcp-sessions-inject.md](log/2026-10-03-mcp-sessions-inject.md) · [docs/log/2026-10-26-agent-enable.md](log/2026-10-26-agent-enable.md).

<a id="inv-2"></a>
## 2. 볼트와 비밀

- 비밀번호·키 암호구는 **사용자가 켠 볼트에만** 저장한다 (옵트인 — 켜지 않으면 예전 그대로
  한 번 쓰고 버리고 다음 접속에 다시 묻는다 · 예외 하나: DB 비밀번호는 그 연결의 사람 쿼리 타일이 붙어 있는 동안 세션 서버
  메모리에 빌려 둔다 — 아래 DB 절). 볼트는 OS 저장소가 아니라 **자체 파일
  하나**(`vault.bin`, 통째로 암호화)이고 마스터 암호는 **선택**이다 — 걸지 않으면 "이 PC 의
  내 계정으로 로그인한 사람은 볼 수 있다" 를 화면이 그대로 밝힌다. **가림막이 걸리면 볼트도
  잠기고, 가림막을 걷는 것이 곧 볼트를 여는 것이다**(마스터 없으면 Enter). **보는 창이 0개여도 잠긴다**(마지막 창 파괴·GUI 종료/kill —
  이때 HTTP MCP 티켓은 폐기가 아니라 정지, 가림막을 걷으면 같은 티켓으로 복구 — 결정 · 예외: 사람 쿼리 타일이 붙어 있는 동안 그 타일이
  인증한 DB 비밀번호는 세션 서버 메모리에서 AI 연결이 쓴다 — 볼트 잠김과 무관, SSH 의 열린 세션과 같은 등급 · 사용자 결정 · 아래 DB 절). **마스터를 걸었으면 앱을 다시 켤 때(메인 창 부팅에
  볼트가 잠겨 있으면 — 세션 서버가 새로 뜬 날 포함) 무조건 가림막이 선다** · **가림막은 집 PC 창 전체에 하나처럼 서고 걷힌다**(원격 웹 창 제외) — 건너뛰는 길은 없고, 마스터를 잊으면 `vault.bin` 을 손으로 지운다(앱 안에
  지우는 길을 두지 않는다 — [docs/log/2026-10-28-lock-screens.md](log/2026-10-28-lock-screens.md)) — 자물쇠를 그린
  가림막 자신이 그 관문이고, 다른 키·클릭으로는 걷히지 않는다. 시계는 프라이버시의 무입력
  자동 잠금 하나뿐이고 볼트 쪽 자동 잠금 칸은 없다. 볼트 **밖**(설정 파일·
  로그·`Debug`·MCP)에는 한 글자도 남기지 않고, **볼트 값은 세션 서버 프로세스 밖으로 나가지 않는다**(GUI 는 상태·종류·대상·참조만 — SSH 인증·헤드리스는 서버 프로세스에서 직접 읽고 **값을 돌려주는 op 는 없다**)
  (프런트가 받는 것은 `has_*`·`list` 의 종류와 대상뿐). 개인키 파일 자체는 저장하지 않고
  접속 순간 읽어 서명한 뒤 버린다(에이전트 우선 · `IdentityFile` 은 그다음).
  **헤드리스 위임은 기본적으로 볼트를 쓰지 않고, 호스트별 위임 '볼트의 키 암호구
  사용'(`vault_passphrase`)을 켠 호스트에서만** 그 키의 암호구를 볼트에서 꺼내 쓴다
  (비밀번호는 여전히 아니고, 볼트가 잠겨 있으면 그 접속은 아예 서지 않는다).
  **위임의 편집은 호스트 폼 · 타일 AI 권한 팝오버(둘 다 Tauri 명령)뿐이고 MCP 에는 위임·권한을 바꾸는 도구가 없다**(오케스트레이션 조율 도구는 Run 장부만 바꾼다).
  **Run(앨범)은 사람이 [새 앨범]에서 첫 말을 보내는 Tauri 명령 `producer_album_start` 로만 열린다** — 사람이 정한 저장소 · 아티스트별 등급 · 허용 명령 ·
  수락 규칙 · 검증 · 한도를 Run 에 담고, 띄운 프로듀서 세대와 Run · 조정자 묶음 · 귀속을 한 잠금에서 확정한다(첫 말 전송 실패는 `sent:false` — 앨범은 남고 사람이 다시 보낸다).
  **범위는 사람만 정한다 — AI · MCP 에는 앨범을 열거나 구성을 넓힐 길이 없다**(시험 `album_opens_only_from_human_op` · `start_run_is_gone` ·
  `album_config_has_no_mcp_writer` · `run_without_album_is_inert`). **앨범 구성은 시작 때와 [앨범 권한]에서만 사람이 바꾼다**(Tauri `orchestration_album_widen` ·
  `_set` — 서버 `widens` 하나가 넓힘 판정 · `_set` 은 넓힘을 거절, 시험 `album_set_rejects_widening` · 다음 턴부터 지금 rev).
  **아티스트는 권한 없는 프로필**(이름 · 아이콘 · CLI · 종류 · 모델 · 강도 · 지침 — `orchestration-artists.toml` · 시험 `artist_has_no_permission`)이고,
  편집은 Tauri `orchestration_artist_set` · `_remove` 뿐(원격 ALLOW · 산 앨범의 멤버는 삭제 거절). MCP 에는 구성 · 아티스트 쓰기 도구가 없다 →
  [docs/log/2026-10-30-orchestration-album-first.md](log/2026-10-30-orchestration-album-first.md) 2절 · 3절 · 6절.
  **원격 세션의 AI 권한은 호스트 하나**(Off · Read · Ask · Auto · YOLO = 끔 · 읽기 · 승인 후 실행 · 허용 목록 자동 · 무엇이든 자동 — 이름은 모든 언어에서 이 영어 낱말 — 사람이 연 타일과
  헤드리스에 똑같이), 로컬 타일은 타일별 읽기 허용만(실행 대상 아님 · AI CLI 타일은 없음), 호스트 목록에 없는 원격 타일은 끔 →
  [docs/log/2026-10-07-ai-permission-unify.md](log/2026-10-07-ai-permission-unify.md) ·
  [docs/log/2026-09-19-vault.md](log/2026-09-19-vault.md) ·
  [docs/log/2026-09-19-identity-file-auth.md](log/2026-09-19-identity-file-auth.md) ·
  [docs/log/2026-09-21-fleet-delegation-ui.md](log/2026-09-21-fleet-delegation-ui.md) ·
  [docs/log/2026-09-22-delegation-vault-passphrase.md](log/2026-09-22-delegation-vault-passphrase.md).

<a id="inv-3"></a>
## 3. 외부 MCP 서버 환경변수(예외)

- **예외 하나 — 외부 MCP 서버 환경변수(볼트 `mcp_env`).** stdio 서버는 평문 환경변수가 있어야 돌기
  때문에, 이 값만은 볼트가 **열려 있는 동안** **세션 서버의** 루프백 실행 브로커가 `aynx mcp-run` 도우미(별도
  프로세스)를 거쳐 그 서버 자식 환경에 평문으로 넘긴다. 브로커는 64자 실행 티켓만 확인하고 상대
  프로세스는 확인하지 않는다. 티켓은 Claude `--mcp-config` 파일·Codex `-c` 인자(셸 첫 입력 → 스크롤백·
  셸 히스토리 · 감싸개가 있는 로컬 셸 타일은 그 타일의 장식 파일)에 남고 설정을 바꾸거나 세션 서버가 끝날 때까지(GUI 를 꺼도 산다) 다시 쓸 수 있다 — 그러니 **이 값은 같은 사용자 계정의
  프로세스, 그 타일(로컬 AI 타일 · 감싸개가 있는 로컬 셸 타일 전부)의 AI 에이전트 자신을 포함해, 에게 노출된다고 본다**(마스터 암호는 볼트를 여는
  순간만 지킨다). 알고 받은 한계(사용자 결정): 평문 `.mcp.json` 과 같은 등급이고, 디스크·
  설정 파일·프런트·MCP RPC 에는 여전히 값이 없다. 볼트가 잠기면 브로커도 값을 내주지 않는다 →
  [docs/log/2026-10-03-mcp-scopes-env.md](log/2026-10-03-mcp-scopes-env.md).
  HTTP 헤더 값은 세션 서버 안 프록시가 붙여 Aynx 프로세스(GUI·세션 서버) 밖의 CLI·도우미로 나가지 않는다 →
  [docs/log/2026-10-04-mcp-http-header-proxy.md](log/2026-10-04-mcp-http-header-proxy.md).

<a id="inv-4"></a>
## 4. 위임 범위 안에서만 실행

- **앱은 사용자가 명시적으로 위임한 범위 안에서만 실행한다** (규모에서 매
  쓰기의 실시간 감독은 불가능하다). 위임의 형식은 둘: (a) 그 자리 사람 승인, (b) 사전 정책
  (자동 승인)이되 **범위·한도가 명시된** 것(호스트 · DB 연결의 **YOLO** 는 범위 = 그 호스트 · 그 연결 전부 — 명령 정책 · 빈도 한도 없이,
  caps · 전체 스위치 · 감사는 그대로 → [docs/log/2026-10-23-approve-all.md](log/2026-10-23-approve-all.md)). 지켜지는 것: 원시 `send_command` 는 만들지 않는다(서버 op `ssh_exec` 도 아니다 —
  대상은 서버 표의 세션 id, 호출자는 GUI Rust 고정 조립 함수뿐, 프런트·MCP 명령 없음을 시험이 지킨다). **AI 문자열→PTY 길은 없다**.
  **AI 자유 글과 실행 입력의 경계 — AI가 작성한 자유 글을 새 작업 지시로 실행 재료에 싣는 앱 경로는 오케스트레이션 작업자·검토자의 헤드리스 턴뿐이다. 프로듀서 채팅에는 사람이 제출한 입력 외에 서버가 Run 장부에서 제한된 타입으로 만든 깨움 메시지만 새 사용자 턴으로 넣을 수 있다. MCP 결과·작업자 대화·보고·판정 본문을 그대로 채팅 입력으로 전달하는 경로는 두지 않는다**(사이드 채팅 stdin 은 사람 문자열 — 아래 ③ · 프로듀서 채팅 — 아래 ④). 헤드리스 턴은 첫 지시
  (`spawn_worker`) · 이어지는 지시(MCP `send_prompt` = 같은 대화를 resume 하는 **새 턴** — `orchestration/resume.rs`)를 셸 없는 인자 배열의
  마지막(옵션 → `--` → 서버 머리줄 `[` 로 시작하는 지시)로만 싣는다. 대상은 **사람이 연 앨범의 Run 이 띄운 쓰기형 작업자**(`idle` ·
  대화가 끊기지 않았을 때 · 한 번에 한 턴 — 도는 중이면 `busy{attemptIds}` · 큐 없음 · 결과는 `started` 또는 `rejected{spawn-failed}` —
  예약 수락과 실제 시작이 나뉠 수 있다(생성 대기 상한을 넘으면 `started{launching:true}` · 뒤에 못 서면 그 턴이 `failed:spawn-failed` · `idle` · 사건으로 보인다 — 끝내 모르는 상태는 없다)). 셸 타일 · 사람이 연 타일 · 원격 타일 · 프로듀서 채팅에는 길이 없다. 작업자에게는 권한 화면이 없다(비대화형 — 허용 밖은 CLI 가 거절하고
  작업자는 `report_done{blocked}` 로 알린다: 비종결 · worktree 유지 · 사람이 [앨범 권한]에서 넓히면 조정자가 같은 대화를 잇는다). **오케스트레이션 검증**: 검증 문자열은 사람만 설정한다
  (**[새 앨범]의 구성에서만** — 글자는 앨범 시작 때 Run 에 고정되고 도중에 바뀌지 않는다 · [앨범 권한]은 사람 확인 ↔ 자동 실행만 · MCP 로 정하거나 바꿀 수 없다). 실행 대상 코드는 AI 가 바꿀 수 있다 — 그래서 실행은 **사람 확인(후보별 — 후보 OID ·
  명령 해시 · 통합 머리에 묶임)** 또는 **사람이 켠 자동 실행 위임 범위 안에서만** 한다(자동은 '전부 자동' 과 같은 위험 등급 표시). 승인 ·
  실패 덮어쓰기는 Tauri 명령뿐(MCP 도구 없음). 검증은 사용자 권한 · 샌드박스 없이 돈다(OS 격리는 아직 없다 — 무인 검증의 임의 코드 실행 위험은 사용자가 수용했다) →
  [docs/log/2026-10-15-orchestration-integration-design.md](log/2026-10-15-orchestration-integration-design.md) 5절. 무인 검증(자동 실행)은
  후보마다 **지금 앨범 구성의 자동 실행 칸 · 저장소 신원**으로 다시 판정하고, 거둬졌으면 사람 확인으로 돌린다. 작업자의 권한은 **앨범 구성의 그 아티스트 등급 ·
  허용 명령**(편집은 [앨범 권한] Tauri 명령 · 원격은 넓힘만 REAUTH)을 **턴마다 지금 rev** 에서 읽고, 모델 · 강도 · 지침은 아티스트 목록의 지금 값이다
  (넓힘 · 좁힘 모두 다음 턴부터 · 도는 턴의 인자는 그대로 — 시험 `album_change_applies_next_turn`) — 남는 위험은
  그 역할의 권한과 사람 감독이 진다 → [docs/log/2026-10-16-orchestration-headless-design.md](log/2026-10-16-orchestration-headless-design.md) · AI 는 자기 실행을 **자가 승인 못 한다**(approve 는 Tauri 전용, MCP 아님 — 세션 서버로 가는 **승인 등급 프레임은
  `approve_operation` 하나만** 만들고(소스 훑기 시험), 서버가 만료·상한·정책·권한·빈도를 다시 판정한다 — 서버 안 자동 승인 진입점도 `approve_in(…, "auto")` 하나, 시험 `auto_approve_has_one_entry`) ·
  위임되지 않은 범위는 여전히 승인 대기. 쓰기(실행)는 단계가 아니라 **이미 선 기능**이다.

<a id="inv-5"></a>
## 5. 세션 로깅

- 세션 로깅은 기본 꺼짐, **세션별 옵트인**.

<a id="inv-6"></a>
## 6. 메신저 웹훅 URL

- **메신저 웹훅 URL 은 채널마다 자기 파일(`<설정 루트>/discord-webhook` · `<설정 루트>/slack-webhook`)에만** — 프런트·MCP·로그·`Debug` 로 나가지 않고(`configured` 하나), 멘션은 늘 막는다(Discord `allowed_mentions` · Slack `& < >` 걷기) →
  [docs/log/2026-09-27-discord-notify.md](log/2026-09-27-discord-notify.md) ·
  [docs/log/2026-09-28-messenger-channels.md](log/2026-09-28-messenger-channels.md).

<a id="inv-7"></a>
## 7. 포트 포워드

- 포트 포워드는 **127.0.0.1 전용**.

<a id="inv-8"></a>
## 8. DB 비밀번호와 AI 의 DB 접근

- **DB 비밀번호는 볼트 `db_password`(대상 = DB 연결 id)에만 저장한다** — 연결 목록은 `<설정 루트>/db-connections.json` 하나(경유 `via` = 호스트
  별칭 · 비밀번호 칸 없음 · 서버가 열 때 id 로 다시 읽음). 담는 길은 쿼리 타일 접속 모달 하나(인증 성공 뒤), 값은
  세션 서버 안에서만 읽는다. DB 연결·드라이버는 세션 서버에 살고 session_core 밖이다. **MCP 의 DB 도구는 연결마다 사람이 준
  AI 권한(Off · Schema · Read · Ask · YOLO — `delegation.toml` `[[database]]` + 신원 스냅샷, 대상을 바꾸면 끔 · 편집은 Tauri 명령뿐 ·
  허용 목록 자동 승인 없음) 안에서만** 보이고(끔이면 목록에도 없다 · 판정은 세션 서버), AI 는 **사람 타일과 따로 연 AI 전용 읽기 전용 연결**로만
  읽는다(가드 읽기 전용 + 엔진 READ ONLY — 사람의 트랜잭션·쓰기 모드에 닿지 않음). **Read 이상이면 조회 결과 행이 모델 제공자로
  간다**(Schema 는 행 없음 · 호출마다 감사 `db_read`, 값은 남기지 않음). **AI 의 쓰기는 작업안뿐**(MCP 는 초안 저장만 — 대상 `db:<id>`
  하나 · Ask 이상 연결만 · 사람 승인(연결이 YOLO 면 자동 승인) · 실행 직전 권한·신원 재판정 · 따로 연 쓰기 연결의 한 트랜잭션 ·
  `maxAffected` 넘으면 커밋 전 되돌림). DB 비밀번호는 여전히 볼트 → 세션 서버 안에서만(경유 SSH 는 헤드리스 규칙).
  **AI 연결(읽기 · 쓰기 작업안)의 DB 비밀번호 = 빌린 값 → (헤드리스 위임이 켜진 연결만) 볼트**(사용자 결정): 사람 쿼리 타일의 새 열기가 비밀번호로 인증에
  성공하면(**사람이 친 값 · 볼트에서 읽은 값 모두** — "저장" 체크와 무관 · [연결 테스트] · 재부착 · AI 연결은 담지 않음) 그 값을 인증 당시 신원과 함께
  **세션 서버 메모리에만** 들고, 그 연결의 사람 타일이 붙어 있는 동안 AI 연결이 볼트보다 먼저 쓴다(거절되면 버리고 볼트로 한 번).
  **가림막 · 창 0개 · GUI 연결 0(볼트 잠금)과 무관하다**(SSH 의 열린 세션 위 AI 와 같은 모양 — 타일이 없을 때 볼트 값으로 새로 여는 것은 예전 그대로
  볼트가 열려 있어야 한다). **지우는 때는 셋뿐 — 그 연결의 마지막 사람 타일이 표에서 빠짐(닫기 · 창 파괴 · 리로드 TTL · 떨어진 세션 [닫기] · 모두 닫기 · 다른 연결로
  바뀜 — 창이 사라져 떨어진 세션으로 남은 동안은 그대로) · 대상(엔진 · 경유 · 주소 · 포트 · DB · 사용자 · 파일) 바뀜 · DB 가 빌린 값을 거절**(도는 AI 조회 · 쓰기 트랜잭션은 끝까지 · 빌린 값으로 연 AI
  읽기 연결은 지움 뒤 닫음). 볼트 값과 같은 비밀 — 프로세스 밖 · 로그 · `Debug` · 영속 ·
  감사 · 값 돌려주는 op 없음(`db/borrowed.rs` · 시험 `borrowed_password_never_leaves`). 둘 다 없으면 AI 는 실패하고 사람에게 타일 · 볼트를
  안내한다 → [docs/log/2026-11-09-db-borrowed-password.md](log/2026-11-09-db-borrowed-password.md).
  **타일 없이 AI 가 볼트 값으로 새로 여는 것은 헤드리스 위임(`[[database]] headless` — 연결 폼 "타일 없이 AI 접속", 단계와 따로 · 끔이거나 스냅샷이
  어긋나면 함께 꺼짐)이 켜진 연결만**(SSH 헤드리스 접속과 같은 원칙 — 끄면 볼트 · 경유 SSH 에 닿지 않고 실패 · 판정은 세션 서버 `db::ai::open_with`
  하나 · 편집은 Tauri `db_ai_set` 의 `headless` 뿐 — 원격 REAUTH · MCP 길 없음). **SQLite 도 같은 칸** — 비밀번호가 없어도 그 연결의 사람 타일이
  세션 서버 표에 없으면 켠 연결만 AI 가 파일을 연다(읽기 · 쓰기 작업안 · `db::ai::sqlite_gate` · 비밀번호 없이 연 풀 연결도 같은 문). 이관: 칸 없는 옛 블록은 켬으로 읽고(파일 안 고침) 새 블록 ·
  대상이 바뀐 다시 적기는 `headless = false` 를 적는다. **쿼리 타일은
  읽기 전용이 기본**(문장 하나 · 첫 낱말 허용 목록 · 엔진 READ ONLY — 최종 방어선은 DB 계정 권한, 쓰기는 타일마다 확인 뒤 켜고
  저장하지 않는다). TLS 신뢰 = 내장 공개 CA + CA 파일(OS 저장소 안 씀 · verify-ca 는 CA 파일만) →
  [docs/log/2026-10-12-query-tile.md](log/2026-10-12-query-tile.md) ·
  [docs/log/2026-10-13-db-write-mcp-design.md](log/2026-10-13-db-write-mcp-design.md).

<a id="inv-9"></a>
## 9. 오케스트레이션 역할 토큰

- **오케스트레이션 역할 토큰** — **로컬 AI 타일마다 MCP 토큰**(감싸개가 있는 로컬 셸 타일도 — AI 타일인가는 서버 표의 따로 칸,
  셸 타일의 AI 읽기 허용은 예전 그대로)(`src-tauri/src/tile_token.rs` — 세션 서버가 세션 `open` 에서 뽑아
  `(stream, sessionEpoch)` 에 묶는다: 요청마다 그 회차가 살아 있어야 하고 아니면 `stale-tile` · 회차가 바뀌거나 세션 회수 · 타일 닫기 때 폐기 ·
  F5 · 웹뷰 크래시 재부착은 그대로). **타일 토큰은 Run 을 열지도 이어받지도
  조율하지도 못한다** — 타일의 목록에 타일 도구 · 조율 도구가 없고, 불러도 서버가 거절한다(호출자 갈래에 타일이 없어 모르는 도구 — 시험
  `tile_token_cannot_open_or_coordinate`).
  **조정자 토큰은 없다 — 조정자는 프로듀서 채팅의 채팅 토큰(종류 `producer`)에 서버 표가 붙인 역할**(Run 세대 ↔ 자리 묶음
  `Slot.coordinator = (gen, Seat{chat, proc})` — 묶음이 서는 길은 둘뿐: **사람의 앨범 시작 op**(`producer_album_start` — **Run 은 이 길로만 열린다** · 띄운 세대 · 묶음 · 귀속과 Run 이 한 잠금에서) ·
  조정자 없는 멈춘 Run 을 **그 앨범에 귀속된** 프로듀서 채팅이 `adopt_run`(세대 +1 · 알림 `run-adopted` · 판정은 `adopt_verdict` 하나 · 시간 한도 · 보류는 `not-adoptable` · 사람 [재개] 는
  조정자가 있어야 선다 — 없으면 `no-coordinator`)). 프로듀서 채팅은 사람이 오케스트레이션 탭에서 연 것뿐이다(Tauri `producer_album_start` · `producer_chat_open` · AI · MCP 에는 길이 없다) ·
  귀속의 자리는 Run 파일의 `producers`(채팅 하나 = 앨범 하나 `already-produced` · 귀속은 사람의 앨범 시작 · [새 프로듀서로 이어받기] op 만 세운다 ·
  `adopt_run` 은 토큰의 앨범 하나만 `out-of-scope:run`).
  **프로듀서 호출의 신원은 HTTP 인증 시 확정한 채팅 ID와 재사용하지 않는 프로세스 세대이며, 요청 처리 중 현재 세대로 바꾸지 않는다. 조정자 역할은 그 신원과 Run 세대의 서버 묶음으로만 부여한다. 앨범 시작과 adopt_run은 묶음을 확정하는 잠금 안에서 인증 신원의 유효성과 논리적 채팅의 앨범 귀속을 다시 확인한다. 논리적 채팅 하나는 앨범 하나에만 귀속되며, 프로세스 재시작·재부착·모델 변경으로 귀속을 초기화하지 않는다.**
  (잠금 안 확인이 실패하면 `not-a-tile` — 낱말은 옛 이름 그대로.)
  **프로세스 종료 시 해당 세대의 토큰을 먼저 회수하고 그 세대의 조정자 묶음을 해제한 뒤 재시작 가능한 종료 상태를 알린다. 옛 세대의 지연된 요청과 정리는 새 세대에 영향을 주지 않는다. adopt_run은 귀속 복원과 자동 재개를 구분하며, 사람이 일시정지한 Run은 귀속을 복원해도 사람이 재개하기 전까지 멈춘 상태를 유지한다. 서버 재시작으로 orphaned가 된 Run의 권한은 대화 resume으로 복원하지 않는다.**
  (묶음 해제 = 그 자리의 `wait_run` 취소 · 잠정 커서 되돌림.) 묶음은 프로세스 끝(사람의 [프로듀서 끝내기] 포함 — 토큰 칸 먼저) · 중단 · Run 끝 · 세대 교체 때 곧바로 푼다 · **조율 요청은 예상 `runId` · `gen` 이 묶음과 맞을 때만**: `stale-run` · `stale-generation` ·
  `run-ended` · `not-coordinator`. `adopt_run` · `complete_run` 의 멱등 기록은 **역할 판정보다 먼저** `(chat, ProcId, requestId)`
  로 찾는다(`chat_token::with_request` — 그 세대의 토큰 칸 · 성공 뒤 · Run 이 끝난 뒤의 재시도도 처음 결과 · 프로세스가 바뀐 뒤의 재시도는 `already-produced{runId}`).
  앨범 시작은 `(chat, clientId)` 로 처음 확정 답(`sent:false` 포함)을 돌려준다(확정 전 오류는 재시도 가능). 작업자 토큰(판정형 턴은 검토자 토큰 — 같은 규칙)은 **턴마다** 뽑고 **그 턴의 프로세스 트리 종료가 확인된 뒤에**
  거둔다(늦은 보고를 `late` 로 받으려고 — 사용자 결정 · 생성 실패면 곧바로 · `idle` 에는 산 토큰이 없다 · 서버 재시작 뒤 orphaned Run 에는
  되살리지 않는다). Claude 턴의 토큰은 **그 턴의** MCP 파일(`orch-<att>-t<n>.json` — 턴 claim 이 쥐고 턴 끝에 지운다), Codex 는 그 턴 프로세스의
  환경 변수에만 있다. 역할은 서버 표에서만 읽고 조정자의 조율은 자기 Run 안에서만이다. 값은 프런트·로그·
  `Debug`·영속 파일(`<데이터 루트>/orchestration/run-<id>.json`)에 나가지 않는다(타일 토큰은 셸 환경에 서버가 넣고 GUI Rust 만 서버 op
  `mcp_tile_token` 으로 읽어 그 타일의 `--mcp-config` 파일에만 쓴다 — 셸 타일의 장식 파일에는 그 경로만 · 시험 `tile_token_never_reaches_frontend` · 프로듀서
  채팅 토큰은 그 프로세스의 임시 `--mcp-config` · 환경에만 — 시험 `chat_token_never_reaches_frontend`).
  **역할 토큰 · 타일 토큰 · 채팅 토큰은 같은 계정 안의 보안 경계가 아니다**(작업자는 같은 사용자 권한으로 돈다 — 방어선은 앨범 구성의 권한 + 사람 감독) →
  [docs/log/2026-10-14-orchestration-design.md](log/2026-10-14-orchestration-design.md) C-1 ·
  [docs/log/2026-10-16-orchestration-headless-design.md](log/2026-10-16-orchestration-headless-design.md) 3-1 ·
  [docs/log/2026-10-30-orchestration-structured-producer.md](log/2026-10-30-orchestration-structured-producer.md) 2절 · 6절.

<a id="inv-10"></a>
## 10. 대화 기록의 MCP 출구

- **대화 기록이 MCP 로 나가는 길은 조정자 `read_worker` 하나 — 자기 Run 작업자의 고정 대화만**(처음 받은 대화 id · 그 CLI 대화 폴더 안 · 기록된 cwd = 그 worktree). 다른 대화(사람 타일 · 다른 Run · 작업자가 옮겨 간 대화)는 MCP 로 나가지 않고, 본문은 로그 · 감사 · 영속 파일 · `Debug` 에 없다 → 같은 설계 C-6.

<a id="inv-11"></a>
## 11. 원격 타일과 신호 전용 토큰

- **원격 타일에는 MCP 토큰을 주지 않는다 — 신호 전용 토큰(스트림별)만.** 훅은 앱이 건 `-R`
  (양쪽 끝 루프백)로 `/agent-signal` 에 닿고, 그 토큰은 그 타일의 상태 점 신호에만 통한다(세션이 닫히면 거둔다) →
  [docs/log/2026-09-24-remote-agent-signals.md](log/2026-09-24-remote-agent-signals.md).
  받는 타일: **앱이 AI 를 띄운 타일, 또는 호스트의 에이전트 활성화(`sessions.toml` `agent`)가 켜졌으면 그 호스트의 모든 원격 타일**
  (손으로 띄운 CLI · 재접속 · tmux 포함 · 빠른 접속은 토글이 늘 끔) — **호스트 AI 권한은 관여하지 않는다**(판정은 세션 서버 `ssh/open.rs` `signal_stream` 한 곳, 프런트는 스트림 id 만) →
  [docs/log/2026-10-27-signal-by-agent.md](log/2026-10-27-signal-by-agent.md) ·
  [docs/log/2026-10-26-agent-enable.md](log/2026-10-26-agent-enable.md).
  원격의 주소·토큰은 서버 파일 `~/.config/aynx/signal/<스트림>.env`(0600, 접속마다 원자 교체)로 전달하고 **셸에는 스트림 id 만**
  export 한다(에이전트 활성화 호스트는 + PATH 심 폴더 — 비밀 아님 · 셸 통합 끔·SFTP 실패 때만 예전 export 폴백 — `src-tauri/src/remote_signal_file.rs`).
  **로컬 타일은 모두 같은 신호 전용 토큰을 받고, MCP 토큰은 로컬 셸 타일(셸 통합 감싸개가 있는 셸 — PowerShell · Git Bash · 셸 통합 켬)과
  AI 타일 — 타일마다 따로**(타일 토큰 · 서버 전역 토큰은 `mcp.json` 에 남되 조율 도구는 `not-a-tile`) 받는다(평범한 셸에서 친 `claude` 도
  신호를 보내게 · 그 `claude` · `codex` 가 AI 타일과 같은 추가 인자 · MCP · `--no-daemon` 을 받게 — GUI Rust 가 열 때 쓰는 타일
  장식 파일 `src-tauri/src/agent_tile.rs` · 셸에는 그 경로 `AYNX_TILE_AGENT` 만 · 감싸개 타일의 autorun 은 장식하지 않는다. cmd · WSL · 셸 통합 끔은
  예전 그대로) → [docs/log/2026-09-25-shell-claude-signals.md](log/2026-09-25-shell-claude-signals.md) ·
  [docs/log/2026-10-26-agent-enable.md](log/2026-10-26-agent-enable.md).
  **신호 전용 토큰 표·에이전트 상태 표·`/agent-signal` 수신은 세션 서버 프로세스에 있다**(127.0.0.1 임시 포트, 신호 토큰만 받고
  MCP 토큰은 받지 않음). 로컬·원격 타일 토큰 모두 서버 안에서 뽑고 거두며 **파이프·GUI 를 지나지 않는다**(원격 파일·export 도 서버의
  SFTP 채널이 쓴다). 세션 자원 회수 때 서버가 거둔다 →
  [docs/log/2026-10-09-session-server-signals.md](log/2026-10-09-session-server-signals.md).
  **권한 결정 토큰(스트림별 · 로컬 AI 타일 · 감싸개 셸 타일만 · 결정 경로 `/agent-permission` 전용)** 은 신호 전용 토큰과 따로다(서로의 경로에서 401 ·
  같은 수명 · 셸 환경으로만 — 파이프 · GUI · 프런트에 값 없음). 권한 훅은 그 타일 장식의 CLI 프로세스에만 실리고(사용자 전역 훅 파일 아님) **도구 입력
  본문(명령 · 파일 내용 · URL · MCP 인자)을 앱으로 보낸다** — 그 세션을 보는 창의 카드로만, 로그 · MCP · 영속에는 없다. 결정은 훅 응답으로만 가고 PTY 에
  쓰지 않는다 → [docs/log/2026-11-01-tile-permission-hook.md](log/2026-11-01-tile-permission-hook.md)
  (같은 장식의 Codex `Interrupt` 훅만은 **신호 경로**로 그 타일의 신호 전용 토큰을 써 `interrupt` 하나를 보낸다 — 상태 점 전용 그대로 ·
  대화 면 [중지]는 Esc 키 하나(사람 키) + 서버 op `agent_state_interrupt`.)

<a id="inv-12"></a>
## 12. 에이전트 포워딩

- 에이전트 포워딩은 **호스트별 옵트인(기본 꺼짐)**, 헤드리스 위임 접속에는 없다 →
  [docs/log/2026-09-23-agent-forwarding.md](log/2026-09-23-agent-forwarding.md).

<a id="inv-13"></a>
## 13. 원격 웹 클라이언트

- **원격 웹 클라이언트는 tailnet 안 브라우저만** — 관문(`src-tauri/src/remote/`)은 **127.0.0.1 에만** 묶이고 노출은 사용자가 직접 건, 또는 집 PC 설정 화면의 [연결]로 건
  `tailscale serve` 가 한다(앱 실행은 고정 인자 · Funnel 길 없음 · 집 PC 전용 — `remote/serve.rs` · Funnel 이 그 포트를 내보내면 열지 않는다). 신원은 **집 PC 사람이 6자리 코드를 보고 [허용] 한 기기 페어링
  토큰**(Tailscale 헤더는 참고), 원격 창은 자기 가림막을 걷고 연결된 동안만 창으로 센다(마스터 암호는 선택 — 없으면 단추). 원격 창은
  집 PC 창과 동등하되 **앱 명령의 문은 `remote/deny.rs` 하나**(표 넷 — 명령마다 정확히 하나, 시험이 `generate_handler!` 와 맞춘다):
  집 PC 전용 = 볼트 마스터 바꾸기·전체 삭제 · 기기 페어링 답 · 자동 승인 정책(`[automation]`) · `tailscale serve` 걸기·끄기 · 원격 접속 켜기·이름·포트(끄기·기기
  폐기는 원격도 된다) / 재확인 = 작업안 승인·AI 권한 올리기는 **마스터가 있으면 그 순간 다시 묻는다**(1회용 표 — 암호는 HTTP 몸으로만,
  ws·로그에 없음) / 프로듀서 채팅 명령(`producer_chat_*`)은 ALLOW(사람의 말 · 결정 · 끊기 — `decide` 는 허용 목록 두 카드에만 뜻 · 앨범 시작 `producer_album_start` · 앨범 권한 넓힘 `orchestration_album_widen` 은 REAUTH ·
  앨범 영구 삭제 `orchestration_delete_archived` · 앨범 병합 `orchestration_merge` 는 REAUTH(병합 미리 보기는 ALLOW) · 넓힘 없는 변경 `orchestration_album_set` · 기본값 읽기 · 아티스트 명령 · 이름 변경 · `producer_fork_probe` 는 ALLOW — 서버가 다시 판정) / 사이드 채팅 명령(`side_chat_*` · `side_chats_*`)도 ALLOW(권한 카드 `side_chat_decide` 포함 · 재확인 없음 → [docs/log/2026-11-01-remote-side-chat.md](log/2026-11-01-remote-side-chat.md)). 플러그인은 `capabilities/remote.json` ACL 이 막고, 그 ACL 이 연 **이벤트 emit 은 이름으로 다시 거른다**(`deny::REMOTE_EMIT`
  넷만 — 기본 거절 · 집 PC 리스너가 받는 순간 일을 하는 이벤트를 원격이 못 낸다). 집 PC 에는 원격이 열 때 OS 알림 + 상태바 "원격 접속 중"
  (둘 다 끌 수 없다). 볼트 값·MCP 토큰·웹훅 URL 은 여전히 원격으로 나가지 않는다 →
  [docs/log/2026-10-15-remote-web-client-design.md](log/2026-10-15-remote-web-client-design.md).

<a id="inv-14"></a>
## 14. OS 자격증명 저장(닫힘)

- OS 자격증명 저장은 **(닫힘) OS 저장소 대신 자체 볼트**. Credential Manager·
  Keychain·libsecret 은 잠금 개념도 다시 묻는 시점도 백업 방법도 달라, 쓰면 OS 마다 UX 가
  갈리고 그걸 설명하려 프런트가 OS 를 알아야 한다(위에서 금지한 바로 그 모양). 나중에 붙인다면
  볼트 **키를 감싸는 자리**(`protect_key_bytes`)가 그 문이다 —
  [docs/log/2026-09-19-vault.md](log/2026-09-19-vault.md) 2절.

# AYNX 문서

AYNX — Hyprland 감성의 AI 코딩 에이전트 작업 공간
(Tauri 2 + Svelte 5 + xterm.js). 저장소 소개와 빌드 방법은 [README](../README.ko.md) 에 있다.

## 기능과 보안

- [features.ko.md](features.ko.md) · [features.md](features.md) — 전체 기능 목록(절마다 화면 캡처 — `images/features/`)
- [security.ko.md](security.ko.md) · [security.md](security.md) — 보안 관련 안내와 알려진 한계

## 사용자 안내 — `user/` (영어)

화면에 다 싣지 못한 사정 · 예외 · 기본값을 적는다. 안내마다 주요 화면 캡처가 있다(`images/guides/` · 일부는 `images/features/` 를 함께 쓴다).

- [getting-started.ko.md](user/getting-started.ko.md) · [getting-started.md](user/getting-started.md) — 처음 쓰는 사람용 한 장(이 안내만 두 벌)(설치 · 시작 화면 · 숨은 독 열기(가장자리 호버 · 단축키) · AI 타일 · 타일 배치 · 호스트 추가 · 사이드 채팅 · 세션 판 · 테마), 캡처는 `images/getting-started/`
- [settings.md](user/settings.md) — 설정 창의 항목별 설명(일반 · 앱 테마(프로필에 담기는 것 · 창 단추 · 독 배치 · 자원/사용량 고리) · 터미널 · 스니펫 · 트리거 · MCP · 지침 · 자동 승인 · 알림 · 보안 · 원격 접속)
- [hosts.md](user/hosts.md) — 호스트 폼(`~/.ssh/config` · `sessions.toml`), 포트 포워딩, AI 위임, 호스트 독
- [projects.md](user/projects.md) — 프로젝트 · 워크트리 · 브랜치 그래프, 에이전트 훅과 상태 점, 프로젝트 시작 화면
- [files.md](user/files.md) — 파일 타일(SFTP · 로컬), 업로드 · 가져오기, 원격 파일 편집, 문서 타일
- [query-tile.md](user/query-tile.md) — 쿼리 타일(DB) — 여는 길, 연결 폼 · TLS 모드, 비밀번호 · 볼트, 실행 · 결과, 읽기 전용과 쓰기, 연결 수명
- [dashboard.md](user/dashboard.md) — 세션 목록 판 · 작업안 · 사용량, 검토 카드 · 알림
- [orchestration.md](user/orchestration.md) — 오케스트레이션 — 앨범 · 트랙 · 아티스트 · 프로듀서, 수락 · 검증 · main 병합
- [remote-web.md](user/remote-web.md) — 원격 접속(원격 웹 클라이언트) — `tailscale serve`, 기기 페어링, 폰 화면, 원격 승인
- [shortcuts.md](user/shortcuts.md) — 단축키 도움말에 싣지 않은 사정 · 예외

## 기여자용

- [conventions.md](conventions.md) — 두 번 이상 깨진 코드 규칙만 모은 곳(용어표 포함)
- [modules.md](modules.md) — 백엔드(`src-tauri/src/`) 모듈 지도 — 층별 표와 "어디를 고치나"
- [modules-frontend.md](modules-frontend.md) — 프런트(`src/lib/`) 모듈 지도 — 배럴 규칙과 "어디를 고치나"

설계 노트와 작업 기록 같은 내부 노트는 공개 저장소에 없다.

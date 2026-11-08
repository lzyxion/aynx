; AYNX 설치기 훅 (③-4 — 설계 docs/internal/session-server-design-2026-10-08.md ③ "설치기").
;
; 설치(업데이트)·제거는 같은 이름의 프로세스(aynx.exe)를 모두 끝낸다 — **세션 서버(aynx session-server)도** 끝나고 그
; 안의 로컬 셸·SSH·AI 에이전트가 함께 닫힌다(③-0 실측: NSIS 는 이름+사용자로 TerminateProcess). 그래서 Tauri 의 "앱이 실행 중"
; 확인(CheckIfAppIsRunning)보다 **먼저** 묻는다: 서버가 돌고 있고 살아 있는 세션이 있으면 "세션 N개가 닫힙니다 — 계속할까요?",
; [취소] = 설치·제거 중단.
;
; - 세션 수는 서버가 찾기 파일 %APPDATA%\aynx\server.json 의 `  "sessions": N` 줄에 적어 둔다(비밀 없음 — 수가 바뀌면 다시 쓴다,
;   src-tauri/src/server/discovery.rs). NSIS 는 JSON 을 풀지 못해 그 한 줄을 글자로 찾는다(앞 두 칸 + "sessions": + 한 칸 + 숫자 —
;   시험 discovery_writes_sessions_on_its_own_line 이 모양을 지킨다).
; - 파일이 남아 있어도(서버 kill 뒤) aynx.exe 가 돌고 있지 않으면 묻지 않는다.
; - 조용한 설치·수동(passive) 모드에서는 묻지 않는다(사람이 없다 — 업데이트 경로가 앱 안에서 먼저 경고한다).
; - MSI 는 이 훅이 없다(릴리스는 NSIS — MSI 의 Restart Manager 는 분리 서버를 닫지도 못한다).
; - 개발 빌드(%APPDATA%\aynx-dev)는 보지 않는다 — 설치본은 릴리스뿐이다.
;
; 이 파일은 UTF-8 BOM 이다(NSIS 가 한국어 문구를 시스템 코드 페이지로 읽지 않게).

!macro AYNX_SESSION_SERVER_WARNING
  !define PLID ${__LINE__}
  IfSilent pl_done_${PLID}
  StrCmp $PassiveMode "1" pl_done_${PLID}
  StrCpy $R5 0
  IfFileExists "$APPDATA\aynx\server.json" 0 pl_done_${PLID}
  ClearErrors
  FileOpen $R6 "$APPDATA\aynx\server.json" r
  IfErrors pl_done_${PLID}
  pl_loop_${PLID}:
    ClearErrors
    FileRead $R6 $R7
    IfErrors pl_close_${PLID}
    StrCpy $R8 $R7 13
    StrCmp $R8 '  "sessions":' 0 pl_loop_${PLID}
    StrCpy $R9 $R7 "" 14
    IntOp $R5 $R9 + 0
  pl_close_${PLID}:
  FileClose $R6
  IntCmp $R5 0 pl_done_${PLID} pl_done_${PLID} 0
  nsis_tauri_utils::FindProcessCurrentUser "${MAINBINARYNAME}.exe"
  Pop $R0
  IntCmp $R0 0 0 pl_done_${PLID} pl_done_${PLID}
  StrCmp $LANGUAGE "1042" 0 pl_en_${PLID}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "AYNX 세션 서버가 실행 중입니다 — 살아 있는 세션 $R5개(로컬 셸·SSH·안의 AI 에이전트)가 닫힙니다.$\n$\n계속할까요?" IDOK pl_done_${PLID}
    Abort
  pl_en_${PLID}:
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "The AYNX session server is running — $R5 live session(s) (local shells, SSH and the AI agents in them) will be closed.$\n$\nContinue?" IDOK pl_done_${PLID}
    Abort
  pl_done_${PLID}:
  !undef PLID
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro AYNX_SESSION_SERVER_WARNING
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AYNX_SESSION_SERVER_WARNING
!macroend

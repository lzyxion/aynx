/**
 * `commands` 영역의 문구 — 한국어가 기준 사전이다 (규칙은 `ko/settings.ts` 머리말).
 * 액션 이름은 여기 없다 — 설정 화면과 같은 칸 `settings.keybinding.<id>` 를 읽는다(한 벌 더 두면 화면마다 갈린다).
 * 예외: 설정 이름이 긴 액션만 치트시트용 짧은 이름을 `cheatsheet.*` 에 둔다 (docs/log/2026-09-28-cheatsheet-cleanup.md).
 */
export const commands = {
  // ── 명령 팔레트 ────────────────────────────────────────────────────────────
  "palette.aria": "명령 팔레트",
  "palette.search.aria": "명령 팔레트에서 찾기",
  "palette.placeholder": "호스트 · 프로젝트 · 명령 · 설정 찾기",
  "palette.empty": "결과가 없습니다",

  // 접두사 힌트 — `<code>`·`<kbd>` 마크업에 맞춰 조각으로 쪼갠다(문자열에 HTML 을 넣지 않는다) · 접두사 글자는 코드가 쥔다.
  "palette.hint.action": "명령",
  "palette.hint.tab": "탭",
  "palette.hint.group": "그룹",
  "palette.hint.snippet": "스니펫",
  "palette.hint.history": "이력",
  "palette.hint.enter": "실행",
  "palette.hint.here": "지금 탭에",
  "palette.hint.newTab": "새 탭",
  "palette.foot.move": "이동",
  "palette.foot.close": "닫기",
  // `!` 를 친 동안 Enter·Shift+Enter 의 뜻이 바뀐다 — 힌트도 그 자리에서 함께 바뀌어야 한다(적힌 것과 다른 일을 하면 안 된다).
  "palette.history.hint.enter": "넣기",
  "palette.history.hint.shiftEnter": "넣고 실행",

  "palette.section.quick": "빠른 접속",
  "palette.section.recent": "최근",
  "palette.section.host": "호스트",
  "palette.section.project": "프로젝트",
  "palette.project.tail.local": "로컬 · {tail}",
  "palette.project.tail.remote": "{host} · {tail}",
  "palette.section.group": "그룹 전체 열기",
  "palette.section.workspace": "탭",
  "palette.section.theme": "테마 프로필",
  "palette.section.snippet": "스니펫",
  "palette.section.history": "명령 이력",
  "palette.section.action": "명령",
  // 브랜치 그래프 (docs/log/2026-09-29-branch-graph.md)
  "palette.action.branchGraph": "브랜치 그래프",
  "palette.action.openDb": "DB 연결 열기…",
  "palette.action.alertsDock": "독: 알림",
  // 설정 색인 (docs/log/2026-09-25-palette.md)
  "palette.section.setting": "설정",
  "palette.setting.root": "설정",
  "palette.setting.vault": "볼트",

  "palette.quick.row": "빠른 접속: {target}",
  "palette.quick.tail": "설정에 없는 대상",
  "palette.group.tail": "{count}개 전체 열기",
  "palette.workspace.current": "현재",
  "palette.theme.row": "테마 프로필: {name}",
  "palette.theme.tail": "모양 적용",
  "palette.snippet.row": "스니펫: {name}",
  "palette.snippet.save": "'{command}' 을(를) 스니펫으로 저장",
  "palette.snippet.saveTail": "새 스니펫",
  "palette.snippet.manage": "스니펫 관리…",
  "palette.snippet.manageTail": "설정 › 스니펫",
  // 관리 줄의 여벌 검색 글자 — 없으면 `>snip` 같은 영문 질의에서 줄이 사라진다.
  "palette.snippet.manageKeywords": "snippet manage 설정",

  // 이력 줄 뒷글자 — 타일 이름 · 상대 시각을 자리표시자 둘로 받는다(이어 붙이지 않는다 — 영어는 어순이 다르다).
  "palette.history.tail": "{pane} · {when}",
  // 이력이 없을 때의 줄 — 괄호 속 조건(OSC 133 셸 통합)이 요점이라 빼지 않는다.
  "palette.history.empty": "실행한 명령이 아직 없습니다",
  // 지난 대화 (docs/log/2026-09-26-agent-sessions.md)
  "palette.section.conversation": "지난 대화",
  "palette.hint.conversation": "재개",
  "palette.conversation.hint.enter": "재개",
  "palette.conversation.hint.shiftEnter": "새 대화로 계속",
  "palette.conversation.hint.ctrlEnter": "기록 보기",
  "palette.conversation.missing": "경로 없음",
  "palette.conversation.elsewhere": "밖에서 열림",
  "palette.conversation.open": "열림",
  "palette.conversation.loading": "대화를 읽는 중…",
  "palette.conversation.empty": "지난 대화가 없습니다",
  "palette.section.usage": "사용량",
  "palette.usage.row": "{agent} 사용량 — {detail}",
  "palette.usage.keywords": "사용량 한도 토큰 usage limit tokens",
  // 상대 시각 — tmux 팝오버(`pane.tmux.ago.*`)와 같은 계단이지만 다른 사전이다.
  "palette.history.ago.now": "방금",
  "palette.history.ago.minutes": "{n}분 전",
  "palette.history.ago.hours": "{n}시간 전",
  "palette.history.ago.days": "{n}일 전",

  // ── 단축키 치트시트 ────────────────────────────────────────────────────────
  "cheatsheet.title": "단축키",
  "cheatsheet.close": "닫기",
  "cheatsheet.rebind": "설정에서 바꾸기",
  "cheatsheet.foot.question": "로도 열립니다 (터미널 밖에서)",
  "cheatsheet.foot.esc": "닫기",

  "cheatsheet.tabs.title": "탭",
  "cheatsheet.tabs.nth": "n번째 탭",

  "cheatsheet.tiles.title": "타일",
  "cheatsheet.tiles.zoom": "최대화",
  "cheatsheet.tiles.focus": "포커스 이동",
  "cheatsheet.tiles.move": "옮기기",
  "cheatsheet.tiles.expand": "크기 조절",
  "cheatsheet.tiles.sync": "동시 입력",

  "cheatsheet.open.title": "열기",
  "cheatsheet.open.shell": "새 터미널",
  "cheatsheet.open.dock": "독: 호스트 · 프로젝트",
  "cheatsheet.open.sftp": "현재 폴더 열기",
  "cheatsheet.open.localfs": "로컬 파일",
  "cheatsheet.open.ai": "AI 타일",

  "cheatsheet.app.title": "앱",
  "cheatsheet.app.settings": "설정",
  "cheatsheet.app.snippet": "스니펫 넣기",
  "cheatsheet.app.reconnect": "모두 다시 접속",

  "cheatsheet.terminal.title": "터미널",
  "cheatsheet.terminal.jump": "이전 · 다음 명령",
  "cheatsheet.terminal.copyOutput": "마지막 출력 복사",
  "cheatsheet.terminal.eof": "셸 종료 · 종료된 타일 닫기",
  "cheatsheet.terminal.reconnect": "종료된 타일 다시 접속",
  "cheatsheet.terminal.menu": "터미널 메뉴",
  "cheatsheet.terminal.menuSwap": "메뉴 ↔ 붙여넣기 반대로",

  "cheatsheet.files.title": "파일 타일",
  "cheatsheet.files.views": "보기 — 아이콘 · 간단히 · 자세히",


  // 마우스 몸짓 칩 — 자리 낱말은 클릭 낱말과 공백으로 띄운다(클릭 낱말은 마우스 아이콘 칩이 된다).
  "cheatsheet.g.rightClick": "우클릭",
  "cheatsheet.g.shiftRightClick": "Shift+우클릭",

  // ── 터미널 찾기 ────────────────────────────────────────────────────────────
  "search.aria": "터미널에서 찾기",
  "search.input.aria": "터미널에서 찾기",
  "search.placeholder.all": "터미널에서 찾기 — @이름 으로 한 터미널만",
  "search.placeholder.scoped": "이 터미널에서 찾기",
  "search.chip.scope.aria": "범위 @{name}, 제거하려면 Backspace",
  "search.chip.scope.remove": "범위 @{name} 제거",
  "search.chip.block.aria": "블록 #{name}, 제거하려면 Backspace",
  "search.chip.block.remove": "블록 #{name} 제거",
  "search.ac.empty": "열려 있는 터미널이 없습니다",
  "search.regexBroken": "정규식이 잘못됐습니다",
  "search.noTerminal": "그런 터미널이 없습니다",
  "search.blocks.empty": "명령 블록이 없습니다",
  "search.empty": "결과가 없습니다",
  "search.truncated": "결과가 너무 많아 일부만 보여 줍니다 (상한 {limit})",
  "search.group.count": "{count}개",
  "search.group.countMore": "{count}개 · …더 있음 (터미널당 {limit})",
  "search.running": "실행 중",
  "search.blockGone": "화면에서 밀려난 블록입니다 — 발췌만 남았습니다",

  "search.hint.at": "@이름",
  "search.hint.scope": " 범위 · ",
  "search.hint.options": "옵션 · ",
  "search.hint.hash": "#명령",
  "search.hint.block": " 블록 · ",
  "search.hint.quoted": '"따옴표"',
  "search.hint.literal": " 문자 그대로",

  // ── 스니펫 ─────────────────────────────────────────────────────────────────
  // `{{이름}}` 은 보여 주는 예시 문법이다 — `interpolate` 가 치환하지 않고 비켜 간다.
  "snippet.save.title": "스니펫으로 저장",
  "snippet.save.lead.before": "이 명령을 이름 붙여 남깁니다. ",
  "snippet.save.lead.token": "{{이름}}",
  "snippet.save.lead.after": " 을 적어 두면 넣을 때마다 그 칸을 묻습니다.",
  "snippet.save.name": "이름",
  "snippet.save.command": "명령",
  "snippet.save.scope": "범위",
  "snippet.save.scope.all": "모든 호스트",
  "snippet.save.scope.host": "이 호스트 ({alias})",
  "snippet.save.enter": "Enter 로 실행",
  "snippet.save.enter.on": "넣는 즉시 실행됩니다",
  "snippet.save.enter.off": "명령줄에 글자만 놓입니다 (Enter 는 사람이 칩니다)",
  "snippet.save.description": "설명",
  "snippet.save.description.placeholder": "선택 — 목록에 함께 보일 한 줄",
  "snippet.save.placeholders": "자리표시자 {count}개: {names} — 넣을 때 묻습니다",
  "snippet.save.submit": "저장",
  "snippet.prompt.lead": "값을 채우세요 — 비운 칸은 빈 글자로 들어갑니다.",
  "snippet.prompt.submit": "넣기",
  "snippet.cancel": "취소",
  "snippet.delete.ask": '스니펫 "{name}" 을(를) 지울까요?',
  "snippet.delete.title": "스니펫 삭제",
  "snippet.notice.notFound": "스니펫을 찾을 수 없습니다.",
  "snippet.notice.hostOnly": '"{name}" 은(는) {alias} 타일에서만 쓸 수 있습니다.',
  "snippet.notice.tileChanged": "타일이 바뀌어 스니펫을 넣지 않았습니다.",
  "snippet.notice.notConnected": "세션이 아직 연결되지 않았습니다.",
  "snippet.notice.sendFailed": "스니펫을 보내지 못했습니다: {error}",
  "snippet.notice.noCommand": "저장할 명령이 없습니다.",
  "snippet.notice.incomplete": "이름과 명령을 모두 채워야 저장됩니다.",
  "snippet.notice.saved": '스니펫 "{name}" 저장됨',

  // ── 액션을 실행하다 막혔을 때 ──────────────────────────────────────────────
  // 팔레트 · 단축키 · 설정의 [삽입] 이 같은 한 줄을 쓴다 — 같은 사정에 문장을 둘 두지 않는다.
  "keys.terminalRequired": "터미널 타일이 포커스돼 있어야 합니다.",
  // 탭 템플릿
  "palette.section.template": "템플릿",
  "palette.action.saveTemplate": "지금 탭을 템플릿으로 저장…",
  "palette.action.exportSettings": "설정 내보내기…",
  "palette.action.importSettings": "설정 가져오기…",
  "palette.template.keywords": "템플릿 template",
  "palette.template.manage": "템플릿 관리…",
  "palette.template.manageTail": "설정 › 템플릿",
  // 관리 줄이 걸리는 글자들 — 라벨만 훑으면 `>tem` 같은 영문 질의에서 사라진다(스니펫 관리 줄과 같다)
  "palette.template.manageKeywords": "template manage 설정",
} as const satisfies Record<string, string>;

/**
 * 동시 입력 (Sync Input) — 한 번 친 키를 여러 패널에 함께 보낸다.
 *
 * 여기 있는 것은 **입력 레지스트리 하나** 뿐이다: 패널 id → 그 패널로 들어가는 입력 함수.
 * "어느 탭이 켜져 있는가" 는 `+page.svelte` 가, "이 탭의 패널이 누구인가" 는
 * `PaneHost.svelte` 가 안다 — 이 모듈은 둘 다 모른 채 이름표를 들고만 있다.
 *
 * ## 왜 문자열 레벨인가 (= 왜 여기서 나누는가)
 *
 * 등록되는 함수는 `Terminal.svelte` 의 `writeInput` 이다. 그 지점은 xterm 의 `onData`
 * 이후이므로 **IME 조합이 끝난 최종 문자열**이다 — 한글은 완성된 글자("가")로 한 번,
 * 조합 중간 상태(ㄱ, 가…)는 아예 오지 않는다. 키 이벤트를 복제하는 방식이었다면 각
 * 패널의 IME 상태가 따로 놀아 패널마다 다른 글자가 들어갔을 것이다.
 *
 * 같은 이유로 **붙여넣기도 브로드캐스트된다** (xterm 은 붙여넣기도 `onData` 로 준다).
 * 이것은 의도된 동작이다 — 여러 서버에 같은 스크립트 한 덩어리를 붙여넣는 것이
 * 동시 입력의 주된 쓰임이다.
 *
 * 반대로 **키 입력 경로가 아닌 것은 절대 여기 오지 않는다**:
 * 재연결 배너의 [지금 재연결]·[중단] 은 함수 호출이고, `on_connect`(접속 후 명령)는
 * 애초에 Rust 가 직접 보낸다 (docs/log/2026-09-01-on-connect.md).
 *
 * ## 예외 하나 — 터미널이 '생성'해 돌려보내는 보고 (마우스·포커스)
 *
 * 위 문장에는 구멍이 있었다. `onData` 는 사용자가 '친' 것만 주는 게 아니라, 앱이 **마우스
 * 모드**를 켰을 때 터미널이 만들어 돌려보내는 **마우스 좌표 보고**(`\e[<b;x;yM`)와 **포커스
 * 이벤트**(`\e[I`/`\e[O`)도 그대로 준다. 이런 것은 '입력' 이 아니라 '보고' 라서, 형제
 * 패널에 방송하면 vim·htop·less·claude 같은 전체화면 TUI 위에서 마우스가 움직일 때마다
 * 그 좌표가 다른 셸에 쓰레기로 쏟아진다 (실기: `35;34;1M35;34;2M…`). 그래서 방송 직전에
 * [`isTerminalReport`] 로 걸러 **자기 세션에만** 전달한다 (자기 TUI 의 마우스는 살아야 하므로
 * 버리지는 않는다).
 */

/** 패널 하나에 문자열을 흘려 넣는 함수 (= `Terminal.svelte` 의 `writeInput`) */
export type InputFn = (data: string) => void;

/**
 * 터미널이 앱에게 **돌려보내는 보고** 시퀀스 전체인가 — 마우스 추적·포커스 이벤트.
 *
 * 이것들은 사용자가 친 입력이 아니라 xterm 이 마우스/포커스 모드에서 생성한 값이라
 * 동시 입력으로 형제 패널에 방송하면 안 된다 (호출부는 `false` 없이 이 함수가 `true` 면
 * 그 데이터를 자기 패널에만 쓴다). 인식하는 형태:
 *
 * - X10/1000 마우스: `ESC [ M` + 3바이트
 * - SGR/1006 마우스: `ESC [ < b ; x ; y (M|m)`  ← 요즘 xterm 기본
 * - urxvt/1015 마우스: `ESC [ b ; x ; y (M|m)`
 * - 포커스 이벤트/1004: `ESC [ I` · `ESC [ O`
 *
 * **문자열 전체가** 이 보고들로만 이뤄졌을 때만 참이다 (`^(?:…)+$`). 그래서 사용자가 친
 * 화살표(`ESC [ A`)나 텍스트가 섞이면 거짓 → 정상대로 방송된다. 괄호 붙여넣기 마커
 * (`ESC [ 200~`…)도 여기 안 걸려 그대로 방송된다 (의도된 대상).
 */
const TERMINAL_REPORT =
  // eslint-disable-next-line no-control-regex
  /^(?:\x1b\[M[\s\S]{3}|\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[\d+;\d+;\d+[Mm]|\x1b\[[IO])+$/;

export function isTerminalReport(data: string): boolean {
  return TERMINAL_REPORT.test(data);
}

/**
 * 살아 있는 패널들의 입력 함수. 모듈 전역이지만 **키가 패널 id** 라 탭·창이 몇 개든 섞이지 않는다.
 * `$state` 가 아니다 — 렌더에 쓰이지 않고 오직 호출만 되므로 반응성이 필요 없다.
 */
const inputs = new Map<string, InputFn>();

/**
 * 패널의 입력 함수를 등록한다 (터미널 마운트 시 1회).
 * 돌려주는 함수를 언마운트 정리에서 부르면 해제된다.
 *
 * 해제는 **내가 넣은 그 함수일 때만** 지운다 — 같은 id 로 새 터미널이 먼저 등록한 뒤
 * 옛 인스턴스의 정리가 늦게 돌아도 새 등록을 지우지 않게 한다.
 */
export function registerInput(paneId: string, fn: InputFn): () => void {
  inputs.set(paneId, fn);
  return () => {
    if (inputs.get(paneId) === fn) inputs.delete(paneId);
  };
}

/**
 * 주어진 패널들에 같은 문자열을 보낸다 (**입력을 시작한 패널 자신도 목록에 포함해서** 부른다).
 *
 * 등록이 없는 id 는 조용히 건너뛴다. 등록은 있으나 세션이 죽었거나 재연결 중인 패널도
 * 무해하다 — `writeInput` 안의 기존 가드(`reconnect` 검사)와 `SessionHandle` 의 dead 가드가
 * 그대로 걸려 그 패널만 입력을 버린다.
 */
export function broadcastInput(paneIds: readonly string[], data: string): void {
  for (const id of paneIds) inputs.get(id)?.(data);
}

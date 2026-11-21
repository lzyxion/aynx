/**
 * 동시 입력 — 한 번 친 키를 여러 패널에 함께 보낸다.
 * xterm `onData` 뒤의 문자열 단계에서 나눈다 — IME 조합이 끝난 글자라 패널마다 글자가 갈리지 않는다(붙여넣기도 방송되는 것은 의도).
 * 키 입력 경로가 아닌 것(재연결 배너 단추 · `on_connect`)은 여기 오지 않는다.
 */

export type InputFn = (data: string) => void;

/**
 * 터미널이 돌려보내는 보고(마우스 추적 · 포커스 이벤트)로만 된 문자열인가 — 형제 패널에 방송하면 TUI 위의 마우스 좌표가
 * 다른 셸에 쏟아진다. 문자열 전체가 보고일 때만 참이라 친 키 · 괄호 붙여넣기 마커가 섞이면 그대로 방송된다.
 */
const TERMINAL_REPORT =
  // eslint-disable-next-line no-control-regex
  /^(?:\x1b\[M[\s\S]{3}|\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[\d+;\d+;\d+[Mm]|\x1b\[[IO])+$/;

export function isTerminalReport(data: string): boolean {
  return TERMINAL_REPORT.test(data);
}

const inputs = new Map<string, InputFn>();

/** 해제는 내가 넣은 그 함수일 때만 — 옛 인스턴스의 늦은 정리가 같은 id 의 새 등록을 지우지 않게 */
export function registerInput(paneId: string, fn: InputFn): () => void {
  inputs.set(paneId, fn);
  return () => {
    if (inputs.get(paneId) === fn) inputs.delete(paneId);
  };
}

/** 입력을 시작한 패널 자신도 목록에 넣어 부른다 */
export function broadcastInput(paneIds: readonly string[], data: string): void {
  for (const id of paneIds) inputs.get(id)?.(data);
}

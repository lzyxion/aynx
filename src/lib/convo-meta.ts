import { pathKey, type AgentConversation } from "$lib/agent-sessions";
import { folderNameOf } from "$lib/pane-chips";

/**
 * **지난 대화 줄의 아래 칩들** — 상태줄 지난 대화(`FolderConversations`)와 프로젝트 시작 화면(`ProjectStart`)이 같은
 * 순서 · 같은 모양으로 그린다(2026-10-16 사용자 결정: 배경 있는 칩으로 갈라 보이게, 순서 = 브랜치 · 모델 · 사용량,
 * 상태 칩은 그 뒤 — 마크업이 붙인다).
 *
 * - **폴더** — 여러 폴더를 섞어 보는 범위(이 프로젝트 전체 · 모든 대화 · 호스트 전체)에서만, 그리고 브랜치 이름과 같지
 *   않을 때만(워크트리 = 브랜치 1:1 이면 같은 말을 두 번 하지 않는다).
 * - **브랜치** — 대화가 기록한 브랜치.
 * - **모델** — 대화가 기록한 모델.
 * - **사용량** — 그 대화의 토큰 합(갈라진 대화면 `+N` — 원본에서 물려받은 앞부분을 뺀 몫).
 * - **갈라짐** — 다른 대화에서 갈라져 나온 대화.
 *
 * 글자는 부르는 쪽이 번역해 넘긴다(이 파일은 순수하다 — 시험이 순서를 지킨다).
 */
export type ConvoMetaKind = "folder" | "branch" | "model" | "tokens" | "forked";

export interface ConvoMetaChip {
  kind: ConvoMetaKind;
  text: string;
}

export interface ConvoMetaInput {
  /** 여러 폴더를 섞어 보는 범위인가 */
  mixed: boolean;
  /** 사용량 글자(이미 번역 · 서식) — 모르면 `null` */
  tokens: string | null;
  /** "갈라짐" 글자 */
  forkedLabel: string;
}

export function convoMetaChips(
  s: Pick<AgentConversation, "cwd" | "branch" | "model" | "forkedFrom">,
  input: ConvoMetaInput,
): ConvoMetaChip[] {
  const out: ConvoMetaChip[] = [];
  const branch = s.branch?.trim() || null;
  const folder = input.mixed && s.cwd ? folderNameOf(s.cwd) : "";
  if (folder !== "" && (branch === null || pathKey(folder) !== pathKey(branch))) out.push({ kind: "folder", text: folder });
  if (branch !== null) out.push({ kind: "branch", text: branch });
  const model = s.model?.trim();
  if (model) out.push({ kind: "model", text: model });
  if (input.tokens) out.push({ kind: "tokens", text: input.tokens });
  if (s.forkedFrom) out.push({ kind: "forked", text: input.forkedLabel });
  return out;
}

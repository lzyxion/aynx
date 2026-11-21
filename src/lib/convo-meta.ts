import { pathKey, type AgentConversation } from "$lib/agent-sessions";
import { folderNameOf } from "$lib/pane-chips";
import { modelLabel } from "$lib/model-order";

/** 지난 대화 줄의 아래 칩들 — 순서는 사용자 결정이다(시험이 지킨다). 글자는 부르는 쪽이 번역해 넘긴다. */
export type ConvoMetaKind = "folder" | "branch" | "model" | "tokens" | "forked";

export interface ConvoMetaChip {
  kind: ConvoMetaKind;
  text: string;
}

export interface ConvoMetaInput {
  /** 여러 폴더를 섞어 보는 범위인가 — 아니면 폴더 칩이 없다 */
  mixed: boolean;
  tokens: string | null;
  forkedLabel: string;
}

/** 폴더가 브랜치 이름과 같으면 폴더 칩을 빼 같은 말을 두 번 하지 않는다 */
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
  if (model) out.push({ kind: "model", text: modelLabel(model) });
  if (input.tokens) out.push({ kind: "tokens", text: input.tokens });
  if (s.forkedFrom) out.push({ kind: "forked", text: input.forkedLabel });
  return out;
}

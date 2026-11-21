import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import {
  DEFAULT_KEY_KIND,
  generateSshKey,
  type GeneratedKey,
  type KeyKind,
} from "$lib/keygen";

/**
 * 새 키 만들기 모달 (docs/log/2026-09-17-keygen.md).
 * 암호구는 `keygenForm` 의 두 칸에만 살고 어느 경로로 닫히든 `resetFields` 가 지운다 — 큐 · 모듈 변수 · `localStorage` 에 남기지 않는다.
 * "에이전트에 넣기"(ssh-add) 는 두지 않는다 — 다시 묻지 않게 하는 길은 금고 하나다 (docs/log/2026-09-19-vault.md).
 */

const FOCUS_KEYGEN = "keygen";

export interface KeygenRequest {
  alias: string | null;
  suggestedName: string;
  /** 비우면 `ssh-keygen` 이 `user@hostname` 을 채운다 */
  suggestedComment: string;
}

/** 룬 모듈은 재대입되는 `$state` 를 export 할 수 없어 객체 한 칸에 모은다 */
export const keygenForm = $state<{
  name: string;
  kind: KeyKind;
  passphrase: string;
  confirm: string;
  comment: string;
  error: string | null;
  busy: boolean;
  firstField: HTMLInputElement | null;
}>({
  name: "",
  kind: DEFAULT_KEY_KIND,
  passphrase: "",
  confirm: "",
  comment: "",
  error: null,
  busy: false,
  firstField: null,
});

let open = $state<KeygenRequest | null>(null);
let settle: ((key: GeneratedKey | null) => void) | null = null;

export function keygenRequest(): KeygenRequest | null {
  return open;
}

/** 아무것도 참조하지 않는다 — 여는 길이 둘 다 이미 모달 안이라 언제나 사슬의 맨 위다 */
export function keygenVisible(): boolean {
  return open !== null;
}

/** 암호구가 지워지는 유일한 자리 */
function resetFields(): void {
  keygenForm.name = "";
  keygenForm.kind = DEFAULT_KEY_KIND;
  keygenForm.passphrase = "";
  keygenForm.confirm = "";
  keygenForm.comment = "";
  keygenForm.error = null;
  keygenForm.busy = false;
}

/** 이미 떠 있으면 `null` — 겹쳐 열리면 앞의 약속이 영영 안 풀린다 */
export const promptKeygen = (req: KeygenRequest) =>
  new Promise<GeneratedKey | null>((resolve) => {
    if (open !== null) {
      resolve(null);
      return;
    }
    rememberFocusOrigin(FOCUS_KEYGEN);
    resetFields();
    keygenForm.name = req.suggestedName;
    keygenForm.comment = req.suggestedComment;
    open = req;
    settle = resolve;
  });

/** 닫는 유일한 문 — 성공 · 취소 · Escape 가 전부 지난다 */
function finish(key: GeneratedKey | null): void {
  const done = settle;
  settle = null;
  open = null;
  resetFields();
  returnFocus(FOCUS_KEYGEN);
  done?.(key);
}

/** 만드는 중에는 닫지 않는다 — 파일은 어차피 생기고, 화면이 모르면 다음 번 만들기가 "이미 있습니다" 로 막힌다 */
export function closeKeygen(): void {
  if (keygenForm.busy) return;
  finish(null);
}

export function focusKeygen(): void {
  keygenForm.firstField?.focus();
  keygenForm.firstField?.select();
}

/** 프런트는 확인 칸 어긋남만 거른다 — 이름 · 종류 규칙은 `keygen.rs` 가 단일 진실이다 */
export async function submitKeygen(): Promise<void> {
  if (open === null || keygenForm.busy) return;
  if (keygenForm.passphrase !== keygenForm.confirm) {
    keygenForm.error = t("app.hostform.keygen.mismatch");
    return;
  }

  keygenForm.busy = true;
  keygenForm.error = null;
  try {
    const made = await generateSshKey(
      keygenForm.name,
      keygenForm.kind,
      keygenForm.passphrase,
      keygenForm.comment.trim(),
    );
    finish(made);
  } catch (e) {
    // 암호구는 백엔드 문구에서 이미 지워졌다 (`keygen.rs` 의 `scrub`)
    keygenForm.error = e instanceof Error ? e.message : String(e);
    keygenForm.busy = false;
  }
}

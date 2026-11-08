import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import {
  DEFAULT_KEY_KIND,
  generateSshKey,
  type GeneratedKey,
  type KeyKind,
} from "$lib/keygen";

/**
 * **새 키 만들기 모달** — 이름·종류·암호구·설명 넷을 받아 `ssh-keygen` 을 돌린다
 * (docs/log/2026-09-17-keygen.md).
 *
 * ## 왜 약속(Promise) 하나인가
 *
 * 이 모달은 **두 곳**에서 열린다: 호스트 폼의 `IdentityFile` 줄과, 공개키 설치 고르개의
 * "새 키 만들기…" 줄이다. 둘 다 "만들어진 키 하나를 받아 하던 일을 계속" 하는 흐름이라,
 * `app/prompts.svelte.ts` 의 세 대화상자와 같은 모양을 쓴다 — 여는 쪽이 `await` 하고,
 * 닫는 문 하나(`finish`)가 모든 경로(성공·취소·Escape)를 지난다.
 *
 * 2026-09-19 ② 까지는 모달 말고 하나가 더 살았다 — "에이전트에 넣기". 그 자리는 금고가
 * 이어받았고(docs/log/2026-09-19-vault.md), 이 파일에는 모달만 남았다.
 *
 * 대기열이 아닌 것이 그 셋과 다른 점이다. 이 모달을 여는 길은 둘 다 **이미 모달 위**라
 * (폼이 떠 있거나 고르개가 떠 있다) 두 장이 동시에 요청될 자리가 없다. 큐를 만들어 두면
 * 있지도 않은 겹침을 위해 코드가 한 겹 두꺼워진다.
 *
 * ## 암호구가 사는 곳
 *
 * **[`keygenForm.passphrase`]·[`keygenForm.confirm`] 두 칸뿐**이다. 어느 경로로 닫히든
 * [`resetFields`] 가 `""` 로 지운다 — 큐 항목·모듈 변수·`localStorage` 어디에도 남기지
 * 않는다 (`prompts.svelte.ts` 의 비밀번호 칸과 같은 규칙). 백엔드도 저장하지 않고 오류
 * 문구에서도 지운다 (`keygen.rs` 의 `scrub`).
 */

/** 포커스 복귀 이름표 (`app/focus-return`) — 닫으면 폼·고르개로 키보드가 돌아간다 */
const FOCUS_KEYGEN = "keygen";

/** 이 모달을 연 쪽이 미리 채워 달라고 부탁한 것들 */
export interface KeygenRequest {
  /** 이 키가 붙을 호스트 별칭 (모르면 `null`) — 설명 칸의 기본값이 된다 */
  alias: string | null;
  /** 이름 칸의 기본값 (`$lib/keygen` 의 `defaultKeyName` 이 고른 값) */
  suggestedName: string;
  /** 설명(주석) 칸의 기본값. 비우면 `ssh-keygen` 이 `user@hostname` 을 채운다 */
  suggestedComment: string;
}

/**
 * 모달이 직접 바인딩하는 칸들 (`bind:value` · `bind:this`).
 *
 * 상태를 **객체 한 칸**에 모으는 이유는 룬 모듈이 재대입되는 `$state` 를 export 할 수 없기
 * 때문이다 (`prompts.svelte.ts` 의 `pw` 와 같은 꼴).
 */
export const keygenForm = $state<{
  name: string;
  kind: KeyKind;
  passphrase: string;
  confirm: string;
  comment: string;
  /** 폼 아래 한 줄 — 백엔드 문구를 그대로 싣는다 */
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

/** 지금 열려 있는 요청 (없으면 `null`) */
let open = $state<KeygenRequest | null>(null);
let settle: ((key: GeneratedKey | null) => void) | null = null;

export function keygenRequest(): KeygenRequest | null {
  return open;
}

/**
 * 이 모달이 떠 있는가.
 *
 * 다른 모달의 `…Visible()` 들과 달리 **아무것도 참조하지 않는다** — 이것은 언제나 사슬의
 * 맨 위다 (여는 길이 둘 다 이미 모달 안이라, 열렸다면 가장 나중에 열린 것이다).
 */
export function keygenVisible(): boolean {
  return open !== null;
}

/** 모든 칸을 비운다 — **암호구가 지워지는 유일한 자리** */
function resetFields(): void {
  keygenForm.name = "";
  keygenForm.kind = DEFAULT_KEY_KIND;
  keygenForm.passphrase = "";
  keygenForm.confirm = "";
  keygenForm.comment = "";
  keygenForm.error = null;
  keygenForm.busy = false;
}

/**
 * 모달을 열고 **만들어진 키 하나**를 기다린다. 취소·Escape 면 `null`.
 *
 * 이미 떠 있으면 새 요청을 무시하고 `null` 을 준다 — 두 장이 겹칠 자리가 없다는 위 설계에서
 * 곧바로 따라오는 규칙이고, 겹쳐 열리면 앞의 약속이 영영 안 풀린다.
 */
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

/**
 * 닫는 **유일한 문** — 성공·취소·Escape 가 전부 여기를 지난다.
 * 암호구는 이 함수가 지운다.
 */
function finish(key: GeneratedKey | null): void {
  const done = settle;
  settle = null;
  open = null;
  resetFields();
  returnFocus(FOCUS_KEYGEN);
  done?.(key);
}

/**
 * 취소 · Escape · 바깥 [닫기].
 *
 * 만드는 중(`busy`)에는 **아무 일도 하지 않는다** — `ssh-keygen` 은 이미 돌고 있어서 지금
 * 닫아도 파일은 생긴다. 그 파일을 화면이 모르는 채로 두면 다음 번 "새 키 만들기" 가
 * "이미 있습니다" 로 막히고, 사용자는 자기가 만든 적 없는 파일과 마주한다.
 */
export function closeKeygen(): void {
  if (keygenForm.busy) return;
  finish(null);
}

/** 모달이 뜨면 이름 칸에 포커스 + 전체 선택 (기본값을 곧바로 갈아 칠 수 있게) */
export function focusKeygen(): void {
  keygenForm.firstField?.focus();
  keygenForm.firstField?.select();
}

/**
 * [만들기] — 검증 한 줄, invoke 한 번.
 *
 * 프런트가 직접 거르는 것은 **확인 칸이 어긋났는가** 하나뿐이다. 그 값은 백엔드로 가지
 * 않으므로(암호구는 하나만 보낸다) 백엔드가 알 수 없는 유일한 규칙이다. 이름·종류 규칙은
 * `keygen.rs` 가 단일 진실이라 여기서 다시 적지 않는다 — 두 곳에 적으면 언젠가 어긋난다
 * (호스트 폼이 포트만 미리 거르는 것과 같은 규칙).
 */
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
    // 백엔드 문구를 그대로 싣는다 — 암호구는 이미 거기서 지워졌다 (`keygen.rs` 의 `scrub`).
    keygenForm.error = e instanceof Error ? e.message : String(e);
    keygenForm.busy = false;
  }
}

// ---------------------------------------------------------------------------
// (2026-09-19 ② — **"에이전트에 넣기" 는 여기서 사라졌다**)
//
// 이 파일 아래쪽에는 `addKeyToAgent`·`watchAgent`·`announceInAgent` 가 살았다. 키를
// 만들거나 서버에 심은 뒤 `ssh-add` 타일을 열고, `agent_has_key` 로 들어갔는지 지켜보는
// 흐름이었다 (docs/log/2026-09-17-keygen.md 의 "③ 에이전트에 넣기").
//
// 그 자리를 금고가 이어받았다 (docs/log/2026-09-19-vault.md 의 ②). 사용자 결정:
// **"다시 묻지 않게 하는 길" 은 금고 하나다** — 에이전트 키는 여전히 맨 먼저 조용히
// 시도되지만(백엔드의 인증 순서는 한 칸도 안 바뀌었다), 화면이 권하는 길은 아니다.
//
// 지운 이유를 남겨 둔다: 옛 흐름은 **암호구를 한 번 더 묻는** 길이었다(앱이 이미 받은
// 값을 ssh-add 에 넘길 수 없어서 — 그건 이 앱이 지켜 온 선이다). 금고는 이미 손에 든
// 값을 그대로 담으므로 묻는 창이 하나 줄어든다.
// ---------------------------------------------------------------------------

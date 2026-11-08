// SSH 열기의 **관문 고리** — 백엔드가 "끊고 다시 시도" 를 요구하는 물음(호스트 키 · 키 암호구 · 비밀번호)을 사람에게 묻고
// 그 답을 실어 다시 부른다. 터미널 SSH 타일(`open.ts` `openSshInteractive`)과 쿼리 타일의 SSH 경유 `db_open`
// (`$lib/query/open-flow`)이 같은 고리를 쓴다 — 서버가 같은 `SshOpenError` 를 돌려주기 때문이다(Rust `ssh::open::acquire_shared`).

import {
  MAX_PASSPHRASE_ATTEMPTS,
  MAX_PASSWORD_ATTEMPTS,
  type ConfirmHostKey,
  type HostKeyDecision,
  type PromptPassphrase,
  type PromptPassword,
} from "./contract";
import { SessionOpenError, parseSessionError } from "./errors";
import { koTr } from "./ko-tr";

/** 한 번의 시도에 실을 관문 답 — 비밀번호 · 암호구는 그 시도 한 번에만 쓰이고 곧바로 버려진다 */
export interface SshGateCreds {
  /** 사람이 고른 호스트 키 결정. `null` 이면 아무도 묻지 않았다 = 거부(백엔드 기본값) */
  hostKeyDecision: Exclude<HostKeyDecision, "reject"> | null;
  password: string | null;
  passphrase: string | null;
  /** `passphrase` 가 풀 키 파일의 전체 경로 */
  passphraseFor: string | null;
  /** 사람이 묻는 창을 취소한 키 경로들 — 백엔드가 다시 묻지 않게 */
  declinedKeys: string[];
}

/** 물을 창들 — 없는 것은 묻지 않고 그 실패를 그대로 던진다(비대화형 열기) */
export interface SshGatePrompts {
  confirm?: ConfirmHostKey;
  promptPassword?: PromptPassword;
  promptPassphrase?: PromptPassphrase;
}

export interface SshGateOptions {
  /**
   * 이 실패는 관문이 아니다 — 해석하지 않고 **받은 그대로** 던진다(쿼리 타일: 글자로 오는 DB 쪽 실패
   * `[db-password]` 등을 부른 쪽이 가르게). 없으면 모든 실패를 `parseSessionError` 로 읽는다(터미널 열기 — 예전 그대로).
   */
  passthrough?: (e: unknown) => boolean;
}

/**
 * 관문을 대신 돌린다 — `attempt` 를 부르고, 관문 실패면 묻고 답을 실어 다시 부른다.
 *
 * ```
 * attempt(hostKeyDecision:null, password:null)
 *   ├ host_key_unknown     → confirm → 고른 것을 hostKeyDecision 으로 실어 재시도
 *   ├ host_key_changed     → confirm(changed:true) → 같은 자리 (2026-09-16)
 *   ├ passphrase_required  → promptPassphrase → 암호구 + 그 경로를 실어 재시도 (2026-09-19)
 *   ├ password_required    → promptPassword → 입력값을 실어 재시도 (최대 3회)
 *   └ 그 외                → 그대로 실패(`SessionOpenError` — `passthrough` 면 받은 그대로)
 * ```
 *
 * 호스트 키는 **한 번만** 묻는다 (미상이든 변경이든 합쳐 한 번이다 — 같은 질문이 두 번 뜨면
 * 그 자체가 "계속 누르면 되는 창" 이 된다). 비밀번호는 최대 [`MAX_PASSWORD_ATTEMPTS`] 번
 * 재시도하고, 매번 Rust 가 준 `message` 를 모달에 넘겨 "틀렸다" 는 피드백을 준다.
 * 사용자가 취소하면 `cancelled` / `password_cancelled` 로 중단한다.
 *
 * ## 암호구는 **키 파일 하나당** 센다
 *
 * 후보가 여럿일 수 있어서다 (`~/.ssh` 기본 이름 셋). 상한을 접속 하나로 잡으면 첫 키에서
 * 세 번 틀린 사람이 **둘째 키는 시도조차 못 한다**. 그래서 횟수는 경로별이고, 취소한 경로는
 * `declinedKeys` 에 적어 백엔드로 되돌려 준다 — 그러지 않으면 같은 물음이 그대로 다시 와
 * 무한 루프가 된다(취소의 뜻은 "이 키는 빼고 계속" 이다 → 결국 비밀번호).
 *
 * 비밀번호도 암호구도 지역 변수 하나로만 오가고, 시도 직후 참조를 놓는다 — 어디에도 보관하지 않는다.
 */
export async function runSshGates<T>(
  alias: string,
  prompts: SshGatePrompts,
  attempt: (creds: SshGateCreds) => Promise<T>,
  options: SshGateOptions = {},
): Promise<T> {
  const { confirm, promptPassword, promptPassphrase } = prompts;
  let hostKeyDecision: Exclude<HostKeyDecision, "reject"> | null = null;
  let hostKeyAsked = false;
  let passwordAttempts = 0;
  // 직전 시도에 쓴 비밀번호. 성공하든 실패하든 그 자리에서 버린다.
  let password: string | undefined;
  // 직전 시도에 쓴 암호구와 **그 경로**. 같은 규칙으로 그 자리에서 버린다.
  let passphrase: string | undefined;
  let passphraseFor: string | undefined;
  const declined: string[] = [];
  const passphraseAttempts = new Map<string, number>();

  // 관문마다 한 걸음씩 나아가는 루프. 매 반복은 반드시 성공·throw·상태 전진 중 하나로 끝난다.
  for (;;) {
    try {
      const done = await attempt({
        hostKeyDecision,
        password: password ?? null,
        passphrase: passphrase ?? null,
        passphraseFor: passphraseFor ?? null,
        declinedKeys: declined,
      });
      password = undefined; // 성공 — 값을 놓아준다
      passphrase = undefined;
      return done;
    } catch (e) {
      password = undefined; // 실패해도 즉시 놓아준다 (재시도는 새로 입력받는다)
      passphrase = undefined;
      if (options.passthrough?.(e)) throw e;
      const err = parseSessionError(e, koTr);

      if ((err.kind === "host_key_unknown" || err.kind === "host_key_changed") && confirm && !hostKeyAsked) {
        hostKeyAsked = true;
        const changed = err.kind === "host_key_changed";
        const decision = await confirm({
          alias,
          fingerprint: err.fingerprint,
          key_type: err.key_type,
          changed,
          oldFingerprint: err.oldFingerprint,
          host: err.host,
          port: err.port,
          // 기록할 수 없는 호스트(`UserKnownHostsFile none`)에서는 기록 계열을 감춘다.
          canRecord: !err.noStore,
          allowOnce: true,
        });
        if (decision === "reject") throw new SessionOpenError({ kind: "cancelled" });
        hostKeyDecision = decision;
        continue;
      }

      // 암호구는 **비밀번호보다 앞**이다. 잠긴 키를 풀면 비밀번호를 칠 일이 없고,
      // 반대 순서면 사용자는 "키가 있는데 왜 비밀번호를 묻지" 를 먼저 보게 된다.
      if (err.kind === "passphrase_required" && promptPassphrase) {
        const used = (passphraseAttempts.get(err.path) ?? 0) + 1;
        if (used > MAX_PASSPHRASE_ATTEMPTS) throw new SessionOpenError(err);
        passphraseAttempts.set(err.path, used);
        const entered = await promptPassphrase({
          path: err.path,
          fingerprint: err.fingerprint,
          wrong: err.wrong,
          storedRejected: err.storedRejected,
          attempt: used,
          maxAttempts: MAX_PASSPHRASE_ATTEMPTS,
        });
        if (entered === null) {
          // 취소 = "이 키는 빼고 계속" — 남은 후보로, 결국 비밀번호로 간다.
          if (!declined.includes(err.path)) declined.push(err.path);
          passphraseFor = undefined;
          continue;
        }
        passphrase = entered;
        passphraseFor = err.path;
        // "이 앱에 저장" 체크는 **접속이 성공한 뒤** 처리한다 (틀린 값을 담으면 다음
        // 접속이 그 값으로 한 번 더 거부당한다) — 적어 두는 자리는 `app/prompts` 다.
        continue;
      }

      if (err.kind === "password_required" && promptPassword) {
        if (passwordAttempts >= MAX_PASSWORD_ATTEMPTS) throw new SessionOpenError(err);
        passwordAttempts += 1;
        const entered = await promptPassword({
          alias,
          message: err.message,
          attempt: passwordAttempts,
          maxAttempts: MAX_PASSWORD_ATTEMPTS,
          storedRejected: err.storedRejected === true,
        });
        if (entered === null) throw new SessionOpenError({ kind: "password_cancelled" });
        password = entered;
        continue;
      }

      throw new SessionOpenError(err);
    }
  }
}

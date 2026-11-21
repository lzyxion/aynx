// SSH 열기의 관문 고리(호스트 키 · 키 암호구 · 비밀번호) — 터미널 SSH 열기와 쿼리 타일의 SSH 경유 `db_open` 이 함께 쓴다
// (서버가 같은 `SshOpenError` 를 돌려준다 — Rust `ssh::open::acquire_shared`).

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

/** 비밀번호 · 암호구는 그 시도 한 번에만 쓰이고 곧바로 버려진다 */
export interface SshGateCreds {
  /** `null` 이면 아무도 묻지 않았다 = 거부(백엔드 기본값) */
  hostKeyDecision: Exclude<HostKeyDecision, "reject"> | null;
  password: string | null;
  passphrase: string | null;
  passphraseFor: string | null;
  /** 취소한 키 경로들 — 백엔드가 다시 묻지 않게 */
  declinedKeys: string[];
}

/** 없는 것은 묻지 않고 그 실패를 그대로 던진다(비대화형 열기) */
export interface SshGatePrompts {
  confirm?: ConfirmHostKey;
  promptPassword?: PromptPassword;
  promptPassphrase?: PromptPassphrase;
}

export interface SshGateOptions {
  /** 관문이 아닌 실패 — 해석하지 않고 받은 그대로 던진다(쿼리 타일의 `[db-password]` 등을 부른 쪽이 가르게) */
  passthrough?: (e: unknown) => boolean;
}

/**
 * 호스트 키는 미상이든 변경이든 합쳐 한 번만 묻는다 — 두 번 뜨면 "계속 누르면 되는 창" 이 된다. 비밀번호는 최대
 * [`MAX_PASSWORD_ATTEMPTS`] 번. 암호구는 키 파일 하나당 센다 — 접속 하나로 세면 첫 키에서 세 번 틀린 사람이 둘째 키를 못 쓴다.
 * 취소한 경로는 `declinedKeys` 로 되돌린다 — 안 그러면 같은 물음이 다시 와 무한 루프가 된다(취소 = "이 키는 빼고 계속").
 * 비밀번호도 암호구도 지역 변수로만 오가고 시도 직후 놓는다 — 어디에도 보관하지 않는다.
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
  let password: string | undefined;
  let passphrase: string | undefined;
  let passphraseFor: string | undefined;
  const declined: string[] = [];
  const passphraseAttempts = new Map<string, number>();

  // 매 반복은 반드시 성공·throw·상태 전진 중 하나로 끝난다.
  for (;;) {
    try {
      const done = await attempt({
        hostKeyDecision,
        password: password ?? null,
        passphrase: passphrase ?? null,
        passphraseFor: passphraseFor ?? null,
        declinedKeys: declined,
      });
      password = undefined;
      passphrase = undefined;
      return done;
    } catch (e) {
      password = undefined;
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
          canRecord: !err.noStore,
          allowOnce: true,
        });
        if (decision === "reject") throw new SessionOpenError({ kind: "cancelled" });
        hostKeyDecision = decision;
        continue;
      }

      // 암호구는 비밀번호보다 앞이다 — 잠긴 키를 풀면 비밀번호를 칠 일이 없다.
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
          if (!declined.includes(err.path)) declined.push(err.path);
          passphraseFor = undefined;
          continue;
        }
        passphrase = entered;
        passphraseFor = err.path;
        // "이 앱에 저장" 은 접속이 성공한 뒤 처리한다(`app/prompts`) — 틀린 값을 담으면 다음 접속이 한 번 더 거부당한다.
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

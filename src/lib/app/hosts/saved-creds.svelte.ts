// 호스트 폼의 저장된 자격증명 줄 — 볼트에 있는가만 안다(값은 Rust 밖으로 오지 않는다: 종류와 대상뿐).
import * as vault from "$lib/vault";
import { sameIdentityPath } from "$lib/hosts";

/**
 * [저장]에 실리지 않고 지우기만 한다 (docs/log/2026-09-19-vault.md).
 * 암호구는 담긴 경로 그대로 — 지우려면 백엔드가 편 전체 경로 글자가 필요하다(프런트에서 다시 만들면 어긋난다).
 */
export const savedCreds = $state<{ password: boolean; passphrase: string | null }>({
  password: false,
  passphrase: null,
});

export function savedPassword(): boolean {
  return savedCreds.password;
}

export function savedPassphrasePath(): string | null {
  return savedCreds.passphrase;
}

/** 잠겼거나 볼트가 없으면 둘 다 조용히 "없음" 이다 */
export async function refreshSavedCreds(alias: string, identityFile: string): Promise<void> {
  savedCreds.password = alias.trim() === "" ? false : await vault.hasPassword(alias);
  const key = identityFile.trim();
  if (key === "") {
    savedCreds.passphrase = null;
    return;
  }
  const items = await vault.list().catch(() => []);
  savedCreds.passphrase =
    items.find((i) => i.kind === "key_passphrase" && sameIdentityPath(i.target, key))?.target ??
    null;
}

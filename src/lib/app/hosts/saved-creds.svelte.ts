// 호스트 폼의 **저장된 자격증명 줄** — 이 호스트의 비밀번호·키 암호구가 볼트에 **있는가**만 안다(값은 Rust 밖으로 오지 않는다:
// `vault.hasPassword` · `vault.list` 의 종류와 대상뿐). 지우기는 `saved-creds-clear.ts`. `savedCreds` · `refreshSavedCreds` 는 내부 전용.
import * as vault from "$lib/vault";
import { sameIdentityPath } from "$lib/hosts";

// ---------------------------------------------------------------------------
// 저장된 자격증명 — **수정 모드에서만** (docs/log/2026-09-19-vault.md ③)
// ---------------------------------------------------------------------------

/**
 * 이 호스트의 값이 볼트에 담겨 있는가.
 *
 * **설정이 아니라 사실의 보고**라 폼의 다른 칸들과 성질이 다르다: [저장]에 실리지 않고,
 * 여기서 할 수 있는 일은 **지우는 것뿐**이다. 담는 길은 접속 모달의 체크 하나이고(값을 아는
 * 자리가 거기뿐이다) 빈 상태의 문구가 그 자리를 가리킨다.
 *
 * 암호구 쪽이 `boolean` 이 아니라 **담긴 경로 그대로**인 것이 요점이다: 볼트의 대상은
 * 백엔드가 `~` 를 펴서 파일로 확인한 전체 경로이고, 지우려면 그 글자가 그대로 필요하다
 * (프런트에서 다시 만들면 한 글자가 어긋난다 — `sameIdentityPath` 의 머리말).
 */
export const savedCreds = $state<{ password: boolean; passphrase: string | null }>({
  password: false,
  passphrase: null,
});

export function savedPassword(): boolean {
  return savedCreds.password;
}

/** 담긴 키 암호구의 **대상 경로** (없으면 `null`) */
export function savedPassphrasePath(): string | null {
  return savedCreds.passphrase;
}

/**
 * 볼트를 한 번 훑어 이 호스트의 두 줄을 채운다 — 폼을 열 때, 그리고 지운 뒤.
 *
 * 비밀번호는 `vault_has_password(별칭)` 한 번으로 족하다(대상이 곧 별칭이다). 암호구는
 * **목록을 훑는다** — 칸에 적힌 `~/.ssh/…` 로는 담긴 전체 경로를 맞출 수 없기 때문이다.
 * 잠겼거나 볼트가 없으면 둘 다 조용히 "없음" 이다 (그 사실은 설정 화면이 말한다).
 */
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

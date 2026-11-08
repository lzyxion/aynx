// **내부 전용** — 배럴(`session.ts`)이 내보내지 않는다. 화면에 닿지 않는 진단 글자만 쓰는 한국어 고정 `koTr`.
// `errors.ts`(SessionOpenError.message)와 `open.ts`(세션 없는 타일 방어) 두 곳이 함께 쓰려고 한 파일로 뺐다.

import { FALLBACK_LOCALE, translate } from "$lib/i18n/dict";
import type { Tr } from "./spec";

/**
 * **한국어 고정** 문구 함수 — 화면에 닿지 않는 자리에서만 쓴다.
 *
 * 이 파일은 vitest 가 그대로 돌리는 순수 모듈이라 `i18n.svelte.ts`(룬)를 들여올 수 없어
 * 문구 함수를 **인자로 받는다**. 화면을 그리는 자리는 전부 `t` 를 넘기므로 기본값을
 * 두지 않는다 — 기본값이 있으면 인자를 빠뜨린 자리가 조용히 한국어로 남고, 그것이 화면에
 * 보일 때까지 아무도 모른다.
 *
 * 남은 부름은 둘뿐이고 둘 다 **사람에게 보이지 않는 글자**다:
 * `SessionOpenError.message`(진단용 — 화면은 `describeSessionError(detail, t)` 를 따로
 * 부른다)와 세션 없는 타일에 대한 방어(실제로는 도달하지 않는다).
 */
export const koTr: Tr = (key, params) => translate(FALLBACK_LOCALE, key, params);

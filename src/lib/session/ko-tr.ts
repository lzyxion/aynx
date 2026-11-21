// 내부 전용 — 배럴(`session.ts`)이 내보내지 않는다.

import { FALLBACK_LOCALE, translate } from "$lib/i18n/dict";
import type { Tr } from "./spec";

/**
 * 한국어 고정 문구 함수 — 화면에 닿지 않는 진단 글자(`SessionOpenError.message` · 세션 없는 타일 방어)에서만 쓴다.
 * 순수 모듈들이 문구 함수를 인자로 받는 데 기본값을 두지 않는 것은 일부러다 — 있으면 인자를 빠뜨린 자리가 조용히 한국어로 남는다.
 */
export const koTr: Tr = (key, params) => translate(FALLBACK_LOCALE, key, params);

import { settings } from "$lib/i18n/ko/settings";
import { app } from "$lib/i18n/ko/app";
import { commands } from "$lib/i18n/ko/commands";
import { pane } from "$lib/i18n/ko/pane";
import { board } from "$lib/i18n/ko/board";
import { files } from "$lib/i18n/ko/files";
import { orch } from "$lib/i18n/ko/orch";

/**
 * 한국어 사전 한 벌 — **네임스페이스(화면 영역)마다 파일 하나**다.
 *
 * 쪼개 둔 이유는 나중 단계를 **같은 파일을 건드리지 않고** 나눠 맡기기 위해서다
 * (단계 ② 팔레트·메뉴·상태 표시줄 · ③ 터미널·대화상자·토스트 —
 * docs/log/2026-09-17-i18n.md). 새 영역은 여기 한 줄을 더하는 것으로 끝나고, `Key` 타입은
 * 이 객체에서 자동으로 넓어진다.
 */
export const ko = { settings, app, commands, pane, board, files, orch } as const;

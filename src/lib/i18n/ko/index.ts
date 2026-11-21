import { settings } from "$lib/i18n/ko/settings";
import { app } from "$lib/i18n/ko/app";
import { commands } from "$lib/i18n/ko/commands";
import { pane } from "$lib/i18n/ko/pane";
import { board } from "$lib/i18n/ko/board";
import { files } from "$lib/i18n/ko/files";
import { orch } from "$lib/i18n/ko/orch";

/** 한국어 사전 한 벌 — 네임스페이스(화면 영역)마다 파일 하나이고, `Key` 타입은 이 객체에서 넓어진다. */
export const ko = { settings, app, commands, pane, board, files, orch } as const;

import { settings } from "$lib/i18n/en/settings";
import { app } from "$lib/i18n/en/app";
import { commands } from "$lib/i18n/en/commands";
import { pane } from "$lib/i18n/en/pane";
import { board } from "$lib/i18n/en/board";
import { files } from "$lib/i18n/en/files";
import { orch } from "$lib/i18n/en/orch";

/** English dictionary — one file per namespace, mirroring `ko/index.ts`. */
export const en = { settings, app, commands, pane, board, files, orch } as const;

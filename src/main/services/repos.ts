import type Database from "better-sqlite3";
import type { Db } from "../db/client";
import { SettingsRepo } from "../db/repositories/settings.repo";
import { MediaRepo } from "../db/repositories/media.repo";
import { BibleRepo } from "../db/repositories/bible.repo";
import { ProgramsRepo } from "../db/repositories/programs.repo";
import { HistoryRepo } from "../db/repositories/history.repo";
import { SlidesRepo } from "../db/repositories/slides.repo";

/**
 * Small process-wide registry so modules that can't easily receive constructor
 * injection (the worship:// protocol handler, registered once before any
 * window exists) can still reach the same repository instances the IPC
 * handlers use. Populated once in main/index.ts right after the DB opens.
 */
let settingsRepo: SettingsRepo | null = null;
let mediaRepo: MediaRepo | null = null;
let bibleRepo: BibleRepo | null = null;
let programsRepo: ProgramsRepo | null = null;
let historyRepo: HistoryRepo | null = null;
let slidesRepo: SlidesRepo | null = null;
let dbHandle: { db: Db; sqlite: Database.Database } | null = null;

export function initRepos(db: Db, sqlite: Database.Database): void {
  settingsRepo = new SettingsRepo(db);
  mediaRepo = new MediaRepo(db);
  bibleRepo = new BibleRepo(db, sqlite);
  programsRepo = new ProgramsRepo(db, sqlite);
  historyRepo = new HistoryRepo(db);
  slidesRepo = new SlidesRepo(db, sqlite);
  dbHandle = { db, sqlite };
}

export const getDbHandle = () => assertInit(dbHandle, "Database");

function assertInit<T>(value: T | null, name: string): T {
  if (!value) throw new Error(`${name} accessed before initRepos() ran`);
  return value;
}

export const getSettingsRepo = () => assertInit(settingsRepo, "SettingsRepo");
export const getMediaRepo = () => assertInit(mediaRepo, "MediaRepo");
export const getBibleRepo = () => assertInit(bibleRepo, "BibleRepo");
export const getProgramsRepo = () => assertInit(programsRepo, "ProgramsRepo");
export const getHistoryRepo = () => assertInit(historyRepo, "HistoryRepo");
export const getSlidesRepo = () => assertInit(slidesRepo, "SlidesRepo");

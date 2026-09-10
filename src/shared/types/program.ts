export type ProgramSummary = {
  id: number;
  name: string;
  notes: string | null;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  /** Manual list position — the programs list is sorted by this, never by
   *  recency. Only meaningful relative to the other programs. */
  sortOrder: number;
  itemCount: number;
};

export type ProgramItemDTO =
  | { id: number; position: number; kind: "media"; mediaAssetId: number; title: string | null }
  | { id: number; position: number; kind: "ppt"; mediaAssetId: number; title: string | null }
  | {
      id: number;
      position: number;
      kind: "bible";
      bibleVersionId: number | null;
      bibleBookId: number | null;
      chapter: number | null;
      verseFrom: number | null;
      verseTo: number | null;
      reference: string;
      text: string;
    }
  | { id: number; position: number; kind: "text"; body: string; title: string | null };

export type ProgramDTO = ProgramSummary & {
  items: ProgramItemDTO[];
};

// `Omit` over a discriminated union collapses to the shared members only, so
// each variant is un-keyed by hand instead — this is what keeps `kind` acting
// as a real discriminant in ProgramsRepo.save()'s `toRow` switch.
export type ProgramItemUpsert =
  | { id?: number; kind: "media"; mediaAssetId: number; title: string | null }
  | { id?: number; kind: "ppt"; mediaAssetId: number; title: string | null }
  | {
      id?: number;
      kind: "bible";
      bibleVersionId: number | null;
      bibleBookId: number | null;
      chapter: number | null;
      verseFrom: number | null;
      verseTo: number | null;
      reference: string;
      text: string;
    }
  | { id?: number; kind: "text"; body: string; title: string | null };

export type ProgramUpsert = {
  id?: number;
  name: string;
  notes?: string | null;
  favorite?: boolean;
  items: ProgramItemUpsert[];
};

export type ProgramMetaUpsert = {
  id: number;
  name: string;
  notes?: string | null;
  favorite?: boolean;
};

/** `notes`/`favorite` default to the source program's own values when omitted
 *  — unlike `ProgramMetaUpsert.notes`, which `??`s to null, see
 *  `ProgramsRepo.duplicate()`. */
export type ProgramDuplicateInput = {
  id: number;
  name: string;
  notes?: string | null;
  favorite?: boolean;
};

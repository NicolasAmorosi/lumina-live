import type { ServiceItemKind } from "../constants";

export type ServiceSummary = {
  id: number;
  name: string;
  notes: string | null;
  serviceDate: number | null;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  itemCount: number;
};

export type ServiceItemDTO =
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

export type ServiceDTO = ServiceSummary & {
  items: ServiceItemDTO[];
};

// `Omit` over a discriminated union collapses to the shared members only, so
// each variant is un-keyed by hand instead — this is what keeps `kind` acting
// as a real discriminant in ServicesRepo.save()'s `toRow` switch.
export type ServiceItemUpsert =
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

export type ServiceUpsert = {
  id?: number;
  name: string;
  notes?: string | null;
  serviceDate?: number | null;
  items: ServiceItemUpsert[];
};

export type PlaylistItemKind = ServiceItemKind;

/**
 * What `bible_versions.language` is allowed to hold.
 *
 * The column is a two-letter tag and defaults to `"es"`, because until the
 * importer accepted more than one JSON shape every bible in the app was
 * Spanish and nothing ever said otherwise. The formats added since do carry a
 * language — and each of them carries a different flavour of it: Zefania
 * writes ISO 639-2 (`SPA`), OSIS writes a BCP 47 tag on `xml:lang`
 * (`es-419`), MyBible writes 639-1 already (`es`).
 *
 * So this is a funnel, not a lookup table: anything that reduces to two
 * letters is taken, the 639-2 codes that actually appear in circulated
 * modules are mapped, and everything else comes back `null` — which the
 * importer reads as "the file did not say" and resolves to the column's own
 * default. A wrong language is worse than an absent one: it is a fact the app
 * would then display.
 */
const ISO_639_2: Record<string, string> = {
  spa: "es",
  eng: "en",
  ita: "it",
  por: "pt",
  fra: "fr",
  fre: "fr",
  deu: "de",
  ger: "de",
  lat: "la",
  grc: "el",
  ell: "el",
  gre: "el",
  heb: "he",
  rus: "ru",
  ron: "ro",
  rum: "ro",
  nld: "nl",
  dut: "nl",
  pol: "pl",
  ukr: "uk",
  cat: "ca",
};

export function normalizeLanguage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // `es-419`, `pt_BR`: the region is not something this app models, and the
  // language underneath it is.
  const head = raw.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if (head.length === 2) return head;
  return ISO_639_2[head] ?? null;
}

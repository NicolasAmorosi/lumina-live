import type { Locale } from "@shared/types/settings";
import { mainLocale, toLocale } from "../../../i18n";
import type { CanonBook } from "./canon";

/**
 * The 66 books by their usual name in each interface language, in canonical
 * order. Spanish is `canon.ts`'s own column.
 *
 * Only for a file that names a book nowhere (an OSIS or USFX module without a
 * title per book is common): «Génesis» inside an imported King James is the
 * app talking over the very translation the operator chose.
 */
const BOOK_NAMES: Record<Exclude<Locale, "es">, readonly string[]> = {
  en: [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel",
    "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
    "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel",
    "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
    "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians",
    "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians",
    "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter",
    "1 John", "2 John", "3 John", "Jude", "Revelation",
  ],
  it: [
    "Genesi", "Esodo", "Levitico", "Numeri", "Deuteronomio", "Giosuè", "Giudici", "Rut", "1 Samuele",
    "2 Samuele", "1 Re", "2 Re", "1 Cronache", "2 Cronache", "Esdra", "Neemia", "Ester", "Giobbe", "Salmi",
    "Proverbi", "Ecclesiaste", "Cantico dei Cantici", "Isaia", "Geremia", "Lamentazioni", "Ezechiele",
    "Daniele", "Osea", "Gioele", "Amos", "Abdia", "Giona", "Michea", "Naum", "Abacuc", "Sofonia", "Aggeo",
    "Zaccaria", "Malachia", "Matteo", "Marco", "Luca", "Giovanni", "Atti", "Romani", "1 Corinzi", "2 Corinzi",
    "Galati", "Efesini", "Filippesi", "Colossesi", "1 Tessalonicesi", "2 Tessalonicesi", "1 Timoteo",
    "2 Timoteo", "Tito", "Filemone", "Ebrei", "Giacomo", "1 Pietro", "2 Pietro", "1 Giovanni", "2 Giovanni",
    "3 Giovanni", "Giuda", "Apocalisse",
  ],
  pt: [
    "Gênesis", "Êxodo", "Levítico", "Números", "Deuteronômio", "Josué", "Juízes", "Rute", "1 Samuel",
    "2 Samuel", "1 Reis", "2 Reis", "1 Crônicas", "2 Crônicas", "Esdras", "Neemias", "Ester", "Jó", "Salmos",
    "Provérbios", "Eclesiastes", "Cântico dos Cânticos", "Isaías", "Jeremias", "Lamentações", "Ezequiel",
    "Daniel", "Oseias", "Joel", "Amós", "Obadias", "Jonas", "Miqueias", "Naum", "Habacuque", "Sofonias", "Ageu",
    "Zacarias", "Malaquias", "Mateus", "Marcos", "Lucas", "João", "Atos", "Romanos", "1 Coríntios",
    "2 Coríntios", "Gálatas", "Efésios", "Filipenses", "Colossenses", "1 Tessalonicenses",
    "2 Tessalonicenses", "1 Timóteo", "2 Timóteo", "Tito", "Filemom", "Hebreus", "Tiago", "1 Pedro", "2 Pedro",
    "1 João", "2 João", "3 João", "Judas", "Apocalipse",
  ],
};

/** The name for a book its file did not name: in the bible's own language when
 *  the app has names for it, in the interface's otherwise. */
export function fallbackBookName(book: CanonBook, language: string | null): string {
  const locale = toLocale(language ?? "") ?? mainLocale();
  return locale === "es" ? book.name : (BOOK_NAMES[locale][book.index - 1] ?? book.name);
}

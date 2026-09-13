import fs from "node:fs";

/**
 * Reads per-slide auto-advance times straight out of a legacy binary
 * `.ppt`/`.pps`, because the LibreOffice round-trip loses most of them.
 *
 * ## Why this exists
 *
 * A legacy binary carries no OOXML, so `readMetadata` gets its timings by
 * converting the deck to `.pptx` with LibreOffice and parsing that. LibreOffice
 * *imports* the timings correctly — export the same file to `.odp` and every
 * slide has its `presentation:duration`. But its PPTX export only writes a
 * `<p:transition>` element when the slide has a visual transition EFFECT, and
 * `advTm` is an attribute of that element: a slide set to "no transition,
 * advance after 27 s" loses the 27 s because there is nowhere to put it.
 *
 * Measured on the user's own hymnal (`Himnario Nuevo`, 1226 `.pps` files):
 * every one of them has auto-advance in the source, and **222 lose it** —
 * 208 completely, 14 on some slides. The correlation with "the source slide's
 * `effectType` is 0" is exact: 672 decks checked against the converted output,
 * zero disagreements.
 *
 * ## What it reads
 *
 * The OLE2 compound file's `PowerPoint Document` stream, and only that: in a
 * `.pps` the pictures live in a separate `Pictures` stream, so the records
 * this parses are ~45 KB of a 1.4 MB file. Sectors are read on demand through
 * one file descriptor, never the whole file — the same rule `zip-reader.ts`
 * follows, for the same reason: this runs on the thread that serves the
 * projection window.
 *
 * Presentation order comes from the documented path (MS-PPT), not from the
 * order records happen to sit in the stream: `Current User` → the most recent
 * `UserEditAtom` → its persist directory → the `SlideListWithText` for slides
 * → one `SlidePersistAtom` per slide, in order → each slide's container.
 */

// -- record types (MS-PPT) ---------------------------------------------------

const RT_SLIDE_PERSIST_ATOM = 0x03f3;
const RT_SLIDE_LIST_WITH_TEXT = 0x0ff0;
const RT_SS_SLIDE_INFO_ATOM = 0x03f9;
const RT_USER_EDIT_ATOM = 0x0ff5;
const RT_PERSIST_DIRECTORY_ATOM = 0x1772;

/** `SlideListWithTextContainer.rh.recInstance`: 0 = slides, 1 = masters,
 *  2 = notes. Reading the wrong one silently yields the masters' timings. */
const SLIDE_LIST_INSTANCE_SLIDES = 0;

/**
 * `SlideShowSlideInfoAtom.fFlags`. MS-PPT interleaves reserved bits, so these
 * are NOT consecutive — reading them as bits 0..6 (the obvious guess) makes
 * `fAutoAdvance` land on `fLoopSound` and every deck looks manual-only.
 */
const FLAG_MANUAL_ADVANCE = 0x0001;
const FLAG_HIDDEN = 0x0004;
const FLAG_AUTO_ADVANCE = 0x0400;

/** A record header is `recVer/recInstance` (u16), `recType` (u16), `recLen`
 *  (u32). A container is marked by `recVer == 0xF`. */
const HEADER_SIZE = 8;
const CONTAINER_VER = 0x0f;

/** `SlideShowSlideInfoAtom` is a fixed 16 bytes; anything shorter is not one. */
const SS_SLIDE_INFO_MIN_LEN = 12;

/** Bounds every recursive walk. Real decks nest ~4 deep; this only ever fires
 *  on a malformed file, where the alternative is a stack overflow in main. */
const MAX_DEPTH = 16;

/** The records stream of even a 400-slide deck is a few hundred KB. Anything
 *  past this is not a presentation we should be loading into memory on the
 *  main thread — bail and let the LibreOffice path answer. */
const MAX_RECORD_STREAM_BYTES = 32 * 1024 * 1024;

const STREAM_POWERPOINT = "PowerPoint Document";
const STREAM_CURRENT_USER = "Current User";

// -- OLE2 compound file ------------------------------------------------------

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const SECTOR_END_OF_CHAIN = 0xfffffffe;
const SECTOR_FREE = 0xffffffff;
const DIFAT_HEADER_ENTRIES = 109;
const DIR_ENTRY_SIZE = 128;
const DIR_ENTRY_TYPE_STORAGE = 1;
const DIR_ENTRY_TYPE_STREAM = 2;
const DIR_ENTRY_TYPE_ROOT = 5;
const DIR_ENTRY_NONE = 0xffffffff;

/**
 * PowerPoint 95/97 "dual storage". A `.ppt` saved for both versions keeps the
 * PowerPoint 95 stream at the root and the 97-format one — the record layout
 * this file parses — inside this storage. Reading the root's by name picks the
 * 95 one, whose records are a different format entirely: found on the user's
 * own `044.ppt`, the single deck of 673 that came back unparseable.
 */
const DUAL_STORAGE_NAME = "PP97_DUALSTORAGE";

/** A chain longer than this is a loop in a corrupt file, not a real stream. */
const MAX_CHAIN_SECTORS = 1 << 20;

type OleFile = {
  readStreamByName: (name: string) => Buffer | null;
};

function openOle(fd: number, fileSize: number): OleFile | null {
  const header = Buffer.alloc(512);
  if (fs.readSync(fd, header, 0, 512, 0) < 512) return null;
  if (!header.subarray(0, 8).equals(OLE_SIGNATURE)) return null;

  const sectorSize = 1 << header.readUInt16LE(30);
  const miniSectorSize = 1 << header.readUInt16LE(32);
  const fatSectorCount = header.readUInt32LE(44);
  const dirStart = header.readUInt32LE(48);
  const miniCutoff = header.readUInt32LE(56);
  const miniFatStart = header.readUInt32LE(60);
  const difatStart = header.readUInt32LE(68);
  const difatSectorCount = header.readUInt32LE(72);
  if (sectorSize < 128 || miniSectorSize < 16) return null;

  const sectorOffset = (sector: number): number => (sector + 1) * sectorSize;

  const readSector = (sector: number): Buffer | null => {
    const offset = sectorOffset(sector);
    if (offset + sectorSize > fileSize) return null;
    const buf = Buffer.alloc(sectorSize);
    return fs.readSync(fd, buf, 0, sectorSize, offset) === sectorSize ? buf : null;
  };

  // The DIFAT: which sectors hold the FAT. The first 109 live in the header;
  // the rest chain through their own sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < DIFAT_HEADER_ENTRIES && fatSectors.length < fatSectorCount; i++) {
    const value = header.readUInt32LE(76 + i * 4);
    if (value === SECTOR_FREE || value === SECTOR_END_OF_CHAIN) break;
    fatSectors.push(value);
  }
  let difatSector = difatStart;
  const entriesPerDifat = sectorSize / 4 - 1;
  for (let i = 0; i < difatSectorCount && difatSector !== SECTOR_END_OF_CHAIN; i++) {
    const buf = readSector(difatSector);
    if (!buf) break;
    for (let j = 0; j < entriesPerDifat; j++) {
      const value = buf.readUInt32LE(j * 4);
      if (value !== SECTOR_FREE && value !== SECTOR_END_OF_CHAIN) fatSectors.push(value);
    }
    difatSector = buf.readUInt32LE(sectorSize - 4);
  }

  // The FAT is read one sector at a time, on demand: following three stream
  // chains touches a handful of FAT sectors, while materializing the whole FAT
  // of a 60 MB deck would be half a megabyte read for nothing.
  const entriesPerFatSector = sectorSize / 4;
  const fatCache = new Map<number, Buffer>();
  const fatNext = (sector: number): number => {
    const index = Math.floor(sector / entriesPerFatSector);
    const fatSector = fatSectors[index];
    if (fatSector === undefined) return SECTOR_END_OF_CHAIN;
    let buf = fatCache.get(index);
    if (!buf) {
      const read = readSector(fatSector);
      if (!read) return SECTOR_END_OF_CHAIN;
      buf = read;
      fatCache.set(index, buf);
    }
    return buf.readUInt32LE((sector % entriesPerFatSector) * 4);
  };

  const chain = (start: number, next: (s: number) => number): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    let sector = start;
    while (sector !== SECTOR_END_OF_CHAIN && sector !== SECTOR_FREE && out.length < MAX_CHAIN_SECTORS) {
      if (seen.has(sector)) break;
      seen.add(sector);
      out.push(sector);
      sector = next(sector);
    }
    return out;
  };

  const readChain = (start: number, size: number | null): Buffer => {
    const sectors = chain(start, fatNext);
    const out = Buffer.alloc(sectors.length * sectorSize);
    sectors.forEach((sector, i) => {
      const buf = readSector(sector);
      if (buf) buf.copy(out, i * sectorSize);
    });
    return size === null ? out : out.subarray(0, size);
  };

  // Directory entries. The directory is a tree of red-black sibling lists, not
  // a flat list, and the hierarchy matters: see `DUAL_STORAGE_NAME`.
  const dirBuf = readChain(dirStart, null);
  type Entry = {
    name: string;
    type: number;
    start: number;
    size: number;
    left: number;
    right: number;
    child: number;
  };
  const entryCount = Math.floor(dirBuf.length / DIR_ENTRY_SIZE);
  const entryAt = (index: number): Entry | null => {
    if (index >= entryCount) return null;
    const offset = index * DIR_ENTRY_SIZE;
    const nameLen = dirBuf.readUInt16LE(offset + 64);
    if (nameLen < 2 || nameLen > 64) return null;
    return {
      name: dirBuf.toString("utf16le", offset, offset + nameLen - 2),
      type: dirBuf.readUInt8(offset + 66),
      start: dirBuf.readUInt32LE(offset + 116),
      size: dirBuf.readUInt32LE(offset + 120),
      left: dirBuf.readUInt32LE(offset + 68),
      right: dirBuf.readUInt32LE(offset + 72),
      child: dirBuf.readUInt32LE(offset + 76),
    };
  };

  /** The direct children of one storage, by name. */
  const childrenOf = (childIndex: number): Map<string, Entry> => {
    const out = new Map<string, Entry>();
    const seen = new Set<number>();
    const visit = (index: number): void => {
      if (index === DIR_ENTRY_NONE || seen.has(index)) return;
      seen.add(index);
      const entry = entryAt(index);
      if (!entry) return;
      visit(entry.left);
      out.set(entry.name, entry);
      visit(entry.right);
    };
    visit(childIndex);
    return out;
  };

  const root = entryAt(0);
  if (!root || root.type !== DIR_ENTRY_TYPE_ROOT) return null;
  const rootChildren = childrenOf(root.child);

  // Prefer the 97-format storage when the file carries both.
  const dual = rootChildren.get(DUAL_STORAGE_NAME);
  const streamHome =
    dual && dual.type === DIR_ENTRY_TYPE_STORAGE ? childrenOf(dual.child) : rootChildren;

  // The mini stream, for entries below `miniCutoff`, lives inside the root
  // entry's own chain and is indexed by its own FAT.
  let miniStream: Buffer | null = null;
  let miniFatNext: ((sector: number) => number) | null = null;
  const loadMini = (): void => {
    if (miniStream) return;
    miniStream = readChain(root.start, root.size);
    const miniFatBuf = readChain(miniFatStart, null);
    miniFatNext = (sector: number): number =>
      sector * 4 + 4 <= miniFatBuf.length ? miniFatBuf.readUInt32LE(sector * 4) : SECTOR_END_OF_CHAIN;
  };

  const readStreamByName = (name: string): Buffer | null => {
    const entry = streamHome.get(name);
    if (!entry || entry.type !== DIR_ENTRY_TYPE_STREAM) return null;
    if (entry.size > MAX_RECORD_STREAM_BYTES) return null;
    if (entry.size >= miniCutoff) return readChain(entry.start, entry.size);

    loadMini();
    if (!miniStream || !miniFatNext) return null;
    const sectors = chain(entry.start, miniFatNext);
    const out = Buffer.alloc(sectors.length * miniSectorSize);
    sectors.forEach((sector, i) => {
      const from = sector * miniSectorSize;
      miniStream!.copy(out, i * miniSectorSize, from, from + miniSectorSize);
    });
    return out.subarray(0, entry.size);
  };

  return { readStreamByName };
}

// -- record walking ----------------------------------------------------------

type RecordVisit = (recType: number, recInstance: number, body: number, len: number) => void;

/** Walks the records between `start` and `end`, descending into containers.
 *  `cb` sees atoms AND containers, so a caller can stop at a container it
 *  recognizes. */
function walkRecords(buf: Buffer, start: number, end: number, depth: number, cb: RecordVisit): void {
  if (depth > MAX_DEPTH) return;
  let pointer = start;
  while (pointer + HEADER_SIZE <= end) {
    const verInstance = buf.readUInt16LE(pointer);
    const recType = buf.readUInt16LE(pointer + 2);
    const recLen = buf.readUInt32LE(pointer + 4);
    const body = pointer + HEADER_SIZE;
    if (body + recLen > end || recLen < 0) return;

    cb(recType, verInstance >> 4, body, recLen);
    if ((verInstance & 0x0f) === CONTAINER_VER) {
      walkRecords(buf, body, body + recLen, depth + 1, cb);
    }
    pointer = body + recLen;
  }
}

/** Reads one record header at an absolute offset, validating it fits. */
function recordAt(
  buf: Buffer,
  offset: number,
): { recType: number; body: number; len: number } | null {
  if (offset < 0 || offset + HEADER_SIZE > buf.length) return null;
  const recType = buf.readUInt16LE(offset + 2);
  const len = buf.readUInt32LE(offset + 4);
  const body = offset + HEADER_SIZE;
  if (body + len > buf.length) return null;
  return { recType, body, len };
}

// -- public -------------------------------------------------------------------

export type BinarySlideTiming = {
  /** 1-based, in presentation order. */
  slideIndex: number;
  /** Milliseconds to wait before advancing, or null when the slide does not
   *  auto-advance at all. Unrounded, as PowerPoint stored it — LibreOffice
   *  rounds to whole seconds on the way through `.pptx`. */
  autoAdvanceMs: number | null;
  hidden: boolean;
  /** Whether a click also advances. Recorded for completeness; the app does
   *  not act on it. */
  advanceOnClick: boolean;
};

/**
 * Per-slide timings from a legacy binary presentation, in presentation order,
 * or `null` when the file is not a parseable OLE2 PowerPoint deck.
 *
 * Never throws: every failure mode here (a truncated file, a format we do not
 * recognize, a persist id with no offset) means "the LibreOffice answer is the
 * only one we have", never "the conversion fails".
 */
export function readBinarySlideTimings(filePath: string): BinarySlideTiming[] | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const fileSize = fs.fstatSync(fd).size;
    const ole = openOle(fd, fileSize);
    if (!ole) return null;

    const doc = ole.readStreamByName(STREAM_POWERPOINT);
    if (!doc) return null;

    const currentUser = ole.readStreamByName(STREAM_CURRENT_USER);
    // `CurrentUserAtom`: rh (8) + size (4) + headerToken (4), then the offset
    // of the most recent UserEditAtom in the records stream.
    if (!currentUser || currentUser.length < 20) return null;
    const currentEditOffset = currentUser.readUInt32LE(16);

    // Walk the edit chain newest → oldest. Each edit contributes a persist
    // directory; an id already seen belongs to a newer edit and wins.
    const persistOffsets = new Map<number, number>();
    let docPersistIdRef: number | null = null;
    let editOffset = currentEditOffset;
    const seenEdits = new Set<number>();
    while (editOffset !== 0 && !seenEdits.has(editOffset)) {
      seenEdits.add(editOffset);
      const edit = recordAt(doc, editOffset);
      if (!edit || edit.recType !== RT_USER_EDIT_ATOM || edit.len < 28) break;

      if (docPersistIdRef === null) docPersistIdRef = doc.readUInt32LE(edit.body + 16);
      readPersistDirectory(doc, doc.readUInt32LE(edit.body + 12), persistOffsets);
      editOffset = doc.readUInt32LE(edit.body + 8);
    }
    if (docPersistIdRef === null) return null;

    const docOffset = persistOffsets.get(docPersistIdRef);
    if (docOffset === undefined) return null;
    const documentContainer = recordAt(doc, docOffset);
    if (!documentContainer) return null;

    // The slide list, in presentation order.
    const slidePersistIds: number[] = [];
    let inSlideList = false;
    let slideListEnd = 0;
    walkRecords(doc, documentContainer.body, documentContainer.body + documentContainer.len, 0,
      (recType, recInstance, body, len) => {
        if (recType === RT_SLIDE_LIST_WITH_TEXT) {
          // Only the slides' list. Masters and notes have their own, with
          // their own SlidePersistAtoms and their own timings.
          inSlideList = recInstance === SLIDE_LIST_INSTANCE_SLIDES;
          if (inSlideList) slideListEnd = body + len;
          return;
        }
        if (!inSlideList) return;
        if (body > slideListEnd) {
          inSlideList = false;
          return;
        }
        if (recType === RT_SLIDE_PERSIST_ATOM && len >= 4) {
          slidePersistIds.push(doc.readUInt32LE(body));
        }
      });

    if (slidePersistIds.length === 0) return null;

    return slidePersistIds.map((persistId, index) => {
      const info = readSlideInfo(doc, persistOffsets.get(persistId));
      return {
        slideIndex: index + 1,
        autoAdvanceMs: info?.autoAdvanceMs ?? null,
        hidden: info?.hidden ?? false,
        advanceOnClick: info?.advanceOnClick ?? true,
      };
    });
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already gone */
      }
    }
  }
}

/** `PersistDirectoryAtom`: a sequence of `{ persistId:20 | cPersist:12 }`
 *  headers, each followed by `cPersist` stream offsets. */
function readPersistDirectory(doc: Buffer, offset: number, into: Map<number, number>): void {
  const record = recordAt(doc, offset);
  if (!record || record.recType !== RT_PERSIST_DIRECTORY_ATOM) return;

  let pointer = record.body;
  const end = record.body + record.len;
  while (pointer + 4 <= end) {
    const packed = doc.readUInt32LE(pointer);
    pointer += 4;
    const firstId = packed & 0x000fffff;
    const count = packed >>> 20;
    if (count === 0) break;
    for (let i = 0; i < count && pointer + 4 <= end; i++, pointer += 4) {
      const id = firstId + i;
      // Newest edit first: an id already present came from a later edit.
      if (!into.has(id)) into.set(id, doc.readUInt32LE(pointer));
    }
  }
}

function readSlideInfo(
  doc: Buffer,
  slideOffset: number | undefined,
): { autoAdvanceMs: number | null; hidden: boolean; advanceOnClick: boolean } | null {
  if (slideOffset === undefined) return null;
  const slide = recordAt(doc, slideOffset);
  if (!slide) return null;

  let found: { autoAdvanceMs: number | null; hidden: boolean; advanceOnClick: boolean } | null = null;
  walkRecords(doc, slide.body, slide.body + slide.len, 0, (recType, _instance, body, len) => {
    if (found || recType !== RT_SS_SLIDE_INFO_ATOM || len < SS_SLIDE_INFO_MIN_LEN) return;
    const slideTime = doc.readInt32LE(body);
    const flags = doc.readUInt16LE(body + 10);
    found = {
      // `slideTime` is only meaningful when the deck actually auto-advances;
      // PowerPoint leaves the last value behind when the box is unticked.
      autoAdvanceMs: (flags & FLAG_AUTO_ADVANCE) !== 0 && slideTime > 0 ? slideTime : null,
      hidden: (flags & FLAG_HIDDEN) !== 0,
      advanceOnClick: (flags & FLAG_MANUAL_ADVANCE) !== 0,
    };
  });
  return found;
}

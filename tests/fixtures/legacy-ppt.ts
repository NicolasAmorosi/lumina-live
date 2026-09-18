
/**
 * A minimal OLE2 compound file carrying a PowerPoint 97 record stream with two
 * slides: the first auto-advances after 12345 ms, the second does not (its
 * `fAutoAdvance` bit is clear, with a stale `slideTime` left behind — exactly
 * what PowerPoint writes when the box is unticked).
 *
 * Built rather than checked in so the reader has a deterministic fixture that
 * costs no binary in the repo, and so the structures it depends on are spelled
 * out here: the persist directory, the slide list that defines PRESENTATION
 * order, and the `SlideShowSlideInfoAtom` flag layout.
 *
 * Both streams are padded to `miniCutoff` so they live in ordinary sectors —
 * the mini-FAT is not what this is testing.
 */
export function buildLegacyPpt(): Buffer {
  const SECTOR = 512;
  const STREAM_BYTES = 4096;
  const ENDOFCHAIN = 0xfffffffe;
  const FREESECT = 0xffffffff;
  const FATSECT = 0xfffffffd;
  const NOSTREAM = 0xffffffff;

  const header = (recVer: number, recInstance: number, recType: number, len: number): Buffer => {
    const buf = Buffer.alloc(8);
    buf.writeUInt16LE((recInstance << 4) | recVer, 0);
    buf.writeUInt16LE(recType, 2);
    buf.writeUInt32LE(len, 4);
    return buf;
  };

  const slidePersistAtom = (persistId: number, slideId: number): Buffer => {
    const body = Buffer.alloc(20);
    body.writeUInt32LE(persistId, 0);
    body.writeUInt32LE(slideId, 12);
    return Buffer.concat([header(0x0, 0, 0x03f3, body.length), body]);
  };

  const slideContainer = (slideTimeMs: number, flags: number): Buffer => {
    const info = Buffer.alloc(16);
    info.writeInt32LE(slideTimeMs, 0); // slideTime
    info.writeUInt16LE(flags, 10); // fFlags
    const atom = Buffer.concat([header(0x0, 0, 0x03f9, info.length), info]);
    return Buffer.concat([header(0xf, 0, 0x03ee, atom.length), atom]);
  };

  const slideList = Buffer.concat([slidePersistAtom(2, 256), slidePersistAtom(3, 257)]);
  const document = Buffer.concat([
    header(0xf, 0, 0x0ff0, slideList.length), // SlideListWithText, recInstance 0 = slides
    slideList,
  ]);
  const documentContainer = Buffer.concat([
    header(0xf, 0, 0x03e8, document.length),
    document,
  ]);

  // 0x0400 = fAutoAdvance, 0x0001 = fManualAdvance. Not consecutive bits.
  const slide1 = slideContainer(12_345, 0x0400);
  const slide2 = slideContainer(999, 0x0001);

  const documentOffset = 0;
  const slide1Offset = documentContainer.length;
  const slide2Offset = slide1Offset + slide1.length;
  const persistOffset = slide2Offset + slide2.length;

  // One run of three ids starting at 1: document, slide 1, slide 2.
  const persistBody = Buffer.alloc(4 + 3 * 4);
  persistBody.writeUInt32LE(1 | (3 << 20), 0);
  persistBody.writeUInt32LE(documentOffset, 4);
  persistBody.writeUInt32LE(slide1Offset, 8);
  persistBody.writeUInt32LE(slide2Offset, 12);
  const persistDirectory = Buffer.concat([
    header(0x0, 0, 0x1772, persistBody.length),
    persistBody,
  ]);

  const editOffset = persistOffset + persistDirectory.length;
  const editBody = Buffer.alloc(28);
  editBody.writeUInt32LE(257, 0); // lastSlideIdRef
  editBody.writeUInt32LE(0, 8); // offsetLastEdit — no earlier edit
  editBody.writeUInt32LE(persistOffset, 12);
  editBody.writeUInt32LE(1, 16); // docPersistIdRef
  editBody.writeUInt32LE(4, 20); // persistIdSeed
  const userEdit = Buffer.concat([header(0x0, 0, 0x0ff5, editBody.length), editBody]);

  const docStream = Buffer.alloc(STREAM_BYTES);
  Buffer.concat([documentContainer, slide1, slide2, persistDirectory, userEdit]).copy(docStream);

  const userStream = Buffer.alloc(STREAM_BYTES);
  header(0x0, 0, 0x0ff6, 0x14).copy(userStream, 0); // CurrentUserAtom
  userStream.writeUInt32LE(0x14, 8); // size
  userStream.writeUInt32LE(0xf3d1c4df, 12); // headerToken (unencrypted)
  userStream.writeUInt32LE(editOffset, 16); // offsetToCurrentEdit

  const docSectors = STREAM_BYTES / SECTOR;
  const docStart = 2;
  const userStart = docStart + docSectors;
  const totalSectors = userStart + docSectors;

  const fat = Buffer.alloc(SECTOR, 0xff);
  for (let i = 0; i < SECTOR / 4; i++) fat.writeUInt32LE(FREESECT, i * 4);
  fat.writeUInt32LE(FATSECT, 0 * 4);
  fat.writeUInt32LE(ENDOFCHAIN, 1 * 4); // the directory, one sector
  for (let i = 0; i < docSectors; i++) {
    fat.writeUInt32LE(i === docSectors - 1 ? ENDOFCHAIN : docStart + i + 1, (docStart + i) * 4);
    fat.writeUInt32LE(i === docSectors - 1 ? ENDOFCHAIN : userStart + i + 1, (userStart + i) * 4);
  }

  const directory = Buffer.alloc(SECTOR);
  const writeEntry = (
    index: number,
    name: string,
    type: number,
    left: number,
    right: number,
    child: number,
    start: number,
    size: number,
  ): void => {
    const offset = index * 128;
    const encoded = Buffer.from(`${name}\0`, "utf16le");
    encoded.copy(directory, offset);
    directory.writeUInt16LE(encoded.length, offset + 64);
    directory.writeUInt8(type, offset + 66);
    directory.writeUInt8(1, offset + 67); // colour: black
    directory.writeUInt32LE(left, offset + 68);
    directory.writeUInt32LE(right, offset + 72);
    directory.writeUInt32LE(child, offset + 76);
    directory.writeUInt32LE(start, offset + 116);
    directory.writeUInt32LE(size, offset + 120);
  };
  writeEntry(0, "Root Entry", 5, NOSTREAM, NOSTREAM, 1, ENDOFCHAIN, 0);
  writeEntry(1, "PowerPoint Document", 2, NOSTREAM, 2, NOSTREAM, docStart, STREAM_BYTES);
  writeEntry(2, "Current User", 2, NOSTREAM, NOSTREAM, NOSTREAM, userStart, STREAM_BYTES);

  const head = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(head, 0);
  head.writeUInt16LE(0x003e, 24); // minor version
  head.writeUInt16LE(0x0003, 26); // major version
  head.writeUInt16LE(0xfffe, 28); // byte order
  head.writeUInt16LE(9, 30); // sector shift -> 512
  head.writeUInt16LE(6, 32); // mini sector shift -> 64
  head.writeUInt32LE(1, 44); // FAT sectors
  head.writeUInt32LE(1, 48); // directory start
  head.writeUInt32LE(4096, 56); // mini stream cutoff
  head.writeUInt32LE(ENDOFCHAIN, 60); // mini FAT start
  head.writeUInt32LE(0, 64);
  head.writeUInt32LE(ENDOFCHAIN, 68); // DIFAT start
  head.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) head.writeUInt32LE(i === 0 ? 0 : FREESECT, 76 + i * 4);

  const body = Buffer.alloc(totalSectors * SECTOR);
  fat.copy(body, 0);
  directory.copy(body, SECTOR);
  docStream.copy(body, docStart * SECTOR);
  userStream.copy(body, userStart * SECTOR);
  return Buffer.concat([head, body]);
}

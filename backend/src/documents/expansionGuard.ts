import { createInflate, createInflateRaw } from "node:zlib";

/**
 * The upload routes cap what a client may SEND (4 MB, `MAX_UPLOAD_BYTES`), but a DOCX is a zip and a
 * PDF's pages are deflate streams, and deflate can turn 300 kB into 300 MB (measured: the server's
 * memory grew by ~650 MB and an unrelated `/health` request waited ~3 s behind the parser). So the
 * extractors do not see a file until this check has counted, without keeping it, how much the file
 * really unpacks to. The count comes from inflating the data itself, never from a size the file
 * declares about itself — a bomb is exactly a file whose header lies.
 */
export const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;

/** A zip's central directory is read whole; a real DOCX has a few dozen entries. */
export const MAX_ZIP_ENTRIES = 10_000;

/** The file unpacks to more than one document can hold. Mapped to the same `document_too_long` answer. */
export class DocumentTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentTooLargeError";
  }
}

/** The file is not shaped like the format it claims, so it is refused rather than half-checked. */
export class MalformedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedDocumentError";
  }
}

/**
 * How many bytes `compressed` inflates to, counted as it streams (constant memory). Counting stops at
 * the first byte past `limit`, so a bomb costs a fraction of its size. A stream that is corrupt, or
 * ends early, reports what it produced before it broke: the parser behind this check rejects it.
 */
function inflatedBytes(compressed: Buffer, kind: "raw" | "zlib", limit: number): Promise<number> {
  return new Promise((resolve) => {
    const inflate = kind === "raw" ? createInflateRaw() : createInflate();
    let total = 0;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve(total);
    };
    inflate.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        settle();
        inflate.destroy();
      }
    });
    inflate.on("end", settle);
    inflate.on("error", settle);
    inflate.on("close", settle);
    inflate.end(compressed);
  });
}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_FIXED_SIZE = 46;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_FIXED_SIZE = 30;

/** Locates the zip's end-of-central-directory record, searching back past an optional file comment. */
function findEndOfCentralDirectory(zip: Buffer): number {
  const lowest = Math.max(0, zip.length - EOCD_MIN_SIZE - 0xffff);
  for (let pos = zip.length - EOCD_MIN_SIZE; pos >= lowest; pos--) {
    if (zip.readUInt32LE(pos) === EOCD_SIGNATURE) return pos;
  }
  throw new MalformedDocumentError("zip: no end-of-central-directory record");
}

/**
 * Throws `DocumentTooLargeError` when the zip's entries inflate to more than `maxBytes` together.
 * Anything the extractor's own zip reader could read differently — zip64, data in front of the
 * archive, an unknown compression method, a pointer outside the file — is refused as malformed
 * instead of being measured by a reader that might disagree about what is in the archive.
 */
export async function assertZipWithinBudget(
  zip: Buffer,
  { maxBytes = MAX_EXPANDED_BYTES, maxEntries = MAX_ZIP_ENTRIES } = {},
): Promise<void> {
  const eocd = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(eocd + 10);
  const directorySize = zip.readUInt32LE(eocd + 12);
  const directoryOffset = zip.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new MalformedDocumentError("zip: zip64 archives are not supported");
  }
  if (directoryOffset + directorySize !== eocd) {
    throw new MalformedDocumentError("zip: central directory does not end where the archive does");
  }
  if (entryCount > maxEntries) throw new DocumentTooLargeError(`zip: ${entryCount} entries`);

  let remaining = maxBytes;
  let pos = directoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (pos + CENTRAL_FIXED_SIZE > eocd || zip.readUInt32LE(pos) !== CENTRAL_SIGNATURE) {
      throw new MalformedDocumentError("zip: bad central directory entry");
    }
    const method = zip.readUInt16LE(pos + 10);
    const compressedSize = zip.readUInt32LE(pos + 20);
    const nameLength = zip.readUInt16LE(pos + 28);
    const extraLength = zip.readUInt16LE(pos + 30);
    const commentLength = zip.readUInt16LE(pos + 32);
    const localOffset = zip.readUInt32LE(pos + 42);
    pos += CENTRAL_FIXED_SIZE + nameLength + extraLength + commentLength;

    if (localOffset + LOCAL_FIXED_SIZE > directoryOffset || zip.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new MalformedDocumentError("zip: bad local header");
    }
    const dataStart = localOffset + LOCAL_FIXED_SIZE + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > directoryOffset) throw new MalformedDocumentError("zip: entry runs past the archive");
    const data = zip.subarray(dataStart, dataStart + compressedSize);

    let size: number;
    if (method === 0) size = compressedSize;
    else if (method === 8) size = await inflatedBytes(data, "raw", remaining);
    else throw new MalformedDocumentError(`zip: compression method ${method}`);

    remaining -= size;
    if (remaining < 0) throw new DocumentTooLargeError(`zip: entries unpack to more than ${maxBytes} bytes`);
  }
}

/** Image streams get their own, larger budget: a scan is mostly image data, which compresses far better than text. */
export const MAX_PDF_IMAGE_EXPANDED_BYTES = 128 * 1024 * 1024;

/**
 * Throws `DocumentTooLargeError` when the PDF's deflate streams inflate to more than `maxBytes`
 * together (or, for streams the file itself tags `/Subtype /Image`, more than `maxImageBytes`). This finds
 * `/FlateDecode` streams by their own markers, so it is a bounded best effort and not a PDF parser: a
 * stream behind a second filter (such as ASCII85 before Flate) is not counted, and a PDF it cannot read
 * is left for the real parser to refuse. The image tag is the file's own claim and gets a budget, not an
 * exemption: pdf.js still decodes a page-content stream that carries it.
 */
export async function assertPdfWithinBudget(
  pdf: Buffer,
  { maxBytes = MAX_EXPANDED_BYTES, maxImageBytes = MAX_PDF_IMAGE_EXPANDED_BYTES } = {},
): Promise<void> {
  const text = pdf.toString("latin1");
  let remaining = maxBytes;
  let remainingImage = maxImageBytes;
  let from = 0;
  for (;;) {
    const keyword = text.indexOf("stream", from);
    if (keyword === -1) return;
    from = keyword + "stream".length;
    if (text.startsWith("end", keyword - 3)) continue;

    let dataStart = from;
    if (text[dataStart] === "\r") dataStart++;
    if (text[dataStart] === "\n") dataStart++;
    else if (dataStart === from) continue; // `stream` not followed by a line break is not a stream body

    // The dictionary sits between this object's `obj` keyword and the `stream` keyword.
    const objectStart = text.lastIndexOf("obj", keyword);
    const dictionary = objectStart === -1 ? "" : text.slice(objectStart, keyword);
    if (!/\/(FlateDecode|Fl)\b/.test(dictionary)) continue;
    const isImage = /\/Subtype\s*\/Image\b/.test(dictionary);

    let dataEnd = text.indexOf("endstream", dataStart);
    if (dataEnd === -1) dataEnd = pdf.length;
    const size = await inflatedBytes(pdf.subarray(dataStart, dataEnd), "zlib", isImage ? remainingImage : remaining);
    if (isImage) remainingImage -= size;
    else remaining -= size;
    if (remaining < 0 || remainingImage < 0) throw new DocumentTooLargeError(`pdf: streams unpack to more than the limit`);
    from = dataEnd;
  }
}

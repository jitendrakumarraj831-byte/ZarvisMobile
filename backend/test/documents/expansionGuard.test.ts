import { deflateRawSync, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  assertPdfWithinBudget,
  assertZipWithinBudget,
  DocumentTooLargeError,
  MalformedDocumentError,
} from "../../src/documents/expansionGuard.js";
import { DocumentExtractionError, extractDocumentText, MAX_PDF_PAGES } from "../../src/documents/extractText.js";
import { processUpload } from "../../src/documents/processUpload.js";
import { buildDocxFixture, buildPdfFixture } from "./fixtures.js";

const MB = 1024 * 1024;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface ZipEntry {
  name: string;
  data: Buffer;
  /** 8 = deflate (default), 0 = stored, anything else is written as-is with the data left raw. */
  method?: number;
  /** What the central directory CLAIMS the entry unpacks to. A bomb's header is free to lie. */
  claimedSize?: number;
}

/** A minimal zip writer, so the tests can build files `docx` and `archiver` would never produce. */
function buildZip(entries: ZipEntry[], { zip64 = false } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateRawSync(entry.data, { level: 9 }) : entry.data;
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.claimedSize ?? entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.claimedSize ?? entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : entries.length, 8);
  end.writeUInt16LE(zip64 ? 0xffff : entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const zeros = (bytes: number) => Buffer.alloc(bytes, 0x61);

/** A one-page PDF whose single content stream is `content`, deflated; `dictionary` extends its dictionary. */
function buildPdf(content: Buffer, dictionary = ""): Buffer {
  const body = deflateSync(content, { level: 9 });
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>"),
    Buffer.concat([
      Buffer.from(`<< /Length ${body.length} /Filter /FlateDecode ${dictionary} >>\nstream\n`),
      body,
      Buffer.from("\nendstream"),
    ]),
  ];
  let out = Buffer.from("%PDF-1.4\n");
  objects.forEach((object, index) => {
    out = Buffer.concat([out, Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
  });
  return Buffer.concat([out, Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n")]);
}

/** A PDF of `pages` empty pages: tiny on the wire, and the shape that once held the server for 105 s. */
function buildPdfWithPages(pages: number): Buffer {
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>"),
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("assertZipWithinBudget", () => {
  it("lets the DOCX a real word processor writes through", async () => {
    await expect(assertZipWithinBudget(await buildDocxFixture("An ordinary page."))).resolves.toBeUndefined();
  });

  it("refuses a small file that unpacks past the budget — by what it really unpacks to", async () => {
    const bomb = buildZip([{ name: "word/document.xml", data: zeros(8 * MB) }]);
    expect(bomb.length).toBeLessThan(20_000);
    await expect(assertZipWithinBudget(bomb, { maxBytes: 2 * MB })).rejects.toBeInstanceOf(DocumentTooLargeError);
  });

  it("is not fooled by a header that claims the entry is tiny", async () => {
    const liar = buildZip([{ name: "word/document.xml", data: zeros(8 * MB), claimedSize: 10 }]);
    await expect(assertZipWithinBudget(liar, { maxBytes: 2 * MB })).rejects.toBeInstanceOf(DocumentTooLargeError);
  });

  it("adds the entries up: many entries that are each under the budget are still over it together", async () => {
    const many = buildZip(Array.from({ length: 6 }, (_, i) => ({ name: `word/part${i}.xml`, data: zeros(MB) })));
    await expect(assertZipWithinBudget(many, { maxBytes: 3 * MB })).rejects.toBeInstanceOf(DocumentTooLargeError);
    await expect(assertZipWithinBudget(many, { maxBytes: 7 * MB })).resolves.toBeUndefined();
  });

  it("counts a stored entry by its real size", async () => {
    const stored = buildZip([{ name: "word/media/big.bin", data: zeros(3 * MB), method: 0 }]);
    await expect(assertZipWithinBudget(stored, { maxBytes: 2 * MB })).rejects.toBeInstanceOf(DocumentTooLargeError);
  });

  it("refuses an archive with more entries than a document has", async () => {
    const entries = buildZip(Array.from({ length: 20 }, (_, i) => ({ name: `e${i}`, data: Buffer.from("x") })));
    await expect(assertZipWithinBudget(entries, { maxEntries: 10 })).rejects.toBeInstanceOf(DocumentTooLargeError);
  });

  it.each([
    ["not a zip at all", Buffer.from("this is plainly not a zip archive")],
    ["empty", Buffer.alloc(0)],
    ["bytes in front of the archive", Buffer.concat([Buffer.from("JUNK"), buildZip([{ name: "a", data: Buffer.from("hi") }])])],
    ["zip64", buildZip([{ name: "a", data: Buffer.from("hi") }], { zip64: true })],
    ["an unknown compression method", buildZip([{ name: "a", data: Buffer.from("hi"), method: 12 }])],
    ["a truncated archive", buildZip([{ name: "a", data: zeros(1000) }]).subarray(0, 60)],
  ])("refuses %s as malformed, not as a pass", async (_label, file) => {
    await expect(assertZipWithinBudget(file)).rejects.toBeInstanceOf(MalformedDocumentError);
  });
});

describe("assertPdfWithinBudget", () => {
  it("lets the PDF a real writer produces through", async () => {
    await expect(assertPdfWithinBudget(await buildPdfFixture("An ordinary page."))).resolves.toBeUndefined();
  });

  it("refuses a small PDF whose page stream unpacks past the budget", async () => {
    const bomb = buildPdf(Buffer.concat([Buffer.from("BT /F1 12 Tf (hello) Tj ET\n"), zeros(8 * MB)]));
    expect(bomb.length).toBeLessThan(20_000);
    await expect(assertPdfWithinBudget(bomb, { maxBytes: 2 * MB })).rejects.toBeInstanceOf(DocumentTooLargeError);
  });

  it("gives a real image stream its own larger budget, so a scan is not mistaken for a bomb", async () => {
    const scan = buildPdf(zeros(8 * MB), "/Type /XObject /Subtype /Image /Width 1000 /Height 1000");
    await expect(assertPdfWithinBudget(scan, { maxBytes: 2 * MB, maxImageBytes: 16 * MB })).resolves.toBeUndefined();
  });

  it("does not let the image tag exempt a stream: pdf.js still decodes a page-content stream that carries it", async () => {
    const disguised = buildPdf(zeros(8 * MB), "/Subtype /Image");
    await expect(assertPdfWithinBudget(disguised, { maxBytes: 2 * MB, maxImageBytes: 4 * MB })).rejects.toBeInstanceOf(DocumentTooLargeError);
  });

  it("leaves a damaged stream to the real parser instead of throwing", async () => {
    const damaged = buildPdf(zeros(1000));
    const at = damaged.indexOf("stream\n") + 12;
    damaged.fill(0xff, at, at + 8);
    await expect(assertPdfWithinBudget(damaged)).resolves.toBeUndefined();
    await expect(assertPdfWithinBudget(Buffer.from("%PDF-1.4 and then nothing useful"))).resolves.toBeUndefined();
  });
});

describe("the guard in front of the real extractors", () => {
  it("still extracts real text from a real DOCX and a real PDF", async () => {
    expect(await extractDocumentText(await buildDocxFixture("Namaste Zarvis"), "docx")).toContain("Namaste Zarvis");
    expect(await extractDocumentText(await buildPdfFixture("Namaste Zarvis"), "pdf")).toContain("Namaste Zarvis");
  });

  it("answers a DOCX bomb with 413 document_too_long, before mammoth has unpacked it", async () => {
    const bomb = buildZip([{ name: "word/document.xml", data: zeros(70 * MB) }]);
    expect(bomb.length).toBeLessThan(200_000);
    const result = await processUpload({ buffer: bomb, mimetype: DOCX_MIME, originalname: "bomb.docx", size: bomb.length });
    expect(result).toEqual({ ok: false, status: 413, body: { error: "document_too_long", maxChars: 60_000 } });
  });

  it("answers a PDF bomb the same way", async () => {
    const bomb = buildPdf(zeros(70 * MB));
    const result = await processUpload({ buffer: bomb, mimetype: "application/pdf", originalname: "bomb.pdf", size: bomb.length });
    expect(result).toEqual({ ok: false, status: 413, body: { error: "document_too_long", maxChars: 60_000 } });
  });

  it("refuses a PDF with more pages than a document can hold, before extracting any of them", async () => {
    const tooMany = buildPdfWithPages(MAX_PDF_PAGES + 1);
    expect(tooMany.length).toBeLessThan(100_000);
    await expect(extractDocumentText(tooMany, "pdf")).rejects.toBeInstanceOf(DocumentTooLargeError);
    const result = await processUpload({ buffer: tooMany, mimetype: "application/pdf", originalname: "pages.pdf", size: tooMany.length });
    expect(result).toEqual({ ok: false, status: 413, body: { error: "document_too_long", maxChars: 60_000 } });
  });

  it("still reads a PDF at the page limit", async () => {
    const atLimit = buildPdfWithPages(MAX_PDF_PAGES);
    const result = await processUpload({ buffer: atLimit, mimetype: "application/pdf", originalname: "pages.pdf", size: atLimit.length });
    expect(result).toEqual({ ok: false, status: 422, body: { error: "empty_document" } });
  });

  it("answers a file that is not a zip with the ordinary 422 extraction_failed", async () => {
    const junk = Buffer.from("not a zip");
    await expect(extractDocumentText(junk, "docx")).rejects.toBeInstanceOf(DocumentExtractionError);
    const result = await processUpload({ buffer: junk, mimetype: DOCX_MIME, originalname: "x.docx", size: junk.length });
    expect(result).toEqual({ ok: false, status: 422, body: { error: "extraction_failed" } });
  });
});

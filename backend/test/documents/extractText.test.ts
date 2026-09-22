import { describe, expect, it } from "vitest";
import { classifyDocumentType, extractDocumentText, DocumentExtractionError } from "../../src/documents/extractText.js";
import { buildDocxFixture, buildPdfFixture } from "./fixtures.js";

describe("classifyDocumentType", () => {
  it("classifies by extension when the MIME type is generic/missing", () => {
    expect(classifyDocumentType("report.pdf", "")).toBe("pdf");
    expect(classifyDocumentType("report.PDF", "application/octet-stream")).toBe("pdf");
    expect(classifyDocumentType("notes.docx", "")).toBe("docx");
  });

  it("classifies by MIME type", () => {
    expect(classifyDocumentType("upload", "application/pdf")).toBe("pdf");
    expect(
      classifyDocumentType("upload", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("docx");
  });

  it("returns null for anything else — plain text and truly unsupported types alike", () => {
    expect(classifyDocumentType("notes.txt", "text/plain")).toBeNull();
    expect(classifyDocumentType("photo.png", "image/png")).toBeNull();
    expect(classifyDocumentType("archive.zip", "application/zip")).toBeNull();
  });
});

describe("extractDocumentText", () => {
  it("extracts real text from a real PDF (built with pdfkit, not a hand-rolled byte stream)", async () => {
    const original =
      "ZARVIS MOBILE PDF extraction test. This paragraph verifies real-world PDF text extraction end to end.";
    const buffer = await buildPdfFixture(original);
    const text = await extractDocumentText(buffer, "pdf");
    // pdfkit line-wraps long text, inserting its own newlines — compare with whitespace
    // collapsed rather than requiring a byte-exact match.
    expect(text.replace(/\s+/g, " ").trim()).toBe(original);
  });

  it("extracts real text from a real DOCX (built with the docx package)", async () => {
    const original = "ZARVIS MOBILE DOCX extraction test. This paragraph verifies real Word document extraction.";
    const buffer = await buildDocxFixture(original);
    const text = await extractDocumentText(buffer, "docx");
    expect(text.trim()).toBe(original);
  });

  it("throws DocumentExtractionError — never a fabricated success — on a corrupt PDF", async () => {
    const garbage = Buffer.from("this is not a real pdf file at all, just plain bytes");
    await expect(extractDocumentText(garbage, "pdf")).rejects.toThrow(DocumentExtractionError);
  });

  it("throws DocumentExtractionError on a corrupt DOCX", async () => {
    const garbage = Buffer.from("this is not a real docx file at all, just plain bytes");
    await expect(extractDocumentText(garbage, "docx")).rejects.toThrow(DocumentExtractionError);
  });

  it("never leaks the raw file bytes into the thrown error's own message", async () => {
    const garbage = Buffer.from("SECRET_FILE_CONTENT_MARKER_zzz123");
    try {
      await extractDocumentText(garbage, "pdf");
      expect.unreachable("expected extraction to throw");
    } catch (err) {
      expect(String(err)).not.toContain("SECRET_FILE_CONTENT_MARKER_zzz123");
    }
  });
});

import { Document, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";

/** Builds a real PDF (via `pdfkit`) containing the given text — not a hand-rolled byte
 * stream, so it exercises the same code path a real user's PDF would. */
export function buildPdfFixture(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(14).text(text);
    doc.end();
  });
}

/** Builds a real DOCX (via the `docx` package) containing the given text. */
export async function buildDocxFixture(text: string): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun(text)] })] }],
  });
  return Packer.toBuffer(doc);
}

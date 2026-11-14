import type { PdfConversionResult } from './EzPdfConverter';
import { EzPdfConverter } from './EzPdfConverter';
import { readPdfGlyphs } from './PdfGlyphReader';

/**
 * Imports a PDF score typeset elsewhere. Reads the glyphs drawn in the PDF
 * and rebuilds the notation from them; no OCR is involved, so this works for
 * digitally typeset PDFs (currently those set with the EZ fonts).
 */
export class PdfImporter {
  private readonly converter = new EzPdfConverter();

  public async import(data: Uint8Array): Promise<PdfConversionResult> {
    return this.converter.convert(await readPdfGlyphs(data));
  }
}

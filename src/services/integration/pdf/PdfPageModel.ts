/** One glyph drawn on a PDF page. */
export interface PdfGlyph {
  /** Font name without the subset prefix, e.g. "EZ Psaltica". */
  font: string;
  /** The character the PDF reports for the glyph. */
  text: string;
  /** Glyph origin in points, from the left edge of the page. */
  x: number;
  /** Baseline in points, from the top edge of the page. */
  y: number;
  /** Font size in points. */
  size: number;
  /** Horizontal advance of the glyph in points. */
  width: number;
}

export interface PdfPage {
  width: number;
  height: number;
  glyphs: PdfGlyph[];
}

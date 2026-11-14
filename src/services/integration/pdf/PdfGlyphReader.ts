import type { PdfGlyph, PdfPage } from './PdfPageModel';

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Returns the matrix that applies `inner` first, then `outer`. */
function compose(outer: Matrix, inner: Matrix): Matrix {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ];
}

function applyPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

/** pdf.js passes matrices either as one array argument or as six numbers. */
function toMatrix(args: unknown[]): Matrix {
  const source = (args.length === 1 ? args[0] : args) as ArrayLike<number>;
  return [source[0], source[1], source[2], source[3], source[4], source[5]];
}

interface PdfJsGlyph {
  unicode: string;
  originalCharCode: number | null;
  width: number;
  isSpace: boolean;
}

interface GraphicsState {
  ctm: Matrix;
}

/**
 * Reads every glyph drawn on every page of a PDF, with its font name, text,
 * baseline position and size. Positions are in PDF points with the origin at
 * the top-left of the page and y growing downward.
 *
 * The operator list is used rather than the text layer because the text
 * layer merges and reorders characters; here every glyph keeps its exact
 * position, which is what the notation converter relies on.
 */
export async function readPdfGlyphs(data: Uint8Array): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } =
    await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  // fontExtraProperties exposes the real font names, which identify the
  // notation fonts.
  const loadingTask = pdfjs.getDocument({ data, fontExtraProperties: true });
  const document = await loadingTask.promise;

  const opNames = new Map<number, string>(
    Object.entries(pdfjs.OPS).map(([name, id]) => [id as number, name]),
  );

  try {
    const pages: PdfPage[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const operatorList = await page.getOperatorList();
      const glyphs: PdfGlyph[] = [];

      const stack: GraphicsState[] = [];
      let state: GraphicsState = { ctm: IDENTITY };
      let textMatrix: Matrix = IDENTITY;
      let lineMatrix: Matrix = IDENTITY;
      let fontName = '';
      let fontMatrixScale = 0.001;
      let fontSize = 1;
      let charSpacing = 0;
      let wordSpacing = 0;
      let horizontalScale = 1;
      let leading = 0;
      let rise = 0;

      const moveText = (tx: number, ty: number) => {
        lineMatrix = compose(lineMatrix, translate(tx, ty));
        textMatrix = lineMatrix;
      };

      const showText = (items: (PdfJsGlyph | number)[]) => {
        const toPage = compose(
          viewport.transform as Matrix,
          compose(state.ctm, textMatrix),
        );
        const size = fontSize * Math.hypot(toPage[2], toPage[3]);
        const xScale = Math.hypot(toPage[0], toPage[1]);
        let x = 0;

        for (const item of items) {
          if (typeof item === 'number') {
            x -= (item / 1000) * fontSize * horizontalScale;
            continue;
          }

          const text =
            item.unicode ||
            (item.originalCharCode != null
              ? String.fromCharCode(item.originalCharCode)
              : '');
          const advance =
            (item.width * fontMatrixScale * fontSize +
              charSpacing +
              (item.isSpace ? wordSpacing : 0)) *
            horizontalScale;

          if (text !== '') {
            const [px, py] = applyPoint(toPage, x, rise);
            glyphs.push({
              font: fontName,
              text,
              x: px,
              y: py,
              size,
              width: advance * xScale,
            });
          }

          x += advance;
        }

        textMatrix = compose(textMatrix, translate(x, 0));
      };

      for (let i = 0; i < operatorList.fnArray.length; i++) {
        const args = operatorList.argsArray[i] as unknown[];

        switch (opNames.get(operatorList.fnArray[i])) {
          case 'save':
            stack.push(state);
            state = { ...state };
            break;
          case 'restore':
            state = stack.pop() ?? { ctm: IDENTITY };
            break;
          case 'transform':
            state.ctm = compose(state.ctm, toMatrix(args));
            break;
          case 'beginText':
            textMatrix = IDENTITY;
            lineMatrix = IDENTITY;
            break;
          case 'setFont': {
            const id = args[0] as string;
            const font = page.commonObjs.has(id)
              ? (page.commonObjs.get(id) as {
                  name?: string;
                  fontMatrix?: number[];
                })
              : null;
            fontName = (font?.name ?? '').replace(/^[A-Z]{6}\+/, '');
            fontMatrixScale = font?.fontMatrix?.[0] ?? 0.001;
            fontSize = args[1] as number;
            break;
          }
          case 'setTextMatrix':
            textMatrix = toMatrix(args);
            lineMatrix = textMatrix;
            break;
          case 'moveText':
            moveText(args[0] as number, args[1] as number);
            break;
          case 'setLeadingMoveText':
            leading = -(args[1] as number);
            moveText(args[0] as number, args[1] as number);
            break;
          case 'setLeading':
            leading = args[0] as number;
            break;
          case 'nextLine':
            moveText(0, -leading);
            break;
          case 'setCharSpacing':
            charSpacing = args[0] as number;
            break;
          case 'setWordSpacing':
            wordSpacing = args[0] as number;
            break;
          case 'setHScale':
            horizontalScale = (args[0] as number) / 100;
            break;
          case 'setTextRise':
            rise = args[0] as number;
            break;
          case 'showText':
          case 'showSpacedText':
            showText(args[0] as (PdfJsGlyph | number)[]);
            break;
          case 'nextLineShowText':
            moveText(0, -leading);
            showText(args[0] as (PdfJsGlyph | number)[]);
            break;
          case 'nextLineSetSpacingShowText':
            wordSpacing = args[0] as number;
            charSpacing = args[1] as number;
            moveText(0, -leading);
            showText(args[2] as (PdfJsGlyph | number)[]);
            break;
        }
      }

      pages.push({ width: viewport.width, height: viewport.height, glyphs });
      page.cleanup();
    }

    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

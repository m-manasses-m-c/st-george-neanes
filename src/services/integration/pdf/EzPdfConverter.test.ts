import { describe, expect, it } from 'vitest';

import {
  DropCapElement,
  MartyriaElement,
  ModeKeyElement,
  NoteElement,
} from '@/models/Element';
import {
  GorgonNeume,
  Ison,
  Note,
  QuantitativeNeume,
  RootSign,
  TimeNeume,
} from '@/models/Neumes';
import { getNeumeValue } from '@/models/NeumeValues';
import { Scale, ScaleNote } from '@/models/Scales';
import type { NoteAtomNode } from '@/services/audio/AnalysisService';
import { AnalysisService, NodeType } from '@/services/audio/AnalysisService';

import {
  alignSyllables,
  EzPdfConverter,
  scaleFromRootSign,
} from './EzPdfConverter';
import type { PdfGlyph, PdfPage } from './PdfPageModel';

// Coordinates below are taken from a real Word document typeset with the EZ
// fonts: neumes at 21.96pt on a baseline, lyrics at 12pt about 14pt below.
const NEUME_SIZE = 21.96;
const BASELINE = 262.58;
const LYRIC_BASELINE = 276.6;

/** A character in one of the EZ fonts, typed with keyboard key `key`. */
function ez(font: string, key: string, x: number, y = BASELINE): PdfGlyph {
  return {
    font,
    text: String.fromCodePoint(0xf000 + key.charCodeAt(0)),
    x,
    y,
    size: NEUME_SIZE,
    width: 0,
  };
}

/** A run of lyric text starting at x, each character `charWidth` wide. */
function lyric(text: string, x: number, charWidth = 6): PdfGlyph[] {
  return [...text].map((c, i) => ({
    font: 'EZOmega',
    text: c,
    x: x + i * charWidth,
    y: LYRIC_BASELINE,
    size: 12,
    width: charWidth,
  }));
}

function page(glyphs: PdfGlyph[]): PdfPage {
  return { width: 595.32, height: 841.92, glyphs };
}

function notes(elements: unknown[]) {
  return elements.filter((e): e is NoteElement => e instanceof NoteElement);
}

describe('EzPdfConverter', () => {
  const converter = new EzPdfConverter();

  it('reads notes, their marks and their lyrics', () => {
    const result = converter.convert([
      page([
        ez('EZ Psaltica', '3', 106.82), // oligon with kentima above
        ez('EZ Special-II', 'B', 140.06), // ison indicator Vou over it
        ez('EZ Psaltica', 'z', 140.06), // klasma over it
        ez('EZ Psaltica', '@', 140.18), // elafron
        ez('EZ Psaltica', '`', 167.54), // kentimata on its own
        ez('EZ Psaltica', '0', 183.74), // ison
        ez('EZ Psaltica', 'a', 217.25), // klasma over the ison
        ...lyric('s', 119.1, 4.6),
        ...lyric('An', 150.3),
        ...lyric('–', 168),
        ...lyric('an', 178),
        ...lyric(' -', 190.4, 3.3),
        ...lyric('jos', 197.1, 4.8),
      ]),
    ]);

    const [first, second, third, fourth] = notes(result.elements);

    expect(result.noteCount).toBe(4);
    expect(result.unknownGlyphs).toEqual([]);

    expect(first.quantitativeNeume).toBe(
      QuantitativeNeume.OligonPlusKentimaAbove,
    );
    expect(first.timeNeume).toBe(TimeNeume.Klasma_Top);
    expect(first.ison).toBe(Ison.Vou);
    expect(first.lyrics).toBe('s');

    expect(second.quantitativeNeume).toBe(QuantitativeNeume.Elaphron);
    expect(second.lyrics).toBe('An');

    expect(third.quantitativeNeume).toBe(QuantitativeNeume.Kentemata);
    expect(third.lyrics).toBe('an');

    expect(fourth.quantitativeNeume).toBe(QuantitativeNeume.Ison);
    expect(fourth.timeNeume).not.toBeNull();
    expect(fourth.lyrics).toBe('jos');
  });

  it('builds martyria from the note letter, root sign and dots', () => {
    const result = converter.convert([
      page([
        ez('EZ Psaltica', '1', 60),
        ez('EZ Psaltica', 'b', 111.98), // martyria note Vou
        ez('EZ Psaltica', 'B', 127.46), // root sign legetos
        ez('EZ Psaltica', '1', 140),
        ez('EZ Psaltica', 'm', 276.77), // martyria note Di (low variant)
        ez('EZ Psaltica', '<', 292.97), // dots
        ez('EZ Psaltica', 'C', 292.97), // root sign delta
      ]),
    ]);

    const martyria = result.elements.filter(
      (e): e is MartyriaElement => e instanceof MartyriaElement,
    );

    expect(martyria).toHaveLength(2);
    expect(martyria[0].note).toBe(Note.Vou);
    expect(martyria[0].rootSign).toBe(RootSign.Legetos);
    expect(martyria[0].auto).toBe(false);
    // EZ draws Di the same in every octave; the dotted delta (not its low
    // form) puts it in the middle octave.
    expect(martyria[1].note).toBe(Note.Thi);
    expect(martyria[1].rootSign).toBe(RootSign.DeltaDotted);
  });

  it('gives the score a mode key that leads to its first martyria', () => {
    const result = converter.convert([
      page([
        ez('EZ Psaltica', '1', 60), // oligon: one step up
        ez('EZ Psaltica', 'b', 111.98), // martyria Vou
        ez('EZ Psaltica', 'B', 127.46), // root sign legetos
      ]),
    ]);

    const modeKey = result.elements[0] as ModeKeyElement;

    expect(modeKey).toBeInstanceOf(ModeKeyElement);
    expect(modeKey.scaleNote).toBe(ScaleNote.Pa);
    expect(modeKey.scale).toBe(Scale.Diatonic);
  });

  it('picks the mode key template named by the mode heading', () => {
    const heading = 144;
    const result = converter.convert([
      page([
        ez('EZ Special-II', 'h', 255.8, heading), // the word "Echos"
        ez('EZ Psaltica', 'n', 284.3, heading),
        ez('EZ Psaltica', 'B', 299.6, heading), // legetos
        ez('EZ Oxeia', 'B', 318.3, heading), // "Vou"
        ez('EZ Psaltica', '0', 60), // ison: stays on the starting note
        ez('EZ Psaltica', 'b', 111.98), // martyria Vou
        ez('EZ Psaltica', 'B', 127.46),
      ]),
    ]);

    const modeKey = result.elements[0] as ModeKeyElement;

    // Mode 4 legetos on Vou, not the other templates that start on Vou.
    expect(modeKey.templateId).toBe(404);
    expect(modeKey.mode).toBe(4);
    expect(modeKey.scaleNote).toBe(ScaleNote.Vou);
  });

  it('keeps each martyria in the octave the melody has reached', () => {
    const result = converter.convert([
      page([
        ez('EZ Psaltica', 'b', 60), // martyria Vou
        ez('EZ Psaltica', 'B', 75.48),
        ez('EZ Psaltica', '1', 100), // up to Ga
        ez('EZ Psaltica', '1', 133.3), // up to Di
        ez('EZ Psaltica', 'm', 180), // martyria Di, the low-looking glyph
        ez('EZ Psaltica', 'C', 196.2), // plain delta root
      ]),
    ]);

    const martyria = result.elements.filter(
      (e): e is MartyriaElement => e instanceof MartyriaElement,
    );

    expect(martyria[1].note).toBe(Note.Thi);
  });

  it('reads a kentima typed beside the end of an oligon as two steps', () => {
    const result = converter.convert([
      page([ez('EZ Psaltica', '1', 100), ez('EZ Psaltica', '~', 139.5)]),
    ]);

    const [note] = notes(result.elements);

    expect(note.quantitativeNeume).toBe(QuantitativeNeume.OligonPlusKentima);
    expect(getNeumeValue(note.quantitativeNeume)).toBe(2);
  });

  it('splits a two-note neume when each note has its own syllable', () => {
    const glyphs = [ez('EZ Psaltica', 'o', 321.31)]; // oligon, kentimata below

    const together = converter.convert([
      page([...glyphs, ...lyric('tra', 330)]),
    ]);
    expect(notes(together.elements).map((n) => n.quantitativeNeume)).toEqual([
      QuantitativeNeume.KentemataPlusOligon,
    ]);
    expect(notes(together.elements)[0].lyrics).toBe('tra');

    const split = converter.convert([
      page([...glyphs, ...lyric('tra', 321), ...lyric('a', 345)]),
    ]);
    expect(
      notes(split.elements).map((n) => [n.quantitativeNeume, n.lyrics]),
    ).toEqual([
      [QuantitativeNeume.Kentemata, 'tra'],
      [QuantitativeNeume.Oligon, 'a'],
    ]);
  });

  it('splits a running elafron into notes with the same pitch and rhythm', () => {
    const result = converter.convert([
      page([
        ez('EZ Psaltica', '_', 483.1),
        ...lyric('tra', 483),
        ...lyric('a', 515),
      ]),
    ]);

    const split = notes(result.elements);

    expect(
      split.map((n) => [n.quantitativeNeume, n.gorgonNeume, n.lyrics]),
    ).toEqual([
      [QuantitativeNeume.Apostrophos, GorgonNeume.Gorgon_Top, 'tra'],
      [QuantitativeNeume.Apostrophos, null, 'a'],
    ]);
    // Together they descend as far as the running elafron does.
    expect(
      split.reduce((sum, n) => sum + getNeumeValue(n.quantitativeNeume)!, 0),
    ).toBe(getNeumeValue(QuantitativeNeume.RunningElaphron));
  });

  it('keeps a split gorgon where the unsplit neume would play it', () => {
    // From a real score: "que-e-o-o-os". The digorgon is drawn over the
    // oligon, then a running elafron brings its own gorgon.
    const result = converter.convert([
      page([
        ez('EZ Psaltica', 'o', 276.5), // oligon, kentimata below
        ez('EZ Psaltica', 'd', 309.8), // digorgon over it
        ez('EZ Psaltica', '!', 309.9), // apostrofos
        ez('EZ Psaltica', '_', 329.0), // running elafron
        ...lyric('que', 276),
        ...lyric('e', 300),
        ...lyric('o', 315),
        ...lyric('o', 337),
        ...lyric('os', 352),
      ]),
    ]);

    expect(
      notes(result.elements).map((n) => [
        n.quantitativeNeume,
        n.gorgonNeume,
        n.lyrics,
      ]),
    ).toEqual([
      [QuantitativeNeume.Kentemata, GorgonNeume.Digorgon, 'que'],
      [QuantitativeNeume.Oligon, null, 'e'],
      [QuantitativeNeume.Apostrophos, null, 'o'],
      [QuantitativeNeume.Apostrophos, GorgonNeume.Gorgon_Top, 'o'],
      [QuantitativeNeume.Apostrophos, null, 'os'],
    ]);

    // Every note still lasts a positive time, so playback never goes back.
    result.elements.forEach((e, i) => (e.index = i));
    const durations = AnalysisService.analyze(result.elements, false)
      .filter((n): n is NoteAtomNode => n.nodeType === NodeType.NoteAtomNode)
      .map((n) => n.duration);

    expect(durations.every((d) => d > 0)).toBe(true);
  });

  it('turns a large letter in a text font into a drop cap', () => {
    const result = converter.convert([
      page([
        {
          font: 'PFGoudyInitials',
          text: 'O',
          x: 36,
          y: BASELINE,
          size: 80,
          width: 70,
        },
        ez('EZ Psaltica', '1', 106.82),
        ...lyric('s', 119.1),
      ]),
    ]);

    expect(result.elements[0]).toBeInstanceOf(DropCapElement);
    expect((result.elements[0] as DropCapElement).content).toBe('O');
    expect(notes(result.elements)[0].lyrics).toBe('s');
  });

  it('reads characters from the rest of the EZ font package', () => {
    const result = converter.convert([
      page([
        ez('EZ Oxeia', '@', 100), // oxeia with elafron
        ez('EZ Special-I', '5', 140), // gorgon over oligon, yporroi, kentimata
        ez('EZ Psaltica', '1', 180),
        ez('EZ Psaltica', 'D', 214), // plain digorgon, drawn back over it
      ]),
    ]);

    expect(result.unknownGlyphs).toEqual([]);
    expect(
      notes(result.elements).map((n) => [n.quantitativeNeume, n.gorgonNeume]),
    ).toEqual([
      [QuantitativeNeume.OligonPlusElaphron, null],
      [
        QuantitativeNeume.OligonPlusHyporoePlusKentemata,
        GorgonNeume.Gorgon_Top,
      ],
      [QuantitativeNeume.Oligon, GorgonNeume.Digorgon],
    ]);
  });

  it('reports EZ characters it does not know and finds no notes in plain text', () => {
    const result = converter.convert([
      page([ez('EZ Psaltica', 'é', 100), ...lyric('Hello', 100)]),
    ]);

    expect(result.noteCount).toBe(0);
    expect(result.unknownGlyphs).toEqual(["EZ Psaltica 'é'"]);
  });
});

describe('scaleFromRootSign', () => {
  it.each([
    [RootSign.Legetos, Scale.Diatonic],
    [RootSign.DeltaDottedLow, Scale.Diatonic],
    [RootSign.Tilt, Scale.HardChromatic],
    [RootSign.SquiggleLow, Scale.HardChromatic],
    [RootSign.SoftChromaticPaRootSign, Scale.SoftChromatic],
    [RootSign.Zygos, Scale.Zygos],
  ])('%s belongs to %s', (rootSign, scale) => {
    expect(scaleFromRootSign(rootSign)).toBe(scale);
  });
});

describe('alignSyllables', () => {
  const syllable = (text: string, x: number) => ({ text, x0: x, x1: x + 10 });

  it('keeps order and leaves melismatic notes without a syllable', () => {
    const pairs = alignSyllables(
      [syllable('a', 0), syllable('men', 95)],
      [5, 35, 65, 100],
    );

    expect(pairs.map(([slot, s]) => [slot, s.text])).toEqual([
      [0, 'a'],
      [3, 'men'],
    ]);
  });

  it('never gives two syllables the same note when there are enough notes', () => {
    // Both syllables are closest to the first note.
    const pairs = alignSyllables([syllable('a', 0), syllable('b', 4)], [6, 60]);

    expect(pairs.map(([slot]) => slot)).toEqual([0, 1]);
  });
});

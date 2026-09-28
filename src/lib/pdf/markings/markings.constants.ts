import type {
  MarkingOptions,
  MarkingsExportKind,
} from '#/lib/pdf/markings/markings.types';

/** A bare number, with or without the brackets some engravers box them in. */
export const BARE_NUMBER = /^[([{]?\s*(\d{1,4})\s*[)\]}]?$/;

export const TIME_SIG_DIGIT = /^\d{1,2}$/;

// SMuFL U+E080–U+E089 encode the time-signature digits 0–9 as private-use
// glyphs. pdf.js surfaces them as their raw code points, not as ASCII.
export const SMUFL_TS_BASE = 0xe080;

/**
 * A beat and its rate: "q = 108", "Andante = 96", "♩ = c. 60-72". The note glyph
 * often reaches the text layer as nothing at all, so only the "=" and the number
 * after it are looked for.
 */
export const METRONOME_MARK = /=\s*(?:c(?:irc)?a?\.?\s*)?\d/i;

/** How much of a group has to agree before it is read as a numbering. */
export const AGREEMENT = 0.8;

export const DEFAULT_MARKINGS: MarkingOptions = {
  reach: 2.5,
  sideReach: 1.5,
  padding: 1.5,
};

/** How many neighbouring bars either side may vouch for a printed number. */
export const CORROBORATION_REACH = 3;

export const EXPORT_SUFFIX: Record<MarkingsExportKind, string> = {
  'time-signature': 'time-signature-map',
  tempo: 'tempo-map',
};

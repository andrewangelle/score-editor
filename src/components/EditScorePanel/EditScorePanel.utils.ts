import {
  FINDING_SECTIONS,
  FINISHING_ANALYSIS,
} from '#/components/EditScorePanel/EditScorePanel.constants';
import type { Part } from '#/lib/pdf/partExtraction';

/** Sections are counted over the whole document, so they wait for it. */
export function getDetectedPartsMessage(
  parts: Part[],
  instruments: number,
  complete: boolean,
) {
  return complete
    ? `${parts.length} staves · ${instruments} sections detected`
    : `${parts.length} staves · ${FINDING_SECTIONS}`;
}

export function getFinishingAnalysisMessage(
  progress: { analysed: number; total: number } | null,
) {
  if (!progress || progress.analysed >= progress.total) {
    return FINISHING_ANALYSIS;
  }
  return `${FINISHING_ANALYSIS} ${progress.analysed} of ${progress.total} pages`;
}

export function getDetectionDescription(markings: {
  measure: number;
  tempo: number;
  timeSignature: number;
}) {
  return `${markings.measure} measure ${
    markings.measure === 1 ? 'number' : 'numbers'
  } · ${markings.timeSignature} time ${
    markings.timeSignature === 1 ? 'signature' : 'signatures'
  } · ${markings.tempo} tempo ${
    markings.tempo === 1 ? 'mark' : 'marks'
  } found. A score prints these for the system as a whole, so they are stamped above every part cut from it.`;
}

export function getBusyMessage(isBusy: boolean, regionCount: number) {
  return isBusy
    ? 'Extracting…'
    : `Extract ${regionCount} ${regionCount === 1 ? 'region' : 'regions'}`;
}

export function getPartNameLabel(ordinal: number) {
  return `Name for staff ${ordinal + 1}`;
}

/** Follows the file name in the confirmation, which opens with `REPLACE`. */
export function getReplaceConfirmMessage(regionCount: number) {
  return `with the ${regionCount} ${
    regionCount === 1 ? 'region' : 'regions'
  }? The score in that file is overwritten, and only this tab still has it.`;
}

export function getExtractIntoMessage(name: string) {
  return `Extract into ${name}`;
}

export function getIrregularSystemsMessage(
  irregularCount: number,
  firstPageIndex: number,
) {
  return `${irregularCount} ${
    irregularCount === 1 ? 'system has' : 'systems have'
  } a different number of staves than the first. Those systems are extracted by staff position, so check the result around page ${firstPageIndex + 1}.`;
}

export function getAnnotationCountMessage(annotationCount: number) {
  return `${annotationCount} placed · double-click to edit, drag to move`;
}

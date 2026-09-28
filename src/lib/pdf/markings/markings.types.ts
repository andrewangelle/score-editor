import type { PageTextItem, Rect } from '#/lib/pdf/staffDetection';

export type MarkingKind =
  | 'measure'
  | 'tempo'
  | 'time-signature'
  | 'rehearsal'
  | 'direction';

export type Marking = {
  id: string;
  kind: MarkingKind;
  text: string;
  pageIndex: number;
  systemIndex: number;
  rect: Rect;
};

export type MarkingOptions = {
  /** How far beyond a staff's outermost line a marking may sit, in staff heights. */
  reach: number;
  /** How far outside the system's horizontal span a marking may sit. */
  sideReach: number;
  padding: number;
};

export type Candidate = {
  pageIndex: number;
  systemIndex: number;
  staffIndex: number;
  side: 'above' | 'below' | 'on';
  text: string;
  rect: Rect;
  offset: number;
  rightGap: number;
  size: number;
  value: number | null;
  /** Enclosed by a stroked outline, as a rehearsal mark is by its box. */
  framed: boolean;
};

export type TimeSigPair = {
  numerator: PageTextItem;
  denominator: PageTextItem;
  rect: Rect;
  text: string;
};

export type MarkingsRow = {
  measure: number | null;
  measureMarking: Marking | null;
  eventMarkings: Marking[];
};

/** What a markings export maps: the time signatures, or the tempo marks. */
export type MarkingsExportKind = Extract<
  MarkingKind,
  'time-signature' | 'tempo'
>;

export type MarkingsExportResult = {
  rows: MarkingsRow[];
  measuresInferred: boolean;
};

export type MarkingsExportOptions = {
  pageSize?: { width: number; height: number };
  margin?: number;
  rowGap?: number;
};

/** A bar's place in the document: which system, and which bar across it. */
export type BarPosition = { system: number; bar: number };

export type Anchor = BarPosition & { value: number; marking: Marking };

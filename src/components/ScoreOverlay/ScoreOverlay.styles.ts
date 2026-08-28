import {
  ANNOTATION_COLORS,
  type AnnotationColor,
  type AnnotationKind,
  DEFAULT_COLOR,
  DEFAULT_SIZE,
} from '#/lib/pdf/annotations';

export function getSurfaceStyles(interactive: boolean, placing: boolean) {
  let baseClass = 'absolute inset-0';

  if (!interactive) {
    baseClass += ' pointer-events-none';
  }

  if (placing) {
    baseClass += ' cursor-crosshair';
  }

  return baseClass;
}

/**
 * Holds a mark at its anchor, lifted by exactly its own height so the anchor is
 * the mark's bottom edge — the same rule the value riding the cursor is drawn by.
 */
export const ANNOTATION_ANCHOR_CLASS = 'absolute flex -translate-y-full';

export function getAnnotationStyles(circled: boolean) {
  let baseClass =
    'cursor-move whitespace-nowrap bg-white/80 font-medium leading-none hover:bg-white';

  if (circled) {
    baseClass += ' flex items-center justify-center rounded-full border';
  } else {
    baseClass += ' rounded px-1';
  }

  return baseClass;
}

export const STAFF_HINT_CLASS =
  'pointer-events-none absolute border-slate-400/40 border-l-2 bg-slate-900/4';

export const STAFF_LABEL_CLASS =
  'absolute bottom-0.5 left-1 font-medium text-[10px] text-slate-500';

/**
 * The value riding the cursor before it is put down. Fixed rather than absolute
 * so it is positioned straight from the pointer's client coordinates, and lifted
 * a whole line so it sits exactly where the click will leave it.
 */
export function getCursorMarkStyles(circled: boolean) {
  let baseClass =
    'pointer-events-none fixed z-50 -translate-y-full whitespace-nowrap font-medium leading-none opacity-80';

  if (circled) {
    baseClass += ' flex items-center justify-center rounded-full border';
  } else {
    baseClass += ' rounded px-1';
  }

  return baseClass;
}

export function cursorMarkInk(
  kind: AnnotationKind,
  color: AnnotationColor,
  scale: number,
) {
  const fontSize = Math.max(7, DEFAULT_SIZE[kind] * scale);
  const css = (ANNOTATION_COLORS[color] ?? ANNOTATION_COLORS[DEFAULT_COLOR])
    .css;

  return kind === 'string'
    ? {
        fontSize,
        color: css,
        borderColor: css,
        width: fontSize * 1.8,
        height: fontSize * 1.8,
      }
    : { fontSize, color: css };
}

export const DRAFT_INPUT_CLASS =
  'w-32 rounded border border-blue-400 bg-white px-1 py-0.5 text-xs shadow';

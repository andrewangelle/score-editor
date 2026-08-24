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

export const DRAFT_INPUT_CLASS =
  'w-32 rounded border border-blue-400 bg-white px-1 py-0.5 text-xs shadow';

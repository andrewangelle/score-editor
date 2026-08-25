import type { Edge } from '#/lib/pdf/regions';

export function getSurfaceStyles(interactive: boolean, dragging: boolean) {
  let baseClass = 'absolute inset-0';

  if (!interactive) {
    baseClass += ' pointer-events-none';
  } else if (!dragging) {
    baseClass += ' cursor-crosshair';
  }

  return baseClass;
}

export function getRegionStyles(isSelected: boolean) {
  let baseClass = 'absolute border-2';

  if (isSelected) {
    baseClass += ' border-blue-600 bg-blue-500/10';
  } else {
    baseClass += ' border-blue-400/70 bg-blue-400/5';
  }

  return baseClass;
}

export function getEdgeHandleStyles(edge: Edge) {
  let baseClass = 'absolute';

  if (edge === 'top' || edge === 'bottom') {
    baseClass += ' left-0 h-2 w-full cursor-ns-resize';
  } else {
    baseClass += ' top-0 h-full w-2 cursor-ew-resize';
  }

  return baseClass;
}

export const MOVE_HANDLE_CLASS =
  'absolute inset-0 size-full cursor-move disabled:cursor-default';

export const REGION_LABEL_CLASS =
  'pointer-events-none absolute top-0.5 left-1 rounded bg-white/75 px-1 font-medium text-[10px] text-blue-800';

export const REMOVE_BUTTON_CLASS =
  '-top-3 -right-3 absolute size-6 rounded-full border border-slate-300 bg-white text-slate-600 text-xs shadow hover:bg-red-50 hover:text-red-700 cursor-pointer';

export const PREVIEW_CLASS =
  'pointer-events-none absolute border-2 border-blue-600 border-dashed bg-blue-500/10';

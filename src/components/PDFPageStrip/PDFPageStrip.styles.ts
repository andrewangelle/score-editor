export const PAGE_LIST_CLASS = 'flex h-full flex-col gap-3 overflow-y-auto p-3';

export function getThumbnailStyles(isSelected: boolean) {
  let baseClass =
    'block w-full rounded-lg border-2 bg-white p-1 transition-colors';

  if (isSelected) {
    baseClass += ' border-blue-500 ring-2 ring-blue-200';
  } else {
    baseClass += ' border-slate-200 hover:border-slate-400';
  }

  return baseClass;
}

export const PAGE_LABEL_CLASS = 'mt-1 block text-center text-xs text-slate-500';

export const PAGE_CONTROLS_CLASS =
  'mt-1 flex items-center justify-center gap-0.5';

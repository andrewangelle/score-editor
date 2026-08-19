export function getDragContainerStyles(isDragging: boolean, disabled: boolean) {
  let baseClass =
    'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors';

  if (isDragging) {
    baseClass += ' border-blue-500 bg-blue-50';
  } else {
    baseClass += ' border-slate-300 bg-slate-50';
  }

  if (disabled) {
    baseClass += ' opacity-60';
  }

  return baseClass;
}

export const CHOOSE_FILE_BUTTON_CLASS =
  'mt-2 rounded-lg bg-slate-900 px-4 py-2 font-medium text-sm text-white hover:bg-slate-700 disabled:opacity-60';

export const CHOOSE_FILE_INPUT_LABEL_CLASS =
  'mt-2 cursor-pointer rounded-lg bg-slate-900 px-4 py-2 font-medium text-sm text-white hover:bg-slate-700';

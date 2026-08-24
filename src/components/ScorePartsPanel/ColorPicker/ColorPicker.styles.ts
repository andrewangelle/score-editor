export const COLOR_PICKER_FIELDSET_CLASS = 'mt-3 flex items-center gap-2';

export function getSwatchStyles(selected: boolean) {
  let baseClass =
    'block size-5 rounded-full transition-shadow peer-focus-visible:ring-2 peer-focus-visible:ring-slate-900 peer-focus-visible:ring-offset-2';

  if (selected) {
    baseClass += ' ring-2 ring-slate-900 ring-offset-2';
  } else {
    baseClass += ' ring-1 ring-slate-300 hover:ring-slate-400';
  }

  return baseClass;
}

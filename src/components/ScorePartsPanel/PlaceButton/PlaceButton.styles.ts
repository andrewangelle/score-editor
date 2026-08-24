export function getPlaceButtonStyles(active: boolean) {
  let baseClass =
    'flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors';

  if (active) {
    baseClass += ' border-blue-500 bg-blue-50 text-blue-700';
  } else {
    baseClass += ' border-slate-300 text-slate-700 hover:border-slate-400';
  }

  return baseClass;
}

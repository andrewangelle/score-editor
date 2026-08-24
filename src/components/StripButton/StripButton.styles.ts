export function getStripButtonStyles(destructive: boolean) {
  let baseClass =
    'h-6 w-6 rounded text-xs leading-none text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30';

  if (destructive) {
    baseClass += ' hover:bg-red-100 hover:text-red-700';
  }

  return baseClass;
}

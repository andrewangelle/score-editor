/**
 * The strip reveals itself the way the save-a-copy prompt does — same grid-rows
 * collapse, same place in the header — so the header only ever grows downwards.
 */
export function getValueMenuRevealStyles(open: boolean) {
  const base = 'grid overflow-hidden duration-200 ease-out';

  return open
    ? `${base} visible grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] motion-reduce:transition-none`
    : `${base} invisible grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity,visibility] motion-reduce:transition-none`;
}

export const VALUE_MENU_ROW_CLASS =
  'flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2';

export const VALUE_MENU_LABEL_CLASS =
  'shrink-0 font-medium text-slate-700 text-sm';

export const VALUE_MENU_GROUP_CLASS = 'flex flex-wrap items-center gap-1.5';

/**
 * `circled` follows the mark itself: a string number is engraved in a circle,
 * so the choice it is picked from is one too, and the menu reads as the thing
 * it places rather than as a row of buttons.
 */
export function getValueChoiceStyles(selected: boolean, circled: boolean) {
  let baseClass =
    'flex size-8 items-center justify-center border font-medium text-sm transition-colors cursor-pointer';

  baseClass += circled ? ' rounded-full' : ' rounded-lg';

  if (selected) {
    baseClass += ' border-blue-500 bg-blue-600 text-white';
  } else {
    baseClass +=
      ' border-slate-300 bg-white text-slate-700 hover:border-slate-400';
  }

  return baseClass;
}

export const VALUE_MENU_HINT_CLASS = 'ml-auto text-slate-500 text-xs';

export const VALUE_MENU_DISMISS_BUTTON_CLASS =
  'shrink-0 rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800 cursor-pointer';

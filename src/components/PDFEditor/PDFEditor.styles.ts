export const INTRO_CONTAINER_CLASS = 'mx-auto max-w-2xl px-6 py-16';

export const INTRO_ERROR_CLASS =
  'mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700';

export const HEADER_CLASS =
  'flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3';

export const SAVE_BUTTON_CLASS =
  'rounded-lg bg-blue-600 px-4 py-2 font-medium text-sm text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed';

export function getSaveCopyRevealStyles(open: boolean) {
  const base = 'grid overflow-hidden duration-200 ease-out';

  return open
    ? `${base} visible grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] motion-reduce:transition-none`
    : `${base} invisible grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity,visibility] motion-reduce:transition-none`;
}

export const SAVE_COPY_FORM_CLASS =
  'flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2';

export const SAVE_COPY_NAME_INPUT_CLASS =
  'min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none';

export const SAVE_COPY_SUBMIT_CLASS =
  'rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-blue-500 cursor-pointer';

export const SAVE_COPY_CANCEL_CLASS =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 text-sm hover:border-slate-400 cursor-pointer';

export const STATUS_MESSAGE_CLASS =
  'flex items-center gap-3 border-b border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800';

export const STATUS_DISMISS_BUTTON_CLASS =
  'shrink-0 rounded p-1 text-green-700 hover:bg-green-100 hover:text-green-900 cursor-pointer';

/** The stand-in shown while detection runs, and when it comes back empty. */
export const PARTS_ASIDE_CLASS =
  'w-64 shrink-0 border-slate-200 border-l bg-white p-4';

export const ERROR_MESSAGE_CLASS =
  'border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700';

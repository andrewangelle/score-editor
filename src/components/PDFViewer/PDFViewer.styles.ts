export const VIEWER_MESSAGE_CLASS = 'p-8 text-slate-500 text-sm';

export const VIEWER_ERROR_CLASS = 'p-8 text-red-700 text-sm';

export const DOCUMENT_CLASS = 'flex min-h-0 flex-1';

export const PAGE_NAV_CLASS =
  'w-40 shrink-0 overflow-y-auto border-slate-200 border-r bg-slate-100';

/**
 * Horizontal padding only: the page list spaces pages vertically itself. The
 * horizontal half stays because `usePageWidth` sizes pages to the content box,
 * so dropping it would widen every page.
 */
export const STAGE_CLASS =
  'flex-1 overflow-auto overscroll-contain bg-slate-200 px-4';

export const PAGE_LIST_CLASS = 'relative w-full';

/**
 * Positioned with `top`, not a transform: a transformed ancestor would become
 * the containing block for the `fixed` mark that follows the cursor.
 */
export const PAGE_SLOT_CLASS = 'absolute left-0 w-full';

export const PAGE_FRAME_CLASS = 'relative mx-auto w-fit bg-white shadow-lg';

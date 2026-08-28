import type { AnnotationKind } from '#/lib/pdf/annotations';

export function getAnnotationSelectionPrompt(value: string | null) {
  if (value) {
    return `Click the page to place ${value}. Pick it again to type instead.`;
  }

  return 'Pick a number to place it by clicking, or click the page to type one.';
}

/** Whether a keystroke landed somewhere text is being typed. */
export function isTextField(target: HTMLElement) {
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

export const MENU_LABEL: Record<AnnotationKind, string> = {
  fingering: 'Fingering',
  string: 'String',
  position: 'Position',
  note: 'Performance note',
};

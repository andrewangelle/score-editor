import {
  getAnnotationSelectionPrompt,
  isTextField,
} from '#/components/AnnotationValueMenu/AnnotationValueMenu.utils';

/** Enough of an element for the guard, which only reads these three. */
function element(tagName: string, isContentEditable = false) {
  return { tagName, isContentEditable } as HTMLElement;
}

describe('isTextField', () => {
  it('recognises the fields Escape already means something in', () => {
    // The mark being typed and the save-a-copy name are both plain inputs.
    expect(isTextField(element('INPUT'))).toBe(true);
    expect(isTextField(element('TEXTAREA'))).toBe(true);
    expect(isTextField(element('DIV', true))).toBe(true);
  });

  it('lets a keystroke anywhere else dismiss the menu', () => {
    expect(isTextField(element('BODY'))).toBe(false);
    expect(isTextField(element('BUTTON'))).toBe(false);
    expect(isTextField(element('DIV'))).toBe(false);
  });
});

describe('getAnnotationSelectionPrompt', () => {
  it('names the value that will be placed once one is picked', () => {
    expect(getAnnotationSelectionPrompt('3')).toContain('3');
  });

  it('asks for one when nothing is picked', () => {
    expect(getAnnotationSelectionPrompt(null)).toContain('Pick a number');
  });
});

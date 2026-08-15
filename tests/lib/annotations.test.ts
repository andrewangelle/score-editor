/**
 * The shorthand a guitarist writes on a score.
 *
 * Fingerings, string numbers and left-hand positions are all "a digit or two",
 * and what keeps them apart once they are on the page is how they are set: the
 * form each one takes, and the size it takes it at. Both are decided here, so
 * both are pinned here.
 */

import {
  createAnnotation,
  DEFAULT_SIZE,
  normalizeAnnotationText,
  toRomanNumeral,
} from '#/lib/pdf/annotations';

describe('sizes', () => {
  it('ranks the shorthand: fingering, then string, then position', () => {
    // The order is the point — a fingering belongs to one notehead, a position
    // to a whole passage — so it is asserted as an order, not as three numbers.
    expect(DEFAULT_SIZE.fingering).toBeLessThan(DEFAULT_SIZE.string);
    expect(DEFAULT_SIZE.string).toBeLessThan(DEFAULT_SIZE.position);
  });
});

describe('toRomanNumeral', () => {
  it('converts the positions a left hand can reach', () => {
    expect(toRomanNumeral(1)).toBe('I');
    expect(toRomanNumeral(4)).toBe('IV');
    expect(toRomanNumeral(7)).toBe('VII');
    expect(toRomanNumeral(9)).toBe('IX');
    expect(toRomanNumeral(12)).toBe('XII');
    expect(toRomanNumeral(20)).toBe('XX');
  });

  it('refuses anything that is not a position', () => {
    for (const value of [0, -3, 21, 4.5, Number.NaN]) {
      expect(toRomanNumeral(value)).toBeNull();
    }
  });
});

describe('normalizeAnnotationText', () => {
  it('sets a position as a roman numeral, however it was typed', () => {
    expect(normalizeAnnotationText('position', '5')).toBe('V');
    expect(normalizeAnnotationText('position', ' 12 ')).toBe('XII');
    expect(normalizeAnnotationText('position', 'vii')).toBe('VII');
    expect(normalizeAnnotationText('position', 'IX')).toBe('IX');
  });

  it('drops a position number no hand reaches', () => {
    // Better an empty mark the overlay then removes than "XXXXXXX" engraved
    // across the staff.
    expect(normalizeAnnotationText('position', '40')).toBe('');
  });

  it('keeps a string identifier to the number itself', () => {
    expect(normalizeAnnotationText('string', '3')).toBe('3');
    expect(normalizeAnnotationText('string', 'string 6')).toBe('6');
    // Nothing else fits inside the circle.
    expect(normalizeAnnotationText('string', '12345')).toBe('12');
    expect(normalizeAnnotationText('string', 'sul G')).toBe('');
  });

  it('leaves fingerings and prose alone but for their edges', () => {
    expect(normalizeAnnotationText('fingering', ' 1 3 2 4 ')).toBe('1 3 2 4');
    expect(normalizeAnnotationText('note', ' let ring ')).toBe('let ring');
  });
});

describe('createAnnotation', () => {
  it('normalizes the text it is given', () => {
    expect(createAnnotation(0, 10, 20, 'position', '7').text).toBe('VII');
  });

  it('takes its size from its kind', () => {
    expect(createAnnotation(0, 10, 20, 'string').size).toBe(DEFAULT_SIZE.string);
  });
});

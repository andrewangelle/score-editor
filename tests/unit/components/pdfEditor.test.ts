import { getLoadingStavesMessage } from '#/components/PDFEditor/PDFEditor.utils';

describe('getLoadingStavesMessage', () => {
  it('says only that it is looking before the page count is known', () => {
    expect(getLoadingStavesMessage(null)).toBe('Looking for staves...');
  });

  it('counts pages while they are being analysed', () => {
    expect(getLoadingStavesMessage({ analysed: 12, total: 80 })).toBe(
      'Looking for staves... 12 of 80 pages',
    );
    expect(getLoadingStavesMessage({ analysed: 0, total: 80 })).toBe(
      'Looking for staves... 0 of 80 pages',
    );
  });

  it('moves on to markings once every page is in', () => {
    expect(getLoadingStavesMessage({ analysed: 80, total: 80 })).toBe(
      'Reading markings...',
    );
  });
});

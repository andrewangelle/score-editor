import {
  getDetectedPartsMessage,
  getFinishingAnalysisMessage,
} from '#/components/EditScorePanel/EditScorePanel.utils';

const PARTS = [
  { id: 'part-0', ordinal: 0, name: 'Flute' },
  { id: 'part-1', ordinal: 1, name: 'Cello' },
];

describe('getDetectedPartsMessage', () => {
  it('counts sections once analysis is complete', () => {
    expect(getDetectedPartsMessage(PARTS, 6, true)).toBe(
      '2 staves · 6 sections detected',
    );
  });

  it('does not claim a section count while pages are still coming in', () => {
    expect(getDetectedPartsMessage(PARTS, 0, false)).toBe(
      '2 staves · finding sections',
    );
  });
});

describe('getFinishingAnalysisMessage', () => {
  it('counts pages while they are being analysed', () => {
    expect(getFinishingAnalysisMessage({ analysed: 3, total: 80 })).toBe(
      'Finishing analysis... 3 of 80 pages',
    );
  });

  it('drops the count once every page is in', () => {
    expect(getFinishingAnalysisMessage({ analysed: 80, total: 80 })).toBe(
      'Finishing analysis...',
    );
    expect(getFinishingAnalysisMessage(null)).toBe('Finishing analysis...');
  });
});

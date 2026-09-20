import { DEFAULT_SIZE } from '#/lib/pdf/annotations/annotations';
import {
  annotationPlaced,
  annotationSelected,
  annotationsSlice,
} from '#/store/annotations.slice';
import { selectAnnotationFontSizeValue } from '#/store/selectors';
import {
  annotationFontSizePicked,
  toolSlice,
  toolToggled,
} from '#/store/tool.slice';

const toolReduce = toolSlice.reducer;
const annReduce = annotationsSlice.reducer;

const TOOL_INIT = toolReduce(undefined, { type: '@@init' });
const ANN_INIT = annReduce(undefined, { type: '@@init' });

function state(
  toolActions: Parameters<typeof toolReduce>[1][],
  annActions: Parameters<typeof annReduce>[1][] = [],
) {
  const tool = toolActions.reduce(toolReduce, TOOL_INIT);
  const annotations = annActions.reduce(annReduce, ANN_INIT);
  return { tool, annotations };
}

const placePosition = () =>
  annotationPlaced({ pageIndex: 0, x: 100, y: 400, kind: 'position' });

const placeFingering = () =>
  annotationPlaced({ pageIndex: 0, x: 100, y: 400, kind: 'fingering' });

describe('selectAnnotationFontSizeValue', () => {
  it('shows the kind default when a tool is active with nothing selected', () => {
    const s = state([toolToggled('position')]);

    expect(selectAnnotationFontSizeValue(s)).toBe(DEFAULT_SIZE.position);
  });

  it('shows empty when no tool is active and nothing is selected', () => {
    const s = state([]);

    expect(selectAnnotationFontSizeValue(s)).toBe('');
  });

  it('shows the selected annotation size, not the tool default', () => {
    const placed = placePosition();
    const s = state(
      [toolToggled('fingering')],
      [placed, annotationSelected(placed.payload.id)],
    );

    expect(selectAnnotationFontSizeValue(s)).toBe(DEFAULT_SIZE.position);
  });

  it('shows what the user typed over the selected annotation size', () => {
    const placed = placePosition();
    const s = state(
      [toolToggled('fingering'), annotationFontSizePicked(12)],
      [placed, annotationSelected(placed.payload.id)],
    );

    expect(selectAnnotationFontSizeValue(s)).toBe(12);
  });

  it('does not carry a stale size from one selection into another', () => {
    const pos = placePosition();
    const fin = placeFingering();
    const s = state(
      [
        toolToggled('position'),
        annotationFontSizePicked(9),
        // Apply would dispatch annotationResized here, then user selects another
        annotationSelected(fin.payload.id),
      ],
      [pos, fin, annotationSelected(fin.payload.id)],
    );

    expect(selectAnnotationFontSizeValue(s)).toBe(DEFAULT_SIZE.fingering);
  });

  it('shows the kind default after deselecting', () => {
    const placed = placePosition();
    const s = state(
      [
        toolToggled('fingering'),
        annotationFontSizePicked(12),
        annotationSelected(null),
      ],
      [placed, annotationSelected(placed.payload.id), annotationSelected(null)],
    );

    expect(selectAnnotationFontSizeValue(s)).toBe(DEFAULT_SIZE.fingering);
  });

  it('shows the annotation size when no tool is active', () => {
    const fin = placeFingering();
    const s = state(
      [annotationFontSizePicked(8.5), annotationSelected(fin.payload.id)],
      [fin, annotationSelected(fin.payload.id)],
    );

    expect(selectAnnotationFontSizeValue(s)).toBe(DEFAULT_SIZE.fingering);
  });
});

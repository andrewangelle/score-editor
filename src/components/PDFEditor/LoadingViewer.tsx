import { LOADING_VIEWER } from '#/components/PDFEditor/PDFEditor.constants';

export function LoadingViewer() {
  return <p className="p-8 text-sm text-slate-500">{LOADING_VIEWER}</p>;
}

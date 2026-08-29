export const WORKER_SRC = '/pdf.worker.min.mjs';

let configured: Promise<typeof import('react-pdf').pdfjs> | null = null;

export function loadPdfjs() {
  if (!configured) {
    configured = import('react-pdf').then(({ pdfjs }) => {
      pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
      return pdfjs;
    });
  }
  return configured;
}

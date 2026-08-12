/**
 * Single place that hands out a configured pdf.js.
 *
 * react-pdf touches browser globals as it is imported, so this must never be
 * evaluated during SSR — every export here is async and imports react-pdf
 * lazily, which makes the module itself safe to reference from server-rendered
 * components.
 */

/**
 * The worker is published as a plain file by the `pdf-worker` plugin in
 * `vite.config.ts` — see there for why it must not go through Vite's module
 * pipeline. A root-relative string, so evaluating it on the server is harmless.
 */
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

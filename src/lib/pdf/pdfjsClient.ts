/**
 * Single place that hands out a configured pdf.js.
 *
 * react-pdf touches browser globals as it is imported, so this must never be
 * evaluated during SSR — every export here is async and imports react-pdf
 * lazily, which makes the module itself safe to reference from server-rendered
 * components.
 */

/**
 * Vite resolves this to a hashed asset URL and bundles the worker for us. It is
 * plain URL construction, so evaluating it on the server is harmless.
 */
export const WORKER_SRC = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

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

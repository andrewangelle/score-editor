import { TaskAbortError, type TypedStartListening } from '@reduxjs/toolkit';
import { nextPage } from '#/lib/pdf/analysisOrder';
import type { documentBytes } from '#/lib/pdf/document/document.bytes';
import {
  type analyzePage,
  type finishAnalysis,
  getAnalyseScoreError,
  type openScoreDocument,
  type ScoreDocument,
  toStoredPage,
} from '#/lib/pdf/scoreAnalysis';
import type { PageStaves } from '#/lib/pdf/staffDetection';
import { documentClosed, documentOpened } from '#/store/document.slice';
import type { AppDispatch, RootState } from '#/store/index';
import {
  analysisStarted,
  scoreAnalysed,
  scoreAnalysisFailed,
  scorePageAnalysed,
} from '#/store/score.slice';

/** Injected so tests can run the runner against a fake document. */
export type AnalysisExtra = {
  openScoreDocument: typeof openScoreDocument;
  analyzePage: typeof analyzePage;
  finishAnalysis: typeof finishAnalysis;
  documentBytes: typeof documentBytes;
};

export type AnalysisStartListening = TypedStartListening<
  RootState,
  AppDispatch,
  AnalysisExtra
>;

/**
 * Detects the open document page by page, pages the reader can see first, and
 * caches each one for the overlay as it lands. The document-wide pass (markings,
 * parts, irregular systems) runs once every page is in.
 */
export function registerAnalysisListeners(
  startListening: AnalysisStartListening,
) {
  startListening({
    actionCreator: documentOpened,
    effect: async (action, api) => {
      api.cancelActiveListeners();

      const documentId = action.payload.id;
      const bytes = api.extra.documentBytes(documentId);
      if (!bytes) {
        return;
      }

      const { openScoreDocument, analyzePage, finishAnalysis } = api.extra;

      const run = api.fork(async (task) => {
        const opening = openScoreDocument(bytes);
        let doc: ScoreDocument | undefined;
        try {
          doc = await task.pause(opening);
          api.dispatch(
            analysisStarted({ documentId, pageCount: doc.numPages }),
          );

          // The record of what is finished. The store's pages have already
          // lost the `ink` and `text` that `finishAnalysis` reads.
          const detected: (PageStaves | undefined)[] = Array.from({
            length: doc.numPages,
          });
          const done = new Set<number>();

          for (;;) {
            const index = nextPage(
              done,
              api.getState().score.priority,
              doc.numPages,
            );
            if (index === null) {
              break;
            }

            const page = await task.pause(analyzePage(doc, index));
            detected[index] = page;
            done.add(index);
            api.dispatch(
              scorePageAnalysed({ documentId, page: toStoredPage(page) }),
            );

            // Lets the canvas paint and scroll events land, so the next turn
            // reads a fresh priority.
            await task.delay(0);
          }

          const analysis = await task.pause(
            finishAnalysis(doc, detected as PageStaves[]),
          );
          api.dispatch(scoreAnalysed({ documentId, analysis }));
        } catch (cause) {
          if (cause instanceof TaskAbortError) {
            throw cause;
          }
          api.dispatch(
            scoreAnalysisFailed({
              documentId,
              message: getAnalyseScoreError(cause),
            }),
          );
        } finally {
          if (doc) {
            await doc.destroy();
          } else {
            // Cancelled mid-open: the document still arrives, and must not leak.
            opening.then(
              (late) => late.destroy(),
              () => {},
            );
          }
        }
      });

      const outcome = await Promise.race([
        run.result,
        api.take(documentClosed.match).then(() => 'closed' as const),
      ]);
      if (outcome === 'closed') {
        run.cancel();
      }
    },
  });
}

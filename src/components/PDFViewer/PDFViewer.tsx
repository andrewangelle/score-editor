import { ClientOnly } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingViewer } from '#/components/PDFViewer/LoadingViewer';
import { useAnnotationKeyboard } from '#/hooks/useAnnotationKeyboard';
import {
  ScorePointerProvider,
  useCreateScorePointerRef,
} from '#/hooks/useScorePointer';
import { documentBytes } from '#/lib/pdf/document/document.bytes';
import { selectDocumentId } from '#/store/document.slice';
import { useAppSelector } from '#/store/hooks';

// react-pdf reaches for browser globals at import time, so it must never be
// evaluated during SSR — hence a dynamic import behind ClientOnly.
const PDFViewerContent = lazy(() =>
  import('./PDFViewerContent').then((module) => ({
    default: module.PDFViewerContent,
  })),
);

export function PDFViewer() {
  const documentId = useAppSelector(selectDocumentId);
  const bytes = documentBytes(documentId);
  const scorePointerRef = useCreateScorePointerRef();

  useAnnotationKeyboard(scorePointerRef);

  if (bytes) {
    return (
      <ScorePointerProvider value={scorePointerRef}>
        <ClientOnly fallback={<LoadingViewer />}>
          <Suspense fallback={<LoadingViewer />}>
            <PDFViewerContent bytes={bytes} />
          </Suspense>
        </ClientOnly>
      </ScorePointerProvider>
    );
  }

  return null;
}

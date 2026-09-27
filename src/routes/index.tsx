import { createFileRoute } from '@tanstack/react-router';
import { PDFEditor } from '#/components/PDFEditor/PDFEditor';
import { PDFPicker } from '#/components/PDFPicker/PDFPicker';
import { documentBytes } from '#/lib/pdf/document/document.bytes';
import { selectDocumentId } from '#/store/document.slice';
import { useAppSelector } from '#/store/hooks';

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({ meta: [{ title: 'Score Editor' }] }),
});

function Home() {
  const documentId = useAppSelector(selectDocumentId);
  const bytes = documentBytes(documentId);

  if (!bytes) {
    return <PDFPicker />;
  }

  return <PDFEditor />;
}

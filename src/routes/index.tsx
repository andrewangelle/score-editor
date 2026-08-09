import { createFileRoute } from '@tanstack/react-router';
import { PDFEditor } from '#/components/pdf/PDFEditor/PDFEditor';

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({ meta: [{ title: 'PDF Editor' }] }),
});

function Home() {
  return <PDFEditor />;
}

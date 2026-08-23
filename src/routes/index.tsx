import { createFileRoute } from '@tanstack/react-router';
import { PDFEditor } from '#/components/PDFEditor/PDFEditor';

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({ meta: [{ title: 'Score Editor' }] }),
});

function Home() {
  return <PDFEditor />;
}

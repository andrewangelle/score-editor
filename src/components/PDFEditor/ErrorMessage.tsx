import type { ReactNode } from 'react';
import { ERROR_MESSAGE_CLASS } from '#/components/PDFEditor/PDFEditor.styles';

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p className={ERROR_MESSAGE_CLASS} role="alert">
      {children}
    </p>
  );
}

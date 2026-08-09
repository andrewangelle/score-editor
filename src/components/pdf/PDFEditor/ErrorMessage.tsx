import type { ReactNode } from 'react';

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p
      className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
      role="alert"
    >
      {children}
    </p>
  );
}

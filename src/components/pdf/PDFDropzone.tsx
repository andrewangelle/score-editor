import { useId, useRef, useState } from 'react';
import { MAX_PDF_BYTES } from '#/lib/pdf/document';

type PdfDropzoneProps = {
  onFile: (file: File) => void;
  disabled?: boolean;
};

const megabytes = Math.round(MAX_PDF_BYTES / (1024 * 1024));

export function PDFDropzone({ onFile, disabled = false }: PdfDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);
  // Drag events fire for every child element, so track depth instead of a boolean.
  const dragDepth = useRef(0);

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (disabled) return;

    const file = event.dataTransfer.files.item(0);
    if (file) onFile(file);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target wraps a real file input, which carries the accessible affordance.
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled) setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setIsDragging(false);
      }}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
        isDragging
          ? 'border-blue-500 bg-blue-50'
          : 'border-slate-300 bg-slate-50'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <p className="text-lg font-medium text-slate-800">Drop a PDF here</p>
      <p className="text-sm text-slate-500">
        or choose one from your machine — up to {megabytes} MB
      </p>

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          // Reset so picking the same file again still fires a change event.
          event.target.value = '';
        }}
      />
      <label
        htmlFor={inputId}
        className="mt-2 cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Choose file
      </label>

      <p className="mt-2 text-xs text-slate-400">
        Your file stays in this browser tab. Nothing is uploaded to a server.
      </p>
    </div>
  );
}

import { useId, useRef, useState } from 'react';
import { MAX_PDF_BYTES } from '#/lib/pdf/document';
import {
  droppedFileHandle,
  type PdfFileHandle,
  pickPdfFile,
  supportsInPlaceSave,
} from '#/lib/pdf/fileAccess';

type PdfDropzoneProps = {
  /**
   * The handle is how the editor will offer to save back over the file. It is
   * null wherever the browser will not part with one; the file still opens.
   */
  onFile: (file: File, handle: PdfFileHandle | null) => void;
  /** For the one failure that happens before there is any file to report on. */
  onError: (message: string) => void;
  disabled?: boolean;
};

const megabytes = Math.round(MAX_PDF_BYTES / (1024 * 1024));

export function PDFDropzone({
  onFile,
  onError,
  disabled = false,
}: PdfDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);
  // Drag events fire for every child element, so track depth instead of a boolean.
  const dragDepth = useRef(0);
  // Read once on mount rather than per render: it cannot change under us, and
  // it must not differ between the server render and the first client one.
  const [canPick] = useState(supportsInPlaceSave);

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (disabled) return;

    const file = event.dataTransfer.files.item(0);
    if (!file) return;

    // The item list is cleared when this handler yields, so the handle has to
    // be asked for before the first await — hence reading the item out here.
    const item = event.dataTransfer.items[0];
    onFile(file, await droppedFileHandle(item));
  }

  async function handlePick() {
    try {
      // Null is the user closing the picker, which needs no comment from us.
      const picked = await pickPdfFile();
      if (picked) onFile(picked.file, picked.handle);
    } catch (cause) {
      onError(
        `The file picker could not be opened: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
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

      {/*
        Two ways in, and only one of them is shown. The system picker is worth
        preferring where it exists, because a file opened through it can be
        saved back over itself; the plain input can only ever be downloaded from.
      */}
      {canPick ? (
        <button
          type="button"
          onClick={handlePick}
          disabled={disabled}
          className="mt-2 rounded-lg bg-slate-900 px-4 py-2 font-medium text-sm text-white hover:bg-slate-700 disabled:opacity-60"
        >
          Choose file
        </button>
      ) : (
        <>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file, null);
              // Reset so picking the same file again still fires a change event.
              event.target.value = '';
            }}
          />
          <label
            htmlFor={inputId}
            className="mt-2 cursor-pointer rounded-lg bg-slate-900 px-4 py-2 font-medium text-sm text-white hover:bg-slate-700"
          >
            Choose file
          </label>
        </>
      )}

      <p className="mt-2 text-slate-400 text-xs">
        Your file stays in this browser tab. Nothing is uploaded to a server.
      </p>
    </div>
  );
}

import {
  type ChangeEvent,
  type DragEvent,
  useId,
  useRef,
  useState,
} from 'react';
import {
  CHOOSE_FILE_BUTTON_CLASS,
  CHOOSE_FILE_INPUT_LABEL_CLASS,
  getDragContainerStyles,
} from '#/components/PDFDropzone/PDFDropzone.styles';
import {
  CHOOSE_FILE,
  CHOOSE_FILE_DISCLAIMER,
  DROP_INSTRUCTION_DESCRIPTION,
  DROP_INSTRUCTION_HEADING,
  getFileOpenErrorMessage,
} from '#/components/PDFDropzone/PDFDropzone.utils';
import {
  droppedFileHandle,
  type PdfFileHandle,
  pickPdfFile,
  supportsInPlaceSave,
} from '#/lib/pdf/fileAccess';

type PdfDropzoneProps = {
  onFile: (file: File, handle: PdfFileHandle | null) => void;
  onError: (message: string) => void;
  disabled?: boolean;
};

export function PDFDropzone({
  onFile,
  onError,
  disabled = false,
}: PdfDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const [canPick] = useState(supportsInPlaceSave);

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);

    if (disabled) {
      return;
    }

    const file = event.dataTransfer.files.item(0);
    if (!file) {
      return;
    }

    const item = event.dataTransfer.items[0];
    onFile(file, await droppedFileHandle(item));
  }

  async function handlePick() {
    try {
      const picked = await pickPdfFile();
      if (picked) {
        onFile(picked.file, picked.handle);
      }
    } catch (cause) {
      onError(getFileOpenErrorMessage(cause));
    }
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    dragDepth.current += 1;

    if (!disabled) {
      setIsDragging(true);
    }
  }

  function onDragLeave(_event: DragEvent<HTMLDivElement>) {
    dragDepth.current -= 1;

    if (dragDepth.current <= 0) {
      setIsDragging(false);
    }
  }

  function onInputChange(
    event: ChangeEvent<HTMLInputElement, HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (file) {
      onFile(file, null);
    }

    // reset after handling
    event.target.value = '';
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target wraps a real file input, which carries the accessible affordance.
    <div
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={handleDrop}
      className={getDragContainerStyles(isDragging, disabled)}
    >
      <p className="text-lg font-medium text-slate-800">
        {DROP_INSTRUCTION_HEADING}
      </p>

      <p className="text-sm text-slate-500">{DROP_INSTRUCTION_DESCRIPTION}</p>

      {canPick && (
        <button
          type="button"
          onClick={handlePick}
          disabled={disabled}
          className={CHOOSE_FILE_BUTTON_CLASS}
        >
          {CHOOSE_FILE}
        </button>
      )}

      {!canPick && (
        <>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={disabled}
            onChange={onInputChange}
          />
          <label htmlFor={inputId} className={CHOOSE_FILE_INPUT_LABEL_CLASS}>
            {CHOOSE_FILE}
          </label>
        </>
      )}

      <p className="mt-2 text-slate-400 text-xs">{CHOOSE_FILE_DISCLAIMER}</p>
    </div>
  );
}

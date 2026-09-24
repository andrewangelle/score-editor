import { useEffect, useRef, useState } from 'react';
import {
  CANCEL,
  SAVE,
  SAVE_COPY_AS,
} from '#/components/PDFEditor/PDFEditor.constants';
import {
  getSaveCopyRevealStyles,
  SAVE_COPY_CANCEL_CLASS,
  SAVE_COPY_FORM_CLASS,
  SAVE_COPY_NAME_INPUT_CLASS,
  SAVE_COPY_SUBMIT_CLASS,
} from '#/components/PDFEditor/PDFEditor.styles';

type SaveCopyPromptProps = {
  open: boolean;
  suggestion: string;
  onSave: (typed: string) => void;
  onCancel: () => void;
  inputId?: string;
  label?: string;
};

export function SaveCopyPrompt({
  open,
  suggestion,
  onSave,
  onCancel,
  inputId = 'save-copy-name',
  label = SAVE_COPY_AS,
}: SaveCopyPromptProps) {
  const [typed, setTyped] = useState(suggestion);
  const inputRef = useRef<HTMLInputElement>(null);
  const [wasOpen, setWasOpen] = useState(open);

  useEffect(() => {
    if (open !== wasOpen) {
      setWasOpen(open);
      if (open) setTyped(suggestion);
    }
  }, [open, wasOpen, suggestion]);

  useEffect(() => {
    if (!open) return;

    const input = inputRef.current;
    if (!input) return;

    input.focus();
    input.setSelectionRange(0, input.value.replace(/\.pdf$/i, '').length);
  }, [open]);

  return (
    <div data-testid="SaveCopyPrompt" className={getSaveCopyRevealStyles(open)}>
      <div className="min-h-0">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(typed);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
          }}
          className={SAVE_COPY_FORM_CLASS}
        >
          <label
            htmlFor={inputId}
            className="font-medium text-slate-700 text-sm"
          >
            {label}
          </label>

          <input
            id={inputId}
            ref={inputRef}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className={SAVE_COPY_NAME_INPUT_CLASS}
          />

          <button type="submit" className={SAVE_COPY_SUBMIT_CLASS}>
            {SAVE}
          </button>

          <button
            type="button"
            onClick={onCancel}
            className={SAVE_COPY_CANCEL_CLASS}
          >
            {CANCEL}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
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
};

export function SaveCopyPrompt({
  open,
  suggestion,
  onSave,
  onCancel,
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
    <div className={getSaveCopyRevealStyles(open)}>
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
            htmlFor="save-copy-name"
            className="font-medium text-slate-700 text-sm"
          >
            Save copy as
          </label>

          <input
            id="save-copy-name"
            ref={inputRef}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className={SAVE_COPY_NAME_INPUT_CLASS}
          />

          <button type="submit" className={SAVE_COPY_SUBMIT_CLASS}>
            Save
          </button>

          <button
            type="button"
            onClick={onCancel}
            className={SAVE_COPY_CANCEL_CLASS}
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

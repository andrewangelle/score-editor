import { useState } from 'react';
import {
  SAVE_COPY_CANCEL_CLASS,
  SAVE_COPY_FORM_CLASS,
  SAVE_COPY_NAME_INPUT_CLASS,
  SAVE_COPY_SUBMIT_CLASS,
} from '#/components/PDFEditor/PDFEditor.styles';

type SaveCopyPromptProps = {
  /** What the copy would have been called; the box opens holding it. */
  suggestion: string;
  onSave: (typed: string) => void;
  onCancel: () => void;
};

export function SaveCopyPrompt({
  suggestion,
  onSave,
  onCancel,
}: SaveCopyPromptProps) {
  const [typed, setTyped] = useState(suggestion);

  return (
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
        ref={(input) => {
          if (!input) return;
          input.focus();
          input.setSelectionRange(0, input.value.replace(/\.pdf$/i, '').length);
        }}
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
  );
}

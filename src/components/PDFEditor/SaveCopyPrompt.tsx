import { useState } from 'react';

type SaveCopyPromptProps = {
  /** What the copy would have been called; the box opens holding it. */
  suggestion: string;
  onSave: (typed: string) => void;
  onCancel: () => void;
};

/**
 * Names the copy before it is written.
 *
 * A download cannot be taken back or renamed from here — the browser has put it
 * on disk by the time anything else runs — so the name is asked for on the way
 * out rather than corrected afterwards. It opens with the name the copy would
 * have had, selected up to the extension: pressing Enter is still the old
 * one-click save, and typing replaces just the part worth changing.
 */
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
      className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2"
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
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
      />

      <button
        type="submit"
        className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-blue-500"
      >
        Save
      </button>

      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 text-sm hover:border-slate-400"
      >
        Cancel
      </button>
    </form>
  );
}

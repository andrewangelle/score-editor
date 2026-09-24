import {
  STATUS_DISMISS_BUTTON_CLASS,
  STATUS_MESSAGE_CLASS,
} from '#/components/PDFEditor/PDFEditor.styles';
import {
  documentStatusDismissed,
  selectStatusMessage,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';

export function StatusMessage() {
  const dispatch = useAppDispatch();
  const statusMessage = useAppSelector(selectStatusMessage);

  return (
    <div className={STATUS_MESSAGE_CLASS} role="status">
      <p className="min-w-0 flex-1 truncate">{statusMessage}</p>

      <button
        type="button"
        onClick={() => dispatch(documentStatusDismissed())}
        title="Dismiss"
        aria-label="Dismiss"
        className={STATUS_DISMISS_BUTTON_CLASS}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          className="size-3.5"
        >
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}

import { useEffect, useState } from 'react';
import {
  getValueChoiceStyles,
  getValueMenuRevealStyles,
  VALUE_MENU_DISMISS_BUTTON_CLASS,
  VALUE_MENU_GROUP_CLASS,
  VALUE_MENU_HINT_CLASS,
  VALUE_MENU_LABEL_CLASS,
  VALUE_MENU_ROW_CLASS,
} from '#/components/AnnotationValueMenu/AnnotationValueMenu.styles';
import {
  getAnnotationSelectionPrompt,
  isTextField,
  MENU_LABEL,
} from '#/components/AnnotationValueMenu/AnnotationValueMenu.utils';
import {
  type AnnotationKind,
  annotationValueChoices,
  hasAnnotationValueMenu,
} from '#/lib/pdf/annotations';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import {
  annotationValuePicked,
  selectAnnotationValue,
  selectPlacing,
  toolToggled,
} from '#/store/tool.slice';

export function AnnotationValueMenu() {
  const dispatch = useAppDispatch();
  const placing = useAppSelector(selectPlacing);
  const value = useAppSelector(selectAnnotationValue);
  const kind = placing && hasAnnotationValueMenu(placing) ? placing : null;
  const [shown, setShown] = useState<AnnotationKind | null>(kind);

  const choices = shown ? annotationValueChoices(shown) : [];
  const label = shown ? MENU_LABEL[shown] : '';

  useEffect(() => {
    if (kind && kind !== shown) setShown(kind);
  }, [kind, shown]);

  useEffect(() => {
    if (!kind) return;

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !kind) {
        return;
      }

      // A mark being typed uses Escape to finish, and so does the save-a-copy
      // name. Neither should take the menu down on its way out.
      if (event.target instanceof HTMLElement && isTextField(event.target)) {
        return;
      }
      dispatch(toolToggled(kind));
    }

    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [kind, dispatch]);

  return (
    <div className={getValueMenuRevealStyles(kind !== null)}>
      <div className="min-h-0">
        <div className={VALUE_MENU_ROW_CLASS}>
          <span aria-hidden className={VALUE_MENU_LABEL_CLASS}>
            {label}
          </span>

          <fieldset className={VALUE_MENU_GROUP_CLASS}>
            <legend className="sr-only">{label}</legend>

            {choices.map((choice) => {
              const selected = choice === value;

              return (
                <button
                  key={choice}
                  type="button"
                  tabIndex={kind ? undefined : -1}
                  aria-pressed={selected}
                  onClick={() => dispatch(annotationValuePicked(choice))}
                  className={getValueChoiceStyles(selected, shown === 'string')}
                >
                  {choice}
                </button>
              );
            })}
          </fieldset>

          <p className={VALUE_MENU_HINT_CLASS}>
            {getAnnotationSelectionPrompt(value)}
          </p>

          <button
            type="button"
            tabIndex={kind ? undefined : -1}
            onClick={() => kind && dispatch(toolToggled(kind))}
            title="Dismiss"
            aria-label="Dismiss"
            className={VALUE_MENU_DISMISS_BUTTON_CLASS}
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
      </div>
    </div>
  );
}

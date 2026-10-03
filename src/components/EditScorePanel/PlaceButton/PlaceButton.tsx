import type { ReactNode } from 'react';
import { getPlaceButtonStyles } from '#/components/EditScorePanel/PlaceButton/PlaceButton.styles';

type PlaceButtonProps = {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

export function PlaceButton({
  active,
  onClick,
  children,
  disabled,
}: PlaceButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={getPlaceButtonStyles(active)}
    >
      {children}
    </button>
  );
}

import type { ReactNode } from 'react';
import { getPlaceButtonStyles } from '#/components/EditScorePanel/PlaceButton/PlaceButton.styles';

type PlaceButtonProps = {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
};

export function PlaceButton({ active, onClick, children }: PlaceButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={getPlaceButtonStyles(active)}
    >
      {children}
    </button>
  );
}

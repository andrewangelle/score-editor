import { getPlaceButtonStyles } from '#/components/ScorePartsPanel/PlaceButton/PlaceButton.styles';

type PlaceButtonProps = {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
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

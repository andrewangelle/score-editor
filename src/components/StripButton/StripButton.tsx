import { getStripButtonStyles } from '#/components/StripButton/StripButton.styles';

type StripButtonProps = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
};

export function StripButton({
  label,
  onClick,
  disabled = false,
  destructive = false,
  children,
}: StripButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={getStripButtonStyles(destructive)}
    >
      {children}
    </button>
  );
}

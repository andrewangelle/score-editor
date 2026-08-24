import { TOOLBAR_BUTTON_CLASS } from '#/components/ToolbarButton/ToolbarButton.styles';

type ToolbarButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
};

export function ToolbarButton({
  onClick,
  disabled = false,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={TOOLBAR_BUTTON_CLASS}
    >
      {children}
    </button>
  );
}

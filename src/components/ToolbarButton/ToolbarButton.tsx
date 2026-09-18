import { TOOLBAR_BUTTON_CLASS } from '#/components/ToolbarButton/ToolbarButton.styles';

type ToolbarButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
};

export function ToolbarButton({
  onClick,
  disabled = false,
  title,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={TOOLBAR_BUTTON_CLASS}
    >
      {children}
    </button>
  );
}

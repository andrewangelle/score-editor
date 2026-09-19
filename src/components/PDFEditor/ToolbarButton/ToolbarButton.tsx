import { TOOLBAR_BUTTON_CLASS } from '#/components/PDFEditor/ToolbarButton/ToolbarButton.styles';

type ToolbarButtonProps = {
  'data-testid'?: string;
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
  ...props
}: ToolbarButtonProps) {
  return (
    <button
      data-testid={props['data-testid'] ?? ''}
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

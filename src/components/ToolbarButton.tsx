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
      className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

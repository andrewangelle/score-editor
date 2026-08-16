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
      className={`h-6 w-6 rounded text-xs leading-none text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30 ${
        destructive ? 'hover:bg-red-100 hover:text-red-700' : ''
      }`}
    >
      {children}
    </button>
  );
}

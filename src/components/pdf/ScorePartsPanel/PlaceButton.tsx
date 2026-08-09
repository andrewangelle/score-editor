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
      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
        active
          ? 'border-blue-500 bg-blue-50 text-blue-700'
          : 'border-slate-300 text-slate-700 hover:border-slate-400'
      }`}
    >
      {children}
    </button>
  );
}

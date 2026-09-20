import { type ReactNode, useState } from 'react';

type CollapsibleSectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
  headerRight?: ReactNode;
};

export function CollapsibleSection({
  title,
  children,
  className,
  'data-testid': testId,
  headerRight,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <section data-testid={testId} className={className}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          className="flex items-center gap-1.5 font-semibold text-slate-900 text-sm cursor-pointer"
        >
          <svg
            className={`size-3 shrink-0 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-90'}`}
            viewBox="0 0 6 10"
            fill="none"
          >
            <title>Collapsible icon</title>
            <path
              d="M1 1l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {title}
        </button>
        {headerRight}
      </div>
      {!collapsed && children}
    </section>
  );
}

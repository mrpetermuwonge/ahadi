'use client';
// Marked as a client component because it is used both by server pages (My events) and by the client slideshow;
// a shared unmarked module can break Next.js dev hot-reload ("reading 'call'" runtime error).
import Link from 'next/link';

export type FolderColor = 'brand' | 'sky' | 'rose' | 'amber' | 'slate';
export interface FolderTab {
  id: string;
  label: string;
  color: FolderColor;
  count?: number;
  href?: string; // link tabs (server pages); omit for buttons (client state)
}

/**
 * Folder-style tabs: pastel tabs above a panel that takes the active tab's colour.
 * Works as links (server-rendered filters) or as buttons (pass onSelect from a client component).
 */
export function FolderTabs({ tabs, active, onSelect, children, label }: {
  tabs: FolderTab[];
  active: string;
  onSelect?: (id: string) => void;
  children: React.ReactNode;
  label: string;
}) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto -mb-px px-0.5 [scrollbar-width:none]" role={onSelect ? 'tablist' : undefined} aria-label={label}>
        {tabs.map((t) => {
          const isActive = t.id === current.id;
          const inner = (
            <>
              {t.label}
              {t.count !== undefined && <span className="text-xs font-semibold opacity-70">{t.count}</span>}
            </>
          );
          return t.href && !onSelect ? (
            <Link key={t.id} href={t.href} scroll={false} aria-current={isActive ? 'page' : undefined} className={`ftab f-${t.color} flex-1 sm:flex-none sm:min-w-[150px]`}>
              {inner}
            </Link>
          ) : (
            <button key={t.id} type="button" role="tab" aria-selected={isActive} onClick={() => onSelect?.(t.id)} className={`ftab f-${t.color} flex-1 sm:flex-none sm:min-w-[150px]`}>
              {inner}
            </button>
          );
        })}
      </div>
      <div className={`fpanel f-${current.color} p-3 sm:p-4 ${tabs[0].id === current.id ? 'first-active' : ''}`} role={onSelect ? 'tabpanel' : undefined}>
        {children}
      </div>
    </div>
  );
}

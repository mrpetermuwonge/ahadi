'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Tabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="mt-3 -mx-4 px-4 overflow-x-auto" aria-label="Event">
      <ul className="flex gap-1 min-w-max border-b border-line">
        {tabs.map((tab) => {
          const active = path === tab.href;
          return (
            <li key={tab.href}>
              <Link href={tab.href} aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center min-h-[44px] px-3 text-sm font-semibold border-b-2 -mb-px ${active ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'}`}>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

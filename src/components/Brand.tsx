'use client';
// Shared by server pages and client components (wizard, slideshow), so marked as a client module.
import Link from 'next/link';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 font-extrabold text-xl tracking-tight text-brand ${className}`}>
      <svg aria-hidden width="30" height="30" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="9" className="fill-brand" />
        <path d="M9 22 L16 8 L23 22" fill="none" stroke="rgb(var(--accent))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="19" r="2.4" fill="rgb(var(--accent))" />
      </svg>
      Ahadi
    </Link>
  );
}

const ICONS: Record<string, string> = {
  wedding: 'M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z',
  birthday: 'M4 21h16M5 21v-7h14v7M12 14V9M12 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM5 14c2 1.5 4 1.5 7 0 3 1.5 5 1.5 7 0',
  hospital: 'M12 4v16M4 12h16',
  funeral: 'M12 3c2 3 2 5 0 7-2-2-2-4 0-7zM8 21h8M12 10v11',
  community: 'M3 21h18M5 21V10l7-5 7 5v11M10 21v-6h4v6',
  other: 'M12 3l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.4l6-.9z',
};

export function TypeIcon({ type, className = 'w-6 h-6' }: { type: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={ICONS[type] ?? ICONS.other} />
    </svg>
  );
}

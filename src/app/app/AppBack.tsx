'use client';
import { usePathname } from 'next/navigation';
import { BackLink } from '@/components/BackLink';

/**
 * Back arrow for the organizer area. Where there is no earlier Ahadi page to return to, it goes one level up:
 * an event tab → that event's overview → My events → the Ahadi homepage.
 * The new-event wizard has its own step-by-step Back, so none is shown there.
 */
export function AppBack() {
  const path = usePathname() ?? '/app';
  if (path === '/app/new') return null;
  const parts = path.split('/').filter(Boolean); // ['app', 'e', id, tab]
  const fallback = path === '/app' ? '/' : parts.length > 3 ? `/${parts.slice(0, 3).join('/')}` : '/app';
  return <BackLink fallback={fallback} />;
}

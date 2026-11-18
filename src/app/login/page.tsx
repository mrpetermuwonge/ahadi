import { Logo } from '@/components/Brand';
import { BackLink } from '@/components/BackLink';
import { LangSwitcher } from '@/components/Ui';
import { googleEnabled } from '@/lib/services/google';
import { LoginForm } from './LoginForm';
import { ContactNav } from '@/components/ContactNav';

export const metadata = { title: 'Log in' };

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  // A specific destination (e.g. 'Start an event') means organizer sign-in; otherwise the number decides the portal.
  const explicit = searchParams.next && searchParams.next.startsWith('/') && !searchParams.next.startsWith('//') ? searchParams.next : null;
  const error = searchParams.error && /^[a-z_]{3,40}$/.test(searchParams.error) ? searchParams.error : null;
  return (
    <div className="min-h-screen flex flex-col">
      <header className="mx-auto w-full max-w-md flex items-center justify-between px-4 py-3">
        <Logo />
        <div className="flex items-center gap-2"><ContactNav topic="account" /><LangSwitcher /></div>
      </header>
      <nav className="mx-auto w-full max-w-md px-4"><BackLink fallback="/" /></nav>
      <main className="flex-1 mx-auto w-full max-w-md px-4 py-6">
        <LoginForm next={explicit} google={googleEnabled()} initialError={error} />
      </main>
    </div>
  );
}

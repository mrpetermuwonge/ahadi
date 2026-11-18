import { BackLink } from '@/components/BackLink';
import { Logo } from '@/components/Brand';
import { LangSwitcher } from '@/components/Ui';
import { MyPledges } from './MyPledges';
import { ContactNav } from '@/components/ContactNav';

export const metadata = { title: 'My pledges', robots: { index: false } };

/** Every pledge made with one phone number, for people who never create an account. */
export default function MyPledgesPage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto max-w-md flex items-center justify-between px-4 py-3"><Logo /><div className="flex items-center gap-2"><ContactNav topic="pledge" /><LangSwitcher /></div></header>
      <nav className="mx-auto max-w-md px-4"><BackLink fallback="/" /></nav>
      <main className="mx-auto max-w-md px-4 pb-10">
        <MyPledges />
      </main>
    </div>
  );
}

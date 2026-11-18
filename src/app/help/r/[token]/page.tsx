import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { requestByToken } from '@/lib/services/supportRequests';
import { getT } from '@/i18n/server';
import { Logo } from '@/components/Brand';
import { LangSwitcher } from '@/components/Ui';
import { BackLink } from '@/components/BackLink';
import type { Key } from '@/i18n';
import { RequesterReply } from './RequesterReply';

export const metadata = { title: 'Support request', robots: { index: false } };

/** The person's private page for one support request: the conversation and a box to answer. */
export default async function SupportRequestPage({ params }: { params: { token: string } }) {
  const r = await requestByToken(await getDb(), params.token);
  if (!r) notFound();
  const { t } = getT();
  return (
    <div className="min-h-screen">
      <header className="mx-auto max-w-2xl flex items-center justify-between px-4 py-3"><Logo /><LangSwitcher /></header>
      <nav className="mx-auto max-w-2xl px-4"><BackLink fallback="/help" /></nav>
      <main className="mx-auto max-w-2xl px-4 pb-12 space-y-4">
        <section className="card p-5">
          <p className="text-sm text-muted">{t('hp.request')} {r.ref} · {t(`hp.t.${r.topic}` as Key)}</p>
          <h1 className="text-xl font-bold mt-1">{t(`hp.st.${r.status}` as Key)}</h1>
        </section>
        <ul className="space-y-3">
          {r.messages.map((m: { from_staff: boolean; body: string; created_at: string }, i: number) => (
            <li key={i} className={`rounded-2xl p-4 ${m.from_staff ? 'bg-brand-soft mr-8' : 'bg-card border border-line ml-8'}`}>
              <p className="text-xs text-muted">{m.from_staff ? t('hp.fromAhadi') : r.name} · {new Date(m.created_at).toISOString().slice(0, 16).replace('T', ' ')}</p>
              <p className="whitespace-pre-line mt-1">{m.body}</p>
            </li>
          ))}
        </ul>
        <RequesterReply token={params.token} />
      </main>
    </div>
  );
}

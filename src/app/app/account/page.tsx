import { requireUser } from '@/lib/web';
import { getT } from '@/i18n/server';
import { formatPhone } from '@/lib/phone';
import { NameForm } from './NameForm';

export const metadata = { title: 'My account' };

/** The organizer's own details: name (editable) and how they log in (phone / email, read-only). */
export default async function AccountPage() {
  const user = await requireUser('/app/account');
  const { t } = getT();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('acct.title')}</h1>
      <section className="card p-5">
        <NameForm initial={user.name ?? ''} />
      </section>
      <section className="card p-5 space-y-2">
        <h2 className="font-bold">{t('acct.login')}</h2>
        {user.phone && <p><span className="text-muted text-sm block">{t('acct.phone')}</span><span className="font-semibold">{formatPhone(user.phone)}</span></p>}
        {user.email && <p><span className="text-muted text-sm block">{t('acct.email')}</span><span className="font-semibold">{user.email}</span></p>}
      </section>
    </div>
  );
}

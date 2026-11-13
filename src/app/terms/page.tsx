import { Logo } from '@/components/Brand';
import { BackLink } from '@/components/BackLink';
import { getT } from '@/i18n/server';

export const metadata = { title: 'Terms of use' };

/** Draft terms. Must be reviewed by a Ugandan lawyer before launch (payments licensing, liability). */
export default function Terms() {
  const { t } = getT();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Logo />
      <div className="mt-2"><BackLink fallback="/" /></div>
      <article className="card p-6 mt-4 space-y-4 leading-relaxed">
        <h1 className="text-2xl font-bold">{t('legal.terms')}</h1>
        <p><b>The service.</b> Ahadi helps organizers record pledges and collect contributions for events. Ahadi is not a bank and does not lend money or pay interest.</p>
        <p><b>Where money is held.</b> Payments are processed and held by licensed payment providers. Organizers withdraw to verified mobile money or bank accounts. First withdrawals are reviewed, and hospital and funeral events need a second committee member’s approval.</p>
        <p><b>Fees.</b> A transaction fee is shown before every payment. Pledgers can choose to cover it. Optional tips and Event Passes are clearly priced.</p>
        <p><b>Honest use.</b> Organizers must describe events truthfully. Ahadi may freeze events that look fraudulent while it investigates, and may refund pledgers.</p>
        <p><b>Pledges.</b> A pledge is a promise between the pledger and the organizer. Ahadi records it and sends reminders but does not enforce it.</p>
      </article>
    </div>
  );
}

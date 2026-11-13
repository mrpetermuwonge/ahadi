import { Logo } from '@/components/Brand';
import { BackLink } from '@/components/BackLink';
import { getT } from '@/i18n/server';

export const metadata = { title: 'Privacy policy' };

/**
 * Plain-language privacy policy draft aligned with Uganda's Data Protection and Privacy Act, 2019.
 * Legal text is in English for now; have it reviewed by a lawyer and translated before launch.
 */
export default function Privacy() {
  const { t } = getT();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Logo />
      <div className="mt-2"><BackLink fallback="/" /></div>
      <article className="card p-6 mt-4 space-y-4 leading-relaxed">
        <h1 className="text-2xl font-bold">{t('legal.privacy')}</h1>
        <p><b>What we collect.</b> For organizers: phone number, name, event details and any documents you upload for verification. For pledgers: name, phone number, pledge amounts, payments and optional messages. We collect only what is needed to record pledges, take payments and send receipts and reminders.</p>
        <p><b>Why.</b> To run your event ledger, send receipts and reminders you agreed to, prevent fraud and meet legal obligations. We never sell personal data.</p>
        <p><b>Payments.</b> Card numbers are entered on the payment provider’s secure page and never reach Ahadi. Money is held by a licensed payment provider and paid out only to the verified organizer.</p>
        <p><b>Who sees what.</b> Organizers see the names, phone numbers and amounts of people who pledged to their event. The public sees only totals, and names only if the organizer makes the list public and the pledger did not choose to stay anonymous. Medical and funeral details are shown only as the organizer chooses.</p>
        <p><b>Your rights.</b> You can download your data or delete it at any time from your personal pledge link. Payment reminders are part of the pledge service and continue until the pledge is paid or the event closes. Amounts stay in the organizer’s ledger without your identity, because financial records must be kept.</p>
        <p><b>Security.</b> Data is encrypted in transit, access is limited by role, and every money action is logged.</p>
        <p><b>Contact.</b> Questions or requests: contact the Ahadi data protection officer through the support channel listed in the app.</p>
      </article>
    </div>
  );
}

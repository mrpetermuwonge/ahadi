import QRCode from 'qrcode';
import { getDb } from '@/lib/db';
import { pageAccess } from '@/lib/pageAccess';
import { requireUser } from '@/lib/web';
import { getT } from '@/i18n/server';
import { APP_URL } from '@/lib/config';
import { Alert, CopyButton } from '@/components/Ui';
import { ShareConfetti } from './ShareConfetti';
import { EVENT_TYPES, isSombre, type EventType } from '@/lib/eventTypes';
import { formatDate } from '@/lib/time';
import { PledgeCard } from './PledgeCard';

export default async function SharePage({ params, searchParams }: { params: { id: string }; searchParams: { new?: string } }) {
  const user = await requireUser();
  const { event: e } = await pageAccess(await getDb(), params.id, user, 'event.share');
  const { t } = getT();
  const link = `${APP_URL()}/e/${e.slug}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(t('share.waText', { title: e.title, link }))}`;
  const isNew = searchParams.new === '1';
  // The QR code lives only on the pledge card picture.
  const cardQr = await QRCode.toString(link, { type: 'svg', margin: 0, width: 600, color: { dark: '#0D5C54', light: '#FFFFFF' } });
  const details = (e.details ?? {}) as Record<string, string>;
  const [owner] = await (await getDb()).query('SELECT name FROM users WHERE id=$1', [e.created_by]);
  const ownerName: string = (owner?.name ?? '').trim();
  const tone = EVENT_TYPES[e.type as EventType]?.tone ?? 'neutral';
  const invite = isSombre(e.type as EventType) ? t('card.inviteSombre') : tone === 'neutral' ? t('card.inviteSupport') : t('card.invite');
  const place = details.venue || details.hospital || details.burialPlace || details.institution || '';
  return (
    <div className="space-y-4">
      {isNew && (
        <>
          <ShareConfetti fire={EVENT_TYPES[e.type as EventType].confetti} />
          <Alert kind="ok">{t('wiz.created')}</Alert>
        </>
      )}
      <section className="card p-5 space-y-4">
        <h2 className="text-lg font-bold">{t('share.title')}</h2>
        <a href={wa} target="_blank" rel="noopener" className="btn w-full bg-[#25D366] text-white text-lg">
          <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.2z"/></svg>
          {t('share.whatsapp')}
        </a>
        <div>
          <label className="label" htmlFor="link">{t('share.link')}</label>
          <div className="flex gap-2">
            <input id="link" readOnly className="input" value={link} />
            <CopyButton text={link} />
          </div>
        </div>
      </section>
      <PledgeCard
        title={e.title}
        invite={invite}
        organiser={ownerName ? t('card.by', { name: ownerName }) : ''}
        verifiedLabel={e.verified ? t('ev.verified') : ''}
        dateText={e.event_date ? formatDate(e.event_date) : ''}
        place={place}
        coverUrl={e.cover_file_id ? `/api/files/${e.cover_file_id}` : null}
        qrSvg={cardQr}
        link={link}
        sombre={isSombre(e.type as EventType)}
        fileName={`ahadi-${e.slug}.png`}
        shareText={t('share.waText', { title: e.title, link })}
        labels={{
          heading: t('card.heading'), hint: t('card.hint'), scan: t('card.scan'), orOpen: t('card.orOpen'),
          pay: t('card.pay'), tagline: t('card.tagline'), share: t('card.share'), download: t('card.download'),
          saved: t('card.saved'), preparing: t('card.preparing'),
        }}
      />
    </div>
  );
}

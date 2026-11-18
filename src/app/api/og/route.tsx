import { ImageResponse } from 'next/og';

/**
 * Branded link-preview picture (1200x630) for WhatsApp, Facebook and SMS apps, used when an event has no cover
 * photo and for the homepage. ?t=<event title>&k=<kicker>. Text only, no personal data.
 */
export const runtime = 'edge';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const title = (url.searchParams.get('t') ?? 'Every pledge, recorded, reminded and paid.').slice(0, 90);
  const kicker = (url.searchParams.get('k') ?? 'Pledge on Ahadi').slice(0, 40);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px',
        background: 'linear-gradient(135deg, #0D5C54 0%, #0A4740 55%, #D69E2E 140%)', color: '#fff', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: '#fff', color: '#0D5C54', fontSize: 40, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>A</div>
          <div style={{ fontSize: 40, fontWeight: 800 }}>Ahadi</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 28, color: '#F6C76A', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>{kicker}</div>
          <div style={{ fontSize: title.length > 50 ? 60 : 72, fontWeight: 800, lineHeight: 1.1, marginTop: 14, maxWidth: 1000 }}>{title}</div>
        </div>
        <div style={{ fontSize: 26, opacity: 0.85 }}>Pay by MTN, Airtel or card · every shilling gets a receipt</div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'cache-control': 'public, max-age=86400' } },
  );
}

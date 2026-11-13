'use client';
import { useT } from '@/components/I18n';

/** Download the receipt as PDF (server-generated) or as a PNG image drawn on a canvas (shareable on WhatsApp). */
export function ReceiptActions({ no, lines, heading, amount }: { no: string; lines: [string, string][]; heading: string; amount: string }) {
  const { t } = useT();
  function saveImage() {
    const W = 720, H = 220 + lines.length * 56;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#FAF8F4'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#0D5C54'; c.fillRect(0, 0, W, 90);
    c.fillStyle = '#FFFFFF'; c.font = 'bold 34px system-ui, sans-serif'; c.fillText(heading, 36, 58);
    c.fillStyle = '#18211F'; c.font = 'bold 52px system-ui, sans-serif'; c.fillText(amount, 36, 165);
    c.font = '26px system-ui, sans-serif';
    lines.forEach(([k, v], i) => {
      const y = 230 + i * 56;
      c.fillStyle = '#5C6966'; c.fillText(k, 36, y);
      c.fillStyle = '#18211F'; c.textAlign = 'right'; c.fillText(v.length > 34 ? v.slice(0, 33) + '…' : v, W - 36, y); c.textAlign = 'left';
    });
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = `ahadi-receipt-${no}.png`;
    a.click();
  }
  return (
    <div className="grid grid-cols-2 gap-2 mt-6">
      <a className="btn-primary" href={`/api/receipts/${no}/pdf`}>{t('rc.pdf')}</a>
      <button className="btn-outline" onClick={saveImage}>{t('rc.image')}</button>
    </div>
  );
}

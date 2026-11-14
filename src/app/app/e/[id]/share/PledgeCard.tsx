'use client';
import { useEffect, useState } from 'react';

/**
 * A shareable "pledge card" picture: cover photo, event name, date/place, QR code and link.
 * Drawn on the phone with <canvas> (nothing new is stored on the server), then shared as an
 * image to WhatsApp with the phone's share sheet, or downloaded where sharing files isn't supported.
 * Sombre events (hospital, funeral) get quiet colours and no "celebration" feel.
 */
export interface PledgeCardProps {
  title: string;
  typeLabel: string;
  dateText: string;
  place: string;
  coverUrl: string | null;
  qrSvg: string;
  link: string;
  sombre: boolean;
  fileName: string;
  shareText: string;
  labels: { heading: string; hint: string; scan: string; orOpen: string; pay: string; tagline: string; share: string; download: string; saved: string; preparing: string };
}

const W = 1080;
const H = 1350;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Break text into lines that fit `maxWidth`; the last allowed line ends with "…" if text is cut. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + '…';
    return kept;
  }
  return lines;
}

/** Break a URL anywhere (it has no spaces). */
function wrapChars(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawCard(p: PledgeCardProps): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  try { await document.fonts?.ready; } catch { /* fonts are optional */ }
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';

  const brand = '#0D5C54';
  const accent = p.sombre ? '#6B7A78' : '#E8A33D';
  const ink = '#14211F';
  const muted = '#5B6B68';
  const paper = p.sombre ? '#F6F6F4' : '#FFFDF8';

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);

  // Cover photo (16:9, cropped to fill) or a calm brand gradient.
  const coverH = 560;
  let drewCover = false;
  if (p.coverUrl) {
    try {
      const img = await loadImage(p.coverUrl);
      const scale = Math.max(W / img.width, coverH / img.height);
      const sw = W / scale;
      const sh = coverH / scale;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, coverH);
      drewCover = true;
    } catch { /* fall back to the gradient */ }
  }
  if (!drewCover) {
    const g = ctx.createLinearGradient(0, 0, W, coverH);
    g.addColorStop(0, p.sombre ? '#4E5C5A' : accent);
    g.addColorStop(1, brand);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, coverH);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `800 120px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Ahadi', W / 2, coverH / 2);
    ctx.textAlign = 'left';
  }
  // Thin accent line under the cover.
  ctx.fillStyle = accent;
  ctx.fillRect(0, coverH, W, 10);

  const pad = 72;
  let y = coverH + 64;

  // Type chip.
  ctx.font = `700 30px ${font}`;
  ctx.textBaseline = 'middle';
  const chipW = ctx.measureText(p.typeLabel).width + 48;
  roundRect(ctx, pad, y, chipW, 54, 27);
  ctx.fillStyle = '#E3F0EE';
  ctx.fill();
  ctx.fillStyle = brand;
  ctx.fillText(p.typeLabel, pad + 24, y + 28);
  y += 54 + 34;

  // Title (up to 2 lines).
  ctx.textBaseline = 'top';
  ctx.fillStyle = ink;
  ctx.font = `800 68px ${font}`;
  for (const line of wrap(ctx, p.title, W - pad * 2, 2)) {
    ctx.fillText(line, pad, y);
    y += 80;
  }
  // Date · place.
  const sub = [p.dateText, p.place].filter(Boolean).join('  ·  ');
  if (sub) {
    y += 6;
    ctx.fillStyle = muted;
    ctx.font = `500 36px ${font}`;
    ctx.fillText(wrap(ctx, sub, W - pad * 2, 1)[0]!, pad, y);
  }

  // QR + how to pledge, anchored above the footer.
  const footerH = 116;
  const qrSize = 300;
  const qrY = H - footerH - 56 - qrSize;
  roundRect(ctx, pad - 14, qrY - 14, qrSize + 28, qrSize + 28, 24);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#D9E3E1';
  ctx.lineWidth = 3;
  ctx.stroke();
  try {
    const url = URL.createObjectURL(new Blob([p.qrSvg], { type: 'image/svg+xml' }));
    const qr = await loadImage(url);
    ctx.drawImage(qr, pad, qrY, qrSize, qrSize);
    URL.revokeObjectURL(url);
  } catch { /* the link below still works */ }

  const tx = pad + qrSize + 64;
  const tw = W - tx - pad;
  let ty = qrY + 6;
  ctx.fillStyle = ink;
  ctx.font = `800 46px ${font}`;
  for (const line of wrap(ctx, p.labels.scan, tw, 2)) {
    ctx.fillText(line, tx, ty);
    ty += 56;
  }
  ty += 14;
  ctx.fillStyle = muted;
  ctx.font = `500 28px ${font}`;
  ctx.fillText(p.labels.orOpen, tx, ty);
  ty += 40;
  ctx.fillStyle = brand;
  ctx.font = `700 30px ${font}`;
  for (const line of wrapChars(ctx, p.link.replace(/^https?:\/\//, ''), tw).slice(0, 3)) {
    ctx.fillText(line, tx, ty);
    ty += 38;
  }
  ty += 16;
  ctx.fillStyle = muted;
  ctx.font = `500 26px ${font}`;
  for (const line of wrap(ctx, p.labels.pay, tw, 2)) {
    ctx.fillText(line, tx, ty);
    ty += 34;
  }

  // Footer.
  ctx.fillStyle = brand;
  ctx.fillRect(0, H - footerH, W, footerH);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 44px ${font}`;
  ctx.fillText('Ahadi', pad, H - footerH / 2);
  ctx.font = `500 28px ${font}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(p.labels.tagline, W - pad, H - footerH / 2);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no_blob'))), 'image/png'));
}

export function PledgeCard(p: PledgeCardProps) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    drawCard(p).then((b) => {
      if (!alive) return;
      url = URL.createObjectURL(b);
      setBlob(b);
      setPreview(url);
    }).catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
    // Redraw only when what is on the card changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.title, p.typeLabel, p.dateText, p.place, p.coverUrl, p.qrSvg, p.link, p.sombre]);

  function download() {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = p.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setNote(p.labels.saved);
  }

  async function share() {
    if (!blob) return;
    const file = new File([blob], p.fileName, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], text: p.shareText });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return; // the user closed the share sheet
      }
    }
    // Computers and older phones can't share pictures from a web page: save it to attach in WhatsApp.
    download();
  }

  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">{p.labels.heading}</h2>
      <p className="text-muted text-sm mt-1">{p.labels.hint}</p>
      <div className="mt-4 mx-auto max-w-[320px] rounded-xl overflow-hidden border border-line shadow-sm bg-white">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={p.title} className="w-full aspect-[4/5] object-cover" />
        ) : (
          <div className="skeleton w-full aspect-[4/5]" aria-label={p.labels.preparing} />
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-2 mt-4">
        <button type="button" className="btn w-full bg-[#25D366] text-white" onClick={share} disabled={!blob}>
          <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.2z"/></svg>
          {p.labels.share}
        </button>
        <button type="button" className="btn-outline w-full" onClick={download} disabled={!blob}>
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
          {p.labels.download}
        </button>
      </div>
      {note && <p className="text-sm text-ok mt-3 text-center" role="status">{note}</p>}
    </section>
  );
}

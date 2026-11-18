import { CONTACT } from '@/lib/contact';

type Tone = 'dark' | 'light';

/** Call, email and website tiles. "dark" sits on the green homepage band, "light" on normal pages. */
export function ContactCards({ tone = 'light', labels }: { tone?: Tone; labels: { call: string; email: string; web: string } }) {
  const items = [
    { href: CONTACT.phoneHref, label: labels.call, value: CONTACT.phone, icon: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /> },
    { href: CONTACT.emailHref, label: labels.email, value: CONTACT.email, icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></> },
    { href: CONTACT.websiteHref, label: labels.web, value: CONTACT.website, icon: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></> },
  ];
  const box = tone === 'dark'
    ? 'bg-white/10 hover:bg-white/20 ring-1 ring-white/20 text-white'
    : 'bg-card hover:bg-brand-soft/40 ring-1 ring-line text-ink';
  const iconBox = tone === 'dark' ? 'bg-white/15 text-[#F6C76A]' : 'bg-brand-soft text-brand';
  return (
    <ul className="grid gap-3">
      {items.map((it) => (
        <li key={it.href}>
          <a href={it.href} target={it.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
            className={`group flex items-center gap-3 rounded-2xl p-3 transition ${box}`}>
            <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${iconBox}`}>
              <svg aria-hidden viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{it.icon}</svg>
            </span>
            <span className="min-w-0">
              <span className={`block text-xs ${tone === 'dark' ? 'text-white/70' : 'text-muted'}`}>{it.label}</span>
              <span className="block font-bold truncate">{it.value}</span>
            </span>
            <svg aria-hidden viewBox="0 0 24 24" className="w-4 h-4 ml-auto opacity-50 group-hover:translate-x-0.5 transition" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
          </a>
        </li>
      ))}
    </ul>
  );
}

import { formatPhone, maskPhone } from '@/lib/phone';

/**
 * Account badge: initials, name, masked number and which portal you are in ("Organizer" or "Pledger"),
 * so it is always obvious whose page this is. The number is masked (0772 *** 555) because the screen
 * may be seen by others nearby. Without a name, the number is shown once with a person icon.
 */
export function PledgerBadge({ name, phone, label, tag }: { name: string; phone: string; label: string; tag?: string }) {
  const hasName = /\p{L}/u.test(name) && !name.startsWith('+');
  const shown = hasName ? name : phone.startsWith('+') ? maskPhone(phone) : phone;
  const initials = hasName
    ? shown.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
    : '';
  return (
    <div className="flex items-center gap-2 min-w-0" aria-label={`${label}: ${hasName ? shown : formatPhone(phone)}`}>
      <div className="text-right min-w-0">
        <p className="text-sm font-bold leading-tight truncate max-w-[160px]">{shown}</p>
        <p className="text-[11px] text-muted leading-tight flex items-center justify-end gap-1.5">
          {tag && <span className="chip bg-accent-soft text-ink px-1.5 py-0 text-[10px]">{tag}</span>}
          {hasName && (phone.startsWith('+') ? maskPhone(phone) : phone)}
        </p>
      </div>
      <span aria-hidden className="w-9 h-9 shrink-0 rounded-full bg-brand text-brand-ink font-bold text-sm flex items-center justify-center">
        {initials || (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
          </svg>
        )}
      </span>
    </div>
  );
}

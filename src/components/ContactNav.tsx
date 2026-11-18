'use client';
import { useT } from './I18n';

/**
 * "Contact us" in the title bar. If the page already has the contact form (homepage, Help) it glides down to it,
 * highlights it and puts the cursor in the first box. Elsewhere it opens Help → contact form, with the topic that
 * fits the page already chosen (e.g. "My pledge" on a personal pledge page).
 */
export function ContactNav({ topic }: { topic?: 'payment' | 'pledge' | 'event' | 'account' | 'fraud' | 'other' }) {
  const { t } = useT();
  const href = `/help${topic ? `?topic=${topic}` : ''}#contact`;
  return (
    <a
      href={href}
      title={t('ct.nav')}
      aria-label={t('ct.nav')}
      onClick={(e) => {
        const form = document.getElementById('contact-form');
        if (!form) return; // no form on this page: follow the link to Help
        e.preventDefault();
        goToContactForm(form, true);
        history.replaceState(null, '', '#contact');
      }}
      className="group inline-flex shrink-0 items-center gap-1.5 min-h-[40px] min-w-[40px] justify-center rounded-full border border-brand/25 bg-brand-soft/40 px-2.5 sm:px-3 text-sm whitespace-nowrap font-semibold text-brand hover:bg-brand hover:text-brand-ink transition-colors"
    >
      <span className="relative">
        <svg aria-hidden viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" />
        </svg>
        <span aria-hidden className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#2fbf71] ring-2 ring-surface group-hover:ring-brand" />
      </span>
      <span className="hidden sm:inline">{t('ct.nav')}</span>
    </a>
  );
}

/** Scroll to the contact form, flash it so the eye finds it, and (on a computer) put the cursor in "Your name". */
export function goToContactForm(form: HTMLElement, smooth: boolean) {
  form.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
  form.classList.remove('contact-flash');
  void form.offsetWidth; // restart the animation
  form.classList.add('contact-flash');
  // On phones, opening the keyboard straight away hides the form, so only focus where there is a mouse.
  if (window.matchMedia('(pointer: fine)').matches) {
    window.setTimeout(() => (form.querySelector('input:not([type=hidden]):not([tabindex="-1"])') as HTMLInputElement | null)?.focus({ preventScroll: true }), smooth ? 450 : 0);
  }
}

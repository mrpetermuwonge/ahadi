'use client';

/**
 * Last-resort screen if the whole app shell fails (the normal error screen needs the shell).
 * Kept plain on purpose: no translations or shared components, which may be what failed.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Segoe UI, Roboto, sans-serif', background: '#FFFDF8', color: '#14211F', margin: 0 }}>
        <div style={{ maxWidth: 420, margin: '0 auto', padding: '48px 16px', textAlign: 'center' }}>
          <p style={{ fontSize: 28, fontWeight: 800, color: '#0D5C54', margin: 0 }}>Ahadi</p>
          <p style={{ fontSize: 18, fontWeight: 600, marginTop: 24 }}>Something went wrong. Nothing was lost. Please try again.</p>
          <button type="button" onClick={() => reset()} style={{ marginTop: 24, width: '100%', minHeight: 48, borderRadius: 12, border: 0, background: '#0D5C54', color: '#fff', fontSize: 16, fontWeight: 600 }}>Try again</button>
          <a href="/" style={{ display: 'block', marginTop: 12, color: '#0D5C54', fontWeight: 600 }}>Home</a>
        </div>
      </body>
    </html>
  );
}

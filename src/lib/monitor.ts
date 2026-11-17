/**
 * Error alerts. Every unexpected error is written to the server log as one JSON line (easy to search), and,
 * when ALERT_WEBHOOK_URL is set (a Slack, Microsoft Teams, Discord or Google Chat incoming webhook), the team
 * gets a message. The same error is sent at most once every 10 minutes so an outage doesn't flood the channel.
 * No personal data is sent: only the error, where it happened and a reference.
 */
const lastSent = new Map<string, number>();

export function reportError(err: unknown, where: string, extra: Record<string, unknown> = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  const ref = Math.random().toString(36).slice(2, 10);
  const line = { level: 'error', at: new Date().toISOString(), where, ref, message: e.message, stack: e.stack?.split('\n').slice(0, 6).join(' | '), ...extra };
  console.error(JSON.stringify(line));

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return ref;
  const key = `${where}:${e.message}`;
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < 10 * 60_000) return ref;
  lastSent.set(key, now);
  const text = `Ahadi error in ${where}: ${e.message} (ref ${ref})`;
  // Slack/Teams/Google Chat read "text", Discord reads "content".
  void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }) }).catch(() => {});
  return ref;
}

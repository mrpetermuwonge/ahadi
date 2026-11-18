/**
 * Role checks in a real browser, against the test copy started by scripts/e2e.mjs (seeded demo data).
 * Every role logs in like a person would and we check what it can see and what the server refuses.
 */
import { chromium } from 'playwright-core';

const ORGANIZER = '0772100200'; // Sarah & John's Wedding (has a treasurer)
const TREASURER = '0701234567';
const SUPER = '0700000001';
const FINANCE = '0700000003'; // seeded demo staff
const TRUST = '0700000004';
const PLEDGER = '0751222333';
const HELPER = '0712555001'; // created during the test
const SUPPORT = '0712555002'; // created during the test

const J = { 'content-type': 'application/json' };

export async function runRoleTests(BASE) {
  const browser = await chromium.launch({
    channel: process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'msedge',
    headless: !process.env.E2E_HEADED,
  });
  const results = [];
  const test = async (name, fn) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: BASE });
    const page = await ctx.newPage();
    try {
      await page.goto('/login');
      await fn(page);
      results.push([true, name]);
      console.log(`  ✓ ${name}`);
    } catch (e) {
      results.push([false, name]);
      console.log(`  ✗ ${name}\n      ${String(e.message).split('\n')[0]}`);
      await page.screenshot({ path: `.data/e2e-fail-${results.length}.png` }).catch(() => {});
    } finally {
      await ctx.close();
    }
  };
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

  /** Log in with the on-screen test code (same API calls the login page makes). */
  const login = (page, phone) => page.evaluate(async ({ phone, J }) => {
    const r = await (await fetch('/api/auth/request', { method: 'POST', headers: J, body: JSON.stringify({ kind: 'phone', value: phone }) })).json();
    const v = await fetch('/api/auth/verify', { method: 'POST', headers: J, body: JSON.stringify({ kind: 'phone', value: phone, code: r.devCode }) });
    return v.status;
  }, { phone, J });
  /** "Confirm it's you" via the API (fresh code to the account's own phone). */
  const stepUp = (page) => page.evaluate(async (J) => {
    const s = await (await fetch('/api/auth/step-up', { method: 'POST', headers: J, body: '{}' })).json();
    return (await fetch('/api/auth/step-up', { method: 'POST', headers: J, body: JSON.stringify({ code: s.devCode }) })).status;
  }, J);
  const post = (page, url, body) => page.evaluate(async ({ url, body, J }) => (await fetch(url, { method: 'POST', headers: J, body: JSON.stringify(body) })).status, { url, body, J });
  const eventId = async (page) => {
    await page.goto('/app');
    const href = await page.locator('a[href^="/app/e/evt_"]').filter({ hasText: 'Sarah' }).first().getAttribute('href');
    return href.split('/').pop();
  };
  const tabs = (page) => page.locator('nav[aria-label="Event"] a').allInnerTexts();

  console.log('\nBrowser tests (roles):');

  await test('security headers are sent (CSP, no framing)', async (page) => {
    const r = await page.request.get('/');
    const h = r.headers();
    expect((h['content-security-policy'] ?? '').includes("frame-ancestors 'none'"), 'missing CSP');
    expect(h['x-frame-options'] === 'DENY', 'missing X-Frame-Options');
  });

  await test('pledger: pledges with a WhatsApp code and pays by mobile money', async (page) => {
    await page.goto('/');
    await page.locator('a[href^="/e/sarah"]').first().click();
    await page.getByRole('button', { name: 'Pledge now' }).click();
    await page.getByLabel('Your name').fill('E2E Guest');
    await page.getByPlaceholder('0772 123 456').fill(`0772 9${String(Date.now()).slice(-5)}`);
    await page.getByRole('button', { name: 'Send me a code on WhatsApp' }).click();
    const code = (await page.locator('text=/Temporary code/').first().innerText()).match(/(\d{6})/)[1];
    await page.getByLabel('Enter the 6-digit code').fill(code);
    await page.getByRole('button', { name: 'Verify', exact: true }).click({ timeout: 4000 }).catch(() => {});
    await page.getByText('Number verified').waitFor({ timeout: 15000 });
    expect(!(await page.getByText('Welcome back').count()), 'a new number is greeted as returning');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: '20k' }).click({ timeout: 15000 });
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('label', { hasText: 'I agree that Ahadi stores' }).locator('input').check();
    await page.getByRole('button', { name: /^Pay UGX/ }).click();
    await page.waitForURL(/\/pay\//);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByText('Payment received').waitFor({ timeout: 20000 });
  });

  await test('returning pledger: My pledges needs a fresh code and shows the summary', async (page) => {
    await page.goto('/my');
    await page.getByPlaceholder('0772 123 456').fill(PLEDGER);
    await page.getByRole('button', { name: /Send me a code/ }).click();
    const code = (await page.locator('text=/Temporary code/').first().innerText()).match(/(\d{6})/)[1];
    await page.getByLabel('Enter the 6-digit code').fill(code);
    await page.getByRole('button', { name: 'Verify', exact: true }).click({ timeout: 4000 }).catch(() => {});
    await page.getByText('Welcome back').waitFor({ timeout: 15000 });
  });

  await test('organizer: all tabs, exports; no cash form because the event has a treasurer', async (page) => {
    expect((await login(page, ORGANIZER)) === 200, 'login failed');
    const id = await eventId(page);
    await page.goto(`/app/e/${id}`);
    const t = await tabs(page);
    expect(t.includes('Settings') && t.includes('Withdraw') && t.includes('Ledger'), `tabs: ${t}`);
    expect(await page.getByText('Your role: Organizer').first().isVisible(), 'role banner');
    expect(await page.locator('a[href*="/export?format=csv"]').count() === 1, 'exports missing');
    await page.goto(`/app/e/${id}/ledger`);
    expect(await page.getByRole('button', { name: 'Record payment' }).count() === 0, 'organizer can record cash');
    expect((await post(page, `/api/events/${id}/manual-payment`, {})) === 403, 'cash API not refused');
    expect((await post(page, `/api/events/${id}/request-payout`, { accountId: 'x', amount: 1000 })) === 401, 'withdrawal without fresh code');
  });

  await test('organizer adds a helper (needs a fresh code)', async (page) => {
    await login(page, ORGANIZER);
    const id = await eventId(page);
    expect((await post(page, `/api/events/${id}/add-member`, { phone: HELPER, role: 'viewer' })) === 401, 'no step-up asked');
    expect((await stepUp(page)) === 200, 'step-up failed');
    expect((await post(page, `/api/events/${id}/add-member`, { phone: HELPER, role: 'viewer' })) === 200, 'add helper failed');
  });

  await test('treasurer: money tabs only; settings refused; can record cash', async (page) => {
    await login(page, TREASURER);
    const id = await eventId(page);
    await page.goto(`/app/e/${id}`);
    const t = await tabs(page);
    expect(!t.includes('Settings') && t.includes('Ledger') && t.includes('Withdraw'), `tabs: ${t}`);
    await page.goto(`/app/e/${id}/settings`);
    await page.waitForURL((u) => !u.pathname.endsWith('/settings'));
    await page.goto(`/app/e/${id}/ledger`);
    expect(await page.getByRole('button', { name: 'Record payment' }).count() === 1, 'treasurer cannot record cash');
    expect((await post(page, `/api/events/${id}/settings`, { tipsEnabled: true })) === 403, 'settings API not refused');
  });

  await test('helper: no ledger, no exports, phone numbers hidden', async (page) => {
    await login(page, HELPER);
    const id = await eventId(page);
    await page.goto(`/app/e/${id}`);
    const t = await tabs(page);
    expect(!t.includes('Ledger') && !t.includes('Withdraw') && !t.includes('Settings'), `tabs: ${t}`);
    expect(await page.locator('a[href*="/export?"]').count() === 0, 'exports visible');
    const r = await page.request.get(`/api/events/${id}/export?format=csv`);
    expect(r.status() === 403, `export status ${r.status()}`);
    expect(!(await page.content()).includes('+256'), 'full phone number visible');
  });

  await test('super admin: overview, team and actions; adds a Support member', async (page) => {
    await login(page, SUPER);
    await page.goto('/admin');
    await page.getByText('Waiting for the team').waitFor();
    expect(await page.getByText('Admin · Super admin').count() >= 1, 'role chip');
    expect((await post(page, '/api/admin/team-set', { phone: SUPPORT, role: 'support' })) === 401, 'no step-up asked');
    await stepUp(page);
    expect((await post(page, '/api/admin/team-set', { phone: SUPPORT, role: 'support' })) === 200, 'team-set failed');
    await page.goto('/admin?tab=events');
    expect(await page.getByRole('button', { name: 'Freeze' }).count() > 0, 'no freeze buttons');
  });

  await test('support admin: read-only everywhere', async (page) => {
    await login(page, SUPPORT);
    await page.goto('/admin?tab=events');
    await page.getByText('read-only access').waitFor();
    expect(await page.getByRole('button', { name: 'Freeze' }).count() === 0, 'freeze visible');
    expect((await post(page, '/api/admin/freeze', { eventId: 'x', frozen: true })) === 403, 'freeze not refused');
    expect((await page.request.get('/api/admin/analytics?days=30')).status() === 403, 'export not refused');
  });

  await test('finance admin: money actions only', async (page) => {
    await login(page, FINANCE);
    await page.goto('/admin?tab=payments');
    expect(await page.getByRole('button', { name: 'Refund' }).count() > 0, 'no refund buttons');
    await page.goto('/admin?tab=events');
    expect(await page.getByRole('button', { name: 'Freeze' }).count() === 0, 'finance can freeze');
    expect((await post(page, '/api/admin/freeze', { eventId: 'x', frozen: true })) === 403, 'freeze not refused');
    expect((await post(page, '/api/admin/team-set', { phone: '0700000099', role: 'super' })) === 403, 'team not refused');
    expect((await post(page, '/api/admin/refund', { paymentId: 'x', note: 'x' })) === 401, 'refund without fresh code');
    expect((await page.request.get('/api/admin/analytics?days=30')).status() === 200, 'export refused');
  });

  await test('trust & safety admin: safety actions only', async (page) => {
    await login(page, TRUST);
    await page.goto('/admin?tab=events');
    expect(await page.getByRole('button', { name: 'Freeze' }).count() > 0, 'no freeze buttons');
    await page.goto('/admin?tab=payments');
    expect(await page.getByRole('button', { name: 'Refund' }).count() === 0, 'trust can refund');
    expect((await post(page, '/api/admin/refund', { paymentId: 'x', note: 'x' })) === 403, 'refund not refused');
    expect((await post(page, '/api/admin/payout-review', { payoutId: 'x', approve: true, note: '' })) === 403, 'payout review not refused');
    const nav = await page.locator('nav a[href^="/admin?tab="]').allInnerTexts();
    expect(!nav.includes('Revenue'), 'trust sees revenue');
  });

  await test('export: each staff role only sees the data it may take', async (page) => {
    const kinds = async () => page.locator('label:has(input[type=checkbox]) span.font-semibold').allInnerTexts();
    await login(page, FINANCE);
    await page.goto('/admin?tab=export');
    let k = await kinds();
    expect(k.includes('Pledges') && k.includes('Payments') && !k.includes('Accounts') && !k.includes('Audit log'), `finance: ${k}`);
    await login(page, TRUST);
    await page.goto('/admin?tab=export');
    k = await kinds();
    expect(k.includes('Events') && k.includes('Pledgers') && !k.includes('Payments'), `trust: ${k}`);
    expect((await post(page, '/api/admin/export', { datasets: ['payments'], analytics: false, from: null, to: null, type: null, phones: false, format: 'xlsx' })) === 403, 'trust got payments');
    await login(page, SUPPORT);
    await page.goto('/admin');
    const nav = await page.locator('nav a[href^="/admin?tab="]').allInnerTexts();
    expect(!nav.includes('Export'), 'support sees Export');
  });

  await test('accounts: super admin can open and control any account; support cannot', async (page) => {
    await login(page, SUPER);
    await page.goto('/admin?tab=accounts&kind=organizers');
    await page.locator('a[href*="tab=accounts&user="]').first().click();
    await page.getByText('Manage this account').waitFor();
    await login(page, SUPPORT);
    await page.goto('/admin?tab=accounts');
    await page.locator('a[href*="tab=accounts&user="]').first().click();
    await page.getByText('Only super admins can change accounts').waitFor();
    expect((await post(page, '/api/admin/account-suspend', { userId: 'x', reason: 'testing the rule here', freezeEvents: false })) === 403, 'support could suspend');
  });

  await test('homepage shows the partners strip', async (page) => {
    await page.goto('/');
    await page.locator('#partners-title').waitFor();
    expect((await page.locator('.partners-track li').count()) >= 8, 'partners missing');
  });

  await test('organizer: record a meeting pledge, upload a list, remind, post an update', async (page) => {
    await login(page, ORGANIZER);
    const id = await eventId(page);
    await page.goto(`/app/e/${id}`);
    // The first visit compiles the page; click again until the form has opened (the page is interactive).
    for (let i = 0; i < 10 && !(await page.getByLabel('Your name').isVisible()); i++) {
      await page.getByRole('button', { name: 'Add one pledge' }).click();
      await page.waitForTimeout(1000);
    }
    await page.getByLabel('Your name').fill('Meeting Guest');
    await page.getByLabel('Your phone number').fill('0772 777 001');
    await page.getByLabel('How much?').fill('75000');
    await page.getByRole('button', { name: 'Add pledge and notify' }).click();
    await page.getByText('was added and asked to confirm').waitFor();
    await page.getByRole('button', { name: 'Upload a list (Excel/CSV)' }).click();
    await page.locator('input[type=file][accept=".xlsx,.csv"]').setInputFiles({ name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from(['Name,Phone,Amount', 'List One,0772777002,20000', 'List Two,0772777003,30000', ''].join('\n')) });
    await page.getByRole('button', { name: 'Check the file' }).click();
    await page.getByText('2 pledges found').waitFor();
    await page.getByRole('button', { name: 'Add 2 pledges and notify' }).click();
    await page.getByText('2 added.').waitFor();
    await page.reload();
    await page.getByText('Recorded by committee').first().waitFor();
    expect((await page.getByText('Recorded by committee').count()) >= 3, 'recorded chips missing');
    const r = await page.evaluate(async (id) => (await fetch(`/api/events/${id}/remind-owing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, id);
    expect(r === 200 || r === 400, `remind status ${r}`); // 400 only if run during quiet hours
    await page.getByPlaceholder('Write your update…').fill('We reached half of our target. Thank you!');
    await page.getByRole('button', { name: 'Post update' }).click();
    await page.getByText(/Posted/).waitFor();
    const slug = await page.locator('a[href^="/e/"][target="_blank"]').first().getAttribute('href');
    await page.goto(slug);
    await page.getByText('We reached half of our target').waitFor();
    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(!!og && /\/api\/(files|og)/.test(og), 'no link preview image');
  });

  await test('help: contact Ahadi, support answers, the person sees the answer', async (page) => {
    await page.goto('/help');
    await page.getByText('Do I need an account to pledge?').click();
    await page.getByLabel('Your name').fill('E2E Visitor');
    await page.getByLabel('Phone (WhatsApp) or email').fill('0772 777 009');
    await page.getByLabel('Your message').fill('My mobile money payment did not show on my pledge.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText(/Your reference is AH-SUP-/).waitFor();
    const link = await page.getByRole('link', { name: 'Open my request' }).getAttribute('href');
    await login(page, SUPPORT);
    await page.goto('/admin?tab=support');
    await page.getByText('E2E Visitor').first().click();
    await page.getByLabel('Your answer').fill('Thanks, we found your payment and it now shows.');
    await page.getByRole('button', { name: 'Send answer' }).click();
    await page.getByText('Answer sent.').waitFor();
    await page.goto(link);
    await page.getByText('we found your payment').waitFor();
  });

  await test('signed-out visitors cannot open admin or event dashboards', async (page) => {
    await page.goto('/admin');
    await page.waitForURL(/\/login/, { timeout: 15000 });
    const r = await page.request.get('/api/events/x/export?format=csv');
    expect(r.status() === 403, `export ${r.status()}`);
  });

  await browser.close();
  const failed = results.filter((r) => !r[0]).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  return failed;
}

import type { PaymentProvider } from './types';
import { ProviderNotConfigured } from './types';

/**
 * DPO Pay adapter — hosted card checkout and mobile money across East Africa.
 *
 * INTENTIONALLY NOT IMPLEMENTED. The build brief forbids inventing endpoints, field names or
 * signature schemes, and the current official DPO Pay API documentation has not been verified.
 * To implement, we need:
 *   1. The current official API reference (create token / hosted checkout, verify token, refunds, payouts if offered).
 *   2. Sandbox company token, service type, and base URLs.
 *   3. How the payment result is delivered (redirect + server-side verify, and/or push notification) and how it is authenticated.
 *   4. The fee schedule per method and country.
 * Card numbers are never handled by Ahadi: DPO's hosted checkout must be used.
 */
const notReady = () => {
  throw new ProviderNotConfigured('DPO Pay adapter is not implemented yet (see dpo.ts for what is needed).');
};

export const dpoProvider: PaymentProvider = {
  name: 'dpo',
  supports: (method, country) => ['UG', 'KE', 'TZ', 'RW'].includes(country) && ['card', 'mtn', 'airtel'].includes(method),
  isConfigured: () => false,
  initiateCollection: async () => notReady(),
  getCollectionStatus: async () => notReady(),
  handleWebhook: async () => notReady(),
  initiatePayout: async () => notReady(),
  getPayoutStatus: async () => notReady(),
};

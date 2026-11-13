import type { PaymentProvider } from './types';
import { ProviderNotConfigured } from './types';

/**
 * ZengaPay adapter — mobile money collections and payouts in Uganda (MTN, Airtel).
 *
 * INTENTIONALLY NOT IMPLEMENTED. The build brief forbids inventing endpoints, field names or
 * signature schemes, and the current official ZengaPay API documentation has not been verified.
 * To implement, we need:
 *   1. The current official API reference (collections, payouts, status, refunds).
 *   2. Sandbox API key and the base URL for sandbox and production.
 *   3. The webhook / callback format and how it is authenticated (signature header? IP allow-list?).
 *   4. The fee schedule and the pending-transaction timeout.
 * Until then the app uses the mock provider; this adapter reports itself as unconfigured
 * so the router never selects it.
 */
const notReady = () => {
  throw new ProviderNotConfigured('ZengaPay adapter is not implemented yet (see zengapay.ts for what is needed).');
};

export const zengaPayProvider: PaymentProvider = {
  name: 'zengapay',
  supports: (method, country) => country === 'UG' && (method === 'mtn' || method === 'airtel'),
  isConfigured: () => false,
  initiateCollection: async () => notReady(),
  getCollectionStatus: async () => notReady(),
  handleWebhook: async () => notReady(),
  initiatePayout: async () => notReady(),
  getPayoutStatus: async () => notReady(),
};

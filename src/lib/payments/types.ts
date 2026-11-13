/**
 * Every payment gateway implements this interface. The rest of the app never talks to a gateway directly,
 * so gateways can be added, swapped, or failed over without touching business logic.
 */
export type Method = 'mtn' | 'airtel' | 'card';
export type GatewayStatus = 'pending' | 'succeeded' | 'failed' | 'expired';

export interface CollectionRequest {
  reference: string; // our payment id
  idempotencyKey: string;
  amount: number; // minor units
  currency: string;
  method: Method;
  phone?: string; // E.164 for mobile money
  description: string;
  callbackUrl: string; // webhook
  returnUrl: string; // where hosted checkout sends the browser back
}

export interface CollectionResult {
  status: GatewayStatus;
  providerRef?: string;
  redirectUrl?: string; // hosted checkout (cards)
  raw?: unknown;
}

export interface StatusResult {
  status: GatewayStatus;
  amount?: number;
  currency?: string;
  providerRef?: string;
  raw?: unknown;
}

/** A verified webhook. handleWebhook must throw if the signature (or server-side check) fails. */
export interface WebhookEvent {
  eventId: string; // unique per delivery content; used to drop replays
  kind: 'collection' | 'payout';
  reference: string; // our payment / payout id
  status: GatewayStatus;
  amount: number;
  currency: string;
  providerRef?: string;
}

export interface PayoutRequest {
  reference: string; // our payout id
  idempotencyKey: string;
  amount: number;
  currency: string;
  destination: { kind: 'mobile_money'; phone: string } | { kind: 'bank'; bankName: string; accountNo: string; accountName: string };
  description: string;
}

export interface PaymentProvider {
  name: string;
  supports(method: Method, country: string): boolean;
  isConfigured(): boolean;
  initiateCollection(req: CollectionRequest): Promise<CollectionResult>;
  getCollectionStatus(reference: string, providerRef?: string | null): Promise<StatusResult>;
  handleWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent>;
  initiatePayout(req: PayoutRequest): Promise<{ status: GatewayStatus; providerRef?: string }>;
  getPayoutStatus(reference: string, providerRef?: string | null): Promise<StatusResult>;
  refund?(providerRef: string, amount: number, currency: string): Promise<{ ok: boolean; providerRef?: string }>;
}

export class ProviderNotConfigured extends Error {}
export class WebhookRejected extends Error {}

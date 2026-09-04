/**
 * services/payment/types.ts
 * ---------------------------------------------------------------------------
 * The payment contract.
 *
 * BRD 19 leaves the gateway to the client, so nothing in the business code may
 * know whether it is talking to Stripe, Telr, Network International or PayTabs.
 * Modules depend on this interface; the concrete driver is chosen once, from
 * PAYMENT_PROVIDER.
 *
 * NOTHING IN THIS FILE CARRIES CARD DATA. There is no `cardNumber`, no `cvv`,
 * no `expiry` - not even optionally. BRD 19 and 46 say raw card details are the
 * provider's responsibility, and the surest way to honour that is for our types
 * to have nowhere to put them. The customer enters their card on the provider's
 * page or in the provider's iframe; we only ever see references.
 */

export type ProviderPaymentStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';

export interface CreatePaymentInput {
  /** Our booking reference, passed through for reconciliation. */
  bookingNumber: string;
  amount: string;
  currency: string;
  description: string;
  /** Prevents a retried request from charging twice. */
  idempotencyKey: string;
  customerEmail: string;
  /** Where the provider sends the customer back to. */
  returnUrl: string;
  /** Our own ids, echoed back on the webhook. */
  metadata: Record<string, string>;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  /** Where to send the customer to actually pay. */
  checkoutUrl: string;
  status: ProviderPaymentStatus;
  reference?: string;
}

export interface RefundInput {
  providerPaymentId: string;
  /** Omit for a full refund. */
  amount?: string;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'pending' | 'succeeded' | 'failed';
  amount: string;
}

export interface PaymentStatusResult {
  providerPaymentId: string;
  status: ProviderPaymentStatus;
  amount: string;
  currency: string;
  failureReason?: string;
}

/** A webhook the provider sent us, after signature verification. */
export interface VerifiedWebhookEvent {
  /** The provider's own event id, used for idempotency. */
  eventId: string;
  type: string;
  providerPaymentId?: string;
  providerRefundId?: string;
  status: ProviderPaymentStatus;
  /** The amount THE PROVIDER says was charged. Checked against our record. */
  amount?: string;
  currency?: string;
  failureReason?: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /** Ask the provider directly. Used to reconcile when a webhook is missed. */
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult>;

  refundPayment(input: RefundInput): Promise<RefundResult>;

  /**
   * Verify a webhook's signature and parse it.
   *
   * MUST throw if the signature does not match. An unverified webhook is an
   * anonymous stranger claiming a payment succeeded - which is precisely the
   * attack this whole design exists to stop.
   *
   * Takes the RAW body: signatures are computed over exact bytes, and
   * re-serialising parsed JSON changes them.
   */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): VerifiedWebhookEvent;
}

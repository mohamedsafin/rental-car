/**
 * services/payment/mockProvider.ts
 * ---------------------------------------------------------------------------
 * A development stand-in for the real gateway.
 *
 * BRD 19 says the provider is the client's choice, so until that decision is
 * made this driver lets the whole payment flow be built and tested. It is NOT
 * a shortcut: it implements the same interface, signs its webhooks with the
 * same HMAC scheme, and refuses an invalid signature exactly as a real gateway
 * would. Swapping to Stripe or Telr means writing one new file.
 *
 * It refuses to run in production - see index.ts.
 */
import crypto from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { ApiError, ErrorCode } from '../../utils/ApiError';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  PaymentStatusResult,
  RefundInput,
  RefundResult,
  VerifiedWebhookEvent,
} from './types';

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerPaymentId = `mock_pi_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

    logger.info('Mock payment created', {
      providerPaymentId,
      bookingNumber: input.bookingNumber,
      amount: input.amount,
    });

    return {
      providerPaymentId,
      // A real provider returns its own hosted checkout page. Ours points at a
      // local simulator so the flow can be walked end to end.
      checkoutUrl: `${env.PUBLIC_API_URL}/api/v1/payments/mock-checkout/${providerPaymentId}`,
      status: 'pending',
      reference: input.bookingNumber,
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult> {
    // A real driver queries the provider's API. The mock cannot know, so it
    // reports pending and leaves the webhook as the source of truth - which is
    // the correct behaviour regardless.
    return { providerPaymentId, status: 'pending', amount: '0.00', currency: 'AED' };
  }

  async refundPayment(input: RefundInput): Promise<RefundResult> {
    const providerRefundId = `mock_re_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

    logger.info('Mock refund created', {
      providerRefundId,
      providerPaymentId: input.providerPaymentId,
      amount: input.amount,
    });

    // Real gateways settle refunds asynchronously and confirm by webhook.
    return { providerRefundId, status: 'pending', amount: input.amount ?? '0.00' };
  }

  /**
   * Verify an HMAC-SHA256 signature over the raw body.
   *
   * The scheme most gateways use. Two details matter:
   *
   *  - The signature covers the RAW BYTES. Parsing the JSON and re-serialising
   *    it changes whitespace and key order, and the signature stops matching.
   *  - The comparison is timingSafeEqual, not `===`. A comparison that returns
   *    early leaks, through timing, how much of a forged signature was right -
   *    which is enough to brute-force one byte at a time.
   */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): VerifiedWebhookEvent {
    if (!signature) {
      throw new ApiError(401, 'Missing webhook signature', ErrorCode.UNAUTHORIZED);
    }

    const secret = env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) {
      // Refuse rather than accept unsigned webhooks. A missing secret is a
      // configuration error, not permission to skip the check.
      throw new ApiError(500, 'PAYMENT_WEBHOOK_SECRET is not configured', ErrorCode.INTERNAL_ERROR);
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const provided = Buffer.from(signature, 'utf8');
    const computed = Buffer.from(expected, 'utf8');

    if (provided.length !== computed.length || !crypto.timingSafeEqual(provided, computed)) {
      logger.warn('Rejected webhook with an invalid signature');
      throw new ApiError(401, 'Invalid webhook signature', ErrorCode.UNAUTHORIZED);
    }

    const parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;

    return {
      eventId: String(parsed.eventId ?? crypto.randomUUID()),
      type: String(parsed.type ?? 'payment.unknown'),
      providerPaymentId: parsed.providerPaymentId as string | undefined,
      providerRefundId: parsed.providerRefundId as string | undefined,
      status: (parsed.status as VerifiedWebhookEvent['status']) ?? 'pending',
      amount: parsed.amount as string | undefined,
      currency: parsed.currency as string | undefined,
      failureReason: parsed.failureReason as string | undefined,
      raw: parsed,
    };
  }

  /** Helper used by the local simulator and by tests to sign a payload. */
  static sign(rawBody: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  }
}

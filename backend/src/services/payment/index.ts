/**
 * services/payment/index.ts
 * ---------------------------------------------------------------------------
 * Chooses the payment driver once, at boot, from PAYMENT_PROVIDER.
 *
 * The only file that knows which gateway is in use. When the client picks one
 * (BRD 19), this gains a `case` and the project gains one new file - nothing
 * in bookings, refunds or deposits changes.
 */
import { env, isProduction } from '../../config/env';
import { logger } from '../../config/logger';
import { MockPaymentProvider } from './mockProvider';
import type { PaymentProvider } from './types';

function createProvider(): PaymentProvider {
  switch (env.PAYMENT_PROVIDER) {
    case 'mock':
      if (isProduction) {
        // A mock gateway in production would "confirm" bookings nobody paid
        // for. Refusing to boot is the only safe response.
        throw new Error(
          'PAYMENT_PROVIDER=mock cannot be used in production. Configure the real gateway chosen by the client (BRD 19).',
        );
      }
      return new MockPaymentProvider();

    case 'stripe':
    case 'telr':
    case 'network_international':
    case 'paytabs':
      throw new Error(
        `PAYMENT_PROVIDER="${env.PAYMENT_PROVIDER}" is not implemented yet. The gateway is the client's choice (BRD 19); its driver is written once they confirm it. Use PAYMENT_PROVIDER=mock for development.`,
      );

    default:
      throw new Error(`Unknown PAYMENT_PROVIDER: ${String(env.PAYMENT_PROVIDER)}`);
  }
}

export const paymentProvider: PaymentProvider = createProvider();

logger.info('Payment provider initialised', { provider: paymentProvider.name });

export * from './types';
export { MockPaymentProvider };

/**
 * services/payments.service.ts
 * ---------------------------------------------------------------------------
 * Payment and deposit API calls.
 *
 * Note the absence of anything like `confirmPayment()`. There is no such
 * endpoint, by design: only a signed webhook from the provider can mark a
 * payment successful. This app's job is to send the customer to the gateway
 * and then SHOW them whatever the server says happened.
 */
import { getData, postData } from './api';
import type { DepositSummary, PaymentRecord, PaymentType } from '../types/payment';

export const paymentsService = {
  /** Creates a payment session and returns the provider's checkout URL. */
  initiate: (bookingId: string, type: PaymentType = 'RENTAL') =>
    postData<{ paymentId: string; checkoutUrl: string; amount: string }>('/payments/initiate', {
      bookingId,
      type,
    }),

  listForBooking: (bookingId: string) =>
    getData<{ payments: PaymentRecord[] }>(`/payments/booking/${bookingId}`),

  getDeposit: (bookingId: string) =>
    getData<{ deposit: DepositSummary | null }>(`/deposits/booking/${bookingId}`),
};

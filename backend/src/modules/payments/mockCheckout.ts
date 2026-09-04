/**
 * modules/payments/mockCheckout.ts
 * ---------------------------------------------------------------------------
 * A local stand-in for the provider's hosted payment page.
 *
 * It exists so the payment flow can be walked end to end while the real
 * gateway is unchosen (BRD 19). Crucially it has NO authority: it does not
 * confirm anything. It shows you the signed webhook a real provider would
 * send, which then goes through the exact same verification path.
 *
 * Mounted only when PAYMENT_PROVIDER=mock, and the mock provider itself
 * refuses to load in production.
 */
import { Router } from 'express';
import { env } from '../../config/env';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { paymentProvider, MockPaymentProvider } from '../../services/payment';

export function mountMockCheckout(target: Router): void {
  if (paymentProvider.name !== 'mock') return;

  target.get(
    '/mock-checkout/:providerPaymentId',
    asyncHandler(async (req, res) => {
      const providerPaymentId = req.params.providerPaymentId as string;
      const payment = await prisma.payment.findUnique({ where: { providerPaymentId } });
      if (!payment) throw ApiError.notFound('Payment not found');

      const secret = env.PAYMENT_WEBHOOK_SECRET ?? '';
      const amount = payment.amount.toFixed(2);

      const curlFor = (status: string, reportedAmount: string): string => {
        const body = JSON.stringify({
          eventId: `evt_${Date.now()}_${status}_${reportedAmount}`,
          type: `payment.${status}`,
          providerPaymentId,
          status,
          amount: reportedAmount,
          currency: payment.currency,
        });
        const signature = MockPaymentProvider.sign(body, secret);
        // One line, no shell continuations: the reader can copy it straight
        // into a terminal, and it avoids escaping games inside this template.
        return (
          'curl -X POST ' + env.PUBLIC_API_URL + '/api/v1/payments/webhook' +
          ' -H "Content-Type: application/json"' +
          ' -H "x-webhook-signature: ' + signature + '"' +
          " -d '" + body + "'"
        );
      };

      const escape = (value: string): string =>
        value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      res.type('html').send(`<!doctype html>
<meta charset="utf-8"><title>Mock payment gateway</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 16px;color:#0f172a}
 pre{background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;overflow-x:auto;font-size:12px}
 .warn{background:#fef3c7;border:1px solid #fde68a;padding:12px;border-radius:8px}
 .danger{background:#fee2e2;border:1px solid #fecaca;padding:12px;border-radius:8px}
 code{background:#f1f5f9;padding:1px 4px;border-radius:3px}
</style>
<h1>Mock payment gateway</h1>
<div class="warn"><strong>Development only.</strong> The real gateway is the client's choice (BRD 19).
This page has <em>no</em> authority to confirm anything - it simply shows the signed webhook a real
provider would send.</div>
<p>Payment <code>${escape(providerPaymentId)}</code> for
<strong>${payment.currency} ${amount}</strong>.</p>

<h2>1. Simulate a successful payment</h2>
<pre>${escape(curlFor('succeeded', amount))}</pre>

<h2>2. Simulate a failed payment</h2>
<pre>${escape(curlFor('failed', amount))}</pre>

<h2>3. Simulate an attack: valid signature, wrong amount</h2>
<div class="danger">This webhook is signed <em>correctly</em> and will still be refused, because
the amount does not match what the booking says is owed.</div>
<pre>${escape(curlFor('succeeded', '1.00'))}</pre>`);
    }),
  );
}

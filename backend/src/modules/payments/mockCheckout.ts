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

      /*
       * A button per outcome, so a demonstration does not require a terminal.
       *
       * These are plain form posts, not scripted: helmet's Content-Security-
       * Policy blocks inline scripts, and a page that needed its CSP relaxed
       * to work would be a worse thing to ship than a form.
       *
       * The page still has NO authority. Pressing a button asks the server to
       * send exactly the webhook printed below it, to the ordinary webhook
       * endpoint, which verifies the signature and the amount as it would for
       * any provider. It is the curl command with a nicer handle - nothing is
       * confirmed here.
       */
      const button = (outcome: string, label: string, style: string): string =>
        `<form method="post" action="${env.PUBLIC_API_URL}/api/v1/mock-checkout/${encodeURIComponent(providerPaymentId)}/send">
           <input type="hidden" name="outcome" value="${outcome}">
           <button class="${style}" type="submit">${label}</button>
         </form>`;

      /*
       * Let the browser tell us where this form came from.
       *
       * helmet sets `Referrer-Policy: no-referrer` for the whole API, and
       * Chromium derives a form submission's `Origin` header from the referrer
       * policy: under `no-referrer` it sends `Origin: null` even when the post
       * is back to the very host that served the page. CORS then refuses it,
       * and the Pay button dies on a 403 that curl never reproduces, because
       * curl sends no Origin at all.
       *
       * `same-origin` is the narrowest policy that still sends a real origin:
       * this page's own origin goes out on its own posts, and nothing is
       * revealed to any other site. Scoped to this dev-only route, so the
       * API's own `no-referrer` default is untouched everywhere else.
       */
      res.setHeader('Referrer-Policy', 'same-origin');

      res.type('html').send(`<!doctype html>
<meta charset="utf-8"><title>Payment - ${payment.currency} ${amount}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 :root{--ink:#0b0d10;--muted:#6b7280;--line:#e2e5ea;--accent:#f06c15}
 *{box-sizing:border-box}
 body{font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);
      background:#f7f8fa;margin:0;padding:32px 16px;display:flex;justify-content:center}
 .card{background:#fff;border:1px solid var(--line);border-radius:18px;max-width:460px;width:100%;
       padding:28px;box-shadow:0 1px 2px rgb(16 18 22/.04),0 8px 24px -12px rgb(16 18 22/.1)}
 .mode{display:inline-block;background:#fff6ed;color:#9c4210;border:1px solid #fed0a8;
       border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700;letter-spacing:.06em}
 h1{font-size:19px;margin:16px 0 4px}
 .sub{color:var(--muted);font-size:13px;margin:0 0 20px}
 .amount{font-size:34px;font-weight:700;letter-spacing:-.02em;margin:0}
 .cur{font-size:15px;color:var(--muted);font-weight:600;margin-right:6px}
 .rule{border:0;border-top:1px solid var(--line);margin:20px 0}
 button{font:inherit;font-weight:600;padding:12px 18px;border-radius:10px;border:0;cursor:pointer;width:100%}
 .pay{background:var(--accent);color:#fff;font-size:15px}
 .pay:hover{background:#c1540c}
 .ghost{background:#fff;border:1px solid var(--line);color:#4b5260;font-size:13px;padding:9px 14px}
 .ghost:hover{background:#f7f8fa}
 form{margin:0 0 8px}
 details{margin-top:18px}
 summary{cursor:pointer;color:var(--muted);font-size:13px}
 .row{display:flex;gap:8px;margin-top:10px}
 .row form{flex:1;margin:0}
 pre{background:#0b0d10;color:#e2e8f0;padding:10px;border-radius:8px;overflow-x:auto;font-size:11px}
 .note{color:var(--muted);font-size:12px;margin-top:14px;line-height:1.5}
 code{background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:11px}
</style>
<div class="card">
  <span class="mode">TEST MODE</span>
  <h1>Confirm your payment</h1>
  <p class="sub">Booking ${escape(payment.bookingId.slice(0, 8))} &middot; simulated gateway</p>

  <p class="amount"><span class="cur">${payment.currency}</span>${amount}</p>

  <hr class="rule">

  ${button('succeeded', `Pay ${payment.currency} ${amount}`, 'pay')}

  <p class="note">No real money moves. This stands in for the payment provider until one is
  chosen, and it has <strong>no authority</strong> of its own - pressing Pay sends the same signed
  webhook a live gateway would, to the same endpoint, which verifies it the same way.</p>

  <details>
    <summary>Other outcomes to demonstrate</summary>
    <div class="row">
      ${button('failed', 'Decline', 'ghost')}
      ${button('tampered', 'Wrong amount', 'ghost')}
    </div>
    <p class="note"><strong>Wrong amount</strong> sends a correctly signed webhook claiming
    ${payment.currency} 1.00 was paid. It is refused, because the figure does not match what the
    booking says is owed - which is the check that makes a signature alone insufficient.</p>
    <details>
      <summary>the webhook the Pay button sends</summary>
      <pre>${escape(curlFor('succeeded', amount))}</pre>
    </details>
  </details>
</div>`);
    }),
  );

  /*
   * Send one of the webhooks the page prints, then put the browser back where
   * the customer was.
   *
   * It posts over HTTP to the real endpoint rather than calling the service
   * directly, deliberately: the signature check, the amount check and the
   * replay check all run exactly as they would for a live provider. A refused
   * webhook is reported here as a refusal, not smoothed over - proving the
   * guard fired is half the point of the attack button.
   */
  target.post(
    '/mock-checkout/:providerPaymentId/send',
    asyncHandler(async (req, res) => {
      const providerPaymentId = req.params.providerPaymentId as string;
      const payment = await prisma.payment.findUnique({ where: { providerPaymentId } });
      if (!payment) throw ApiError.notFound('Payment not found');

      const outcome = String((req.body as { outcome?: string }).outcome ?? 'succeeded');
      const status = outcome === 'failed' ? 'failed' : 'succeeded';
      // The attack button reports an amount the booking does not owe.
      const reportedAmount = outcome === 'tampered' ? '1.00' : payment.amount.toFixed(2);

      const body = JSON.stringify({
        eventId: `evt_${Date.now()}_${outcome}`,
        type: `payment.${status}`,
        providerPaymentId,
        status,
        amount: reportedAmount,
        currency: payment.currency,
      });

      const response = await fetch(`${env.PUBLIC_API_URL}/api/v1/payments/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': MockPaymentProvider.sign(body, env.PAYMENT_WEBHOOK_SECRET ?? ''),
        },
        body,
      });

      const bookingUrl = `${env.PUBLIC_SITE_URL}/account/bookings/${payment.bookingId}`;
      const detail = await response.text();

      /*
       * Whether the money was APPLIED is in the body, not the status code.
       *
       * The webhook answers 200 even when it rejects a payload - that is
       * deliberate, so a real provider treats the delivery as received and
       * stops retrying a webhook that will never be accepted. Reading the HTTP
       * code alone would send the browser cheerfully back to the booking after
       * a refused attack, which is precisely the opposite of what the attack
       * button is meant to demonstrate.
       */
      const applied = (() => {
        try {
          return (JSON.parse(detail) as { data?: { handled?: boolean } }).data?.handled === true;
        } catch {
          return false;
        }
      })();

      if (applied && status === 'succeeded') {
        return res.redirect(bookingUrl);
      }

      return res.type('html').send(`<!doctype html>
<meta charset="utf-8"><title>Mock payment gateway</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 16px}
 pre{background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;overflow-x:auto;font-size:12px}
 .ok{color:#15803d}.no{color:#b91c1c}</style>
<h1 class="${applied ? 'ok' : 'no'}">The payment was ${applied ? 'applied' : 'NOT applied'}</h1>
<p>The endpoint answered <strong>HTTP ${response.status}</strong>, and the body below says whether it
acted on the event. Nothing about the booking was decided by this page.</p>
<pre>${detail.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
<p><a href="${bookingUrl}">Back to the booking</a></p>`);
    }),
  );
}

/**
 * modules/invoices/pdf.ts
 * ---------------------------------------------------------------------------
 * Renders a stored invoice as a PDF (BRD 28).
 *
 * It takes the INVOICE ROW, not a booking id. That is the important detail:
 * the document is drawn entirely from the snapshot written at issue time, so
 * downloading the same invoice next year produces the same paper, whatever has
 * happened to prices, company details or the booking since.
 *
 * Rendered on demand rather than stored as a file. A PDF regenerated from
 * immutable rows is always identical, so keeping a copy on disk would buy
 * nothing and add a second thing that can drift out of date, go missing, or
 * need backing up.
 *
 * Where the client has not supplied a value - company name, address, TRN - the
 * PDF prints a visible gap rather than a plausible placeholder. A blank that
 * someone notices is much better than a fake that nobody does.
 */
import PDFDocument from 'pdfkit';
import type { Invoice, InvoiceLineItem } from '@prisma/client';

type InvoiceWithLines = Invoice & { lineItems: InvoiceLineItem[] };

const PAGE_MARGIN = 48;
const INK = '#1e2430';
const MUTED = '#6b7280';
const RULE = '#d8dde5';
const ACCENT = '#0f172a';

/** Column x-offsets for the line-item table, from the left margin. */
const COL = { description: 0, qty: 300, unit: 358, total: 448 };
const TABLE_WIDTH = 499;

export function renderInvoicePdf(invoice: InvoiceWithLines): NodeJS.ReadableStream {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    info: {
      Title: invoice.invoiceNumber,
      Author: invoice.companyName ?? 'Car rental',
      Subject: invoice.type === 'CREDIT_NOTE' ? 'Credit note' : 'Tax invoice',
    },
  });

  const isCredit = invoice.type === 'CREDIT_NOTE';
  const left = PAGE_MARGIN;

  // --- Header -------------------------------------------------------------
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(20);
  doc.text(isCredit ? 'CREDIT NOTE' : 'TAX INVOICE', left, PAGE_MARGIN);

  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  doc.text(invoice.invoiceNumber, left, doc.y + 2);
  doc.text(`Issued ${invoice.issuedAt.toISOString().slice(0, 10)}`);

  if (invoice.status === 'CANCELLED') {
    doc.font('Helvetica-Bold').fillColor('#b91c1c');
    doc.text('CANCELLED - superseded by a credit note');
    doc.font('Helvetica').fillColor(MUTED);
  }

  // Company block, right-aligned against the header.
  const companyTop = PAGE_MARGIN;
  doc.fontSize(10).fillColor(INK).font('Helvetica-Bold');
  doc.text(invoice.companyName ?? '[company name not set]', left, companyTop, {
    width: TABLE_WIDTH,
    align: 'right',
  });

  doc.font('Helvetica').fillColor(MUTED).fontSize(9);
  for (const line of [
    invoice.companyAddress,
    invoice.companyPhone,
    invoice.companyEmail,
    invoice.companyTrn ? `TRN ${invoice.companyTrn}` : '[TRN not set]',
  ]) {
    if (!line) continue;
    doc.text(line, left, doc.y, { width: TABLE_WIDTH, align: 'right' });
  }

  // --- Bill-to ------------------------------------------------------------
  let y = Math.max(doc.y, companyTop + 90) + 18;
  rule(doc, y);
  y += 14;

  doc.fontSize(8).fillColor(MUTED).font('Helvetica-Bold').text('BILL TO', left, y);
  y = doc.y + 2;
  doc.fontSize(10).fillColor(INK).font('Helvetica').text(invoice.customerName, left, y);
  doc.fontSize(9).fillColor(MUTED);
  doc.text(invoice.customerEmail);
  if (invoice.customerPhone) doc.text(invoice.customerPhone);
  if (invoice.customerAddress) doc.text(invoice.customerAddress);

  if (isCredit && invoice.reason) {
    doc.moveDown(0.5);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text('Reason for correction');
    doc.font('Helvetica').fillColor(MUTED).text(invoice.reason, { width: TABLE_WIDTH });
  }

  // --- Line items ---------------------------------------------------------
  y = doc.y + 22;

  doc.fontSize(8).fillColor(MUTED).font('Helvetica-Bold');
  doc.text('DESCRIPTION', left + COL.description, y);
  doc.text('QTY', left + COL.qty, y, { width: 40, align: 'right' });
  doc.text('UNIT', left + COL.unit, y, { width: 70, align: 'right' });
  doc.text('AMOUNT', left + COL.total, y, { width: 51, align: 'right' });

  y = doc.y + 6;
  rule(doc, y);
  y += 10;

  doc.font('Helvetica').fontSize(9.5);

  for (const line of invoice.lineItems) {
    // A long description can wrap onto a second page; ask for the height
    // first rather than discovering it after drawing half a row.
    const descriptionHeight = doc.heightOfString(line.description, { width: 285 });
    const detailHeight = line.detail ? doc.heightOfString(line.detail, { width: 285 }) + 2 : 0;
    const rowHeight = Math.max(descriptionHeight + detailHeight, 14) + 8;

    if (y + rowHeight > doc.page.height - PAGE_MARGIN - 120) {
      doc.addPage();
      y = PAGE_MARGIN;
    }

    doc.fillColor(INK).font('Helvetica').fontSize(9.5);
    doc.text(line.description, left + COL.description, y, { width: 285 });

    if (line.detail) {
      doc.fontSize(8).fillColor(MUTED).text(line.detail, left + COL.description, doc.y + 1, {
        width: 285,
      });
    }

    doc.fontSize(9.5).fillColor(INK);
    doc.text(line.quantity.toFixed(2), left + COL.qty, y, { width: 40, align: 'right' });
    doc.text(line.unitPrice.toFixed(2), left + COL.unit, y, { width: 70, align: 'right' });
    doc.text(line.lineTotal.toFixed(2), left + COL.total, y, { width: 51, align: 'right' });

    // A star marks lines outside the tax base, explained under the totals.
    if (!line.isTaxable) {
      doc.fontSize(8).fillColor(MUTED).text('*', left + COL.total + 53, y);
    }

    y += rowHeight;
  }

  rule(doc, y);
  y += 12;

  // --- Totals -------------------------------------------------------------
  const totalsLeft = left + 300;
  const labelWidth = 120;
  const valueWidth = 79;

  const totals: [string, string, boolean][] = [
    ['Subtotal', invoice.subtotal.toFixed(2), false],
    ['Taxable amount', invoice.taxableAmount.toFixed(2), false],
    [
      invoice.taxPercentage ? `VAT (${invoice.taxPercentage.toFixed(2)}%)` : 'VAT (not configured)',
      invoice.taxTotal.toFixed(2),
      false,
    ],
    [`Total ${invoice.currency}`, invoice.total.toFixed(2), true],
  ];

  for (const [label, value, emphasised] of totals) {
    if (emphasised) {
      y += 4;
      rule(doc, y, totalsLeft);
      y += 8;
    }

    doc.font(emphasised ? 'Helvetica-Bold' : 'Helvetica').fontSize(emphasised ? 11 : 9.5);
    doc.fillColor(emphasised ? ACCENT : MUTED);
    doc.text(label, totalsLeft, y, { width: labelWidth, align: 'right' });
    doc.fillColor(emphasised ? ACCENT : INK);
    doc.text(value, totalsLeft + labelWidth, y, { width: valueWidth, align: 'right' });
    y = doc.y + 4;
  }

  // --- Footer notes -------------------------------------------------------
  y += 18;

  if (invoice.lineItems.some((line) => !line.isTaxable)) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    doc.text('* Outside the tax base on this invoice.', left, y, { width: TABLE_WIDTH });
    y = doc.y + 6;
  }

  if (invoice.notes) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    doc.text(invoice.notes, left, y, { width: TABLE_WIDTH });
  }

  doc.end();
  return doc;
}

function rule(doc: PDFKit.PDFDocument, y: number, from = PAGE_MARGIN): void {
  doc
    .strokeColor(RULE)
    .lineWidth(0.75)
    .moveTo(from, y)
    .lineTo(PAGE_MARGIN + TABLE_WIDTH, y)
    .stroke();
}

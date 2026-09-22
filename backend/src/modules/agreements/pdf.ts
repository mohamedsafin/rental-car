/**
 * modules/agreements/pdf.ts
 * ---------------------------------------------------------------------------
 * Renders a stored rental agreement as a PDF.
 *
 * Like the invoice renderer, it takes the AGREEMENT ROW and nothing else. The
 * document is drawn entirely from the snapshot written at issue time, so the
 * copy printed at the counter, the copy emailed afterwards and the copy pulled
 * up in a dispute two years later are the same piece of paper.
 *
 * Where a value was never captured - no VIN, no insurance excess, no signature
 * yet - it prints a visible gap. A blank somebody notices is far better than a
 * plausible placeholder nobody does.
 */
import PDFDocument from 'pdfkit';
import type { RentalAgreement } from '@prisma/client';

const PAGE_MARGIN = 48;
const INK = '#1e2430';
const MUTED = '#6b7280';
const RULE = '#d8dde5';
const ACCENT = '#0f172a';
const WIDTH = 499;

const BLANK = '—';

export function renderAgreementPdf(agreement: RentalAgreement): NodeJS.ReadableStream {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    info: {
      Title: agreement.agreementNumber,
      Author: agreement.companyName ?? 'Car rental',
      Subject: 'Vehicle rental agreement',
    },
  });

  const left = PAGE_MARGIN;

  // --- Header -------------------------------------------------------------
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(20);
  doc.text('VEHICLE RENTAL AGREEMENT', left, PAGE_MARGIN, { width: 320 });

  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  doc.text(agreement.agreementNumber, left, doc.y + 2);
  doc.text(`Issued ${date(agreement.issuedAt)}`);

  if (agreement.status === 'VOID') {
    doc.font('Helvetica-Bold').fillColor('#b91c1c');
    doc.text('VOID - superseded by a replacement agreement');
    if (agreement.voidReason) doc.font('Helvetica').text(agreement.voidReason, { width: 320 });
    doc.font('Helvetica').fillColor(MUTED);
  }

  // Company block, right-aligned against the header.
  doc.fontSize(10).fillColor(INK).font('Helvetica-Bold');
  doc.text(agreement.companyName ?? '[company name not set]', left, PAGE_MARGIN, {
    width: WIDTH,
    align: 'right',
  });

  doc.font('Helvetica').fillColor(MUTED).fontSize(9);
  for (const line of [
    agreement.companyAddress,
    agreement.companyPhone,
    agreement.companyEmail,
    agreement.companyTrn ? `TRN ${agreement.companyTrn}` : null,
  ]) {
    if (!line) continue;
    doc.text(line, left, doc.y, { width: WIDTH, align: 'right' });
  }

  let y = Math.max(doc.y, PAGE_MARGIN + 92) + 16;

  // --- The two parties ----------------------------------------------------
  y = sectionRule(doc, y);
  y = heading(doc, 'THE HIRER', y);
  y = pairs(doc, y, [
    ['Name', agreement.customerName],
    ['Email', agreement.customerEmail],
    ['Phone', agreement.customerPhone],
    ['Address', agreement.customerAddress],
    ['Driving licence', agreement.licenceNumber],
    ['Licence expiry', agreement.licenceExpiry ? date(agreement.licenceExpiry) : null],
    ['Emirates ID', agreement.emiratesIdNumber],
    ['Passport', agreement.passportNumber],
  ]);

  // --- The vehicle --------------------------------------------------------
  y = sectionRule(doc, y + 8);
  y = heading(doc, 'THE VEHICLE', y);
  y = pairs(doc, y, [
    ['Vehicle', agreement.vehicleDescription],
    ['Plate', agreement.registrationNumber],
    ['Chassis (VIN)', agreement.vin],
    ['Odometer at handover', agreement.pickupMileage === null ? null : `${agreement.pickupMileage} km`],
  ]);

  // --- The rental ---------------------------------------------------------
  y = sectionRule(doc, y + 8);
  y = heading(doc, 'THE RENTAL', y);
  y = pairs(doc, y, [
    ['Collection', `${dateTime(agreement.pickupAt)}${agreement.pickupLocation ? ` — ${agreement.pickupLocation}` : ''}`],
    ['Return', `${dateTime(agreement.returnAt)}${agreement.dropoffLocation ? ` — ${agreement.dropoffLocation}` : ''}`],
    ['Duration', `${agreement.rentalDays} day${agreement.rentalDays === 1 ? '' : 's'}`],
    [
      'Mileage allowance',
      agreement.mileageLimitPerDay === null
        ? 'Unlimited'
        : `${agreement.mileageLimitPerDay} km per day` +
          (agreement.extraMileageCharge
            ? `, then ${agreement.currency} ${agreement.extraMileageCharge.toFixed(2)} per km`
            : ''),
    ],
    ['Fuel', agreement.fuelPolicy],
  ]);

  // --- Who may drive ------------------------------------------------------
  // Printed whether or not anybody was added: "the hirer only" is a term of
  // the contract, not an empty field, and a driver who never appears on the
  // paper is a driver the insurer never covered.
  y = sectionRule(doc, y + 8);
  y = heading(doc, 'AUTHORISED DRIVERS', y);
  y = pairs(doc, y, [['The hirer', agreement.customerName]]);

  if (agreement.additionalDriversText) {
    for (const line of agreement.additionalDriversText.split('\n')) {
      y = pairs(doc, y, [['Additional driver', line]]);
    }
  } else {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    doc.text('No additional drivers. Nobody else is insured to drive this vehicle.', PAGE_MARGIN, y, {
      width: WIDTH,
    });
    y = doc.y + 4;
  }

  // --- Money --------------------------------------------------------------
  y = sectionRule(doc, y + 8);
  y = heading(doc, 'CHARGES', y);
  y = pairs(doc, y, [
    ['Rental', `${agreement.currency} ${agreement.rentalAmount.toFixed(2)}`],
    ['VAT', `${agreement.currency} ${agreement.taxAmount.toFixed(2)}`],
    ['Total payable', `${agreement.currency} ${agreement.totalAmount.toFixed(2)}`, true],
    [
      'Refundable security deposit',
      `${agreement.currency} ${agreement.securityDeposit.toFixed(2)}`,
    ],
  ]);

  // --- Insurance ----------------------------------------------------------
  y = sectionRule(doc, y + 8);
  y = heading(doc, 'INSURANCE', y);
  y = pairs(doc, y, [
    ['Insurer', agreement.insurerName],
    ['Policy number', agreement.policyNumber],
    [
      'Excess payable by the hirer',
      agreement.excessAmount ? `${agreement.currency} ${agreement.excessAmount.toFixed(2)}` : null,
      true,
    ],
  ]);

  // --- Terms --------------------------------------------------------------
  if (agreement.termsBody) {
    doc.addPage();
    y = PAGE_MARGIN;
    y = heading(doc, `TERMS AND CONDITIONS${agreement.termsVersion ? ` — ${agreement.termsVersion}` : ''}`, y);

    doc.font('Helvetica').fontSize(8.5).fillColor(INK);
    doc.text(agreement.termsBody, left, y, { width: WIDTH, align: 'left' });
    y = doc.y + 18;
  }

  // --- Signatures ---------------------------------------------------------
  // Kept together: a signature block split across a page break is the one part
  // of the document somebody will later claim they never saw.
  const SIGNATURE_BLOCK = 130;
  if (y + SIGNATURE_BLOCK > doc.page.height - PAGE_MARGIN) {
    doc.addPage();
    y = PAGE_MARGIN;
  }

  y = sectionRule(doc, y);
  y = heading(doc, 'SIGNATURES', y);

  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  doc.text(
    'By signing below the hirer confirms they have read and accepted the terms above, hold a valid licence, and are responsible for all traffic fines, tolls and damage incurred during the rental period.',
    left,
    y,
    { width: WIDTH },
  );
  y = doc.y + 16;

  const columnWidth = (WIDTH - 40) / 2;
  signature(doc, left, y, columnWidth, 'The hirer', agreement.customerSignedName, agreement.customerSignedAt);
  signature(
    doc,
    left + columnWidth + 40,
    y,
    columnWidth,
    `For ${agreement.companyName ?? 'the company'}`,
    agreement.staffSignedName,
    agreement.staffSignedAt,
  );

  doc.end();
  return doc;
}

/** One signature column: name, rule, role, and when it was signed. */
function signature(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  role: string,
  name: string | null,
  at: Date | null,
): void {
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK);
  doc.text(name ?? '', x, y, { width });

  const lineY = y + 22;
  doc.strokeColor(RULE).lineWidth(0.75).moveTo(x, lineY).lineTo(x + width, lineY).stroke();

  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  doc.text(role, x, lineY + 5, { width });
  doc.text(at ? `Signed ${dateTime(at)}` : 'Not signed', x, doc.y, { width });
}

function heading(doc: PDFKit.PDFDocument, label: string, y: number): number {
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
  doc.text(label, PAGE_MARGIN, y, { width: WIDTH });
  return doc.y + 6;
}

/**
 * A label/value grid. Values that were never captured print a dash, so the
 * reader can tell "not recorded" from "not applicable".
 */
function pairs(
  doc: PDFKit.PDFDocument,
  startY: number,
  rows: [string, string | null | undefined, boolean?][],
): number {
  const labelWidth = 150;
  const valueWidth = WIDTH - labelWidth - 10;
  let y = startY;

  for (const [label, value, emphasised] of rows) {
    if (y + 20 > doc.page.height - PAGE_MARGIN) {
      doc.addPage();
      y = PAGE_MARGIN;
    }

    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text(label, PAGE_MARGIN, y, { width: labelWidth });

    doc
      .font(emphasised ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(emphasised ? 10 : 9.5)
      .fillColor(value ? INK : MUTED);
    doc.text(value || BLANK, PAGE_MARGIN + labelWidth + 10, y, { width: valueWidth });

    y = Math.max(doc.y, y + 14) + 3;
  }

  return y;
}

function sectionRule(doc: PDFKit.PDFDocument, y: number): number {
  doc
    .strokeColor(RULE)
    .lineWidth(0.75)
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + WIDTH, y)
    .stroke();
  return y + 12;
}

const date = (value: Date): string => value.toISOString().slice(0, 10);

const dateTime = (value: Date): string =>
  `${value.toISOString().slice(0, 10)} ${value.toISOString().slice(11, 16)}`;

/**
 * tests/content-disposition.test.ts
 * ---------------------------------------------------------------------------
 * Guards the bug these tests were written for: a document uploaded under a
 * non-ASCII name (Tamil, Arabic, or anything accented - routine in the UAE)
 * used to be interpolated straight into the header, and `res.setHeader` threw
 * ERR_INVALID_CHAR, so every attempt to VIEW the file returned a 500 while the
 * upload itself had worked perfectly.
 *
 * The real assertion is the last one: the header must actually be settable.
 */
import { describe, it, expect } from 'vitest';
import { ServerResponse } from 'node:http';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { contentDisposition } from '../src/utils/contentDisposition';

const TAMIL = 'வீடு வாடகைக்கு.pdf';

describe('contentDisposition', () => {
  it('keeps a plain ASCII name readable in the fallback', () => {
    expect(contentDisposition('mulkiya.pdf')).toContain('filename="mulkiya.pdf"');
  });

  it('encodes a non-ASCII name into the RFC 5987 parameter', () => {
    const header = contentDisposition(TAMIL);
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent('வீடு'));
  });

  it('emits only latin1 characters, whatever the input', () => {
     
    expect(contentDisposition(TAMIL)).toMatch(/^[\x20-\x7e]*$/);
  });

  it('mangles an entirely non-ASCII name rather than dropping it', () => {
    // The real name still rides along in filename*, which browsers prefer.
    const header = contentDisposition('вложение');
    expect(header).toContain('filename="________"');
    expect(header).toContain("filename*=UTF-8''%D0%B2");
  });

  it('falls back to a name when there is nothing left to keep', () => {
    expect(contentDisposition('')).toContain('filename="download"');
  });

  it('strips a quote that would otherwise close the quoted string early', () => {
    expect(contentDisposition('in"voice.pdf')).toContain('filename="invoice.pdf"');
  });

  it('honours the attachment disposition', () => {
    expect(contentDisposition('a.pdf', 'attachment')).toMatch(/^attachment;/);
  });

  it('produces a header Node will actually accept', () => {
    const res = new ServerResponse(new IncomingMessage(new Socket()));
    expect(() => res.setHeader('Content-Disposition', contentDisposition(TAMIL))).not.toThrow();
  });
});

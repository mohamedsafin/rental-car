/**
 * tests/statement-parser.test.ts
 * ---------------------------------------------------------------------------
 * The statement parser, exercised on the shapes a real export actually takes.
 *
 * Pure input/output, so every awkward row can be tried without a fixture
 * rental behind it - which is the whole reason the parser has no database.
 */
import { describe, it, expect } from 'vitest';
import { parseStatement } from '../src/modules/fleet/statementParser';

describe('Salik statement parser', () => {
  it('reads a straightforward export', () => {
    const { rows, problems } = parseStatement(
      [
        'Plate,Date,Time,Toll Gate,Amount',
        'DEMO-D40001,03/04/2026,14:32,Al Barsha,4.00',
        'DEMO-D40001,03/04/2026,18:05,Airport Tunnel,4.00',
      ].join('\n'),
    );

    expect(problems).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.plate).toBe('DEMO-D40001');
    expect(rows[0]!.gate).toBe('Al Barsha');
    expect(rows[0]!.amount).toBe('4.00');
    // DAY first: 03/04 is 3 April, not 4 March.
    expect(rows[0]!.crossedAt.toISOString()).toBe('2026-04-03T14:32:00.000Z');
  });

  it('accepts the column names under their other spellings', () => {
    const { rows, problems } = parseStatement(
      ['Vehicle No,Transaction Date Time,Toll Plaza,Amount (AED),Trip ID', 'D40001,2026-04-03T14:32:00,Al Safa,4,TRIP-9'].join('\n'),
    );

    expect(problems).toHaveLength(0);
    expect(rows[0]!.plate).toBe('D40001');
    expect(rows[0]!.gate).toBe('Al Safa');
    expect(rows[0]!.reference).toBe('TRIP-9');
  });

  it('keeps a gate name that contains a comma intact', () => {
    // Splitting naively on the comma shifts every later column along one, so
    // the gate is read as the amount and the charge becomes nonsense.
    const { rows } = parseStatement(
      ['Plate,Date,Gate,Amount', 'D40001,03/04/2026,"Al Barsha, Dubai",4.00'].join('\n'),
    );

    expect(rows[0]!.gate).toBe('Al Barsha, Dubai');
    expect(rows[0]!.amount).toBe('4.00');
  });

  it('strips currency words and thousands separators from the amount', () => {
    const { rows } = parseStatement(
      ['Plate,Date,Amount', 'D40001,03/04/2026,"AED 1,250.50"'].join('\n'),
    );
    expect(rows[0]!.amount).toBe('1250.50');
  });

  it('reports a bad row without abandoning the good ones', () => {
    const { rows, problems } = parseStatement(
      [
        'Plate,Date,Gate,Amount',
        'D40001,03/04/2026,Al Barsha,4.00',
        'D40001,not-a-date,Al Barsha,4.00',
        'D40001,05/04/2026,Al Barsha,free',
        ',05/04/2026,Al Barsha,4.00',
      ].join('\n'),
    );

    expect(rows).toHaveLength(1);
    expect(problems).toHaveLength(3);
    expect(problems.map((p) => p.line)).toEqual([3, 4, 5]);
    expect(problems[0]!.reason).toMatch(/date and time/i);
  });

  it('refuses a file whose columns it cannot identify, rather than guessing', () => {
    // Guessing here bills the wrong customer for the wrong amount, which is a
    // far worse outcome than an import that declines to run.
    const { rows, problems } = parseStatement(['a,b,c', '1,2,3'].join('\n'));

    expect(rows).toHaveLength(0);
    expect(problems[0]!.reason).toMatch(/could not find/i);
  });

  it('ignores zero and negative rows - reversals are not charges', () => {
    const { rows } = parseStatement(
      ['Plate,Date,Amount', 'D40001,03/04/2026,0.00', 'D40001,04/04/2026,-4.00'].join('\n'),
    );
    expect(rows).toHaveLength(0);
  });

  it('handles an empty file without throwing', () => {
    expect(parseStatement('')).toEqual({ rows: [], problems: [] });
  });
  it('says WHICH columns are missing, and what it did find', () => {
    // "Could not find the columns this needs" gave staff nothing to act on.
    // Usually the file is fine and the header row is one line further down -
    // which is obvious the moment you see the headings it actually read.
    const { problems } = parseStatement(['Vehicle Model,Colour', 'BMW,white'].join('\n'));

    expect(problems[0]!.reason).toContain('an amount column');
    expect(problems[0]!.reason).toContain('a date column');
    expect(problems[0]!.reason).toContain('"Vehicle Model"');
  });

  /*
   * A fixed list of column names is a running guess about what some portal
   * will print next year, and every heading missing from it refused a whole
   * upload. These are all ordinary spellings that used to fail outright.
   */
  describe('reads column headings by what they mean', () => {
    const PLATE_HEADINGS = [
      'Plate No',
      'Vehicle Plate Number',
      'Vehicle Plate',
      'Car Number',
      'Number Plate',
      'Registration Number',
      'Licence Plate',
      'License Plate',
      'Tag Number',
    ];

    it.each(PLATE_HEADINGS)('finds the plate in a column called "%s"', (heading) => {
      const { rows, problems } = parseStatement(
        [`${heading},Date,Gate,Amount`, 'DEMO-D40001,20/09/2026,Al Safa,4.00'].join('\n'),
      );

      expect(problems).toHaveLength(0);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.plate).toBe('DEMO-D40001');
    });

    it('prefers the plate column over one that merely describes the car', () => {
      const { rows } = parseStatement(
        [
          'Vehicle Name,Vehicle Plate Number,Date,Gate,Amount',
          'BMW 5 Series,DEMO-D40001,20/09/2026,Al Safa,4.00',
        ].join('\n'),
      );

      // Reading "BMW 5 Series" as the plate matches no car in any fleet, and
      // the whole statement would import as "not our vehicle".
      expect(rows[0]!.plate).toBe('DEMO-D40001');
    });

    it('does not mistake "Toll Gate" for the money next to "Toll Amount"', () => {
      const { rows } = parseStatement(
        ['Plate,Date,Toll Gate,Toll Amount', 'DEMO-D40001,20/09/2026,Al Safa,4.00'].join('\n'),
      );

      expect(rows[0]!.amount).toBe('4.00');
      expect(rows[0]!.gate).toBe('Al Safa');
    });

    it('accepts a separate date column and time column', () => {
      const { rows } = parseStatement(
        [
          'Plate,Crossing Date,Crossing Time,Gate Name,Charge',
          'DEMO-D40001,20/09/2026,07:30,Al Safa,4.00',
        ].join('\n'),
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.crossedAt.toISOString()).toBe('2026-09-20T07:30:00.000Z');
      expect(rows[0]!.amount).toBe('4.00');
    });
  });
});

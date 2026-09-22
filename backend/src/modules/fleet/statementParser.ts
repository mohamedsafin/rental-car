/**
 * modules/fleet/statementParser.ts
 * ---------------------------------------------------------------------------
 * Reads a Salik (or fines) statement into rows the fleet module can record.
 *
 * ===========================================================================
 * WHY A PARSER AND NOT A FIXED FORMAT
 * ===========================================================================
 * One car crosses a gate roughly sixty times a month. Ten cars is six hundred
 * rows, and typing those by hand is the single biggest time cost in running
 * tolls at all - it is why toll charges quietly go uncollected.
 *
 * The statement is whatever the operator exports, and that changes: column
 * names differ between portals and between years. So this matches columns by
 * MEANING rather than position, accepts the several spellings each one turns
 * up as, and reports what it could not understand instead of guessing. A
 * parser that silently mis-reads a column bills the wrong customer.
 *
 * Pure: text in, rows and problems out. No database, no clock. That is what
 * makes every odd row shape testable without a fixture rental.
 */

export interface ParsedCrossing {
  /** Row number in the file, so a problem can be pointed at. */
  line: number;
  /** The plate exactly as the statement wrote it. */
  plate: string;
  crossedAt: Date;
  gate: string | null;
  amount: string;
  reference: string | null;
  /**
   * What the driver did, on a FINES export: "overspeed", "no seatbelt".
   *
   * Null on a Salik statement, which has nothing to describe - a gate
   * crossing is the same event every time.
   */
  violation: string | null;
}

export interface ParseProblem {
  line: number;
  reason: string;
  raw: string;
}

export interface ParseResult {
  rows: ParsedCrossing[];
  problems: ParseProblem[];
}

/**
 * The column names each field is known by.
 *
 * Compared lowercased with punctuation stripped, so "Toll Gate", "toll_gate"
 * and "TOLLGATE" are one thing.
 */
const COLUMN_ALIASES: Record<
  'plate' | 'datetime' | 'date' | 'time' | 'gate' | 'amount' | 'reference' | 'violation',
  string[]
> = {
  plate: ['plate', 'plateno', 'platenumber', 'vehicle', 'vehicleno', 'vehiclenumber', 'registration', 'regno', 'tag', 'tagnumber'],
  datetime: ['datetime', 'transactiondatetime', 'crossedat', 'timestamp', 'transactiondate'],
  date: ['date', 'tripdate', 'crossingdate'],
  time: ['time', 'triptime', 'crossingtime'],
  gate: ['gate', 'tollgate', 'location', 'plaza', 'tollplaza', 'gatename'],
  amount: ['amount', 'amountaed', 'fare', 'toll', 'charge', 'value', 'fine', 'fineamount'],
  reference: ['reference', 'ref', 'transactionid', 'trip', 'tripid', 'receipt', 'finenumber', 'fineno'],
  violation: ['violation', 'offence', 'offense', 'description', 'reason', 'violationtype', 'type'],
};

const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Score how much a column heading LOOKS LIKE the field we want.
 *
 * ===========================================================================
 * WHY SCORING AND NOT A LIST
 * ===========================================================================
 * This used to compare each heading against a fixed list of spellings, and
 * anything not on the list was invisible. "Plate No" worked; "Vehicle Plate
 * Number", "Registration Number", "Number Plate", "Car Number" and "License
 * Plate" - all perfectly ordinary things for a portal to print - were read as
 * "this file has no plate column", and the whole upload was refused.
 *
 * Every alias added to a list is a guess about what some portal will call a
 * column next year. Reading the WORDS in the heading generalises instead: a
 * heading containing "plate" is a plate column whatever else it says.
 *
 * Scores, rather than first-match, because headings compete. A file with both
 * "Vehicle Name" and "Vehicle Plate Number" has to pick the second - and a
 * file with "Toll Gate" and "Toll Amount" must not read the gate name as the
 * money.
 *
 * Returns 0 for "definitely not this field".
 */
type Field =
  | 'plate'
  | 'datetime'
  | 'date'
  | 'time'
  | 'gate'
  | 'amount'
  | 'reference'
  | 'violation';

function scoreHeading(field: Field, heading: string): number {
  const has = (...words: string[]) => words.some((word) => heading.includes(word));

  // Exact spellings we already knew about always win: they are unambiguous.
  if (COLUMN_ALIASES[field].includes(heading)) return 1000;

  switch (field) {
    case 'plate': {
      // A description of the car, not an identifier for it.
      if (has('model', 'brand', 'make', 'colour', 'color', 'class', 'category', 'type')) return 0;
      if (has('plate')) return 100;
      if (has('registration', 'regno')) return 90;
      if (has('tag')) return 80;
      if (has('vehicle', 'car')) return has('no', 'number', 'id') ? 70 : 50;
      return 0;
    }

    case 'datetime': {
      if (has('date') && has('time')) return 100;
      return 0;
    }

    case 'date': {
      if (has('date')) return 90;
      return 0;
    }

    case 'time': {
      // Only a time-ONLY column; a "date time" column is handled above.
      if (has('time') && !has('date')) return 90;
      return 0;
    }

    case 'gate': {
      if (has('gate', 'plaza')) return 100;
      if (has('location', 'point', 'site')) return 80;
      return 0;
    }

    case 'amount': {
      // "Toll Gate" contains "toll" and is emphatically not the money.
      if (has('gate', 'plaza', 'location', 'date', 'time', 'name', 'plate', 'number')) return 0;
      if (has('amount')) return 100;
      if (has('fare')) return 90;
      if (has('charge', 'fee', 'debit', 'cost', 'price')) return 80;
      if (has('aed', 'dirham', 'value')) return 70;
      if (has('toll', 'fine')) return 60;
      return 0;
    }

    case 'violation': {
      // "Violation Amount" is money, not a description of the offence.
      if (has('amount', 'fee', 'charge', 'aed', 'date', 'time', 'plate')) return 0;
      if (has('violation', 'offence', 'offense')) return 100;
      if (has('description', 'reason')) return 80;
      return 0;
    }

    case 'reference': {
      if (has('finenumber', 'fineno')) return 110;
      if (has('reference', 'ref')) return 100;
      if (has('transaction') && has('id', 'no', 'number')) return 90;
      if (has('receipt', 'voucher')) return 80;
      if (has('trip') && has('id', 'no', 'number')) return 70;
      return 0;
    }
  }
}

/**
 * Split one CSV line, honouring quoted fields.
 *
 * Gate names contain commas ("Al Barsha, Dubai"), so splitting on the comma
 * alone shifts every later column by one - which would read the gate as the
 * amount and bill nonsense.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      // A doubled quote inside a quoted field is a literal quote.
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

/**
 * Read a date that could be written several ways.
 *
 * UAE statements are overwhelmingly DAY-first, so an ambiguous 03/04/2026 is
 * read as 3 April. Getting this backwards would attribute a crossing to
 * whoever had the car a month earlier, which is worse than refusing the row -
 * so anything that is not clearly a date is reported rather than assumed.
 */
function parseDateTime(dateText: string, timeText?: string): Date | null {
  const combined = timeText ? `${dateText} ${timeText}` : dateText;
  const trimmed = combined.trim();
  if (!trimmed) return null;

  // ISO first: unambiguous, and what an API export usually gives.
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2})?:?(\d{2})?:?(\d{2})?/.exec(trimmed);
  if (iso) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = iso;
    return new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
    );
  }

  // Day-first: 03/04/2026 14:32 or 03-04-2026 14:32:00
  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(trimmed);
  if (dayFirst) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = dayFirst;
    if (Number(month) > 12) return null;
    return new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
    );
  }

  return null;
}

/** Strip currency words and separators: "AED 4.00", "4,00" and "4" all work. */
function parseAmount(text: string): string | null {
  const cleaned = text.replace(/[^0-9.,-]/g, '').replace(/,(?=\d{3}\b)/g, '');
  const normalised = cleaned.replace(',', '.');
  if (!normalised || Number.isNaN(Number(normalised))) return null;
  const value = Number(normalised);
  // A zero or negative toll is a reversal or a header artefact, not a charge.
  if (value <= 0) return null;
  return value.toFixed(2);
}

/**
 * Parse a whole statement.
 *
 * Every row is judged on its own: one unreadable line does not abandon the
 * other five hundred, it just appears in `problems` for someone to look at.
 */
export function parseStatement(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return { rows: [], problems: [] };

  const rawHeader = splitCsvLine(lines[0]!);
  const header = rawHeader.map(normalise);

  /** The best-scoring column for a field, or -1 when nothing looks like it. */
  const columnOf = (field: Field): number => {
    let best = -1;
    let bestScore = 0;

    header.forEach((cell, position) => {
      const score = scoreHeading(field, cell);
      // Strictly greater, so the LEFTMOST of two equally good headings wins -
      // statements put the identifier before the description.
      if (score > bestScore) {
        bestScore = score;
        best = position;
      }
    });

    return best;
  };

  const index = {
    plate: columnOf('plate'),
    datetime: columnOf('datetime'),
    date: columnOf('date'),
    time: columnOf('time'),
    gate: columnOf('gate'),
    amount: columnOf('amount'),
    reference: columnOf('reference'),
    violation: columnOf('violation'),
  };

  // One column cannot be two things. A file with a single "Date Time" column
  // matches both `datetime` and `date`; reading it twice is harmless, but a
  // "Toll" column claimed as both gate and amount is not.
  if (index.gate !== -1 && index.gate === index.amount) {
    index.amount = -1;
  }

  const problems: ParseProblem[] = [];

  if (index.plate === -1 || index.amount === -1 || (index.datetime === -1 && index.date === -1)) {
    /*
     * Name the missing columns and echo back what the file actually had.
     *
     * "Could not find the columns this needs" told staff nothing they could
     * act on. Nine times out of ten the file is fine and the header row is
     * one line further down, or the export came out tab-separated - both
     * obvious the moment you see the headings it read.
     */
    const missing = [
      index.plate === -1 ? 'a plate or vehicle column' : null,
      index.amount === -1 ? 'an amount column' : null,
      index.datetime === -1 && index.date === -1 ? 'a date column' : null,
    ].filter(Boolean);

    problems.push({
      line: 1,
      reason:
        `Could not find ${missing.join(', ')} in this file. The columns it found were: ` +
        `${rawHeader.map((cell) => `"${cell}"`).join(', ')}. ` +
        'The first row has to be the column headings.',
      raw: lines[0]!,
    });
    return { rows: [], problems };
  }

  const rows: ParsedCrossing[] = [];

  lines.slice(1).forEach((line, offset) => {
    const lineNumber = offset + 2; // 1-based, and the header was line 1.
    const cells = splitCsvLine(line);
    const cell = (position: number): string => (position === -1 ? '' : (cells[position] ?? '').trim());

    const plate = cell(index.plate);
    if (!plate) {
      problems.push({ line: lineNumber, reason: 'No plate or vehicle number', raw: line });
      return;
    }

    const crossedAt =
      index.datetime !== -1
        ? parseDateTime(cell(index.datetime))
        : parseDateTime(cell(index.date), index.time !== -1 ? cell(index.time) : undefined);

    if (!crossedAt || Number.isNaN(crossedAt.getTime())) {
      problems.push({ line: lineNumber, reason: 'Could not read the date and time', raw: line });
      return;
    }

    const amount = parseAmount(cell(index.amount));
    if (!amount) {
      problems.push({ line: lineNumber, reason: 'Could not read the amount', raw: line });
      return;
    }

    rows.push({
      line: lineNumber,
      plate,
      crossedAt,
      gate: cell(index.gate) || null,
      amount,
      reference: cell(index.reference) || null,
      violation: cell(index.violation) || null,
    });
  });

  return { rows, problems };
}

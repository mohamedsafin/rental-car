-- Booking references move from COUNT(*)+1 onto the atomic number_sequences
-- counter that invoices already use.
--
-- COUNT(*) went back DOWN whenever a booking was deleted, so the next booking
-- was issued a reference another row still held and the unique index rejected
-- it. The counter never counts rows, so it cannot rewind.
--
-- Seed it from the highest reference already issued this year rather than from
-- zero: starting at 1 in a database that already contains BK-2026-0001 would
-- reproduce the exact collision this is fixing. Bookings whose reference does
-- not match the BK-<year>-<digits> shape (demonstration data, imports) are
-- ignored - they were never part of the series.
INSERT INTO number_sequences (key, year, "lastValue", "updatedAt")
SELECT
  'booking',
  EXTRACT(YEAR FROM CURRENT_DATE)::int,
  COALESCE(
    MAX(SUBSTRING("bookingNumber" FROM '^BK-[0-9]{4}-([0-9]+)$')::int),
    0
  ),
  NOW()
FROM bookings
WHERE "bookingNumber" ~ ('^BK-' || EXTRACT(YEAR FROM CURRENT_DATE)::int || '-[0-9]+$')
ON CONFLICT (key) DO NOTHING;

-- A database with no bookings at all yields no row from the SELECT above, so
-- make sure the counter exists either way.
INSERT INTO number_sequences (key, year, "lastValue", "updatedAt")
VALUES ('booking', EXTRACT(YEAR FROM CURRENT_DATE)::int, 0, NOW())
ON CONFLICT (key) DO NOTHING;

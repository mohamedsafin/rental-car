/**
 * scripts/generateVehicleImages.ts
 * ---------------------------------------------------------------------------
 * Gives every vehicle a real image file, drawn in its own colour.
 *
 *   npm run images:generate --workspace backend            # only cars with none
 *   npm run images:generate --workspace backend -- --force # redraw everything
 *
 * WHY THESE ARE DRAWN, NOT PHOTOGRAPHED
 *
 * There is no licensed photograph of *this* Nissan Patrol, in *this* colour,
 * available to this script. The two obvious shortcuts are both worse than
 * drawing:
 *
 *   - Stock photography would put a picture of a car that is NOT the car on
 *     the page. A customer notices that at handover, and it is a licensing
 *     problem besides.
 *   - Leaving them blank makes a real fleet look broken.
 *
 * So each car gets an illustration rendered from its OWN row - body style from
 * its doors and category, paint from its `color` column. A white Land Cruiser
 * and a red Mustang look different because they ARE different, not because a
 * placeholder was tinted at random. Nobody will mistake one for a photo, which
 * is the point: an honest drawing beats a misleading photograph.
 *
 * Real photos replace these the moment staff upload any - the card prefers
 * `primaryImageUrl`, and the admin image manager overwrites this row.
 *
 * NO NEW DEPENDENCIES. The PNG encoder below is ~60 lines of zlib and CRC32,
 * which is cheaper than adding a native image library to the deployment for
 * one script that runs once.
 */
import zlib from 'node:zlib';
import { prisma } from '../src/config/prisma';
import { storage } from '../src/services/storage';

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));

  return Buffer.concat([length, typed, crc]);
}

/** RGB pixel buffer -> a valid PNG. Colour type 2, 8 bits, no interlacing. */
function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Each scanline is prefixed with its filter byte. 0 = None, which compresses
  // perfectly well here because the image is mostly flat colour and gradients.
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Drawing ---------------------------------------------------------------

const WIDTH = 960;
const HEIGHT = 600;

type Rgb = [number, number, number];

/**
 * Paint from the vehicle's own `color` column.
 *
 * Matched on keywords because the column is free text written by whoever added
 * the car - "Guards Red", "Santorini Black", "Midnight Silver". Anything
 * unrecognised falls back to a neutral graphite rather than guessing.
 */
function paintFor(color: string | null): Rgb {
  const value = (color ?? '').toLowerCase();
  const table: [string, Rgb][] = [
    ['white', [238, 240, 243]],
    ['silver', [176, 182, 190]],
    ['titanium', [166, 170, 174]],
    ['grey', [104, 110, 120]],
    ['gray', [104, 110, 120]],
    ['black', [38, 42, 50]],
    ['blue', [42, 88, 158]],
    ['red', [176, 42, 46]],
    ['orange', [214, 106, 34]],
    ['green', [46, 108, 78]],
    ['yellow', [222, 176, 44]],
    ['brown', [104, 74, 54]],
    ['beige', [206, 192, 168]],
  ];

  for (const [needle, rgb] of table) if (value.includes(needle)) return rgb;
  return [92, 98, 108];
}

/** Backdrop tint per category, so a grid of cards is not one flat colour. */
const BACKDROPS: Record<string, [Rgb, Rgb]> = {
  economy: [[238, 242, 247], [214, 223, 234]],
  sedan: [[233, 239, 248], [206, 219, 236]],
  suv: [[234, 241, 236], [209, 226, 216]],
  luxury: [[243, 238, 230], [227, 214, 192]],
  sports: [[247, 236, 236], [233, 208, 208]],
  electric: [[232, 242, 245], [201, 224, 234]],
  premium: [[239, 236, 245], [217, 209, 234]],
};

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function shade(rgb: Rgb, amount: number): Rgb {
  const target: Rgb = amount > 0 ? [255, 255, 255] : [0, 0, 0];
  return mix(rgb, target, Math.abs(amount));
}

type BodyStyle = 'coupe' | 'suv' | 'sedan' | 'hatch';

function bodyStyleFor(categorySlug: string, doors: number, seats: number): BodyStyle {
  if (doors <= 2 || categorySlug === 'sports') return 'coupe';
  if (categorySlug === 'suv' || seats >= 7) return 'suv';
  if (categorySlug === 'economy') return 'hatch';
  return 'sedan';
}

interface Geometry {
  bodyTop: number;
  bodyBottom: number;
  bodyLeft: number;
  bodyRight: number;
  roofTop: number;
  roofLeft: number;
  roofRight: number;
  wheelY: number;
  wheelR: number;
  wheelXs: [number, number];
}

function geometryFor(style: BodyStyle): Geometry {
  const base: Geometry = {
    bodyTop: 300,
    bodyBottom: 430,
    bodyLeft: 110,
    bodyRight: 850,
    roofTop: 200,
    roofLeft: 300,
    roofRight: 660,
    wheelY: 432,
    wheelR: 62,
    wheelXs: [270, 700],
  };

  switch (style) {
    case 'suv':
      return { ...base, bodyTop: 275, roofTop: 160, roofLeft: 275, roofRight: 690, wheelR: 70 };
    case 'coupe':
      return { ...base, bodyTop: 318, roofTop: 232, roofLeft: 330, roofRight: 630, wheelR: 64 };
    case 'hatch':
      return { ...base, bodyRight: 800, roofTop: 208, roofLeft: 300, roofRight: 640, wheelXs: [265, 660] };
    default:
      return base;
  }
}

/** Is (x, y) inside the car body? Rounded at the corners so it reads as a car. */
function insideBody(x: number, y: number, g: Geometry): boolean {
  if (y < g.bodyTop || y > g.bodyBottom) return false;

  const radius = 46;
  const left = g.bodyLeft;
  const right = g.bodyRight;
  if (x < left || x > right) return false;

  // Round the four corners.
  for (const [cx, cy] of [
    [left + radius, g.bodyTop + radius],
    [right - radius, g.bodyTop + radius],
    [left + radius, g.bodyBottom - radius],
    [right - radius, g.bodyBottom - radius],
  ] as [number, number][]) {
    const outsideX = (cx < left + radius && x < cx) || (cx > right - radius && x > cx);
    const outsideY = (cy < g.bodyTop + radius && y < cy) || (cy > g.bodyBottom - radius && y > cy);
    if (outsideX && outsideY && (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) return false;
  }

  return true;
}

/** The cabin: a trapezoid narrowing towards the roof. */
function insideCabin(x: number, y: number, g: Geometry): boolean {
  if (y < g.roofTop || y > g.bodyTop + 4) return false;

  const t = (y - g.roofTop) / (g.bodyTop - g.roofTop);
  // Widens as it descends, so the pillars rake like a real windscreen.
  const left = g.roofLeft - (g.roofLeft - (g.bodyLeft + 90)) * t;
  const right = g.roofRight + (g.bodyRight - 90 - g.roofRight) * t;

  return x >= left && x <= right;
}

function insideWindow(x: number, y: number, g: Geometry): boolean {
  const inset = 16;
  if (y < g.roofTop + inset || y > g.bodyTop - 14) return false;

  const t = (y - g.roofTop) / (g.bodyTop - g.roofTop);
  const left = g.roofLeft - (g.roofLeft - (g.bodyLeft + 90)) * t + inset;
  const right = g.roofRight + (g.bodyRight - 90 - g.roofRight) * t - inset;

  // A pillar splitting the glass into two windows.
  const middle = (left + right) / 2;
  if (Math.abs(x - middle) < 9) return false;

  return x >= left && x <= right;
}

function renderVehicle(input: {
  categorySlug: string;
  doors: number;
  seats: number;
  color: string | null;
}): Buffer {
  const style = bodyStyleFor(input.categorySlug, input.doors, input.seats);
  const g = geometryFor(style);
  const paint = paintFor(input.color);
  const [backTop, backBottom] = BACKDROPS[input.categorySlug] ?? [
    [238, 240, 244],
    [216, 220, 227],
  ];

  const pixels = new Uint8Array(WIDTH * HEIGHT * 3);

  // 2x2 supersampling. Without it every edge is a staircase, which on a car
  // silhouette is the difference between "drawn" and "broken".
  const SAMPLES = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ];

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const backdrop = mix(backTop, backBottom, y / HEIGHT);

      let r = 0;
      let gg = 0;
      let b = 0;

      for (const [dx, dy] of SAMPLES) {
        const px = x + dx;
        const py = y + dy;
        let sample: Rgb = backdrop;

        // Ground shadow, softened towards its edge.
        const shadowDx = (px - 480) / 330;
        const shadowDy = (py - 500) / 26;
        const shadow = shadowDx * shadowDx + shadowDy * shadowDy;
        if (shadow < 1) sample = mix(sample, [40, 46, 56], 0.20 * (1 - shadow));

        // Wheels sit above the body so the arches read correctly.
        let onWheel = false;
        for (const wx of g.wheelXs) {
          const d = Math.hypot(px - wx, py - g.wheelY);
          if (d <= g.wheelR) {
            sample = d <= g.wheelR * 0.42 ? [150, 156, 165] : [32, 36, 44];
            if (d > g.wheelR * 0.42 && d < g.wheelR * 0.52) sample = [92, 98, 108];
            onWheel = true;
            break;
          }
        }

        if (!onWheel) {
          if (insideWindow(px, py, g)) {
            // Glass: darker at the top, catching light lower down.
            const t = (py - g.roofTop) / (g.bodyTop - g.roofTop);
            sample = mix([58, 72, 92], [130, 152, 176], t);
          } else if (insideCabin(px, py, g)) {
            sample = shade(paint, -0.12);
          } else if (insideBody(px, py, g)) {
            // Vertical gradient on the paint, plus a bright shoulder line -
            // that highlight is most of what makes it read as metal.
            const t = (py - g.bodyTop) / (g.bodyBottom - g.bodyTop);
            sample = mix(shade(paint, 0.18), shade(paint, -0.28), t);
            if (py > g.bodyTop + 34 && py < g.bodyTop + 44) sample = shade(sample, 0.22);
          }
        }

        r += sample[0];
        gg += sample[1];
        b += sample[2];
      }

      const index = (y * WIDTH + x) * 3;
      pixels[index] = Math.round(r / SAMPLES.length);
      pixels[index + 1] = Math.round(gg / SAMPLES.length);
      pixels[index + 2] = Math.round(b / SAMPLES.length);
    }
  }

  return encodePng(WIDTH, HEIGHT, pixels);
}

// --- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  const vehicles = await prisma.vehicle.findMany({
    where: { deletedAt: null },
    include: { category: { select: { slug: true } }, images: { select: { id: true } } },
    orderBy: [{ brand: 'asc' }, { model: 'asc' }],
  });

  console.log('\n  ---------------------------------------------------------------');
  console.log('   VEHICLE IMAGES');
  console.log('   Drawn per vehicle, in its own colour. Not photographs -');
  console.log('   real photos replace these as soon as staff upload any.');
  console.log('  ---------------------------------------------------------------\n');

  let created = 0;
  let skipped = 0;

  for (const vehicle of vehicles) {
    if (vehicle.images.length > 0 && !force) {
      skipped += 1;
      continue;
    }

    if (force && vehicle.images.length > 0) {
      // Remove the rows first; the files themselves are swept by
      // `npm run storage:sweep` once nothing references them.
      await prisma.vehicleImage.deleteMany({ where: { vehicleId: vehicle.id } });
    }

    const png = renderVehicle({
      categorySlug: vehicle.category.slug,
      doors: vehicle.doors,
      seats: vehicle.seats,
      color: vehicle.color,
    });

    const stored = await storage.upload({
      buffer: png,
      originalName: `${vehicle.brand}-${vehicle.model}.png`.toLowerCase().replace(/\s+/g, '-'),
      mimeType: 'image/png',
      folder: `vehicles/${vehicle.id}`,
      // Marketing imagery, cacheable by anyone. Not customer documents.
      visibility: 'public',
    });

    await prisma.vehicleImage.create({
      data: {
        vehicleId: vehicle.id,
        storageKey: stored.key,
        // A side profile - which is exactly what the drawing is.
        type: 'EXTERIOR_LEFT',
        altText: `${vehicle.brand} ${vehicle.model} ${vehicle.year}${vehicle.color ? `, ${vehicle.color}` : ''}`,
        isPrimary: true,
        sortOrder: 0,
        sizeBytes: stored.sizeBytes,
        mimeType: stored.mimeType,
      },
    });

    created += 1;
    console.log(
      `    ${vehicle.brand} ${vehicle.model}`.padEnd(38) +
        `${vehicle.color ?? 'no colour'}`.padEnd(18) +
        `${(png.length / 1024).toFixed(0)} KB`,
    );
  }

  console.log(`\n  ${created} images created, ${skipped} vehicles already had one.`);
  if (skipped > 0 && !force) console.log('  Use --force to redraw those too.\n');
  else console.log('');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

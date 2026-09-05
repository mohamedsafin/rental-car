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
 * available to this script. The two obvious shortcuts are both worse:
 *
 *   - Stock photography puts a picture of a car that is NOT the car on the
 *     page. A customer notices that at handover, and it is a licensing
 *     problem besides.
 *   - Leaving them blank makes a real fleet look broken.
 *
 * So each car is drawn from its OWN row: silhouette from its body style, paint
 * from its `color` column. Real photos replace these the moment staff upload
 * any - the card prefers `primaryImageUrl`.
 *
 * HOW THE SHAPES WORK
 *
 * The first version composed a rounded rectangle and a trapezoid, which meant
 * a Mustang and a Land Cruiser came out as the same generic estate car. Body
 * style was in the data and invisible in the picture.
 *
 * Now each style is a hand-placed POLYGON traced along the real silhouette -
 * bonnet line, windscreen rake, roof, rear - and filled by point-in-polygon
 * test. A coupe gets a long bonnet, a steeply raked screen and a fastback
 * tail; an SUV gets an upright greenhouse, a tall body and visible ground
 * clearance. They are recognisable at thumbnail size, which is the only size
 * that matters on a listing card.
 *
 * NO NEW DEPENDENCIES. The PNG encoder is ~40 lines of zlib and CRC32, cheaper
 * than adding a native image library to the deployment for a script that runs
 * once.
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
  header[8] = 8;
  header[9] = 2;

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

// --- Colour ----------------------------------------------------------------

const WIDTH = 960;
const HEIGHT = 600;

type Rgb = [number, number, number];
type Point = [number, number];

/**
 * Paint from the vehicle's own `color` column.
 *
 * Matched on keywords because the column is free text - "Guards Red",
 * "Santorini Black", "Midnight Silver". Anything unrecognised falls back to a
 * neutral graphite rather than guessing.
 */
function paintFor(color: string | null): Rgb {
  const value = (color ?? '').toLowerCase();
  const table: [string, Rgb][] = [
    ['pearl white', [242, 243, 245]],
    ['white', [232, 235, 239]],
    ['silver', [172, 179, 188]],
    ['titanium', [158, 163, 168]],
    ['grey', [96, 103, 113]],
    ['gray', [96, 103, 113]],
    ['black', [32, 36, 44]],
    ['blue', [38, 84, 156]],
    ['red', [172, 38, 44]],
    ['orange', [212, 102, 32]],
    ['green', [42, 104, 74]],
    ['yellow', [220, 172, 40]],
    ['brown', [100, 70, 50]],
    ['beige', [204, 190, 166]],
  ];
  for (const [needle, rgb] of table) if (value.includes(needle)) return rgb;
  return [88, 94, 104];
}

const BACKDROPS: Record<string, [Rgb, Rgb]> = {
  economy: [[240, 244, 249], [216, 225, 236]],
  sedan: [[236, 242, 250], [208, 221, 238]],
  suv: [[236, 243, 238], [211, 228, 218]],
  luxury: [[245, 240, 232], [229, 216, 194]],
  sports: [[249, 238, 238], [235, 210, 210]],
  electric: [[234, 244, 247], [203, 226, 236]],
  premium: [[241, 238, 247], [219, 211, 236]],
};

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function shade(rgb: Rgb, amount: number): Rgb {
  return mix(rgb, amount > 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(amount));
}

// --- Silhouettes -----------------------------------------------------------

type BodyStyle = 'coupe' | 'suv' | 'sedan' | 'hatch';

/**
 * DOOR COUNT decides the silhouette, not the marketing category.
 *
 * Keying off the category got five cars wrong: a Range Rover Sport, an Audi
 * Q5, a BMW X3, a Tesla Model Y and a BYD Atto 3 are all filed under `luxury`,
 * `premium` or `electric` - and were therefore drawn as saloons. They are
 * unmistakably SUVs, and a customer looking at the card knows it.
 *
 * Doors are physical. Two is a coupe. Five means a tailgate, which is an SUV
 * or a hatchback - and the category separates those two, which is the one
 * thing it is actually reliable for. Four doors and a separate boot is a
 * saloon.
 */
function bodyStyleFor(categorySlug: string, doors: number, seats: number): BodyStyle {
  if (doors <= 2 || categorySlug === 'sports') return 'coupe';
  if (doors >= 5 || seats >= 7 || categorySlug === 'suv') {
    return categorySlug === 'economy' ? 'hatch' : 'suv';
  }
  return 'sedan';
}

interface Shape {
  /** Outer silhouette, traced clockwise from the front bumper. */
  body: Point[];
  /** Glass areas, drawn over the body. */
  windows: Point[][];
  wheels: { x: number; y: number; r: number }[];
  /** Where the doors meet, drawn as a shut line. */
  doorLines: number[];
  headlight: Point[];
  taillight: Point[];
  /** Y of the crease running along the flank - the shoulder highlight. */
  shoulderY: number;
}

/**
 * Hand-traced profiles. The numbers are deliberate, not parametric: a real
 * car's proportions are not a formula, and four hand-placed outlines look far
 * more like cars than one shape with four multipliers.
 */
const SHAPES: Record<BodyStyle, Shape> = {
  sedan: {
    body: [
      [96, 404], [104, 366], [150, 350], [250, 342], [318, 336],
      [392, 246], [520, 236], [610, 244], [676, 330], [790, 340],
      [858, 356], [872, 380], [874, 424], [846, 436], [110, 436], [92, 424],
    ],
    windows: [
      [[336, 330], [396, 262], [498, 254], [498, 330]],
      [[514, 254], [600, 260], [656, 330], [514, 330]],
    ],
    wheels: [
      { x: 262, y: 436, r: 62 },
      { x: 706, y: 436, r: 62 },
    ],
    doorLines: [506],
    headlight: [[104, 366], [150, 352], [156, 372], [106, 382]],
    taillight: [[812, 344], [862, 358], [860, 380], [810, 372]],
    shoulderY: 372,
  },

  suv: {
    body: [
      [92, 380], [100, 330], [146, 306], [246, 298], [306, 292],
      [352, 196], [688, 192], [752, 288], [846, 296], [872, 318],
      [876, 410], [844, 424], [116, 424], [90, 408],
    ],
    windows: [
      [[326, 284], [358, 214], [508, 210], [508, 284]],
      [[524, 210], [676, 212], [730, 284], [524, 284]],
    ],
    wheels: [
      { x: 258, y: 430, r: 74 },
      { x: 712, y: 430, r: 74 },
    ],
    doorLines: [516],
    headlight: [[100, 330], [148, 310], [154, 334], [102, 348]],
    taillight: [[806, 300], [864, 320], [862, 346], [804, 332]],
    shoulderY: 336,
  },

  coupe: {
    body: [
      [82, 418], [92, 388], [160, 368], [286, 356], [352, 348],
      [446, 282], [556, 278], [648, 300], [768, 344], [846, 366],
      [870, 388], [872, 428], [842, 440], [104, 440], [80, 428],
    ],
    windows: [
      [[372, 342], [452, 296], [536, 292], [536, 342]],
      [[550, 292], [636, 310], [690, 342], [550, 342]],
    ],
    wheels: [
      { x: 248, y: 440, r: 66 },
      { x: 704, y: 440, r: 66 },
    ],
    doorLines: [544],
    headlight: [[92, 388], [156, 370], [162, 390], [94, 402]],
    taillight: [[800, 356], [852, 370], [850, 392], [798, 380]],
    shoulderY: 392,
  },

  hatch: {
    body: [
      [110, 398], [118, 362], [162, 346], [252, 338], [312, 332],
      [378, 248], [560, 244], [640, 250], [704, 330], [762, 344],
      [782, 366], [784, 420], [756, 432], [126, 432], [106, 420],
    ],
    windows: [
      [[330, 326], [382, 264], [486, 260], [486, 326]],
      [[502, 260], [630, 266], [686, 326], [502, 326]],
    ],
    wheels: [
      { x: 258, y: 432, r: 60 },
      { x: 654, y: 432, r: 60 },
    ],
    doorLines: [494],
    headlight: [[118, 362], [162, 348], [168, 368], [120, 378]],
    taillight: [[730, 348], [776, 364], [774, 386], [728, 374]],
    shoulderY: 368,
  },
};

/** Ray casting. Fast enough here, and exact at the edges once supersampled. */
function inPolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function boundsOf(polygon: Point[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function renderVehicle(input: {
  categorySlug: string;
  doors: number;
  seats: number;
  color: string | null;
}): Buffer {
  const style = bodyStyleFor(input.categorySlug, input.doors, input.seats);
  const shape = SHAPES[style];
  const paint = paintFor(input.color);
  const [backTop, backBottom] = BACKDROPS[input.categorySlug] ?? [
    [240, 242, 246],
    [218, 222, 229],
  ];

  // Precomputed so the inner loop can skip most of the canvas cheaply.
  const bodyBounds = boundsOf(shape.body);
  const windowBounds = shape.windows.map(boundsOf);

  const bodyTop = bodyBounds[1];
  const bodyBottom = bodyBounds[3];

  const pixels = new Uint8Array(WIDTH * HEIGHT * 3);
  const SAMPLES: Point[] = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ];

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;

      for (const [dx, dy] of SAMPLES) {
        const px = x + dx;
        const py = y + dy;
        let sample: Rgb = mix(backTop, backBottom, y / HEIGHT);

        // Ground shadow.
        const sx = (px - 480) / 350;
        const sy = (py - 508) / 24;
        const shadow = sx * sx + sy * sy;
        if (shadow < 1) sample = mix(sample, [38, 44, 54], 0.22 * (1 - shadow));

        // Wheels first, so the arches read as cut into the body.
        let drawn = false;
        for (const wheel of shape.wheels) {
          const d = Math.hypot(px - wheel.x, py - wheel.y);
          if (d > wheel.r) continue;

          if (d < wheel.r * 0.30) sample = [128, 134, 143];
          else if (d < wheel.r * 0.36) sample = [78, 84, 93];
          else if (d < wheel.r * 0.52) {
            // Spokes: five, so the wheel does not read as a flat disc.
            const angle = Math.atan2(py - wheel.y, px - wheel.x);
            const spoke = Math.cos(angle * 5);
            sample = spoke > 0.55 ? [116, 122, 131] : [58, 63, 71];
          } else if (d < wheel.r * 0.60) sample = [96, 102, 111];
          else sample = [26, 29, 35];

          drawn = true;
          break;
        }

        if (!drawn) {
          let onWindow = false;
          for (let i = 0; i < shape.windows.length; i += 1) {
            const [wx0, wy0, wx1, wy1] = windowBounds[i]!;
            if (px < wx0 || px > wx1 || py < wy0 || py > wy1) continue;
            if (!inPolygon(px, py, shape.windows[i]!)) continue;

            // Glass darkens towards the roof and catches light lower down.
            const t = (py - wy0) / Math.max(1, wy1 - wy0);
            sample = mix([48, 62, 82], [138, 160, 184], t);
            onWindow = true;
            break;
          }

          if (
            !onWindow &&
            px >= bodyBounds[0] &&
            px <= bodyBounds[2] &&
            py >= bodyTop &&
            py <= bodyBottom &&
            inPolygon(px, py, shape.body)
          ) {
            const t = (py - bodyTop) / (bodyBottom - bodyTop);
            sample = mix(shade(paint, 0.22), shade(paint, -0.34), t);

            // The shoulder crease - most of what makes flat colour read as
            // a metal panel catching light.
            const crease = Math.abs(py - shape.shoulderY);
            if (crease < 5) sample = shade(sample, 0.20 * (1 - crease / 5));
            else if (crease < 12 && py > shape.shoulderY) sample = shade(sample, -0.10);

            // Door shut lines.
            for (const doorX of shape.doorLines) {
              if (Math.abs(px - doorX) < 1.6 && py > shape.shoulderY - 30) {
                sample = shade(sample, -0.30);
              }
            }

            // Lamps, drawn last so they sit on the paint.
            if (inPolygon(px, py, shape.headlight)) sample = [246, 242, 220];
            else if (inPolygon(px, py, shape.taillight)) sample = [198, 52, 48];
          }
        }

        r += sample[0];
        g += sample[1];
        b += sample[2];
      }

      const index = (y * WIDTH + x) * 3;
      pixels[index] = Math.round(r / SAMPLES.length);
      pixels[index + 1] = Math.round(g / SAMPLES.length);
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
  console.log('   Drawn per vehicle, in its own colour and body style.');
  console.log('   Not photographs - real uploads replace them.');
  console.log('  ---------------------------------------------------------------\n');

  let created = 0;
  let skipped = 0;

  for (const vehicle of vehicles) {
    if (vehicle.images.length > 0 && !force) {
      skipped += 1;
      continue;
    }

    if (vehicle.images.length > 0) {
      // The rows go now; the orphaned files are reclaimed by
      // `npm run storage:sweep` once nothing references them.
      await prisma.vehicleImage.deleteMany({ where: { vehicleId: vehicle.id } });
    }

    const style = bodyStyleFor(vehicle.category.slug, vehicle.doors, vehicle.seats);
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
      visibility: 'public',
    });

    await prisma.vehicleImage.create({
      data: {
        vehicleId: vehicle.id,
        storageKey: stored.key,
        // A side profile, which is exactly what the drawing is.
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
        `${style}`.padEnd(9) +
        `${vehicle.color ?? '-'}`.padEnd(18) +
        `${(png.length / 1024).toFixed(0)} KB`,
    );
  }

  console.log(`\n  ${created} images created, ${skipped} skipped.`);
  console.log(skipped > 0 && !force ? '  Use --force to redraw those too.\n' : '');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

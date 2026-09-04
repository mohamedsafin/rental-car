/**
 * prisma/seedDemo.ts
 * ---------------------------------------------------------------------------
 * A DEMONSTRATION fleet, so the site can be shown, clicked through and tested
 * with something in it.
 *
 * This is a SEPARATE script from `seed.ts` on purpose, and the separation is
 * the whole point.
 *
 * `seed.ts` is the production seed. It creates the admin account and the
 * settings rows, and it leaves every client-owned number BLANK, because BRD 51
 * says rates, fees and deposits come from the client. A plausible-looking
 * invented price that quietly reaches production is worse than an empty field:
 * an empty field gets noticed and filled in, a wrong price gets charged.
 *
 * So the demo data lives here instead, behind its own command, with its own
 * banner, and it refuses to run in production. Every rate below is a
 * PLACEHOLDER chosen only so the pricing engine has something to work with.
 * None of it is client-approved and none of it should survive to launch.
 *
 * Run with:   npm run seed:demo --workspace backend
 * Remove with: npm run seed:demo:clear --workspace backend
 *
 * Safe to re-run - vehicles are matched on registration number, so re-running
 * updates rather than duplicating.
 */
import { PrismaClient, type FuelType, type Transmission } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

/**
 * Every demo plate starts with this. It is how the clear command knows what it
 * may delete: it removes demo rows and nothing else, so running it against a
 * database that also holds real vehicles cannot take the real ones with it.
 */
const DEMO_PLATE_PREFIX = 'DEMO-';

interface DemoVehicle {
  brand: string;
  model: string;
  year: number;
  variant?: string;
  plate: string;
  categorySlug: string;
  seats: number;
  doors: number;
  transmission: Transmission;
  fuelType: FuelType;
  color: string;
  /** PLACEHOLDER rate. Not client-approved. */
  dailyPrice: string;
  weeklyPrice: string;
  monthlyPrice: string;
  /** PLACEHOLDER deposit. Not client-approved. */
  securityDeposit: string;
  mileageLimitPerDay: number;
  extraMileageCharge: string;
  currentMileage: number;
  isFeatured?: boolean;
  description: string;
  featureSlugs: string[];
}

/**
 * Models chosen because they are the cars actually on UAE rental forecourts -
 * a fleet of invented models would make the demo useless for judging layout,
 * name lengths and category balance.
 *
 * The NUMBERS beside them are placeholders. See the banner above.
 */
const DEMO_FLEET: DemoVehicle[] = [
  // --- Economy -------------------------------------------------------------
  {
    brand: 'Nissan',
    model: 'Sunny',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}A10001`,
    categorySlug: 'economy',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'White',
    dailyPrice: '89.00',
    weeklyPrice: '540.00',
    monthlyPrice: '1750.00',
    securityDeposit: '1000.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '0.50',
    currentMileage: 18400,
    description:
      'A dependable, economical saloon for city driving. Light on fuel, easy to park and comfortable for four adults.',
    featureSlugs: ['bluetooth', 'reverse-camera'],
  },
  {
    brand: 'Toyota',
    model: 'Yaris',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}A10002`,
    categorySlug: 'economy',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Silver',
    dailyPrice: '95.00',
    weeklyPrice: '580.00',
    monthlyPrice: '1850.00',
    securityDeposit: '1000.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '0.50',
    currentMileage: 12750,
    description:
      'Compact and frugal, with a light steering setup that makes multi-storey car parks painless.',
    featureSlugs: ['bluetooth', 'reverse-camera', 'cruise-control'],
  },
  {
    brand: 'Mitsubishi',
    model: 'Attrage',
    year: 2023,
    plate: `${DEMO_PLATE_PREFIX}A10003`,
    categorySlug: 'economy',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Grey',
    dailyPrice: '85.00',
    weeklyPrice: '510.00',
    monthlyPrice: '1650.00',
    securityDeposit: '1000.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '0.50',
    currentMileage: 31200,
    description: 'The budget pick of the fleet. Genuinely cheap to run over a long rental.',
    featureSlugs: ['bluetooth'],
  },
  {
    brand: 'Hyundai',
    model: 'Accent',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}A10004`,
    categorySlug: 'economy',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Blue',
    dailyPrice: '92.00',
    weeklyPrice: '555.00',
    monthlyPrice: '1790.00',
    securityDeposit: '1000.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '0.50',
    currentMileage: 9800,
    description: 'Roomier inside than it looks, with a boot that takes two large suitcases.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'reverse-camera'],
  },

  // --- Sedan ---------------------------------------------------------------
  {
    brand: 'Toyota',
    model: 'Corolla',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}B20001`,
    categorySlug: 'sedan',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'White',
    dailyPrice: '130.00',
    weeklyPrice: '790.00',
    monthlyPrice: '2500.00',
    securityDeposit: '1500.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '0.60',
    currentMileage: 14300,
    isFeatured: true,
    description:
      'The default sensible choice: quiet at motorway speed, cheap to fuel and big enough for a family weekend.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'reverse-camera', 'cruise-control'],
  },
  {
    brand: 'Honda',
    model: 'Accord',
    year: 2023,
    plate: `${DEMO_PLATE_PREFIX}B20002`,
    categorySlug: 'sedan',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Black',
    dailyPrice: '155.00',
    weeklyPrice: '940.00',
    monthlyPrice: '2950.00',
    securityDeposit: '1500.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '0.60',
    currentMileage: 27600,
    description: 'A large, refined saloon with a properly comfortable back seat.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'reverse-camera', 'parking-sensors', 'cruise-control'],
  },
  {
    brand: 'Toyota',
    model: 'Camry',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}B20003`,
    categorySlug: 'sedan',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'HYBRID',
    color: 'Pearl White',
    dailyPrice: '170.00',
    weeklyPrice: '1020.00',
    monthlyPrice: '3200.00',
    securityDeposit: '1500.00',
    mileageLimitPerDay: 300,
    extraMileageCharge: '0.60',
    currentMileage: 8100,
    isFeatured: true,
    description:
      'Hybrid drivetrain, so it sips fuel in traffic. The most comfortable car in the mid-range fleet.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'reverse-camera', 'parking-sensors', 'cruise-control'],
  },
  {
    brand: 'Hyundai',
    model: 'Elantra',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}B20004`,
    categorySlug: 'sedan',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Red',
    dailyPrice: '125.00',
    weeklyPrice: '750.00',
    monthlyPrice: '2400.00',
    securityDeposit: '1500.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '0.60',
    currentMileage: 16900,
    description: 'Sharp styling and a well-equipped cabin for the money.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'reverse-camera'],
  },
  {
    brand: 'Chevrolet',
    model: 'Malibu',
    year: 2023,
    plate: `${DEMO_PLATE_PREFIX}B20005`,
    categorySlug: 'sedan',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Grey',
    dailyPrice: '140.00',
    weeklyPrice: '845.00',
    monthlyPrice: '2700.00',
    securityDeposit: '1500.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '0.60',
    currentMileage: 34500,
    description: 'A wide, softly sprung cruiser that suits long drives between emirates.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'cruise-control'],
  },

  // --- SUV -----------------------------------------------------------------
  {
    brand: 'Nissan',
    model: 'Patrol',
    year: 2024,
    variant: 'SE Platinum',
    plate: `${DEMO_PLATE_PREFIX}C30001`,
    categorySlug: 'suv',
    seats: 7,
    doors: 5,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Black',
    dailyPrice: '450.00',
    weeklyPrice: '2700.00',
    monthlyPrice: '8500.00',
    securityDeposit: '3000.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '1.50',
    currentMileage: 22400,
    isFeatured: true,
    description:
      'The desert default. Seven full-size seats, a commanding driving position and enough torque for dune roads.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'reverse-camera', 'parking-sensors', 'cruise-control', 'leather-seats'],
  },
  {
    brand: 'Toyota',
    model: 'Land Cruiser',
    year: 2023,
    plate: `${DEMO_PLATE_PREFIX}C30002`,
    categorySlug: 'suv',
    seats: 7,
    doors: 5,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'White',
    dailyPrice: '430.00',
    weeklyPrice: '2580.00',
    monthlyPrice: '8200.00',
    securityDeposit: '3000.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '1.50',
    currentMileage: 41800,
    description: 'Unbreakable, comfortable and equally happy on tarmac or sand.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'reverse-camera', 'parking-sensors', 'cruise-control', 'leather-seats'],
  },
  {
    brand: 'Toyota',
    model: 'Prado',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}C30003`,
    categorySlug: 'suv',
    seats: 7,
    doors: 5,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Silver',
    dailyPrice: '340.00',
    weeklyPrice: '2040.00',
    monthlyPrice: '6500.00',
    securityDeposit: '2500.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '1.20',
    currentMileage: 19200,
    description: 'A smaller, easier-to-park Land Cruiser with most of the same ability.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'reverse-camera', 'parking-sensors'],
  },
  {
    brand: 'Hyundai',
    model: 'Tucson',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}C30004`,
    categorySlug: 'suv',
    seats: 5,
    doors: 5,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Blue',
    dailyPrice: '190.00',
    weeklyPrice: '1140.00',
    monthlyPrice: '3600.00',
    securityDeposit: '1500.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '0.75',
    currentMileage: 11600,
    description: 'A mid-size crossover: raised seating without the bulk of a full SUV.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'reverse-camera', 'parking-sensors', 'cruise-control'],
  },
  {
    brand: 'Kia',
    model: 'Seltos',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}C30005`,
    categorySlug: 'suv',
    seats: 5,
    doors: 5,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Orange',
    dailyPrice: '165.00',
    weeklyPrice: '990.00',
    monthlyPrice: '3150.00',
    securityDeposit: '1500.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '0.75',
    currentMileage: 15400,
    description: 'Compact SUV with a surprisingly generous equipment list.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'reverse-camera'],
  },
  {
    brand: 'Ford',
    model: 'Explorer',
    year: 2023,
    plate: `${DEMO_PLATE_PREFIX}C30006`,
    categorySlug: 'suv',
    seats: 7,
    doors: 5,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Dark Grey',
    dailyPrice: '295.00',
    weeklyPrice: '1770.00',
    monthlyPrice: '5600.00',
    securityDeposit: '2500.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '1.00',
    currentMileage: 28300,
    description: 'Three usable rows and a big boot behind them - a proper family hauler.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'reverse-camera', 'parking-sensors', 'cruise-control'],
  },

  // --- Luxury --------------------------------------------------------------
  {
    brand: 'Mercedes-Benz',
    model: 'E-Class',
    year: 2024,
    variant: 'E 300',
    plate: `${DEMO_PLATE_PREFIX}D40001`,
    categorySlug: 'luxury',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Obsidian Black',
    dailyPrice: '650.00',
    weeklyPrice: '3900.00',
    monthlyPrice: '12500.00',
    securityDeposit: '5000.00',
    mileageLimitPerDay: 200,
    extraMileageCharge: '2.50',
    currentMileage: 7400,
    isFeatured: true,
    description:
      'Quiet, beautifully finished and effortless over distance. The car to arrive in.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'gps-navigation', 'reverse-camera', 'parking-sensors', 'cruise-control', 'leather-seats'],
  },
  {
    brand: 'BMW',
    model: '5 Series',
    year: 2024,
    variant: '530i',
    plate: `${DEMO_PLATE_PREFIX}D40002`,
    categorySlug: 'luxury',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Alpine White',
    dailyPrice: '620.00',
    weeklyPrice: '3720.00',
    monthlyPrice: '11900.00',
    securityDeposit: '5000.00',
    mileageLimitPerDay: 200,
    extraMileageCharge: '2.50',
    currentMileage: 10200,
    description: 'The driver’s executive saloon - sharper through corners than its rivals.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'gps-navigation', 'reverse-camera', 'parking-sensors', 'cruise-control', 'leather-seats'],
  },
  {
    brand: 'Land Rover',
    model: 'Range Rover Sport',
    year: 2023,
    plate: `${DEMO_PLATE_PREFIX}D40003`,
    categorySlug: 'luxury',
    seats: 5,
    doors: 5,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Santorini Black',
    dailyPrice: '890.00',
    weeklyPrice: '5340.00',
    monthlyPrice: '17000.00',
    securityDeposit: '7500.00',
    mileageLimitPerDay: 200,
    extraMileageCharge: '3.50',
    currentMileage: 16800,
    description: 'Presence, pace and a cabin that shrugs off broken tarmac.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'gps-navigation', 'reverse-camera', 'parking-sensors', 'cruise-control', 'leather-seats'],
  },
  {
    brand: 'Audi',
    model: 'Q5',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}D40004`,
    categorySlug: 'luxury',
    seats: 5,
    doors: 5,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Navarra Blue',
    dailyPrice: '520.00',
    weeklyPrice: '3120.00',
    monthlyPrice: '9900.00',
    securityDeposit: '4000.00',
    mileageLimitPerDay: 200,
    extraMileageCharge: '2.00',
    currentMileage: 13100,
    description: 'A restrained, high-quality SUV that is easy to live with day to day.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'gps-navigation', 'reverse-camera', 'parking-sensors', 'leather-seats'],
  },

  // --- Sports --------------------------------------------------------------
  {
    brand: 'Ford',
    model: 'Mustang',
    year: 2024,
    variant: 'GT Convertible',
    plate: `${DEMO_PLATE_PREFIX}E50001`,
    categorySlug: 'sports',
    seats: 4,
    doors: 2,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Race Red',
    dailyPrice: '750.00',
    weeklyPrice: '4500.00',
    monthlyPrice: '14000.00',
    securityDeposit: '6000.00',
    mileageLimitPerDay: 150,
    extraMileageCharge: '3.00',
    currentMileage: 9600,
    isFeatured: true,
    description: 'Roof down along the corniche. Loud, theatrical and enormous fun.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'reverse-camera', 'leather-seats'],
  },
  {
    brand: 'Chevrolet',
    model: 'Camaro',
    year: 2023,
    plate: `${DEMO_PLATE_PREFIX}E50002`,
    categorySlug: 'sports',
    seats: 4,
    doors: 2,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Summit White',
    dailyPrice: '690.00',
    weeklyPrice: '4140.00',
    monthlyPrice: '13000.00',
    securityDeposit: '6000.00',
    mileageLimitPerDay: 150,
    extraMileageCharge: '3.00',
    currentMileage: 18700,
    description: 'Lower and meaner than the Mustang, with a serious exhaust note.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'reverse-camera'],
  },
  {
    brand: 'Porsche',
    model: '911',
    year: 2023,
    variant: 'Carrera',
    plate: `${DEMO_PLATE_PREFIX}E50003`,
    categorySlug: 'sports',
    seats: 4,
    doors: 2,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Guards Red',
    dailyPrice: '1850.00',
    weeklyPrice: '11100.00',
    monthlyPrice: '35000.00',
    securityDeposit: '15000.00',
    mileageLimitPerDay: 100,
    extraMileageCharge: '8.00',
    currentMileage: 6300,
    description: 'The benchmark sports car, and usable enough to drive all day.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'gps-navigation', 'reverse-camera', 'parking-sensors', 'leather-seats'],
  },

  // --- Electric ------------------------------------------------------------
  {
    brand: 'Tesla',
    model: 'Model 3',
    year: 2024,
    variant: 'Long Range',
    plate: `${DEMO_PLATE_PREFIX}F60001`,
    categorySlug: 'electric',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'ELECTRIC',
    color: 'Midnight Silver',
    dailyPrice: '260.00',
    weeklyPrice: '1560.00',
    monthlyPrice: '4900.00',
    securityDeposit: '2500.00',
    mileageLimitPerDay: 300,
    extraMileageCharge: '1.00',
    currentMileage: 12400,
    isFeatured: true,
    description: 'Quick, silent and cheap to charge. Supercharger access along the E11.',
    featureSlugs: ['bluetooth', 'gps-navigation', 'reverse-camera', 'parking-sensors', 'cruise-control', 'leather-seats'],
  },
  {
    brand: 'Tesla',
    model: 'Model Y',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}F60002`,
    categorySlug: 'electric',
    seats: 5,
    doors: 5,
    transmission: 'AUTOMATIC',
    fuelType: 'ELECTRIC',
    color: 'Pearl White',
    dailyPrice: '295.00',
    weeklyPrice: '1770.00',
    monthlyPrice: '5600.00',
    securityDeposit: '2500.00',
    mileageLimitPerDay: 300,
    extraMileageCharge: '1.00',
    currentMileage: 8900,
    description: 'The Model 3 with a hatchback and a much larger boot.',
    featureSlugs: ['bluetooth', 'gps-navigation', 'reverse-camera', 'parking-sensors', 'cruise-control'],
  },
  {
    brand: 'BYD',
    model: 'Atto 3',
    year: 2024,
    plate: `${DEMO_PLATE_PREFIX}F60003`,
    categorySlug: 'electric',
    seats: 5,
    doors: 5,
    transmission: 'AUTOMATIC',
    fuelType: 'ELECTRIC',
    color: 'Surf Blue',
    dailyPrice: '210.00',
    weeklyPrice: '1260.00',
    monthlyPrice: '4000.00',
    securityDeposit: '2000.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '0.90',
    currentMileage: 14200,
    description: 'An affordable electric crossover with a genuinely spacious interior.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'reverse-camera'],
  },

  // --- Premium -------------------------------------------------------------
  {
    brand: 'Mercedes-Benz',
    model: 'C-Class',
    year: 2024,
    variant: 'C 200',
    plate: `${DEMO_PLATE_PREFIX}G70001`,
    categorySlug: 'premium',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Selenite Grey',
    dailyPrice: '390.00',
    weeklyPrice: '2340.00',
    monthlyPrice: '7400.00',
    securityDeposit: '3000.00',
    mileageLimitPerDay: 200,
    extraMileageCharge: '1.80',
    currentMileage: 11800,
    description: 'Junior E-Class: the same cabin quality in a more manageable size.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'android-auto', 'gps-navigation', 'reverse-camera', 'parking-sensors', 'leather-seats'],
  },
  {
    brand: 'BMW',
    model: 'X3',
    year: 2023,
    plate: `${DEMO_PLATE_PREFIX}G70002`,
    categorySlug: 'premium',
    seats: 5,
    doors: 5,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    color: 'Phytonic Blue',
    dailyPrice: '420.00',
    weeklyPrice: '2520.00',
    monthlyPrice: '8000.00',
    securityDeposit: '3000.00',
    mileageLimitPerDay: 200,
    extraMileageCharge: '1.80',
    currentMileage: 21500,
    description: 'A premium SUV that still drives like a car.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'gps-navigation', 'reverse-camera', 'parking-sensors', 'cruise-control', 'leather-seats'],
  },
  {
    brand: 'Lexus',
    model: 'ES',
    year: 2024,
    variant: '300h',
    plate: `${DEMO_PLATE_PREFIX}G70003`,
    categorySlug: 'premium',
    seats: 5,
    doors: 4,
    transmission: 'AUTOMATIC',
    fuelType: 'HYBRID',
    color: 'Sonic Titanium',
    dailyPrice: '360.00',
    weeklyPrice: '2160.00',
    monthlyPrice: '6900.00',
    securityDeposit: '3000.00',
    mileageLimitPerDay: 250,
    extraMileageCharge: '1.50',
    currentMileage: 9300,
    description: 'Exceptionally quiet hybrid saloon. The most comfortable ride in the fleet.',
    featureSlugs: ['bluetooth', 'apple-carplay', 'gps-navigation', 'reverse-camera', 'parking-sensors', 'cruise-control', 'leather-seats'],
  },
];

/**
 * Demo pickup points. Real office addresses, delivery areas and any delivery
 * charge come from the client (BRD 38, 51), so these carry a zero charge -
 * "not set" rather than an invented fee.
 */
const DEMO_LOCATIONS = [
  { name: 'Demo - Dubai Marina Office', slug: 'demo-dubai-marina', type: 'OFFICE' as const, emirate: 'Dubai' },
  { name: 'Demo - Dubai International Airport T3', slug: 'demo-dxb-t3', type: 'AIRPORT' as const, emirate: 'Dubai' },
  { name: 'Demo - Abu Dhabi Corniche Office', slug: 'demo-ad-corniche', type: 'OFFICE' as const, emirate: 'Abu Dhabi' },
  { name: 'Demo - Sharjah Al Majaz Office', slug: 'demo-sharjah-majaz', type: 'OFFICE' as const, emirate: 'Sharjah' },
];

async function seed(): Promise<void> {
  const categories = await prisma.vehicleCategory.findMany();
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));

  const features = await prisma.vehicleFeature.findMany();
  const featureBySlug = new Map(features.map((feature) => [feature.slug, feature.id]));

  if (categoryBySlug.size === 0) {
    throw new Error('No categories found. Run `npm run prisma:seed` first.');
  }

  for (const location of DEMO_LOCATIONS) {
    await prisma.location.upsert({
      where: { slug: location.slug },
      update: {},
      create: { ...location, deliveryCharge: '0' },
    });
  }

  const locations = await prisma.location.findMany({
    where: { slug: { startsWith: 'demo-' } },
    orderBy: { slug: 'asc' },
  });

  let created = 0;
  let updated = 0;

  for (const [index, car] of DEMO_FLEET.entries()) {
    const categoryId = categoryBySlug.get(car.categorySlug);
    if (!categoryId) {
      console.warn(`  ! Skipped ${car.brand} ${car.model}: no "${car.categorySlug}" category`);
      continue;
    }

    const existing = await prisma.vehicle.findUnique({
      where: { registrationNumber: car.plate },
      select: { id: true },
    });

    const data = {
      brand: car.brand,
      model: car.model,
      year: car.year,
      variant: car.variant ?? null,
      categoryId,
      seats: car.seats,
      doors: car.doors,
      transmission: car.transmission,
      fuelType: car.fuelType,
      color: car.color,
      dailyPrice: car.dailyPrice,
      weeklyPrice: car.weeklyPrice,
      monthlyPrice: car.monthlyPrice,
      securityDeposit: car.securityDeposit,
      mileageLimitPerDay: car.mileageLimitPerDay,
      extraMileageCharge: car.extraMileageCharge,
      currentMileage: car.currentMileage,
      isFeatured: car.isFeatured ?? false,
      isPublished: true,
      description: car.description,
      // Spread the fleet across the demo branches rather than parking it all
      // in one office - it makes the location filter worth testing.
      locationId: locations.length > 0 ? locations[index % locations.length]!.id : null,
    };

    const vehicle = existing
      ? await prisma.vehicle.update({ where: { id: existing.id }, data })
      : await prisma.vehicle.create({ data: { ...data, registrationNumber: car.plate } });

    if (existing) updated += 1;
    else created += 1;

    // Replace the feature set rather than adding to it, so re-running after
    // editing the list above converges instead of accumulating.
    await prisma.vehicleFeatureOnVehicle.deleteMany({ where: { vehicleId: vehicle.id } });
    const featureIds = car.featureSlugs
      .map((slug) => featureBySlug.get(slug))
      .filter((id): id is string => Boolean(id));

    if (featureIds.length > 0) {
      await prisma.vehicleFeatureOnVehicle.createMany({
        data: featureIds.map((featureId) => ({ vehicleId: vehicle.id, featureId })),
        skipDuplicates: true,
      });
    }
  }

  console.log(`\n  ${created} vehicles created, ${updated} updated.`);
  console.log(`  ${DEMO_LOCATIONS.length} demo pickup points available.`);
  console.log('\n  Every rate above is a PLACEHOLDER. Replace them with the');
  console.log('  client-approved figures before this goes anywhere near production.\n');
}

/** Removes only rows this script created - matched on the DEMO- plate prefix. */
async function clear(): Promise<void> {
  const demoVehicles = await prisma.vehicle.findMany({
    where: { registrationNumber: { startsWith: DEMO_PLATE_PREFIX } },
    select: { id: true, _count: { select: { bookings: true } } },
  });

  const withBookings = demoVehicles.filter((vehicle) => vehicle._count.bookings > 0);
  const removable = demoVehicles.filter((vehicle) => vehicle._count.bookings === 0);

  await prisma.vehicleFeatureOnVehicle.deleteMany({
    where: { vehicleId: { in: removable.map((vehicle) => vehicle.id) } },
  });
  await prisma.vehicleImage.deleteMany({
    where: { vehicleId: { in: removable.map((vehicle) => vehicle.id) } },
  });
  await prisma.vehicle.deleteMany({ where: { id: { in: removable.map((vehicle) => vehicle.id) } } });

  console.log(`\n  ${removable.length} demo vehicles removed.`);

  if (withBookings.length > 0) {
    // Deleting a vehicle someone has booked would orphan the booking and lose
    // the rental history behind it. Soft-delete is what that case is for.
    console.log(
      `  ${withBookings.length} kept: they have bookings against them. ` +
        'Unpublish or soft-delete those from the admin dashboard instead.',
    );
  }
  console.log('');
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('\n  Refusing to run: this is demonstration data, not production data.\n');
    process.exit(1);
  }

  const shouldClear = process.argv.includes('--clear');

  console.log('\n  ---------------------------------------------------------------');
  console.log('   DEMONSTRATION DATA');
  console.log('   Placeholder rates and deposits, chosen so the app has content.');
  console.log('   NONE of these figures are client-approved (BRD 51).');
  console.log('  ---------------------------------------------------------------');

  if (shouldClear) await clear();
  else await seed();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

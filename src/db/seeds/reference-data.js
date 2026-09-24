'use strict';

/**
 * Reference data for the seed script.
 *
 * Everything here is modelled on the real Indonesian market: the makes that
 * actually sell here, the models each one is known for, plausible engine sizes,
 * seating, drivetrains and price bands in IDR, and the cities listings are
 * actually concentrated in.
 *
 * Prices are used to pick a value *within* the band for the vehicle's age and
 * condition, so a 2015 Avanza is never priced like a 2024 one.
 *
 * All money is in IDR, expressed in full rupiah (not millions) to match the
 * numeric(14,2) column.
 */

/** Cities listings are concentrated in, with their province. */
const CITIES = [
  { city: 'Jakarta', province: 'DKI Jakarta', weight: 26 },
  { city: 'Surabaya', province: 'Jawa Timur', weight: 15 },
  { city: 'Bandung', province: 'Jawa Barat', weight: 13 },
  { city: 'Semarang', province: 'Jawa Tengah', weight: 8 },
  { city: 'Yogyakarta', province: 'DI Yogyakarta', weight: 8 },
  { city: 'Medan', province: 'Sumatera Utara', weight: 8 },
  { city: 'Makassar', province: 'Sulawesi Selatan', weight: 6 },
  { city: 'Denpasar', province: 'Bali', weight: 6 },
  { city: 'Tangerang', province: 'Banten', weight: 5 },
  { city: 'Bekasi', province: 'Jawa Barat', weight: 5 },
];

/** Colours as they appear in Indonesian listings. */
const COLORS = ['White', 'Black', 'Silver', 'Grey', 'Red', 'Blue', 'Brown', 'Gold'];

/**
 * Cars, grouped by the body type that decides their category.
 *
 * `engineCc` is a range so a model can span variants; `seats` likewise.
 * `fuel` lists the fuels that model is actually offered with here - it is not
 * uniform, which is what makes the fuel-type facet meaningful.
 */
const CARS = [
  // --- Toyota -------------------------------------------------------------
  { make: 'Toyota', model: 'Avanza', body: 'mpv', engineCc: [1300, 1500], seats: [7], drive: ['FWD'], fuel: ['gasoline'], price: [120_000_000, 245_000_000] },
  { make: 'Toyota', model: 'Innova', body: 'mpv', engineCc: [2000, 2400], seats: [7, 8], drive: ['RWD'], fuel: ['gasoline', 'diesel'], price: [300_000_000, 540_000_000] },
  { make: 'Toyota', model: 'Rush', body: 'suv', engineCc: [1500], seats: [7], drive: ['RWD'], fuel: ['gasoline'], price: [195_000_000, 300_000_000] },
  { make: 'Toyota', model: 'Calya', body: 'mpv', engineCc: [1000, 1200], seats: [7], drive: ['FWD'], fuel: ['gasoline'], price: [110_000_000, 175_000_000] },
  { make: 'Toyota', model: 'Agya', body: 'hatchback', engineCc: [1000, 1200], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [100_000_000, 170_000_000] },
  { make: 'Toyota', model: 'Fortuner', body: 'suv', engineCc: [2400, 2800], seats: [7], drive: ['RWD', 'AWD'], fuel: ['diesel', 'gasoline'], price: [430_000_000, 720_000_000] },
  { make: 'Toyota', model: 'Yaris', body: 'hatchback', engineCc: [1500], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [230_000_000, 340_000_000] },
  { make: 'Toyota', model: 'Corolla Altis', body: 'sedan', engineCc: [1800], seats: [5], drive: ['FWD'], fuel: ['gasoline', 'hybrid'], price: [400_000_000, 540_000_000] },
  { make: 'Toyota', model: 'Raize', body: 'suv', engineCc: [1000], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [220_000_000, 310_000_000] },
  { make: 'Toyota', model: 'Hilux', body: 'pickup', engineCc: [2400], seats: [5], drive: ['4WD'], fuel: ['diesel'], price: [340_000_000, 520_000_000] },
  { make: 'Toyota', model: 'Camry', body: 'sedan', engineCc: [2500], seats: [5], drive: ['FWD'], fuel: ['hybrid'], price: [560_000_000, 780_000_000] },
  { make: 'Toyota', model: 'Alphard', body: 'mpv', engineCc: [2500], seats: [7], drive: ['FWD'], fuel: ['hybrid'], price: [900_000_000, 1_600_000_000] },
  { make: 'Toyota', model: 'Land Cruiser', body: 'suv', engineCc: [3500], seats: [7], drive: ['4WD'], fuel: ['diesel'], price: [1_500_000_000, 2_000_000_000] },

  // --- Honda --------------------------------------------------------------
  { make: 'Honda', model: 'Brio', body: 'hatchback', engineCc: [1200], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [140_000_000, 225_000_000] },
  { make: 'Honda', model: 'Mobilio', body: 'mpv', engineCc: [1500], seats: [7], drive: ['FWD'], fuel: ['gasoline'], price: [150_000_000, 235_000_000] },
  { make: 'Honda', model: 'BR-V', body: 'suv', engineCc: [1500], seats: [7], drive: ['FWD'], fuel: ['gasoline'], price: [230_000_000, 340_000_000] },
  { make: 'Honda', model: 'HR-V', body: 'suv', engineCc: [1500], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [320_000_000, 460_000_000] },
  { make: 'Honda', model: 'CR-V', body: 'suv', engineCc: [1500, 2000], seats: [5, 7], drive: ['FWD', 'AWD'], fuel: ['gasoline', 'hybrid'], price: [450_000_000, 720_000_000] },
  { make: 'Honda', model: 'Jazz', body: 'hatchback', engineCc: [1500], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [230_000_000, 330_000_000] },
  { make: 'Honda', model: 'City', body: 'sedan', engineCc: [1500], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [280_000_000, 395_000_000] },
  { make: 'Honda', model: 'Civic', body: 'sedan', engineCc: [1500, 1800], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [400_000_000, 620_000_000] },

  // --- Mitsubishi ---------------------------------------------------------
  { make: 'Mitsubishi', model: 'Xpander', body: 'mpv', engineCc: [1500], seats: [7], drive: ['FWD'], fuel: ['gasoline'], price: [200_000_000, 330_000_000] },
  { make: 'Mitsubishi', model: 'Pajero Sport', body: 'suv', engineCc: [2400], seats: [7], drive: ['4WD', 'RWD'], fuel: ['diesel'], price: [450_000_000, 760_000_000] },
  { make: 'Mitsubishi', model: 'Outlander', body: 'suv', engineCc: [2000, 2400], seats: [7], drive: ['4WD'], fuel: ['gasoline'], price: [400_000_000, 620_000_000] },
  { make: 'Mitsubishi', model: 'L300', body: 'pickup', engineCc: [2500], seats: [3], drive: ['RWD'], fuel: ['diesel'], price: [175_000_000, 265_000_000] },
  { make: 'Mitsubishi', model: 'Triton', body: 'pickup', engineCc: [2400], seats: [5], drive: ['4WD'], fuel: ['diesel'], price: [300_000_000, 490_000_000] },

  // --- Suzuki -------------------------------------------------------------
  { make: 'Suzuki', model: 'Ertiga', body: 'mpv', engineCc: [1500], seats: [7], drive: ['FWD'], fuel: ['gasoline', 'hybrid'], price: [170_000_000, 285_000_000] },
  { make: 'Suzuki', model: 'XL7', body: 'suv', engineCc: [1500], seats: [7], drive: ['FWD'], fuel: ['gasoline', 'hybrid'], price: [220_000_000, 330_000_000] },
  { make: 'Suzuki', model: 'Ignis', body: 'hatchback', engineCc: [1200], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [160_000_000, 245_000_000] },
  { make: 'Suzuki', model: 'Swift', body: 'hatchback', engineCc: [1200, 1400], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [180_000_000, 300_000_000] },
  { make: 'Suzuki', model: 'Carry', body: 'pickup', engineCc: [1500], seats: [3], drive: ['RWD'], fuel: ['gasoline'], price: [120_000_000, 195_000_000] },
  { make: 'Suzuki', model: 'Jimny', body: 'suv', engineCc: [1500], seats: [4], drive: ['4WD'], fuel: ['gasoline'], price: [350_000_000, 510_000_000] },

  // --- Daihatsu -----------------------------------------------------------
  { make: 'Daihatsu', model: 'Xenia', body: 'mpv', engineCc: [1000, 1300], seats: [7], drive: ['FWD'], fuel: ['gasoline'], price: [140_000_000, 235_000_000] },
  { make: 'Daihatsu', model: 'Terios', body: 'suv', engineCc: [1500], seats: [7], drive: ['RWD'], fuel: ['gasoline'], price: [180_000_000, 295_000_000] },
  { make: 'Daihatsu', model: 'Ayla', body: 'hatchback', engineCc: [1000, 1200], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [100_000_000, 165_000_000] },
  { make: 'Daihatsu', model: 'Sigra', body: 'mpv', engineCc: [1000, 1200], seats: [7], drive: ['FWD'], fuel: ['gasoline'], price: [110_000_000, 180_000_000] },
  { make: 'Daihatsu', model: 'Gran Max', body: 'pickup', engineCc: [1300, 1500], seats: [3], drive: ['RWD'], fuel: ['gasoline'], price: [110_000_000, 185_000_000] },
  { make: 'Daihatsu', model: 'Luxio', body: 'mpv', engineCc: [1500], seats: [8], drive: ['RWD'], fuel: ['gasoline'], price: [180_000_000, 265_000_000] },

  // --- Nissan -------------------------------------------------------------
  { make: 'Nissan', model: 'Livina', body: 'mpv', engineCc: [1500], seats: [7], drive: ['FWD'], fuel: ['gasoline'], price: [180_000_000, 265_000_000] },
  { make: 'Nissan', model: 'Kicks', body: 'suv', engineCc: [1200], seats: [5], drive: ['FWD'], fuel: ['hybrid'], price: [330_000_000, 440_000_000] },
  { make: 'Nissan', model: 'X-Trail', body: 'suv', engineCc: [2000, 2500], seats: [5, 7], drive: ['4WD'], fuel: ['gasoline', 'hybrid'], price: [400_000_000, 620_000_000] },
  { make: 'Nissan', model: 'Serena', body: 'mpv', engineCc: [2000], seats: [8], drive: ['FWD'], fuel: ['hybrid'], price: [400_000_000, 570_000_000] },
  { make: 'Nissan', model: 'Magnite', body: 'suv', engineCc: [1000], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [200_000_000, 285_000_000] },

  // --- BMW ----------------------------------------------------------------
  { make: 'BMW', model: '320i', body: 'sedan', engineCc: [2000], seats: [5], drive: ['RWD'], fuel: ['gasoline'], price: [700_000_000, 1_050_000_000] },
  { make: 'BMW', model: '520i', body: 'sedan', engineCc: [2000], seats: [5], drive: ['RWD'], fuel: ['gasoline'], price: [900_000_000, 1_350_000_000] },
  { make: 'BMW', model: 'X1', body: 'suv', engineCc: [2000], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [750_000_000, 1_150_000_000] },
  { make: 'BMW', model: 'X3', body: 'suv', engineCc: [2000], seats: [5], drive: ['AWD'], fuel: ['gasoline'], price: [1_000_000_000, 1_500_000_000] },
  { make: 'BMW', model: 'X5', body: 'suv', engineCc: [3000], seats: [5], drive: ['AWD'], fuel: ['gasoline'], price: [1_500_000_000, 2_000_000_000] },
  { make: 'BMW', model: 'iX', body: 'suv', engineCc: [0], seats: [5], drive: ['AWD'], fuel: ['electric'], price: [1_500_000_000, 2_000_000_000] },

  // --- Mercedes-Benz ------------------------------------------------------
  { make: 'Mercedes-Benz', model: 'C200', body: 'sedan', engineCc: [1500, 2000], seats: [5], drive: ['RWD'], fuel: ['gasoline'], price: [800_000_000, 1_150_000_000] },
  { make: 'Mercedes-Benz', model: 'E250', body: 'sedan', engineCc: [2000], seats: [5], drive: ['RWD'], fuel: ['gasoline'], price: [1_000_000_000, 1_450_000_000] },
  { make: 'Mercedes-Benz', model: 'GLC 200', body: 'suv', engineCc: [2000], seats: [5], drive: ['AWD'], fuel: ['gasoline'], price: [1_000_000_000, 1_500_000_000] },
  { make: 'Mercedes-Benz', model: 'GLE 400', body: 'suv', engineCc: [3000], seats: [5], drive: ['AWD'], fuel: ['gasoline'], price: [1_500_000_000, 2_000_000_000] },
  { make: 'Mercedes-Benz', model: 'S450', body: 'sedan', engineCc: [3000], seats: [5], drive: ['RWD'], fuel: ['gasoline'], price: [1_800_000_000, 2_000_000_000] },

  // --- Hyundai ------------------------------------------------------------
  { make: 'Hyundai', model: 'Creta', body: 'suv', engineCc: [1500], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [300_000_000, 430_000_000] },
  { make: 'Hyundai', model: 'Tucson', body: 'suv', engineCc: [2000], seats: [5], drive: ['FWD'], fuel: ['gasoline'], price: [450_000_000, 620_000_000] },
  { make: 'Hyundai', model: 'Santa Fe', body: 'suv', engineCc: [2200], seats: [7], drive: ['AWD'], fuel: ['diesel'], price: [600_000_000, 820_000_000] },
  { make: 'Hyundai', model: 'Ioniq', body: 'hatchback', engineCc: [0], seats: [5], drive: ['FWD'], fuel: ['electric'], price: [600_000_000, 820_000_000] },
  { make: 'Hyundai', model: 'Stargazer', body: 'mpv', engineCc: [1500], seats: [7], drive: ['FWD'], fuel: ['gasoline'], price: [250_000_000, 360_000_000] },

  // --- Wuling -------------------------------------------------------------
  { make: 'Wuling', model: 'Confero', body: 'mpv', engineCc: [1500], seats: [7], drive: ['RWD'], fuel: ['gasoline'], price: [150_000_000, 225_000_000] },
  { make: 'Wuling', model: 'Cortez', body: 'mpv', engineCc: [1500, 1800], seats: [7], drive: ['RWD'], fuel: ['gasoline'], price: [250_000_000, 360_000_000] },
  { make: 'Wuling', model: 'Almaz', body: 'suv', engineCc: [1500], seats: [7], drive: ['FWD'], fuel: ['gasoline'], price: [280_000_000, 390_000_000] },
  { make: 'Wuling', model: 'Formo', body: 'mpv', engineCc: [1200], seats: [8], drive: ['RWD'], fuel: ['gasoline'], price: [150_000_000, 225_000_000] },
  { make: 'Wuling', model: 'Air EV', body: 'hatchback', engineCc: [0], seats: [4], drive: ['RWD'], fuel: ['electric'], price: [240_000_000, 330_000_000] },
];

/** Motorcycles, by the type that decides their category. */
const MOTORCYCLES = [
  { make: 'Honda', model: 'Beat', type: 'matic', engineCc: [110, 125], price: [17_000_000, 21_000_000], hasAbs: false },
  { make: 'Honda', model: 'Vario', type: 'matic', engineCc: [125, 160], price: [22_000_000, 31_000_000], hasAbs: false },
  { make: 'Honda', model: 'PCX', type: 'matic', engineCc: [160], price: [32_000_000, 41_000_000], hasAbs: true },
  { make: 'Honda', model: 'CB150R', type: 'sport', engineCc: [150], price: [32_000_000, 39_000_000], hasAbs: false },
  { make: 'Honda', model: 'CBR150R', type: 'sport', engineCc: [150], price: [38_000_000, 46_000_000], hasAbs: true },
  { make: 'Honda', model: 'Supra', type: 'bebek', engineCc: [125], price: [17_000_000, 21_000_000], hasAbs: false },
  { make: 'Yamaha', model: 'NMAX', type: 'matic', engineCc: [155], price: [30_000_000, 39_000_000], hasAbs: true },
  { make: 'Yamaha', model: 'Aerox', type: 'matic', engineCc: [155], price: [28_000_000, 36_000_000], hasAbs: false },
  { make: 'Yamaha', model: 'Mio', type: 'matic', engineCc: [125], price: [17_000_000, 22_000_000], hasAbs: false },
  { make: 'Yamaha', model: 'R15', type: 'sport', engineCc: [155], price: [38_000_000, 46_000_000], hasAbs: true },
  { make: 'Yamaha', model: 'Jupiter', type: 'bebek', engineCc: [115, 125], price: [16_000_000, 21_000_000], hasAbs: false },
  { make: 'Yamaha', model: 'XSR155', type: 'sport', engineCc: [155], price: [37_000_000, 43_000_000], hasAbs: true },
  { make: 'Suzuki', model: 'Satria F150', type: 'sport', engineCc: [150], price: [25_000_000, 33_000_000], hasAbs: false },
  { make: 'Suzuki', model: 'Nex II', type: 'matic', engineCc: [115], price: [17_000_000, 22_000_000], hasAbs: false },
  { make: 'Suzuki', model: 'Address', type: 'matic', engineCc: [110], price: [16_000_000, 21_000_000], hasAbs: false },
  { make: 'Suzuki', model: 'GSX-R150', type: 'sport', engineCc: [150], price: [30_000_000, 39_000_000], hasAbs: true },
  { make: 'Kawasaki', model: 'Ninja 250', type: 'sport', engineCc: [250], price: [60_000_000, 76_000_000], hasAbs: true },
  { make: 'Kawasaki', model: 'W175', type: 'sport', engineCc: [175], price: [32_000_000, 39_000_000], hasAbs: false },
  { make: 'Kawasaki', model: 'KLX 150', type: 'sport', engineCc: [150], price: [35_000_000, 43_000_000], hasAbs: false },
];

/** Commercial vehicles: trucks and buses. */
const COMMERCIAL = [
  { make: 'Hino', model: 'Dutro 110 SDL', type: 'truck', engineCc: [4000], payloadKg: [4000, 4500], wheels: [4], price: [350_000_000, 460_000_000] },
  { make: 'Hino', model: 'Dutro 130 HD', type: 'truck', engineCc: [4000], payloadKg: [5000, 6000], wheels: [4], price: [420_000_000, 530_000_000] },
  { make: 'Isuzu', model: 'Elf NMR 71', type: 'truck', engineCc: [3000], payloadKg: [4000, 5000], wheels: [4], price: [380_000_000, 490_000_000] },
  { make: 'Mitsubishi', model: 'Canter FE 74', type: 'truck', engineCc: [3900], payloadKg: [6000, 7500], wheels: [6], price: [400_000_000, 540_000_000] },
  { make: 'Mitsubishi', model: 'Fuso Fighter FN 62', type: 'truck', engineCc: [7500], payloadKg: [10_000, 12_000], wheels: [6], price: [600_000_000, 820_000_000] },
  { make: 'Hino', model: 'RK8 R260', type: 'bus', engineCc: [7700], payloadKg: [12_000, 16_000], wheels: [6], price: [900_000_000, 1_250_000_000] },
  { make: 'Mercedes-Benz', model: 'OH 1626', type: 'bus', engineCc: [6500], payloadKg: [14_000, 18_000], wheels: [6], price: [1_200_000_000, 1_500_000_000] },
  { make: 'Isuzu', model: 'NQR 71', type: 'bus', engineCc: [5200], payloadKg: [9000, 11_000], wheels: [6], price: [700_000_000, 920_000_000] },
];

/**
 * The category tree.
 *
 * Depth varies on purpose (Vehicles > Cars > SUV is three levels, while
 * Motorcycles' children are two) to exercise arbitrary-depth traversal.
 */
const CATEGORY_TREE = [
  {
    name: 'Vehicles',
    slug: 'vehicles',
    icon: 'directions_car',
    sortOrder: 1,
    children: [
      {
        name: 'Cars',
        slug: 'cars',
        icon: 'car',
        sortOrder: 1,
        children: [
          { name: 'Sedan', slug: 'sedan', sortOrder: 1 },
          { name: 'SUV', slug: 'suv', sortOrder: 2 },
          { name: 'MPV', slug: 'mpv', sortOrder: 3 },
          { name: 'Hatchback', slug: 'hatchback', sortOrder: 4 },
          { name: 'Pickup', slug: 'pickup', sortOrder: 5 },
        ],
      },
      {
        name: 'Motorcycles',
        slug: 'motorcycles',
        icon: 'two_wheeler',
        sortOrder: 2,
        children: [
          { name: 'Sport', slug: 'sport', sortOrder: 1 },
          { name: 'Matic', slug: 'matic', sortOrder: 2 },
          { name: 'Bebek', slug: 'bebek', sortOrder: 3 },
        ],
      },
      {
        name: 'Commercial Vehicles',
        slug: 'commercial-vehicles',
        icon: 'local_shipping',
        sortOrder: 3,
        children: [
          { name: 'Truck', slug: 'truck', sortOrder: 1 },
          { name: 'Bus', slug: 'bus', sortOrder: 2 },
        ],
      },
    ],
  },
];

/** Enum options reused by more than one filter definition. */
const CONDITION_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'used', label: 'Used' },
  { value: 'certified', label: 'Certified Pre-Owned' },
];

const TRANSMISSION_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'automatic', label: 'Automatic' },
  { value: 'cvt', label: 'CVT' },
];

const FUEL_OPTIONS = [
  { value: 'gasoline', label: 'Gasoline' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'electric', label: 'Electric' },
  { value: 'hybrid', label: 'Hybrid' },
];

const DRIVE_OPTIONS = [
  { value: 'FWD', label: 'Front-Wheel Drive' },
  { value: 'RWD', label: 'Rear-Wheel Drive' },
  { value: 'AWD', label: 'All-Wheel Drive' },
  { value: '4WD', label: 'Four-Wheel Drive' },
];

const WHEEL_OPTIONS = [
  { value: '4', label: '4 Wheels' },
  { value: '6', label: '6 Wheels' },
  { value: '10', label: '10 Wheels' },
];

/** Every make that appears in the dataset, for the `make` filter options. */
const MAKE_OPTIONS = [...new Set([...CARS, ...MOTORCYCLES, ...COMMERCIAL].map((v) => v.make))]
  .sort()
  .map((make) => ({ value: make, label: make }));

module.exports = {
  CITIES,
  COLORS,
  CARS,
  MOTORCYCLES,
  COMMERCIAL,
  CATEGORY_TREE,
  CONDITION_OPTIONS,
  TRANSMISSION_OPTIONS,
  FUEL_OPTIONS,
  DRIVE_OPTIONS,
  WHEEL_OPTIONS,
  MAKE_OPTIONS,
};

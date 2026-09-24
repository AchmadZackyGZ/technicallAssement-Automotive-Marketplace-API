'use strict';

/**
 * Seed accounts.
 *
 * Three roles are created so every authorisation path can be exercised straight
 * after seeding:
 *
 *   admin@automotive.test  / Admin12345   - may create/update categories
 *   buyer@automotive.test  / Buyer12345   - browse-only account
 *   seller1..N@automotive.test / Seller12345 - own the seeded listings
 *
 * All seeded accounts share one bcrypt hash per role. Hashing 27 times would add
 * seconds to every seed run for no security benefit, since these are throwaway
 * demo credentials that the README publishes anyway.
 */

const bcrypt = require('bcryptjs');
const { insertInBatches } = require('./seed-helpers');

const FIRST_NAMES = [
  'Budi', 'Siti', 'Agus', 'Dewi', 'Rudi', 'Rina', 'Hendra', 'Maya', 'Joko', 'Lina',
  'Andi', 'Putri', 'Bambang', 'Sri', 'Eko', 'Nur', 'Wahyudi', 'Fitri', 'Dedi', 'Ratna',
  'Iwan', 'Indah', 'Slamet', 'Ayu', 'Gunawan', 'Rini', 'Hasan', 'Mega', 'Yusuf', 'Citra',
];

const LAST_NAMES = [
  'Santoso', 'Rahayu', 'Wijaya', 'Kusuma', 'Saputra', 'Handoko', 'Pratama', 'Siregar',
  'Nugroho', 'Halim', 'Simanjuntak', 'Purnama', 'Setiawan', 'Maulana', 'Hidayat',
  'Susanto', 'Firmansyah', 'Anggraini', 'Permata', 'Wibowo',
];

function indonesianName(random) {
  const first = FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

function phoneNumber(random) {
  const prefix = ['812', '813', '821', '822', '851', '852', '855', '878', '895'][
    Math.floor(random() * 9)
  ];
  const a = String(Math.floor(random() * 9000) + 1000);
  const b = String(Math.floor(random() * 9000) + 1000);
  return `+62${prefix}${a}${b}`;
}

/**
 * @returns {Promise<{ adminId: string, buyerId: string, sellerIds: string[] }>}
 */
async function seedUsers(client, { random, sellerCount }) {
  const [adminHash, buyerHash, sellerHash] = await Promise.all([
    bcrypt.hash('Admin12345', 8),
    bcrypt.hash('Buyer12345', 8),
    bcrypt.hash('Seller12345', 8),
  ]);

  const rows = [
    ['admin@automotive.test', adminHash, 'Platform Admin', '+6281200000001', 'admin'],
    ['buyer@automotive.test', buyerHash, 'Rina Pembeli', '+6281200000002', 'buyer'],
  ];

  for (let index = 1; index <= sellerCount; index += 1) {
    rows.push([
      `seller${index}@automotive.test`,
      sellerHash,
      indonesianName(random),
      phoneNumber(random),
      'seller',
    ]);
  }

  const { returned } = await insertInBatches(
    client,
    'users',
    ['email', 'password_hash', 'name', 'phone', 'role'],
    rows,
    { returning: 'id, email, role' },
  );

  const byEmail = new Map(returned.map((row) => [row.email, row.id]));

  return {
    adminId: byEmail.get('admin@automotive.test'),
    buyerId: byEmail.get('buyer@automotive.test'),
    sellerIds: returned.filter((row) => row.role === 'seller').map((row) => row.id),
  };
}

module.exports = { seedUsers };

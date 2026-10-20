'use strict';

const db = require('../../utils/db');

const PUBLIC_COLUMNS = `
  id,
  email,
  name,
  phone,
  role,
  is_active    AS "isActive",
  created_at   AS "createdAt",
  updated_at   AS "updatedAt"
`;

async function create({ email, passwordHash, name, phone = null, role = 'seller' }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, name, phone, role)
     VALUES (LOWER($1), $2, $3, $4, $5)
     RETURNING ${PUBLIC_COLUMNS}`,
    [email, passwordHash, name, phone, role],
  );
  return rows[0];
}

async function findByEmailWithHash(email) {
  return db.queryOne(
    `SELECT ${PUBLIC_COLUMNS}, password_hash AS "passwordHash"
       FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
    [email],
  );
}

async function findById(id) {
  return db.queryOne(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1 LIMIT 1`, [id]);
}

async function emailExists(email, excludeUserId = null) {
  const { rows } = await db.query(
    `SELECT 1
       FROM users
      WHERE LOWER(email) = LOWER($1)
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      LIMIT 1`,
    [email, excludeUserId],
  );
  return rows.length > 0;
}

async function updateProfile(id, { name, phone }) {
  return db.queryOne(
    `UPDATE users
        SET name  = COALESCE($2, name),
            phone = COALESCE($3, phone)
      WHERE id = $1
      RETURNING ${PUBLIC_COLUMNS}`,
    [id, name ?? null, phone ?? null],
  );
}

async function countAll() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS total FROM users');
  return rows[0].total;
}

module.exports = {
  PUBLIC_COLUMNS,
  create,
  findByEmailWithHash,
  findById,
  emailExists,
  updateProfile,
  countAll,
};

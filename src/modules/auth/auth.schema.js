'use strict';

/**
 * Auth request/response contracts.
 *
 * Password policy is enforced here so every entry point (register, future
 * password reset) shares one definition: >= 8 characters, at least one letter
 * and one digit.
 */

const { z } = require('zod');

const email = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(5, 'Email is too short')
  .max(255, 'Email must be at most 255 characters')
  .email('Must be a valid email address');

const password = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

const name = z
  .string({ required_error: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(120, 'Name must be at most 120 characters');

const phone = z
  .string()
  .trim()
  .regex(/^[+()\d][\d\s()-]{6,29}$/, 'Must be a valid phone number')
  .optional();

const registerBody = z.object({
  email,
  password,
  name,
  phone,
  role: z.enum(['buyer', 'seller']).default('seller'),
});

const loginBody = z.object({
  email,
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

const updateMeBody = z
  .object({
    name: name.optional(),
    phone: phone.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

module.exports = {
  registerSchema: { body: registerBody },
  loginSchema: { body: loginBody },
  updateMeSchema: { body: updateMeBody },
};

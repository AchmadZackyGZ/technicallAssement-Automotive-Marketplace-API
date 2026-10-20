'use strict';

const express = require('express');

const controller = require('./auth.controller');
const { registerSchema, loginSchema, updateMeSchema } = require('./auth.schema');
const { validate } = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const { authLimiter } = require('../../middleware/rateLimiter');

const router = express.Router();

router.post('/register', authLimiter, validate(registerSchema), controller.register);

router.post('/login', authLimiter, validate(loginSchema), controller.login);

router.get('/me', authenticate, controller.me);
router.patch('/me', authenticate, validate(updateMeSchema), controller.updateMe);

module.exports = router;

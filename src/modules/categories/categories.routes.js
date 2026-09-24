'use strict';

const express = require('express');

const controller = require('./categories.controller');
const { createSchema, updateSchema, idSchema, listSchema } = require('./categories.schema');
const { validate } = require('../../middleware/validate');
const { authenticate, requireRole } = require('../../middleware/auth');

const router = express.Router();

/**
 * @openapi
 * /categories:
 *   get:
 *     tags: [Categories]
 *     summary: Get the full category tree
 *     description: |
 *       Returns the whole taxonomy. The response is nested (`children`) by
 *       default; pass `flat=true` for a materialized-path-ordered list.
 *
 *       Backed by the adjacency-list + materialized-path design: the flat list is
 *       ordered by `path`, so assembling the tree needs no recursive query.
 *     parameters:
 *       - in: query
 *         name: flat
 *         schema: { type: boolean, default: false }
 *         description: Return a flat list instead of a nested tree
 *       - in: query
 *         name: maxDepth
 *         schema: { type: integer, minimum: 0, maximum: 20 }
 *         description: Only include nodes at or above this depth
 *       - in: query
 *         name: includeInactive
 *         schema: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: Category tree
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Category' }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     count: { type: integer, example: 15 }
 *                     flat:  { type: boolean }
 *   post:
 *     tags: [Categories]
 *     summary: Create a category node
 *     description: Requires an authenticated user with the `admin` role.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:        { type: string, example: SUV }
 *               slug:        { type: string, example: suv, description: 'Optional - derived from name when omitted' }
 *               parentId:    { type: string, format: uuid, nullable: true }
 *               description: { type: string, nullable: true }
 *               icon:        { type: string, nullable: true, example: car }
 *               sortOrder:   { type: integer, default: 0 }
 *     responses:
 *       201:
 *         description: Category created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/Category' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/', validate(listSchema), controller.list);
router.post('/', authenticate, requireRole('admin'), validate(createSchema), controller.create);

/**
 * @openapi
 * /categories/{id}:
 *   get:
 *     tags: [Categories]
 *     summary: Get a single category with its direct children
 *     parameters:
 *       - $ref: '#/components/parameters/CategoryId'
 *     responses:
 *       200:
 *         description: Category detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/Category'
 *                     - type: object
 *                       properties:
 *                         children:
 *                           type: array
 *                           items: { $ref: '#/components/schemas/Category' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Categories]
 *     summary: Update a category
 *     description: |
 *       Requires the `admin` role. Supplying `parentId` moves the node: the whole
 *       subtree is rewritten in one transaction and moving a node into its own
 *       descendant is rejected with a 400.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/CategoryId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:        { type: string }
 *               slug:        { type: string }
 *               parentId:    { type: string, format: uuid, nullable: true, description: 'Move the node (and its subtree) under this parent' }
 *               description: { type: string, nullable: true }
 *               icon:        { type: string, nullable: true }
 *               sortOrder:   { type: integer }
 *               isActive:    { type: boolean }
 *     responses:
 *       200:
 *         description: Updated category
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/Category' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/:id', validate(idSchema), controller.getOne);
router.patch('/:id', authenticate, requireRole('admin'), validate(updateSchema), controller.update);

module.exports = router;

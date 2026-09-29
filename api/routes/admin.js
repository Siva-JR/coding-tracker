import { Router } from 'express';
import { z } from 'zod';
import { HttpError, asyncRoute, parseBody, parseInteger } from '../http.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { listUsers, createUser, updateUser, resetPassword } from '../services/users.js';

const scopeSchema = z.object({
  deptId: z.number().int().positive().nullable().optional(),
  year: z.number().int().min(1).max(4).nullable().optional(),
});

const createUserSchema = z.object({
  username: z.string(),
  displayTitle: z.string().max(80).nullable().optional(),
  role: z.enum(['admin', 'viewer']),
  password: z.string().optional(),
  scopes: z.array(scopeSchema).max(50).optional(),
});

const updateUserSchema = z.object({
  displayTitle: z.string().max(80).nullable().optional(),
  role: z.enum(['admin', 'viewer']).optional(),
  scopes: z.array(scopeSchema).max(50).optional(),
  disabled: z.boolean().optional(),
});

const resetSchema = z.object({ password: z.string().optional() });
const departmentSchema = z.object({ name: z.string().trim().min(2).max(100), code: z.string().trim().min(2).max(12) });

export function adminRoutes({ db, sessionSecret }) {
  const router = Router();
  router.use(authenticate({ db, sessionSecret }), requireAdmin);

  const userId = (req) => parseInteger(req.params.id, 'id', { min: 1, max: 2147483647 });

  router.get('/users', asyncRoute(async (req, res) => res.json(await listUsers(db))));

  router.post('/users', asyncRoute(async (req, res) => {
    res.status(201).json(await createUser(db, parseBody(createUserSchema, req.body)));
  }));

  router.patch('/users/:id', asyncRoute(async (req, res) => {
    res.json(await updateUser(db, userId(req), parseBody(updateUserSchema, req.body)));
  }));

  router.post('/users/:id/reset-password', asyncRoute(async (req, res) => {
    res.json(await resetPassword(db, userId(req), parseBody(resetSchema, req.body).password));
  }));

  router.post('/departments', asyncRoute(async (req, res) => {
    const { name, code } = parseBody(departmentSchema, req.body);
    try {
      const { rows: [dept] } = await db.query('insert into departments (name, code) values ($1, upper($2)) returning id, name, code', [name, code]);
      res.status(201).json(dept);
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'DEPARTMENT_EXISTS', 'A department with that name or code already exists');
      throw err;
    }
  }));

  return router;
}

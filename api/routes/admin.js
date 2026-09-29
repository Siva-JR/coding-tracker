import { Router } from 'express';
import { z } from 'zod';
import { HttpError, asyncRoute, parseBody, parseInteger } from '../http.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { listUsers, createUser, updateUser, resetPassword } from '../services/users.js';
import { addStudent, updateStudent, deleteStudent, refreshStudent, listStudents, validateRows, importRows } from '../services/students.js';

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
// Student fields are validated by the service, which reports every problem in one response.
const studentSchema = z.record(z.string(), z.unknown());
const rowsSchema = (max) => z.object({ rows: z.array(studentSchema).min(1).max(max) });
const VALIDATE_MAX_ROWS = 10;
const IMPORT_MAX_ROWS = 200;

const departmentSchema = z.object({ name: z.string().trim().min(2).max(100), code: z.string().trim().min(2).max(12) });

export function adminRoutes({ db, sessionSecret, fetchProfile, now }) {
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

  const studentId = (req) => parseInteger(req.params.id, 'id', { min: 1, max: 2147483647 });
  const options = () => ({ fetchProfile, now: now() });

  router.get('/students', asyncRoute(async (req, res) => {
    const { deptId, batchYear, q, page, pageSize } = req.query;
    res.json(await listStudents(db, {
      deptId: deptId === undefined ? null : parseInteger(deptId, 'deptId', { min: 1, max: 2147483647 }),
      batchYear: batchYear === undefined ? null : parseInteger(batchYear, 'batchYear', { min: 2000, max: 2100 }),
      q: typeof q === 'string' && q.trim() ? q.trim().slice(0, 100) : null,
      page: page === undefined ? 1 : parseInteger(page, 'page', { min: 1, max: 100000 }),
      pageSize: pageSize === undefined ? 50 : parseInteger(pageSize, 'pageSize', { min: 1, max: 100 }),
      now: now(),
    }));
  }));

  router.post('/students', asyncRoute(async (req, res) => {
    res.status(201).json(await addStudent(db, parseBody(studentSchema, req.body), { verify: true, ...options() }));
  }));

  router.post('/students/validate', asyncRoute(async (req, res) => {
    const { rows } = parseBody(rowsSchema(VALIDATE_MAX_ROWS), req.body);
    res.json({ results: await validateRows(db, rows, { fetchProfile }) });
  }));

  router.post('/students/import', asyncRoute(async (req, res) => {
    const { rows } = parseBody(rowsSchema(IMPORT_MAX_ROWS), req.body);
    res.json(await importRows(db, rows));
  }));

  router.patch('/students/:id', asyncRoute(async (req, res) => {
    res.json(await updateStudent(db, studentId(req), parseBody(studentSchema, req.body), options()));
  }));

  router.delete('/students/:id', asyncRoute(async (req, res) => {
    await deleteStudent(db, studentId(req));
    res.sendStatus(204);
  }));

  router.post('/students/:id/refresh', asyncRoute(async (req, res) => {
    res.json(await refreshStudent(db, studentId(req), options()));
  }));

  return router;
}

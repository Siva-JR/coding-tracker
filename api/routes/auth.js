import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, parseBody } from '../http.js';
import { authenticate } from '../middleware/auth.js';
import { login, changePassword, signSession, publicUser, SESSION_MS } from '../services/auth.js';

const loginSchema = z.object({ username: z.string(), password: z.string() });
const changeSchema = z.object({ currentPassword: z.string(), newPassword: z.string() });

export function authRoutes({ db, sessionSecret, cookieOptions, now }) {
  const router = Router();
  const gate = authenticate({ db, sessionSecret, allowPasswordChange: true });
  const setSession = (res, user) => res.cookie('session', signSession(user, sessionSecret), { ...cookieOptions, maxAge: SESSION_MS });

  router.post('/login', asyncRoute(async (req, res) => {
    const user = await login(db, parseBody(loginSchema, req.body), { now: now() });
    setSession(res, user);
    res.json({ user: publicUser(user) });
  }));

  router.post('/logout', (req, res) => {
    res.clearCookie('session', cookieOptions);
    res.sendStatus(204);
  });

  router.get('/me', gate, (req, res) => res.json({ user: publicUser(req.user) }));

  router.post('/change-password', gate, asyncRoute(async (req, res) => {
    const { currentPassword, newPassword } = parseBody(changeSchema, req.body);
    const user = await changePassword(db, req.user.id, currentPassword, newPassword);
    setSession(res, user); // the old cookie is revoked because token_version changed
    res.sendStatus(204);
  }));

  return router;
}

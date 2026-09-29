import { HttpError } from '../http.js';
import { userFromToken } from '../services/auth.js';

export function authenticate({ db, sessionSecret, allowPasswordChange = false }) {
  return async (req, res, next) => {
    try {
      const token = req.cookies?.session;
      const user = token ? await userFromToken(db, token, sessionSecret) : null;
      if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Login required');
      if (user.mustChangePassword && !allowPasswordChange) {
        throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your password first');
      }
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAdmin(req, res, next) {
  next(req.user?.role === 'admin' ? undefined : new HttpError(403, 'FORBIDDEN', 'Admin access required'));
}

// CSRF guard: a cross-site HTML form cannot send this content type, and a cross-site script
// sending it triggers a CORS preflight that only the allow-listed origins pass.
export function requireJson(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const type = (req.get('content-type') ?? '').toLowerCase();
  if (type.startsWith('application/json')) return next();
  return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send Content-Type: application/json'));
}

export function cors(origins = []) {
  const allowed = new Set(origins);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowed.has(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.append('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '600');
        return res.sendStatus(204);
      }
    } else if (origin && req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  };
}

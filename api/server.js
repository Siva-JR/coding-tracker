import { createApp } from './app.js';
import { getPool } from './db.js';

// AppSail supplies its port via X_ZOHO_CATALYST_LISTEN_PORT (verify at deploy time).
const port = Number(process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 3000);

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to a random string of at least 32 characters');
  process.exit(1);
}

const cookieSecure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';
const cookieSameSite = process.env.COOKIE_SAMESITE || 'lax';
if (cookieSameSite === 'none' && !cookieSecure) {
  console.error('COOKIE_SAMESITE=none requires secure cookies: set NODE_ENV=production or COOKIE_SECURE=true (browsers reject SameSite=None cookies without Secure)');
  process.exit(1);
}

const app = createApp({
  db: getPool(),
  sessionSecret: process.env.SESSION_SECRET,
  scrapeSecret: process.env.SCRAPE_SECRET,
  cookie: { secure: cookieSecure, sameSite: cookieSameSite },
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
});

app.listen(port, () => console.log(`API listening on :${port}`));

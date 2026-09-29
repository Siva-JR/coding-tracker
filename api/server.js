import { createApp } from './app.js';
import { getPool } from './db.js';

// AppSail supplies its port via X_ZOHO_CATALYST_LISTEN_PORT (verify at deploy time).
const port = Number(process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 3000);

const app = createApp({ db: getPool(), scrapeSecret: process.env.SCRAPE_SECRET });
app.listen(port, () => console.log(`API listening on :${port}`));

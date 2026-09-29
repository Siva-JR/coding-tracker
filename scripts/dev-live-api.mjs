// Dev-only: boots the API on a throwaway embedded Postgres with sample rows, on :3000, for the web app to talk to.
import { startTestDb } from '../tests/helpers/testdb.js';
import { createApp } from '../api/app.js';

const t = await startTestDb();
const db = t.db;
await db.query("insert into departments (name, code) values ('Computer Science and Engineering','CSE'),('Information Technology','IT'),('Electronics and Communication Engineering','ECE')");
const names = ['Arun Kumar','Priya S','Karthik R','Divya K','Rahul M','Sneha V','Vikram P','Ananya N','Surya G','Meera D','Naveen T','Kavya B'];
let i = 0;
for (const n of names) {
  i++;
  const dept = (i % 3) + 1, batch = 2027 + (i % 4);
  const { rows: [s] } = await db.query('insert into students (roll_no,name,dept_id,batch_year) values ($1,$2,$3,$4) returning id', [`R${100 + i}`, n, dept, batch]);
  await db.query("insert into platform_accounts (student_id,platform,username) values ($1,'leetcode',$2),($1,'hackerrank',$3)", [s.id, n.split(' ')[0].toLowerCase() + i, n.split(' ')[0].toLowerCase() + '_' + i]);
  const total = 400 - i * 25;
  await db.query("insert into snapshots (student_id,platform,snap_date,solved_total,solved_easy,solved_medium,solved_hard,global_rank) values ($1,'leetcode',current_date,$2,$3,$4,$5,$6)", [s.id, total, Math.round(total * .6), Math.round(total * .32), Math.round(total * .08), i % 5 === 0 ? null : 900000 / (total + 5) | 0]);
  await db.query("insert into snapshots (student_id,platform,snap_date,solved_total,hr_stars) values ($1,'hackerrank',current_date,$2,$3)", [s.id, Math.round(total / 3), Math.min(5, 1 + (total / 90 | 0))]);
}
const app = createApp({ db, scrapeSecret: 'dev' });
app.listen(3000, () => console.log('live backend on :3000'));
process.on('SIGTERM', async () => { await t.stop(); process.exit(0); });

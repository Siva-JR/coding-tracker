import { parseArgs } from 'node:util';
import { createPool } from '../api/db.js';
import { addStudent, ValidationError } from '../api/services/students.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    roll: { type: 'string' },
    dept: { type: 'string' },
    batch: { type: 'string' },
    leetcode: { type: 'string' },
    hackerrank: { type: 'string' },
  },
});

const db = createPool();
try {
  const result = await addStudent(db, {
    name: values.name,
    rollNo: values.roll,
    deptCode: values.dept,
    batchYear: values.batch,
    leetcodeUrl: values.leetcode,
    hackerrankUrl: values.hackerrank,
  });
  console.log(`Added student #${result.studentId}:`, result.accounts.map((a) => `${a.platform}=${a.username}`).join(', '));
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(`Could not add student:\n - ${err.errors.join('\n - ')}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  await db.end();
}

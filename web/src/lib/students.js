import { api } from '../api/index.js';

/** Every student, page by page (the list endpoint returns at most 100 at a time). */
export async function allStudents() {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await api.admin.students({ page, pageSize: 100 });
    out.push(...r.items);
    if (out.length >= r.total || !r.items.length) return out;
  }
}

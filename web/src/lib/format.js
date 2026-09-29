const nf = new Intl.NumberFormat('en-IN');
export const num = (n) => (n == null ? '—' : nf.format(n));

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const longDate = (d = new Date()) =>
  d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const shortDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function relDay(iso, today = new Date()) {
  const a = new Date(iso + 'T00:00:00');
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((b - a) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff} days ago`;
}

export const isoDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const nf = new Intl.NumberFormat('en-IN');
export const num = (n) => (n == null ? '—' : nf.format(n));

// 05:00-11:59 Morning, 12:00-16:59 Afternoon, 17:00-20:59 Evening, otherwise Night
export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'Good Morning';
  if (h >= 12 && h < 17) return 'Good Afternoon';
  if (h >= 17 && h < 21) return 'Good Evening';
  return 'Good Night';
}

// Sign-in names: a short username shows as "@asha"; an email address already has its @, so it is shown as it is.
export const handle = (username) => (!username ? '' : username.includes('@') ? username : `@${username}`);

// Job titles are typed by hand and stored as given, so tidy the ones we know are often written in capitals:
// the head of department is "HoD", not "HOD".
export const niceTitle = (t) => (t || '').replace(/\bHOD\b/gi, 'HoD');

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

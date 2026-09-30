import { useEffect } from 'react';

export function Modal({ title, children, onClose, actions, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(640px, 100%)' } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

/** Every problem the server listed, or its single message. */
export const errorLines = (err) => (Array.isArray(err?.details?.errors) && err.details.errors.length ? err.details.errors : [err?.message || 'Something went wrong']);

export function ErrorBox({ err, style }) {
  if (!err) return null;
  const lines = Array.isArray(err) ? err : errorLines(err);
  return (
    <div className="alert" role="alert" style={style}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" /></svg>
      <span>{lines.length === 1 ? lines[0] : <ul style={{ margin: 0, paddingLeft: 18 }}>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}</span>
    </div>
  );
}

export const platformName = (p) => (p === 'leetcode' ? 'LeetCode' : 'HackerRank');

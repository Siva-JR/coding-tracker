import { useState } from 'react';
import { api } from '../../api/index.js';
import { useScope } from '../../context/Scope.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { Icon } from '../../components/Icons.jsx';
import { ErrorBox } from './shared.jsx';

export default function DepartmentsTab() {
  const toast = useToast();
  const { departments, reload } = useScope();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // { id, name, code } while a row is being renamed

  const saveEdit = async () => {
    if (editing.name.trim().length < 2 || editing.code.trim().length < 2) { setError(['A department needs a name and a short code (at least 2 characters each).']); return; }
    setBusy(true); setError(null);
    try {
      const d = await api.admin.updateDepartment(editing.id, { name: editing.name.trim(), code: editing.code.trim() });
      toast(`${d.code} saved`); setEditing(null); reload();
    } catch (err) { setError(err); }
    setBusy(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2 || code.trim().length < 2) { setError(['Enter a name and a short code (at least 2 characters each).']); return; }
    setBusy(true); setError(null);
    try {
      const d = await api.admin.createDepartment(name.trim(), code.trim());
      toast(`${d.code} added`); setName(''); setCode(''); reload();
    } catch (err) { setError(err); }
    setBusy(false);
  };

  return (
    <section className="card">
      <div className="card-head"><h2><Icon name="grid" /> Departments</h2></div>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table className="t">
          <thead><tr><th>Code</th><th>Name</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {departments.map((d) => (editing?.id === d.id ? (
              <tr key={d.id}>
                <td><input className="cell-input" value={editing.code} maxLength={12} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} aria-label="Department code" /></td>
                <td><input className="cell-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Department name" /></td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" disabled={busy} onClick={saveEdit}>Save</button>{' '}
                  <button className="btn sm ghost" disabled={busy} onClick={() => { setEditing(null); setError(null); }}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={d.id}>
                <td className="name-cell">{d.code}</td><td>{d.name}</td>
                <td className="r"><button className="icon-btn" onClick={() => { setEditing({ id: d.id, name: d.name, code: d.code }); setError(null); }} aria-label={`Rename ${d.code}`}><Icon name="edit" /></button></td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      <ErrorBox err={error} style={{ marginBottom: 12 }} />
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <div className="field"><label htmlFor="dn">Name</label><input id="dn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mechatronics Engineering" /></div>
          <div className="field"><label htmlFor="dc">Code</label><input id="dc" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} placeholder="MCT" /></div>
        </div>
        <div style={{ marginTop: 16 }}><button className="btn" disabled={busy}><Icon name="plus" /> {busy ? 'Adding…' : 'Add department'}</button></div>
      </form>
    </section>
  );
}

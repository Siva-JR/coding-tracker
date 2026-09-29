import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/Auth.jsx';
import { Scribble } from '../components/Decor.jsx';
import AddStudent from './admin/AddStudent.jsx';
import ImportCsv from './admin/ImportCsv.jsx';
import StudentsTab from './admin/StudentsTab.jsx';
import UsersTab from './admin/UsersTab.jsx';
import DepartmentsTab from './admin/DepartmentsTab.jsx';

const TABS = [['add', 'Add student'], ['import', 'Import'], ['students', 'Students'], ['users', 'Users'], ['departments', 'Departments']];

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState('add');
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Admin</h1>
          <Scribble width={140} />
          <p className="sub">Manage students, users and departments.</p>
        </div>
      </header>
      <div className="controls">
        <div className="seg" role="tablist" aria-label="Admin sections">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      </div>
      {tab === 'add' && <AddStudent />}
      {tab === 'import' && <ImportCsv />}
      {tab === 'students' && <StudentsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'departments' && <DepartmentsTab />}
    </>
  );
}

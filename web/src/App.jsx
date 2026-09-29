import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/Auth.jsx';
import { ToastProvider } from './components/Toasts.jsx';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Departments from './pages/Departments.jsx';
import StudentDetail from './pages/StudentDetail.jsx';
import Attention from './pages/Attention.jsx';
import Admin from './pages/Admin.jsx';
import Present from './pages/Present.jsx';

function Protected() {
  const { user, booting } = useAuth();
  if (booting) return <div className="board"><div className="bezel"><div className="glass"><div className="scroll"><div className="skeleton" style={{ height: 200 }} /></div></div></div></div>;
  return user ? <Shell /> : <Navigate to="/login" replace />;
}

function InstituteOnly({ children }) {
  const { user } = useAuth();
  return user.role === 'hod' ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Protected />}>
              <Route index element={<Dashboard />} />
              <Route path="dept/:deptId" element={<InstituteOnly><Dashboard /></InstituteOnly>} />
              <Route path="departments" element={<InstituteOnly><Departments /></InstituteOnly>} />
              <Route path="student/:id" element={<StudentDetail />} />
              <Route path="attention" element={<Attention />} />
              <Route path="admin" element={<Admin />} />
              <Route path="present" element={<Present />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
  );
}

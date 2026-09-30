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
import ChangePassword from './pages/ChangePassword.jsx';
import { ScopeProvider, useScope } from './context/Scope.jsx';

function Protected() {
  const { user, booting } = useAuth();
  if (booting) return <div className="board"><div className="bezel"><div className="glass"><div className="scroll"><div className="skeleton" style={{ height: 200 }} /></div></div></div></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <ScopeProvider><Shell /></ScopeProvider>;
}

// Department picker pages only make sense for users who can see more than one department.
function MultiDeptOnly({ children }) {
  const { ready, multi } = useScope();
  if (!ready) return null;
  return multi ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/change-password" element={<ChangePassword />} />
            <Route element={<Protected />}>
              <Route index element={<Dashboard />} />
              <Route path="dept/:deptId" element={<MultiDeptOnly><Dashboard /></MultiDeptOnly>} />
              <Route path="departments" element={<MultiDeptOnly><Departments /></MultiDeptOnly>} />
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

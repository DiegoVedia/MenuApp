import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="spinner-text">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

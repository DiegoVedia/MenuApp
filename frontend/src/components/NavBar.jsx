import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const LINKS = [
  { to: '/meals', label: 'Comidas' },
  { to: '/import', label: 'Importar receta' },
  { to: '/pantry', label: 'Despensa' },
  { to: '/preferences', label: 'Preferencias' },
  { to: '/menu', label: 'Menú semanal' },
  { to: '/shopping-lists', label: 'Listas de compras' },
];

export default function NavBar() {
  const { user, logout } = useAuth();

  return (
    <nav className="navbar">
      <NavLink to="/" className="navbar-brand">🍽️ MenuApp</NavLink>
      {user && (
        <div className="navbar-links">
          {LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {link.label}
            </NavLink>
          ))}
        </div>
      )}
      {user && (
        <div className="navbar-user">
          <span>{user.name || user.email}</span>
          <button className="btn ghost small" onClick={logout} type="button">
            Salir
          </button>
        </div>
      )}
    </nav>
  );
}

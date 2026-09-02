import { useState } from 'react';
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
  const [open, setOpen] = useState(false);

  return (
    <nav className="navbar">
      <div className="navbar-row">
        <NavLink to="/" className="navbar-brand" onClick={() => setOpen(false)}>
          MENU<span>APP</span>
        </NavLink>
        {user && (
          <button
            type="button"
            className="navbar-toggle"
            aria-label="Abrir menú"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        )}
      </div>

      {user && (
        <div className={`navbar-collapse ${open ? 'open' : ''}`}>
          <div className="navbar-links">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => (isActive ? 'active' : '')}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </NavLink>
            ))}
          </div>
          <div className="navbar-user">
            <span>{user.name || user.email}</span>
            <button className="btn ghost small" onClick={logout} type="button">
              Salir
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}

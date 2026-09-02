/**
 * Layout compartido de login/registro: panel de marca a la izquierda
 * (oculto en mobile) + el formulario a la derecha. Centraliza el "look"
 * para que ambas pantallas queden consistentes.
 */
export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="auth-shell">
      <div className="auth-brand-panel">
        <div className="auth-brand-mark">MENU<span>APP</span></div>
        <p className="auth-brand-tagline">
          Cargá tus recetas una vez. Dejá que el planificador arme el menú
          de la semana, evite repetir comidas seguido, y te consolide la
          lista de compras — descontando lo que ya tenés en casa.
        </p>
        <ul className="auth-brand-list">
          <li>Menú semanal rotativo</li>
          <li>Lista de compras automática</li>
          <li>Importación de recetas por link</li>
        </ul>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form-card">
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

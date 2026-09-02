import { Link } from 'react-router-dom';

/**
 * Estado vacío consistente para listas sin datos todavía. Siempre incluye
 * una acción concreta (no solo un mensaje) para que la pantalla invite a
 * hacer algo en vez de sentirse un callejón sin salida.
 *
 * @param {{icon?: string, title: string, description?: string, action?: {label: string, to: string}, secondaryAction?: {label: string, to: string}}} props
 */
export default function EmptyState({ icon = '＋', title, description, action, secondaryAction }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {(action || secondaryAction) && (
        <div className="empty-state-actions">
          {action && <Link className="btn" to={action.to}>{action.label}</Link>}
          {secondaryAction && <Link className="btn secondary" to={secondaryAction.to}>{secondaryAction.label}</Link>}
        </div>
      )}
    </div>
  );
}

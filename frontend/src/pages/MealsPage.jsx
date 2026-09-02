import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

const MEAL_TYPES = ['desayuno', 'almuerzo', 'cena', 'snack'];

export default function MealsPage() {
  const [meals, setMeals] = useState([]);
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (search) params.set('search', search);
      const data = await api.get(`/meals?${params.toString()}`);
      setMeals(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`¿Archivar "${name}"? Ya no aparecerá en el generador de menú.`)) return;
    try {
      await api.delete(`/meals/${id}`);
      setMeals((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Comidas</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link className="btn secondary" to="/import">Importar desde link</Link>
          <Link className="btn" to="/meals/new">+ Nueva comida</Link>
        </div>
      </div>

      <ErrorBanner error={error} />

      <div className="card">
        <div className="form-row">
          <div>
            <label htmlFor="filter-type">Tipo</label>
            <select id="filter-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Todos</option>
              {MEAL_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-search">Buscar por nombre</label>
            <input
              id="filter-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="ej: pollo"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn secondary" type="button" onClick={load}>Buscar</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="spinner-text">Cargando comidas…</div>
      ) : meals.length === 0 ? (
        <div className="empty-state">
          Todavía no cargaste comidas. <Link to="/meals/new">Creá la primera</Link> o{' '}
          <Link to="/import">importá una desde un link</Link>.
        </div>
      ) : (
        <div className="meal-grid">
          {meals.map((meal) => (
            <div className="card meal-card" key={meal.id}>
              <Link to={`/meals/${meal.id}/edit`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <h3>{meal.name}</h3>
              </Link>
              <div className="meta">
                {meal.meal_type} · {meal.prep_time_minutes ? `${meal.prep_time_minutes} min` : 'sin tiempo'} ·{' '}
                {meal.base_servings} porciones
              </div>
              {meal.avg_rating && <div className="rating-stars">{'★'.repeat(Math.round(meal.avg_rating))}{'☆'.repeat(5 - Math.round(meal.avg_rating))}</div>}
              <div style={{ marginTop: '0.5rem' }}>
                {(meal.tags || []).map((tag) => (
                  <span className="tag" key={tag}>{tag}</span>
                ))}
              </div>
              <div className="slot-actions" style={{ marginTop: '0.7rem' }}>
                <Link className="btn small secondary" to={`/meals/${meal.id}/edit`}>Editar</Link>
                <button className="btn small danger" type="button" onClick={() => handleDelete(meal.id, meal.name)}>
                  Archivar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

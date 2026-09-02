import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

function addDaysToDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ShoppingListsPage() {
  const [lists, setLists] = useState([]);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({ weekStart: '', weeksCount: 1, name: '' });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      setLists(await api.get('/shopping-lists'));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!form.weekStart) return;
    setGenerating(true);
    setError(null);
    setWarnings([]);
    const weekStartDates = Array.from({ length: Number(form.weeksCount) || 1 }, (_, i) =>
      addDaysToDateStr(form.weekStart, i * 7)
    );
    try {
      const result = await api.post('/shopping-lists', {
        week_start_dates: weekStartDates,
        period_type: weekStartDates.length > 1 ? 'monthly' : 'weekly',
        name: form.name || undefined,
      });
      setWarnings(result.warnings || []);
      load();
    } catch (err) {
      setError(err);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <div className="page-header"><h1>Listas de compras</h1></div>
      <ErrorBanner error={error} />
      {warnings.map((w, i) => <div className="warning-banner" key={i}>{w}</div>)}

      <div className="card">
        <h3>Generar nueva lista</h3>
        <p className="muted">Elegí desde qué semana (lunes) empezar y cuántas semanas consolidar (1 = semanal, 4 = mensual aprox.).</p>
        <form className="form-row" style={{ alignItems: 'end' }} onSubmit={handleGenerate}>
          <div>
            <label>Semana de inicio (lunes)</label>
            <input type="date" required value={form.weekStart} onChange={(e) => setForm({ ...form, weekStart: e.target.value })} />
          </div>
          <div>
            <label>Cantidad de semanas</label>
            <input type="number" min="1" max="8" value={form.weeksCount} onChange={(e) => setForm({ ...form, weeksCount: e.target.value })} />
          </div>
          <div>
            <label>Nombre (opcional)</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <button className="btn" type="submit" disabled={generating}>{generating ? 'Generando…' : 'Generar'}</button>
        </form>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Nota: cada semana usada debe tener un menú ya generado (ver "Menú semanal").
        </p>
      </div>

      {loading ? (
        <div className="spinner-text">Cargando…</div>
      ) : lists.length === 0 ? (
        <div className="empty-state">Todavía no generaste ninguna lista de compras.</div>
      ) : (
        <div className="card">
          {lists.map((list) => (
            <div className="list-row" key={list.id}>
              <Link to={`/shopping-lists/${list.id}`}>
                {list.name || `${list.start_date} a ${list.end_date}`} ({list.period_type})
              </Link>
              <span className="muted">
                {list.total_estimated_cost != null ? `$${list.total_estimated_cost}` : 'sin costo estimado'} · {new Date(list.generated_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

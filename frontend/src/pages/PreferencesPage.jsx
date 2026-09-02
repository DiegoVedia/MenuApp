import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

const RESTRICTION_TYPES = ['alergia', 'no_me_gusta', 'evitar'];

export default function PreferencesPage() {
  const { user, updateUser } = useAuth();
  const [ingredients, setIngredients] = useState([]);
  const [restrictions, setRestrictions] = useState([]);
  const [tagLimits, setTagLimits] = useState([]);
  const [error, setError] = useState(null);

  const [restrictionForm, setRestrictionForm] = useState({ ingredient_id: '', type: 'no_me_gusta', is_hard: true });
  const [tagLimitForm, setTagLimitForm] = useState({ tag: '', max_per_week: 2 });
  const [lookbackWeeks, setLookbackWeeks] = useState(user?.lookback_weeks ?? 3);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [ing, restr, limits] = await Promise.all([
        api.get('/ingredients'),
        api.get('/restrictions/ingredients'),
        api.get('/restrictions/tag-limits'),
      ]);
      setIngredients(ing);
      setRestrictions(restr);
      setTagLimits(limits);
    } catch (err) {
      setError(err);
    }
  }

  async function saveLookback(e) {
    e.preventDefault();
    try {
      const updated = await api.patch('/auth/me', { lookback_weeks: Number(lookbackWeeks) });
      updateUser(updated);
    } catch (err) {
      setError(err);
    }
  }

  async function addRestriction(e) {
    e.preventDefault();
    if (!restrictionForm.ingredient_id) return;
    try {
      await api.post('/restrictions/ingredients', restrictionForm);
      setRestrictionForm({ ingredient_id: '', type: 'no_me_gusta', is_hard: true });
      load();
    } catch (err) {
      setError(err);
    }
  }

  async function removeRestriction(ingredientId) {
    try {
      await api.delete(`/restrictions/ingredients/${ingredientId}`);
      setRestrictions((prev) => prev.filter((r) => r.ingredient_id !== ingredientId));
    } catch (err) {
      setError(err);
    }
  }

  async function addTagLimit(e) {
    e.preventDefault();
    if (!tagLimitForm.tag.trim()) return;
    try {
      await api.post('/restrictions/tag-limits', { ...tagLimitForm, max_per_week: Number(tagLimitForm.max_per_week) });
      setTagLimitForm({ tag: '', max_per_week: 2 });
      load();
    } catch (err) {
      setError(err);
    }
  }

  async function removeTagLimit(id) {
    try {
      await api.delete(`/restrictions/tag-limits/${id}`);
      setTagLimits((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div>
      <div className="page-header"><h1>Preferencias</h1></div>
      <ErrorBanner error={error} />

      <div className="card">
        <h3>Rotación</h3>
        <form className="form-row" style={{ alignItems: 'end' }} onSubmit={saveLookback}>
          <div>
            <label>No repetir comidas usadas en las últimas N semanas</label>
            <input type="number" min="0" max="52" value={lookbackWeeks} onChange={(e) => setLookbackWeeks(e.target.value)} />
          </div>
          <button className="btn secondary" type="submit">Guardar</button>
        </form>
      </div>

      <div className="card">
        <h3>Alergias / preferencias por ingrediente</h3>
        <form className="form-row" style={{ alignItems: 'end' }} onSubmit={addRestriction}>
          <div style={{ flex: 2 }}>
            <label>Ingrediente</label>
            <select value={restrictionForm.ingredient_id} onChange={(e) => setRestrictionForm({ ...restrictionForm, ingredient_id: e.target.value })}>
              <option value="">— elegir —</option>
              {ingredients.map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
            </select>
          </div>
          <div>
            <label>Tipo</label>
            <select value={restrictionForm.type} onChange={(e) => setRestrictionForm({ ...restrictionForm, type: e.target.value })}>
              {RESTRICTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label>
              <input type="checkbox" style={{ width: 'auto', marginRight: '0.3rem' }} checked={restrictionForm.is_hard} onChange={(e) => setRestrictionForm({ ...restrictionForm, is_hard: e.target.checked })} />
              Excluir siempre (si no, solo penaliza)
            </label>
          </div>
          <button className="btn secondary" type="submit">Agregar</button>
        </form>
        {restrictions.map((r) => (
          <div className="list-row" key={r.id}>
            <span>{r.ingredient_name} — <span className="tag">{r.type}</span> {r.is_hard ? '(excluida siempre)' : '(penaliza)'}</span>
            <button className="btn small danger" onClick={() => removeRestriction(r.ingredient_id)}>Quitar</button>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Límites por tag (ej: "carne_roja" máx. 2 por semana)</h3>
        <form className="form-row" style={{ alignItems: 'end' }} onSubmit={addTagLimit}>
          <div>
            <label>Tag</label>
            <input value={tagLimitForm.tag} onChange={(e) => setTagLimitForm({ ...tagLimitForm, tag: e.target.value })} />
          </div>
          <div>
            <label>Máximo por semana</label>
            <input type="number" min="0" value={tagLimitForm.max_per_week} onChange={(e) => setTagLimitForm({ ...tagLimitForm, max_per_week: e.target.value })} />
          </div>
          <button className="btn secondary" type="submit">Agregar</button>
        </form>
        {tagLimits.map((t) => (
          <div className="list-row" key={t.id}>
            <span><span className="tag">{t.tag}</span> máx. {t.max_per_week}/semana</span>
            <button className="btn small danger" onClick={() => removeTagLimit(t.id)}>Quitar</button>
          </div>
        ))}
      </div>
    </div>
  );
}

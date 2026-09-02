import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

export default function ImportRecipePage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null);

  async function handleImport(e) {
    e.preventDefault();
    setError(null);
    setDraft(null);
    setLoading(true);
    try {
      const result = await api.post('/recipe-import/preview', { url });
      setDraft(result);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  function updateIngredient(index, patch) {
    setDraft((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)),
    }));
  }

  function removeIngredient(index) {
    setDraft((prev) => ({ ...prev, ingredients: prev.ingredients.filter((_, i) => i !== index) }));
  }

  function continueToSave() {
    navigate('/meals/new', { state: { draft } });
  }

  return (
    <div>
      <div className="page-header"><h1>Importar receta desde un link</h1></div>
      <ErrorBanner error={error} />

      <form className="card form-row" style={{ alignItems: 'end' }} onSubmit={handleImport}>
        <div style={{ flex: 3 }}>
          <label htmlFor="url">URL de la receta</label>
          <input id="url" type="url" required placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={loading}>{loading ? 'Importando…' : 'Importar'}</button>
      </form>

      {draft && (
        <div className="card">
          {(draft.warnings || []).map((w, i) => <div className="warning-banner" key={i}>{w}</div>)}
          <p className="muted">
            Extraído con: <strong>{draft.parsed_with}</strong>. Revisá y corregí lo que haga falta antes de guardar.
          </p>

          <div className="form-grid">
            <div>
              <label>Nombre</label>
              <input value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="form-row">
              <div>
                <label>Porciones base</label>
                <input type="number" min="0.5" step="0.5" value={draft.base_servings || ''} onChange={(e) => setDraft({ ...draft, base_servings: Number(e.target.value) })} />
              </div>
              <div>
                <label>Tiempo total (min)</label>
                <input type="number" min="0" value={draft.prep_time_minutes || ''} onChange={(e) => setDraft({ ...draft, prep_time_minutes: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <label>Instrucciones</label>
              <textarea value={draft.instructions || ''} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
            </div>

            <div>
              <label>Ingredientes detectados</label>
              {draft.ingredients.length === 0 && <p className="muted">No se detectó ninguno — agregalos manualmente en el siguiente paso.</p>}
              {draft.ingredients.map((ing, index) => (
                <div className="form-row" key={index} style={{ alignItems: 'end' }}>
                  <div>
                    <input placeholder="Nombre" value={ing.name || ''} onChange={(e) => updateIngredient(index, { name: e.target.value })} />
                    {ing.matched_ingredient_id ? (
                      <div className="muted" style={{ fontSize: '0.78rem' }}>✓ ya existe: {ing.matched_ingredient_name}</div>
                    ) : (
                      <div className="muted" style={{ fontSize: '0.78rem' }}>se creará como ingrediente nuevo</div>
                    )}
                  </div>
                  <div>
                    <input type="number" step="0.01" placeholder="Cantidad" value={ing.quantity ?? ''} onChange={(e) => updateIngredient(index, { quantity: Number(e.target.value) })} />
                  </div>
                  <div>
                    <input placeholder="Unidad" value={ing.unit || ''} onChange={(e) => updateIngredient(index, { unit: e.target.value })} />
                  </div>
                  <div className="muted" style={{ fontSize: '0.78rem' }}>"{ing.raw_text}"</div>
                  <div>
                    <button type="button" className="btn small danger" onClick={() => removeIngredient(index)}>Quitar</button>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <button className="btn" type="button" onClick={continueToSave}>Continuar y guardar como comida</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

const MEAL_TYPES = ['desayuno', 'almuerzo', 'cena', 'snack'];
const CATEGORIES = ['verduleria', 'carniceria', 'almacen', 'lacteos', 'panaderia', 'congelados', 'bebidas', 'limpieza', 'otros'];

function emptyForm() {
  return {
    name: '', meal_type: 'almuerzo', tags: '', prep_time_minutes: '', base_servings: 2,
    instructions: '', source_url: '',
  };
}

export default function MealFormPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isEditing = Boolean(id);

  const [form, setForm] = useState(emptyForm());
  const [rows, setRows] = useState([]); // {ingredient_id, quantity, unit, notes}
  const [allIngredients, setAllIngredients] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [scalePreview, setScalePreview] = useState(null);
  const [scaleServings, setScaleServings] = useState('');
  const [quickIngredient, setQuickIngredient] = useState({ name: '', default_unit: 'g', category: 'otros' });

  useEffect(() => {
    api.get('/ingredients').then(setAllIngredients).catch(setError);
  }, []);

  useEffect(() => {
    // Si venimos de la vista previa de importación, precargar ese draft.
    if (!isEditing && location.state?.draft) {
      const draft = location.state.draft;
      setForm({
        name: draft.name || '', meal_type: draft.meal_type || 'almuerzo', tags: (draft.tags || []).join(', '),
        prep_time_minutes: draft.prep_time_minutes || '', base_servings: draft.base_servings || 2,
        instructions: draft.instructions || '', source_url: draft.source_url || '',
      });
      setRows(
        (draft.ingredients || []).map((ing) => ({
          ingredient_id: ing.matched_ingredient_id || '',
          new_name: ing.matched_ingredient_id ? '' : ing.name,
          quantity: ing.quantity ?? '',
          unit: ing.unit || '',
          notes: ing.raw_text,
        }))
      );
      return;
    }
    if (isEditing) {
      api.get(`/meals/${id}`).then((meal) => {
        setForm({
          name: meal.name, meal_type: meal.meal_type, tags: (meal.tags || []).join(', '),
          prep_time_minutes: meal.prep_time_minutes || '', base_servings: meal.base_servings,
          instructions: meal.instructions || '', source_url: meal.source_url || '',
        });
        setRows(
          meal.ingredients.map((ing) => ({
            ingredient_id: ing.ingredient_id, quantity: ing.quantity, unit: ing.unit, notes: ing.notes || '',
          }))
        );
        setScaleServings(String(meal.base_servings));
      }).catch(setError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function updateRow(index, patch) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { ingredient_id: '', quantity: '', unit: '', notes: '' }]);
  }
  function removeRow(index) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreateIngredientForRow(index) {
    const row = rows[index];
    const name = row.new_name?.trim();
    if (!name) return;
    try {
      const created = await api.post('/ingredients', { name, default_unit: row.unit || 'unidad', category: 'otros' });
      setAllIngredients((prev) => [...prev, created]);
      updateRow(index, { ingredient_id: created.id, new_name: '' });
    } catch (err) {
      setError(err);
    }
  }

  async function handleQuickCreateIngredient() {
    if (!quickIngredient.name.trim()) return;
    try {
      const created = await api.post('/ingredients', quickIngredient);
      setAllIngredients((prev) => [...prev, created]);
      setQuickIngredient({ name: '', default_unit: 'g', category: 'otros' });
    } catch (err) {
      setError(err);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const ingredientsPayload = rows
      .filter((r) => r.ingredient_id && r.quantity && r.unit)
      .map((r) => ({ ingredient_id: r.ingredient_id, quantity: Number(r.quantity), unit: r.unit, notes: r.notes || undefined }));

    const payload = {
      name: form.name,
      meal_type: form.meal_type,
      tags: form.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      prep_time_minutes: form.prep_time_minutes ? Number(form.prep_time_minutes) : undefined,
      base_servings: Number(form.base_servings),
      instructions: form.instructions || undefined,
      source_url: form.source_url || undefined,
      ingredients: ingredientsPayload,
    };

    setSaving(true);
    try {
      if (isEditing) {
        await api.put(`/meals/${id}`, payload);
      } else {
        await api.post('/meals', payload);
      }
      navigate('/meals');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleScalePreview() {
    if (!isEditing || !scaleServings) return;
    try {
      const result = await api.get(`/meals/${id}/scale?servings=${scaleServings}`);
      setScalePreview(result);
    } catch (err) {
      setError(err);
    }
  }

  async function handleRate(rating) {
    try {
      await api.post(`/meals/${id}/ratings`, { rating });
      alert('¡Gracias! Se guardó la calificación.');
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>{isEditing ? 'Editar comida' : 'Nueva comida'}</h1>
      </div>
      <ErrorBanner error={error} />

      <form className="card form-grid" onSubmit={handleSubmit}>
        <div className="form-row">
          <div>
            <label htmlFor="name">Nombre</label>
            <input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="meal_type">Tipo</label>
            <select id="meal_type" value={form.meal_type} onChange={(e) => setForm({ ...form, meal_type: e.target.value })}>
              {MEAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="tags">Tags (separados por coma)</label>
            <input id="tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="pollo, rapida, vegetariano" />
          </div>
          <div>
            <label htmlFor="prep_time">Tiempo de preparación (min)</label>
            <input id="prep_time" type="number" min="0" value={form.prep_time_minutes} onChange={(e) => setForm({ ...form, prep_time_minutes: e.target.value })} />
          </div>
          <div>
            <label htmlFor="base_servings">Porciones base</label>
            <input id="base_servings" type="number" min="0.5" step="0.5" required value={form.base_servings} onChange={(e) => setForm({ ...form, base_servings: e.target.value })} />
          </div>
        </div>

        <div>
          <label htmlFor="source_url">URL de origen (opcional)</label>
          <input id="source_url" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} />
        </div>

        <div>
          <label htmlFor="instructions">Instrucciones</label>
          <textarea id="instructions" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        </div>

        <div>
          <label>Ingredientes (cantidades a {form.base_servings || '?'} porciones)</label>
          {rows.map((row, index) => (
            <div className="form-row" key={index} style={{ alignItems: 'end' }}>
              <div>
                <select value={row.ingredient_id} onChange={(e) => updateRow(index, { ingredient_id: e.target.value })}>
                  <option value="">— elegir ingrediente —</option>
                  {allIngredients.map((ing) => (
                    <option key={ing.id} value={ing.id}>{ing.name} ({ing.default_unit})</option>
                  ))}
                </select>
                {!row.ingredient_id && row.new_name && (
                  <div style={{ marginTop: '0.3rem', fontSize: '0.8rem' }} className="muted">
                    Sugerido por importación: "{row.new_name}" — no existe todavía.{' '}
                    <button type="button" className="btn small secondary" onClick={() => handleCreateIngredientForRow(index)}>
                      Crear ingrediente "{row.new_name}"
                    </button>
                  </div>
                )}
              </div>
              <div>
                <input type="number" step="0.01" placeholder="Cantidad" value={row.quantity} onChange={(e) => updateRow(index, { quantity: e.target.value })} />
              </div>
              <div>
                <input placeholder="Unidad (g, ml, unidad...)" value={row.unit} onChange={(e) => updateRow(index, { unit: e.target.value })} />
              </div>
              <div>
                <input placeholder="Notas (opcional)" value={row.notes} onChange={(e) => updateRow(index, { notes: e.target.value })} />
              </div>
              <div>
                <button type="button" className="btn small danger" onClick={() => removeRow(index)}>Quitar</button>
              </div>
            </div>
          ))}
          <button type="button" className="btn small secondary" onClick={addRow}>+ Agregar ingrediente</button>
        </div>

        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>¿No encontrás el ingrediente? Creá uno nuevo rápido</summary>
          <div className="form-row" style={{ marginTop: '0.5rem' }}>
            <input placeholder="Nombre" value={quickIngredient.name} onChange={(e) => setQuickIngredient({ ...quickIngredient, name: e.target.value })} />
            <input placeholder="Unidad (g, ml, unidad...)" value={quickIngredient.default_unit} onChange={(e) => setQuickIngredient({ ...quickIngredient, default_unit: e.target.value })} />
            <select value={quickIngredient.category} onChange={(e) => setQuickIngredient({ ...quickIngredient, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" className="btn small secondary" onClick={handleQuickCreateIngredient}>Crear</button>
          </div>
        </details>

        <div>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Guardando…' : isEditing ? 'Guardar cambios' : 'Crear comida'}
          </button>
        </div>
      </form>

      {isEditing && (
        <div className="card">
          <h3>Calificar esta comida</h3>
          <p className="muted">Calificala después de cocinarla: influye en el generador de menú.</p>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className="btn small secondary" type="button" onClick={() => handleRate(n)}>{n} ★</button>
            ))}
          </div>
        </div>
      )}

      {isEditing && (
        <div className="card">
          <h3>Escalar porciones (vista previa)</h3>
          <div className="form-row" style={{ alignItems: 'end' }}>
            <div>
              <label htmlFor="scale">Porciones deseadas</label>
              <input id="scale" type="number" min="0.5" step="0.5" value={scaleServings} onChange={(e) => setScaleServings(e.target.value)} />
            </div>
            <button className="btn small secondary" type="button" onClick={handleScalePreview}>Calcular</button>
          </div>
          {scalePreview && (
            <table style={{ marginTop: '0.75rem' }}>
              <thead><tr><th>Ingrediente</th><th>Cantidad</th></tr></thead>
              <tbody>
                {scalePreview.ingredients.map((ing) => (
                  <tr key={ing.ingredient_id}><td>{ing.ingredient_name}</td><td>{ing.quantity} {ing.unit}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

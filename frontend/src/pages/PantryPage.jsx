import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import ErrorBanner from '../components/ErrorBanner.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function PantryPage() {
  const [items, setItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [form, setForm] = useState({ ingredient_id: '', quantity: '', unit: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [pantryData, ingredientsData] = await Promise.all([api.get('/pantry'), api.get('/ingredients')]);
      setItems(pantryData);
      setIngredients(ingredientsData);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  function selectIngredient(id) {
    const ing = ingredients.find((i) => i.id === id);
    setForm({ ingredient_id: id, quantity: '', unit: ing ? ing.default_unit : '' });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.put(`/pantry/${form.ingredient_id}`, { quantity: Number(form.quantity), unit: form.unit });
      setForm({ ingredient_id: '', quantity: '', unit: '' });
      load();
    } catch (err) {
      setError(err);
    }
  }

  async function handleDelete(ingredientId) {
    try {
      await api.delete(`/pantry/${ingredientId}`);
      setItems((prev) => prev.filter((i) => i.ingredient_id !== ingredientId));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div>
      <div className="page-header"><h1>Despensa</h1></div>
      <ErrorBanner error={error} />

      <div className="card">
        <h3>Agregar / actualizar cantidad</h3>
        <form className="form-row" style={{ alignItems: 'end' }} onSubmit={handleSubmit}>
          <div style={{ flex: 2 }}>
            <label>Ingrediente</label>
            <select required value={form.ingredient_id} onChange={(e) => selectIngredient(e.target.value)}>
              <option value="">— elegir —</option>
              {ingredients.map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
            </select>
          </div>
          <div>
            <label>Cantidad</label>
            <input type="number" min="0" step="0.01" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </div>
          <div>
            <label>Unidad</label>
            <input required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </div>
          <button className="btn" type="submit">Guardar</button>
        </form>
      </div>

      {loading ? (
        <div className="spinner-text">Cargando…</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🧺"
          title="Tu despensa está vacía"
          description="Cargá lo que ya tenés en casa usando el formulario de arriba — así se descuenta automáticamente cuando generes una lista de compras."
        />
      ) : (
        <div className="card">
          <div className="table-scroll">
          <table>
            <thead><tr><th>Ingrediente</th><th>Categoría</th><th>Cantidad</th><th></th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.ingredient_name}</td>
                  <td>{item.category}</td>
                  <td>{item.quantity} {item.unit}</td>
                  <td><button className="btn small danger" onClick={() => handleDelete(item.ingredient_id)}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

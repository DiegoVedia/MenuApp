import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

export default function ShoppingListDetailPage() {
  const { id } = useParams();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [exportText, setExportText] = useState(null);

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    try {
      setList(await api.get(`/shopping-lists/${id}`));
    } catch (err) {
      setError(err);
    }
  }

  async function togglePurchased(item) {
    try {
      await api.patch(`/shopping-lists/items/${item.id}`, { is_purchased: !item.is_purchased });
      setList((prev) => ({
        ...prev,
        groups: prev.groups.map((g) => ({
          ...g,
          items: g.items.map((it) => (it.id === item.id ? { ...it, is_purchased: !it.is_purchased } : it)),
        })),
      }));
    } catch (err) {
      setError(err);
    }
  }

  async function handleExport() {
    try {
      const res = await fetch(`/api/shopping-lists/${id}/export`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('menuapp_token')}` },
      });
      const text = await res.text();
      setExportText(text);
    } catch (err) {
      setError(err);
    }
  }

  function copyExport() {
    if (exportText) navigator.clipboard?.writeText(exportText);
  }

  if (!list) {
    return error ? <ErrorBanner error={error} /> : <div className="spinner-text">Cargando…</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>{list.name || `${list.start_date} a ${list.end_date}`}</h1>
        <button className="btn secondary" onClick={handleExport}>Exportar como texto</button>
      </div>
      <ErrorBanner error={error} />

      {list.total_estimated_cost != null && (
        <div className="info-banner">Costo estimado total: ${list.total_estimated_cost}</div>
      )}

      {exportText && (
        <div className="card">
          <pre style={{ whiteSpace: 'pre-wrap' }}>{exportText}</pre>
          <button className="btn small secondary" onClick={copyExport}>Copiar al portapapeles</button>
        </div>
      )}

      {list.groups.map((group) => (
        <div className="card category-group" key={group.category}>
          <h3>{group.category}</h3>
          {group.items.map((item) => (
            <div className={`shopping-item ${item.is_purchased ? 'purchased' : ''}`} key={item.id}>
              <input type="checkbox" style={{ width: 'auto' }} checked={item.is_purchased} onChange={() => togglePurchased(item)} />
              <span style={{ flex: 1 }}>{item.ingredient_name}</span>
              <span className="qty">{item.quantity_to_buy} {item.unit}</span>
              {item.estimated_price != null && <span className="qty">${item.estimated_price}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

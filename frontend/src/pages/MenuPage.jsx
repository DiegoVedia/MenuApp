import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

const DAY_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function mondayOfCurrentWeek() {
  const now = new Date();
  const day = now.getDay(); // 0=domingo
  const diff = day === 0 ? -6 : 1 - day;
  now.setDate(now.getDate() + diff);
  return now.toISOString().slice(0, 10);
}

function addDaysToDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function MenuPage() {
  const [weekStart, setWeekStart] = useState(mondayOfCurrentWeek());
  const [week, setWeek] = useState(null);
  const [meals, setMeals] = useState([]);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { loadWeek(); }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/meals').then(setMeals).catch(setError); }, []);

  async function loadWeek() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/menu/weeks/${weekStart}`);
      setWeek(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setWeek(null);
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setWarnings([]);
    try {
      const data = await api.post(`/menu/weeks/${weekStart}/generate`, {});
      setWeek(data);
      setWarnings(data.warnings || []);
    } catch (err) {
      setError(err);
    } finally {
      setGenerating(false);
    }
  }

  async function handleConfirm() {
    try {
      await api.post(`/menu/weeks/${weekStart}/confirm`, {});
      loadWeek();
    } catch (err) {
      setError(err);
    }
  }

  async function toggleLock(slot) {
    try {
      const updated = await api.patch(`/menu/slots/${slot.id}`, { is_locked: !slot.is_locked });
      patchSlot(updated);
    } catch (err) {
      setError(err);
    }
  }

  async function assignMeal(slot, mealId) {
    try {
      const updated = await api.patch(`/menu/slots/${slot.id}`, { meal_id: mealId });
      patchSlot(updated);
    } catch (err) {
      setError(err);
    }
  }

  async function requestAlternative(slot) {
    try {
      const updated = await api.post(`/menu/slots/${slot.id}/alternative`);
      patchSlot(updated);
    } catch (err) {
      setError(err);
    }
  }

  function patchSlot(updatedSlot) {
    setWeek((prev) => {
      if (!prev) return prev;
      const meal = meals.find((m) => m.id === updatedSlot.meal_id);
      const merged = { ...updatedSlot, meal_name: meal ? meal.name : updatedSlot.meal_name };
      return { ...prev, slots: prev.slots.map((s) => (s.id === merged.id ? { ...s, ...merged } : s)) };
    });
  }

  const slotsByDay = useMemo(() => {
    const map = {};
    for (let d = 0; d < 7; d++) map[d] = [];
    (week?.slots || []).forEach((s) => map[s.day_of_week]?.push(s));
    return map;
  }, [week]);

  return (
    <div>
      <div className="page-header">
        <h1>Menú semanal</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn ghost small" onClick={() => setWeekStart(addDaysToDateStr(weekStart, -7))}>← Semana anterior</button>
          <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
          <button className="btn ghost small" onClick={() => setWeekStart(addDaysToDateStr(weekStart, 7))}>Semana siguiente →</button>
        </div>
      </div>

      <ErrorBanner error={error} />
      {warnings.map((w, i) => <div className="warning-banner" key={i}>{w}</div>)}

      <div className="card" style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" onClick={handleGenerate} disabled={generating}>
          {generating ? 'Generando…' : week ? 'Regenerar semana (respeta lo fijado)' : 'Generar menú de esta semana'}
        </button>
        {week && week.status !== 'confirmed' && (
          <button className="btn secondary" onClick={handleConfirm}>Confirmar semana</button>
        )}
        {week && <span className="muted">Estado: {week.status === 'confirmed' ? 'confirmado ✓' : 'borrador'}</span>}
      </div>

      {loading ? (
        <div className="spinner-text">Cargando…</div>
      ) : !week ? (
        <div className="empty-state">Todavía no generaste un menú para la semana del {weekStart}.</div>
      ) : (
        <div className="calendar">
          {DAY_LABELS.map((label, dayIndex) => (
            <div className="calendar-day" key={dayIndex}>
              <h4>{label} {addDaysToDateStr(weekStart, dayIndex).slice(5)}</h4>
              {slotsByDay[dayIndex].map((slot) => (
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  meals={meals}
                  onToggleLock={() => toggleLock(slot)}
                  onAssign={(mealId) => assignMeal(slot, mealId)}
                  onAlternative={() => requestAlternative(slot)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SlotCard({ slot, meals, onToggleLock, onAssign, onAlternative }) {
  const className = ['slot-card', !slot.meal_id && 'empty', slot.is_locked && 'locked', slot.is_leftover && 'leftover']
    .filter(Boolean).join(' ');
  const candidateMeals = meals.filter((m) => m.meal_type === slot.slot_type);

  return (
    <div className={className}>
      <div className="slot-type">{slot.slot_type} {slot.is_leftover && '· sobra'}</div>
      {slot.meal_name ? <strong>{slot.meal_name}</strong> : <span>Sin asignar</span>}
      <div className="slot-actions">
        <button className="btn small ghost" onClick={onToggleLock} title="Fijar para que no se pise al regenerar">
          {slot.is_locked ? '🔒 Fijado' : '🔓 Fijar'}
        </button>
        {!slot.is_locked && (
          <button className="btn small ghost" onClick={onAlternative}>Alternativa</button>
        )}
      </div>
      <select
        style={{ marginTop: '0.4rem' }}
        value={slot.meal_id || ''}
        disabled={slot.is_locked}
        onChange={(e) => onAssign(e.target.value)}
      >
        <option value="">— asignar manualmente —</option>
        {candidateMeals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </div>
  );
}

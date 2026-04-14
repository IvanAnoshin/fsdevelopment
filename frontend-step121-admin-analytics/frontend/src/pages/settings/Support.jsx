import { useEffect, useState } from 'react';
import { createSupportTicket, getMySupportTickets, showToast } from '../../services/api';

export default function Support() {
  const [tickets, setTickets] = useState([]);
  const [form, setForm] = useState({ subject: '', message: '', category: 'general' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setError('');
      const res = await getMySupportTickets();
      setTickets(Array.isArray(res.data?.tickets) ? res.data.tickets : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось загрузить обращения');
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.subject.trim() || !form.message.trim()) return;
    try {
      setBusy(true);
      const res = await createSupportTicket({ ...form, subject: form.subject.trim(), message: form.message.trim() });
      const ticket = res.data?.ticket;
      if (ticket) setTickets((prev) => [ticket, ...prev]);
      setForm({ subject: '', message: '', category: 'general' });
      showToast('Обращение отправлено', { tone: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось отправить обращение');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pa-list pa-settings-page">
      <section className="pa-card">
        <div className="pa-section-head" style={{ marginTop: 0 }}>
          <div className="pa-section-title">Поддержка и обращения</div>
          <button className="pa-secondary-btn" onClick={load}>Обновить</button>
        </div>
        <div className="pa-bio">Простая рабочая форма для обращений. Она связана с кабинетом модерации, но сам кабинет недоступен обычным пользователям.</div>
        {error && <div className="pa-error" style={{ marginTop: 12 }}>{error}</div>}
        <input className="pa-input" style={{ marginTop: 12 }} value={form.subject} onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))} placeholder="Тема обращения" />
        <select className="pa-input" style={{ marginTop: 10 }} value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}>
          <option value="general">Общий вопрос</option>
          <option value="report-followup">Уточнение по жалобе</option>
          <option value="billing">Оплата / подписка</option>
          <option value="security">Безопасность</option>
        </select>
        <textarea className="pa-textarea" style={{ marginTop: 10 }} value={form.message} onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))} placeholder="Коротко опишите ситуацию" />
        <div className="pa-action-row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="pa-primary-btn" onClick={submit} disabled={busy || !form.subject.trim() || !form.message.trim()}>{busy ? 'Отправляю…' : 'Отправить'}</button>
        </div>
      </section>

      <section className="pa-card">
        <div className="pa-section-title">Мои обращения</div>
        <div className="pa-list" style={{ marginTop: 12 }}>
          {tickets.length === 0 ? <div className="pa-empty"><h3>Обращений пока нет</h3><p>После отправки обращения оно появится здесь.</p></div> : tickets.map((ticket) => (
            <div key={ticket.id} className="pa-admin-item">
              <div className="pa-admin-row" style={{ alignItems: 'flex-start' }}>
                <div className="pa-admin-main">
                  <div className="pa-name">#{ticket.id} · {ticket.subject}</div>
                  <div className="pa-meta">{new Date(ticket.created_at).toLocaleString('ru-RU')} · {ticket.category}</div>
                  <div className="pa-bio" style={{ marginTop: 8 }}>{ticket.message}</div>
                </div>
                <span className={`pa-pill ${ticket.status === 'resolved' || ticket.status === 'closed' ? 'green' : ticket.status === 'reviewing' ? 'accent' : 'warning'}`}>{ticket.status}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

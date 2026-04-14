import { useEffect, useState } from 'react';
import { getMe, getModerationReports, getSupportTicketsAdmin, updateModerationReport, updateSupportTicketAdmin } from '../../services/api';
import { hasPermission, PERMISSIONS } from '../../services/permissions';

const reportStatuses = ['pending', 'reviewing', 'resolved', 'rejected'];
const ticketStatuses = ['open', 'reviewing', 'resolved', 'closed'];

function statusTone(status) {
  if (status === 'resolved' || status === 'closed') return 'green';
  if (status === 'rejected') return 'red';
  if (status === 'reviewing') return 'accent';
  return 'warning';
}

export default function ModerationDesk() {
  const [reports, setReports] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [tab, setTab] = useState('reports');
  const [busyId, setBusyId] = useState('');
  const [accessChecked, setAccessChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setError('');
      const [reportsRes, ticketsRes] = await Promise.all([getModerationReports({ status: 'all' }), getSupportTicketsAdmin({ status: 'all' })]);
      setReports(Array.isArray(reportsRes.data?.reports) ? reportsRes.data.reports : []);
      setTickets(Array.isArray(ticketsRes.data?.tickets) ? ticketsRes.data.tickets : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось загрузить модерацию');
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await getMe();
        if (!alive) return;
        const ok = hasPermission(me.data, PERMISSIONS.USERS_MODERATE);
        setAllowed(ok);
        if (ok) await load();
        else setError('У вас нет доступа к кабинету модерации.');
      } catch (err) {
        if (alive) setError(err.response?.data?.error || 'Не удалось проверить доступ');
      } finally {
        if (alive) setAccessChecked(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const updateReport = async (report, status) => {
    try {
      setBusyId(`report-${report.id}`);
      const res = await updateModerationReport(report.id, { status, admin_note: report.admin_note || '' });
      const next = res.data?.report;
      if (next) setReports((prev) => prev.map((item) => item.id === next.id ? next : item));
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось обновить жалобу');
    } finally {
      setBusyId('');
    }
  };

  const updateTicket = async (ticket, status) => {
    try {
      setBusyId(`ticket-${ticket.id}`);
      const res = await updateSupportTicketAdmin(ticket.id, { status, admin_note: ticket.admin_note || '', priority: ticket.priority || 'normal' });
      const next = res.data?.ticket;
      if (next) setTickets((prev) => prev.map((item) => item.id === next.id ? next : item));
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось обновить обращение');
    } finally {
      setBusyId('');
    }
  };

  if (!accessChecked) return <div className="pa-loading">Проверяю доступ…</div>;
  if (!allowed) return <div className="pa-empty pa-card"><h3>Доступ ограничен</h3><p>{error || 'Этот экран доступен только модераторам и администраторам.'}</p></div>;

  return (
    <div className="pa-list">
      <section className="pa-card">
        <div className="pa-section-head" style={{ marginTop: 0 }}>
          <div className="pa-section-title">Кабинет модерации</div>
          <button className="pa-secondary-btn" onClick={load}>Обновить</button>
        </div>
        <div className="pa-bio">Здесь собираются жалобы на контент и обращения в поддержку. Доступ к экрану закрыт для обычных пользователей.</div>
        <div className="pa-chip-row" style={{ marginTop: 12 }}>
          <button className={`pa-chip ${tab === 'reports' ? 'is-active' : ''}`} type="button" onClick={() => setTab('reports')}>Жалобы ({reports.length})</button>
          <button className={`pa-chip ${tab === 'tickets' ? 'is-active' : ''}`} type="button" onClick={() => setTab('tickets')}>Обращения ({tickets.length})</button>
        </div>
        {error && <div className="pa-error" style={{ marginTop: 12 }}>{error}</div>}
      </section>

      {tab === 'reports' ? (
        <section className="pa-card">
          <div className="pa-section-title">Жалобы на посты</div>
          <div className="pa-list" style={{ marginTop: 12 }}>
            {reports.length === 0 ? <div className="pa-empty"><h3>Жалоб пока нет</h3><p>Когда пользователи начнут жаловаться на контент, элементы появятся здесь.</p></div> : reports.map((report) => (
              <div key={report.id} className="pa-admin-item">
                <div className="pa-admin-row" style={{ alignItems: 'flex-start' }}>
                  <div className="pa-admin-main">
                    <div className="pa-name">#{report.id} · {report.target_type}:{report.target_id}</div>
                    <div className="pa-meta">От @{report.reporter?.username || 'user'} · {new Date(report.created_at).toLocaleString('ru-RU')}</div>
                    <div className="pa-bio" style={{ marginTop: 8 }}><strong>Причина:</strong> {report.reason}{report.details ? ` · ${report.details}` : ''}</div>
                  </div>
                  <span className={`pa-pill ${statusTone(report.status)}`}>{report.status}</span>
                </div>
                <div className="pa-action-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  {reportStatuses.map((status) => <button key={status} className="pa-secondary-btn" disabled={busyId === `report-${report.id}` || report.status === status} onClick={() => updateReport(report, status)}>{status}</button>)}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="pa-card">
          <div className="pa-section-title">Обращения пользователей</div>
          <div className="pa-list" style={{ marginTop: 12 }}>
            {tickets.length === 0 ? <div className="pa-empty"><h3>Обращений пока нет</h3><p>Пользовательские обращения будут появляться здесь.</p></div> : tickets.map((ticket) => (
              <div key={ticket.id} className="pa-admin-item">
                <div className="pa-admin-row" style={{ alignItems: 'flex-start' }}>
                  <div className="pa-admin-main">
                    <div className="pa-name">#{ticket.id} · {ticket.subject}</div>
                    <div className="pa-meta">От @{ticket.user?.username || 'user'} · {new Date(ticket.created_at).toLocaleString('ru-RU')}</div>
                    <div className="pa-bio" style={{ marginTop: 8 }}>{ticket.message}</div>
                  </div>
                  <span className={`pa-pill ${statusTone(ticket.status)}`}>{ticket.status}</span>
                </div>
                <div className="pa-action-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  {ticketStatuses.map((status) => <button key={status} className="pa-secondary-btn" disabled={busyId === `ticket-${ticket.id}` || ticket.status === status} onClick={() => updateTicket(ticket, status)}>{status}</button>)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

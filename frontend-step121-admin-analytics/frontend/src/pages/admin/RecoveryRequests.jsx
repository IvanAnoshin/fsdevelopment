import { useEffect, useState } from 'react';
import { approveRecoveryRequest, getMe, getRecoveryRequestDetails, getRecoveryRequests, rejectRecoveryRequest, confirmAction, showToast } from '../../services/api';
import { canReviewRecovery } from '../../services/permissions';

function statusPill(status, autoDecision) {
  if (status === 'approved') return ['green', 'Одобрена'];
  if (status === 'rejected') return ['red', 'Отклонена'];
  if (status === 'expired') return ['neutral', 'Истекла'];
  if (autoDecision === 'auto_approve') return ['accent', 'Авто-одобрена'];
  if (autoDecision === 'auto_reject') return ['warning', 'Авто-отклонена'];
  return ['warning', 'Ожидает'];
}

export default function RecoveryRequests() {
  const [requests, setRequests] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [accessChecked, setAccessChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    const bootstrap = async () => {
      try {
        const me = await getMe();
        if (ignore) return;
        const allowed = canReviewRecovery(me.data);
        setIsAdmin(allowed);
        if (!allowed) {
          setError('У вас нет доступа к заявкам на восстановление.');
        } else {
          await loadRequests();
        }
      } catch (err) {
        if (!ignore) setError(err.response?.data?.error || 'Не удалось проверить доступ');
      } finally {
        if (!ignore) setAccessChecked(true);
      }
    };
    bootstrap();
    return () => { ignore = true; };
  }, []);

  const loadRequests = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getRecoveryRequests();
      setRequests(Array.isArray(res.data?.requests) ? res.data.requests : []);
    } catch (err) {
      console.error('Ошибка заявок:', err);
      setError(err.response?.data?.error || 'Не удалось загрузить заявки');
    } finally {
      setLoading(false);
    }
  };

  const loadDetails = async (id) => {
    try {
      setError('');
      const res = await getRecoveryRequestDetails(id);
      setDetails(res.data || null);
      setSelectedId(id);
    } catch (err) {
      console.error('Ошибка деталей:', err);
      setError(err.response?.data?.error || 'Не удалось загрузить детали заявки');
    }
  };

  const approve = async (id) => {
    const confirmed = await confirmAction({ title: 'Одобрить заявку', message: 'Пользователь сможет завершить восстановление доступа после одобрения.', confirmLabel: 'Одобрить', tone: 'warning' });
    if (!confirmed) return;
    try {
      setBusy(true);
      await approveRecoveryRequest(id);
      await loadRequests();
      if (selectedId === id) {
        setSelectedId(null);
        setDetails(null);
      }
      showToast('Заявка одобрена', { tone: 'success' });
    } catch (err) {
      console.error('Ошибка approve:', err);
      setError(err.response?.data?.error || 'Не удалось одобрить заявку');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!selectedId || !reason.trim()) return;
    try {
      setBusy(true);
      await rejectRecoveryRequest(selectedId, { reason: reason.trim() });
      setShowReject(false);
      setReason('');
      setSelectedId(null);
      setDetails(null);
      await loadRequests();
    } catch (err) {
      console.error('Ошибка reject:', err);
      setError(err.response?.data?.error || 'Не удалось отклонить заявку');
    } finally {
      setBusy(false);
    }
  };

  if (!accessChecked) return <div className="pa-loading">Проверяю доступ…</div>;
  if (!isAdmin) return <div className="pa-empty pa-card"><h3>Доступ ограничен</h3><p>{error || 'Эта секция доступна только сотрудникам с правом проверки восстановления.'}</p></div>;

  return (
    <div className="pa-admin-columns">
      <section className="pa-card">
        <div className="pa-section-head" style={{ marginTop: 0 }}>
          <div className="pa-section-title">Заявки на восстановление</div>
          <button className="pa-secondary-btn" onClick={loadRequests}>Обновить</button>
        </div>
        <div className="pa-bio">Список заявок пользователей, которые потеряли доступ к аккаунту и требуют ручной проверки.</div>
        {error && <div className="pa-error" style={{ marginTop: 12 }}>{error}</div>}
        {loading ? <div className="pa-loading">Загружаю заявки…</div> : requests.length === 0 ? <div className="pa-empty" style={{ marginTop: 12 }}><h3>Заявок нет</h3><p>Новых обращений пока не поступало.</p></div> : (
          <div className="pa-list" style={{ marginTop: 12 }}>
            {requests.map((request) => {
              const [pillCls, pillLabel] = statusPill(request.status, request.auto_decision);
              return (
                <button key={request.id} type="button" className="pa-admin-item" style={{ textAlign: 'left', borderColor: selectedId === request.id ? 'rgba(109,94,252,.28)' : undefined }} onClick={() => loadDetails(request.id)}>
                  <div className="pa-admin-row">
                    <div className="pa-admin-main">
                      <div className="pa-name">#{request.id} · {request.user?.first_name} {request.user?.last_name}</div>
                      <div className="pa-handle">@{request.user?.username}</div>
                      <div className="pa-meta" style={{ marginTop: 6 }}>{request.created_at ? new Date(request.created_at).toLocaleString('ru-RU') : '—'}</div>
                    </div>
                    <span className={`pa-pill ${pillCls}`}>{pillLabel}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="pa-card">
        <div className="pa-section-head" style={{ marginTop: 0 }}>
          <div className="pa-section-title">Детали заявки</div>
          {selectedId && details?.request?.status === 'pending' && (
            <div className="pa-pill-row">
              <button className="pa-primary-btn" onClick={() => approve(selectedId)} disabled={busy}>Одобрить</button>
              <button className="pa-danger-btn" onClick={() => setShowReject(true)} disabled={busy}>Отклонить</button>
            </div>
          )}
        </div>
        {!details ? <div className="pa-empty"><h3>Выберите заявку</h3><p>Справа появятся детали, устройства, друзья и ответы пользователя.</p></div> : (
          <div className="pa-list">
            <div className="pa-soft-panel"><div className="pa-section-title">Пользователь</div><div className="pa-bio" style={{ marginTop: 8 }}>{details.request?.user?.first_name} {details.request?.user?.last_name} · @{details.request?.user?.username}</div></div>
            <div className="pa-soft-panel"><div className="pa-section-title">Устройство и DFSN</div><div className="pa-bio" style={{ marginTop: 8 }}>IP: {details.request?.ip || '—'}<br/>User-Agent: {details.request?.user_agent || '—'}<br/>DFSN average: {details.request?.dfsn_average ? `${(details.request.dfsn_average * 100).toFixed(0)}%` : '—'}<br/>DFSN sessions: {details.request?.dfsn_sessions || 0}</div></div>
            {Array.isArray(details.devices) && details.devices.length > 0 && <div className="pa-soft-panel"><div className="pa-section-title">Доверенные устройства</div><div className="pa-pill-row" style={{ marginTop: 10 }}>{details.devices.map((device) => <span key={device.id || device.device_id} className="pa-pill neutral">{device.device_name || 'Устройство'} · {device.ip || '—'}</span>)}</div></div>}
            {Array.isArray(details.friends) && details.friends.length > 0 && <div className="pa-soft-panel"><div className="pa-section-title">Друзья</div><div className="pa-pill-row" style={{ marginTop: 10 }}>{details.friends.slice(0, 12).map((friend) => <span key={friend.id} className="pa-pill accent">{friend.first_name} {friend.last_name}</span>)}</div></div>}
            {Array.isArray(details.posts) && details.posts.length > 0 && <div className="pa-soft-panel"><div className="pa-section-title">Последние посты</div><div className="pa-list" style={{ marginTop: 10 }}>{details.posts.slice(0, 5).map((post) => <div key={post.id} className="pa-card" style={{ padding: 12 }}><div className="pa-bio">{post.content || 'Пустой пост'}</div><div className="pa-meta" style={{ marginTop: 6 }}>{post.created_at ? new Date(post.created_at).toLocaleString('ru-RU') : '—'}</div></div>)}</div></div>}
            {Array.isArray(details.answers) && details.answers.length > 0 && <div className="pa-soft-panel"><div className="pa-section-title">Ответы пользователя</div><div className="pa-list" style={{ marginTop: 10 }}>{details.answers.map((item, idx) => <div key={idx} className="pa-card" style={{ padding: 12 }}><div className="pa-meta">{item.question || `Вопрос ${idx + 1}`}</div><div className="pa-bio" style={{ marginTop: 6 }}>{item.answer || '—'}</div></div>)}</div></div>}
          </div>
        )}
      </section>

      {showReject && (
        <div className="pa-overlay" onClick={() => setShowReject(false)}>
          <div className="pa-modal-wrap" onClick={(e) => e.stopPropagation()}>
            <div className="pa-modal">
              <div className="pa-section-title">Причина отклонения</div>
              <textarea className="pa-textarea" style={{ marginTop: 12 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Объясните, почему заявка отклонена" />
              <div className="pa-action-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="pa-secondary-btn" onClick={() => setShowReject(false)}>Отмена</button><button className="pa-danger-btn" onClick={reject} disabled={busy || !reason.trim()}>Отклонить</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

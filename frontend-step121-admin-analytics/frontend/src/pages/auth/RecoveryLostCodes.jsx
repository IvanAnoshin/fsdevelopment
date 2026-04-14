import { useState } from 'react';
import { Link } from 'react-router-dom';
import PreAuthLayout from '../../components/auth/PreAuthLayout';
import { createRecoveryRequest, getApiErrorMessage, showToast } from '../../services/api';

export default function RecoveryLostCodes() {
  const [form, setForm] = useState({ first_name: '', last_name: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  const capitalizeFirstLetter = (str) => (!str ? '' : str.charAt(0).toUpperCase() + str.slice(1).toLowerCase());

  const handleFirstNameChange = (e) => {
    const formatted = capitalizeFirstLetter(e.target.value);
    setForm((prev) => ({ ...prev, first_name: formatted }));
  };

  const handleLastNameChange = (e) => {
    const formatted = capitalizeFirstLetter(e.target.value);
    setForm((prev) => ({ ...prev, last_name: formatted }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('Введите имя и фамилию');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await createRecoveryRequest({
        first_name: form.first_name,
        last_name: form.last_name,
      });
      setSuccess(res.data);
      showToast('Заявка создана. Сохрани код и ссылку.', { tone: 'success' });
    } catch (err) {
      if (err.response?.data?.tracking_link) {
        setSuccess({
          code: err.response.data.code,
          tracking_link: err.response.data.tracking_link,
          message: err.response.data.error,
        });
      } else {
        setError(getApiErrorMessage(err, 'Ошибка создания заявки'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    const trackingUrl = success.code ? `${window.location.origin}/recovery/status/${success.code}` : success.tracking_link;
    return (
      <PreAuthLayout
        badge="Support request"
        title="Заявка создана — теперь важно сохранить код и tracking link."
        subtitle="Это запасной recovery-сценарий на случай, когда нет ни второго фактора, ни резервных кодов."
        heroTitle="Manual review для тяжёлого случая"
        heroText="Support будет смотреть заявку вручную, поэтому код и ссылка нужны, чтобы вернуться позже и проверить решение без потери контекста."
        stats={[{ value: success.code || 'pending', label: 'code' }, { value: 'manual', label: 'review' }, { value: 'link', label: 'tracking' }]}
        pills={['support', 'tracking link', 'manual review']}
        panelEyebrow="Заявка готова"
        panelTitle={success.message || 'Заявка отправлена на рассмотрение'}
        panelSubtitle="Сохрани ссылку в заметках или отправь её себе в безопасное место."
        footer={<div className="auth-footer"><Link to="/login">← Вернуться ко входу</Link></div>}
      >
        <div className={`auth-preauth-status-card ${success.message ? 'tone-info' : 'tone-success'}`}>
          <div className="auth-preauth-status-icon">✅</div>
          <div className="auth-preauth-status-main">
            <div className="auth-preauth-status-title">{success.code ? `Код заявки: ${success.code}` : 'Tracking link готов'}</div>
            <div className="auth-preauth-status-text">Дальше эта ссылка станет главным способом проверить статус заявки без входа в аккаунт.</div>
          </div>
        </div>

        <div className="auth-preauth-copy-card glass-panel-lite">
          <div className="auth-preauth-copy-head">
            <div>
              <div className="auth-preauth-copy-title">Ссылка для отслеживания</div>
              <div className="auth-preauth-copy-subtitle">Для beta-версии ссылка остаётся внутри сайта и не уходит на сторонние QR-сервисы.</div>
            </div>
            <button type="button" className="btn btn-secondary" onClick={async () => {
              try {
                await navigator.clipboard.writeText(trackingUrl);
                showToast('Ссылка скопирована.', { tone: 'success' });
              } catch {
                setError('Не удалось скопировать ссылку автоматически');
              }
            }}>Копировать</button>
          </div>
          <div className="auth-preauth-copy-value">{trackingUrl}</div>
        </div>

        {error ? <div className="error">{error}</div> : null}
      </PreAuthLayout>
    );
  }

  return (
    <PreAuthLayout
      badge="Нет recovery-кодов"
      title="Создай support-заявку, если backup codes тоже потеряны."
      subtitle="Это более длинный сценарий, но он уже переведён в новый визуальный слой и ведёт к тому же recovery-контуру."
      heroTitle="Запасной путь восстановления"
      heroText="Укажи имя и фамилию так же, как при регистрации. После создания заявки система выдаст код и tracking link для ручной проверки."
      stats={[{ value: 'manual', label: 'review' }, { value: 'name', label: 'lookup' }, { value: 'link', label: 'tracking' }]}
      pills={['support request', 'manual review', 'tracking code']}
      panelEyebrow="Recovery support"
      panelTitle="Потеряны коды восстановления"
      panelSubtitle="Имя и фамилия помогут support точно найти твой аккаунт и связать заявку с профилем."
      footer={<div className="auth-footer">Вспомнил коды? <Link to="/recovery">Вернуться к другим способам</Link></div>}
    >
      {error ? <div className="error">{error}</div> : null}
      <form onSubmit={handleSubmit} className="register-form">
        <div className="form-row auth-preauth-form-row">
          <div className="form-group">
            <label>Имя</label>
            <div className="input-wrapper">
              <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <input type="text" value={form.first_name} onChange={handleFirstNameChange} placeholder="Имя" required />
            </div>
          </div>
          <div className="form-group">
            <label>Фамилия</label>
            <div className="input-wrapper">
              <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <input type="text" value={form.last_name} onChange={handleLastNameChange} placeholder="Фамилия" required />
            </div>
          </div>
        </div>
        <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
          {loading ? <span className="btn-loader"></span> : 'Отправить заявку'}
        </button>
      </form>
    </PreAuthLayout>
  );
}

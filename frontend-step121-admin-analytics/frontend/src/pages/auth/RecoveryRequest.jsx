import { useState } from 'react';
import { Link } from 'react-router-dom';
import PreAuthLayout from '../../components/auth/PreAuthLayout';
import { createRecoveryRequest, getApiErrorMessage, showToast } from '../../services/api';

export default function RecoveryRequest() {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null);

  const capitalizeFirstLetter = (str) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  };

  const handleFirstNameChange = (e) => {
    const value = e.target.value;
    const formatted = value ? capitalizeFirstLetter(value) : '';
    setForm((prev) => ({ ...prev, first_name: formatted }));
  };

  const handleLastNameChange = (e) => {
    const value = e.target.value;
    const formatted = value ? capitalizeFirstLetter(value) : '';
    setForm((prev) => ({ ...prev, last_name: formatted }));
  };

  const handleCopyTracking = async (trackingUrl) => {
    try {
      await navigator.clipboard.writeText(trackingUrl);
      showToast('Ссылка на статус скопирована.', { tone: 'success' });
    } catch (_) {
      setError('Не удалось скопировать ссылку автоматически');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');

    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('Введите имя и фамилию');
      setLoading(false);
      return;
    }

    try {
      const res = await createRecoveryRequest({
        first_name: form.first_name,
        last_name: form.last_name,
      });
      setSuccess(res.data);
      showToast('Заявка создана. Сохрани ссылку на статус.', { tone: 'success' });
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
        badge="Recovery request"
        title="Заявка уже создана — сохрани tracking link."
        subtitle="Дальше этот код и ссылка становятся твоей точкой входа в процесс восстановления."
        heroTitle="Поддержка возьмёт заявку в работу"
        heroText="Открой status page позже с любого устройства: она нужна, чтобы видеть решение и отвечать на вопросы, если они появятся."
        stats={[
          { value: success.code || 'ready', label: 'код' },
          { value: '1', label: 'ссылка' },
          { value: success.message ? 'existing' : 'new', label: 'заявка' },
        ]}
        pills={['status link', 'manual review', 'beta ready']}
        panelEyebrow="Готово"
        panelTitle="Заявка на восстановление"
        panelSubtitle="Скопируй ссылку и сохрани код — они нужны до завершения процесса."
        footer={<div className="auth-footer"><Link to="/login">← Вернуться ко входу</Link></div>}
      >
        {error && <div className="error">{error}</div>}

        <div className="success auth-preauth-success-block">
          ✅ {success.message || 'Заявка отправлена на рассмотрение'}
        </div>

        <div className="auth-preauth-code-box">
          <div className="auth-preauth-code-label">Код заявки</div>
          <div className="auth-preauth-code-value">{success.code || '—'}</div>
        </div>

        <div className="auth-preauth-copy-card glass-panel-lite">
          <div className="auth-preauth-copy-head">
            <div>
              <div className="auth-preauth-copy-title">Tracking link</div>
              <div className="auth-preauth-copy-subtitle">Открывает страницу статуса и ответов поддержки</div>
            </div>
            <button type="button" onClick={() => handleCopyTracking(trackingUrl)} className="btn btn-secondary">
              Копировать
            </button>
          </div>
          <div className="auth-preauth-copy-value">{trackingUrl}</div>
        </div>
      </PreAuthLayout>
    );
  }

  return (
    <PreAuthLayout
      badge="Запрос в поддержку"
      title="Создай recovery request в новом интерфейсе."
      subtitle="Отдельный экран для заявки нужен, когда ты хочешь сразу перейти в support flow без выбора метода."
      heroTitle="Имя и фамилия должны совпадать с регистрацией"
      heroText="После отправки система выдаст код заявки и tracking link. Без них потом неудобно двигаться дальше, поэтому экран сразу заточен под сохранение этих данных."
      stats={[
        { value: 'name', label: 'identity' },
        { value: 'link', label: 'tracking' },
        { value: 'manual', label: 'review' },
      ]}
      pills={['support request', 'status page', 'copy link']}
      panelEyebrow="Support flow"
      panelTitle="Создать заявку"
      panelSubtitle="Заполни имя и фамилию, которые использовал при регистрации аккаунта."
      footer={<div className="auth-footer">Хочешь сначала выбрать способ? <Link to="/recovery">Открыть восстановление</Link></div>}
    >
      {error && <div className="error">{error}</div>}

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

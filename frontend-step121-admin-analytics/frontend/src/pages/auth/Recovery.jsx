import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import PreAuthLayout from '../../components/auth/PreAuthLayout';
import { createRecoveryRequest, getApiErrorMessage, recoveryRequest, showToast } from '../../services/api';
import { setTempToken } from '../../services/authStorage';

export default function Recovery() {
  const [step, setStep] = useState('method');
  const [form, setForm] = useState({ first_name: '', last_name: '' });
  const [backupCode, setBackupCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null);
  const navigate = useNavigate();

  const trackingUrl = useMemo(() => {
    if (!success) return '';
    return success.code ? `${window.location.origin}/recovery/status/${success.code}` : success.tracking_link || '';
  }, [success]);

  const capitalizeFirstLetter = (str) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  };

  const updateFirstName = (value) => {
    setForm((prev) => ({ ...prev, first_name: capitalizeFirstLetter(value) }));
  };

  const updateLastName = (value) => {
    setForm((prev) => ({ ...prev, last_name: capitalizeFirstLetter(value) }));
  };

  const handleCopyTracking = async () => {
    if (!trackingUrl) return;
    try {
      await navigator.clipboard.writeText(trackingUrl);
      showToast('Ссылка на статус скопирована.', { tone: 'success' });
    } catch (_) {
      setError('Не удалось скопировать ссылку автоматически');
    }
  };

  const handleBackupCodeSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('Введите имя и фамилию');
      setLoading(false);
      return;
    }

    if (!backupCode.trim()) {
      setError('Введите резервный код');
      setLoading(false);
      return;
    }

    try {
      const username = `${form.first_name.toLowerCase()}.${form.last_name.toLowerCase()}`;
      const res = await recoveryRequest({
        username,
        type: 'code',
        code: backupCode.trim(),
      });

      if (res.data.temp_token) {
        setTempToken(res.data.temp_token);
        showToast('Доступ подтверждён. Задайте новый пароль.', { tone: 'success' });
        navigate('/reset-password');
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Неверный резервный код'));
    } finally {
      setLoading(false);
    }
  };

  const handleSupportSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

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

  const resetMethodState = () => {
    setStep('method');
    setError('');
    setForm({ first_name: '', last_name: '' });
    setBackupCode('');
  };

  const renderIdentityFields = () => (
    <div className="form-row auth-preauth-form-row">
      <div className="form-group">
        <label>Имя</label>
        <div className="input-wrapper">
          <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <input type="text" value={form.first_name} onChange={(e) => updateFirstName(e.target.value)} placeholder="Имя" required />
        </div>
      </div>
      <div className="form-group">
        <label>Фамилия</label>
        <div className="input-wrapper">
          <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <input type="text" value={form.last_name} onChange={(e) => updateLastName(e.target.value)} placeholder="Фамилия" required />
        </div>
      </div>
    </div>
  );

  if (success) {
    return (
      <PreAuthLayout
        badge="Восстановление доступа"
        title="Статус восстановления уже можно отслеживать."
        subtitle="Ссылка на заявку должна пережить закрытие вкладки и открываться с любого устройства."
        heroTitle="Заявка создана"
        heroText="Сохрани код и ссылку. Дальше можно спокойно ждать решения и возвращаться к статусу по мере надобности."
        stats={[
          { value: success.code || 'ready', label: 'код' },
          { value: trackingUrl ? '1' : '0', label: 'ссылка' },
          { value: success.message ? 'review' : 'sent', label: 'статус' },
        ]}
        pills={['tracking link', 'status page', 'support flow']}
        panelEyebrow="Готово"
        panelTitle="Заявка зафиксирована"
        panelSubtitle="Сохрани код и ссылку — по ним можно открыть страницу статуса позже."
        footer={<div className="auth-footer">Нужен вход? <Link to="/login">Вернуться ко входу</Link></div>}
      >
        {error && <div className="error">{error}</div>}

        <div className="success auth-preauth-success-block">
          ✅ {success.message || 'Заявка отправлена в поддержку'}
        </div>

        <div className="auth-preauth-code-box">
          <div className="auth-preauth-code-label">Код заявки</div>
          <div className="auth-preauth-code-value">{success.code || '—'}</div>
        </div>

        {trackingUrl && (
          <div className="auth-preauth-copy-card glass-panel-lite">
            <div className="auth-preauth-copy-head">
              <div>
                <div className="auth-preauth-copy-title">Ссылка на статус</div>
                <div className="auth-preauth-copy-subtitle">Откроет страницу проверки восстановления</div>
              </div>
              <button type="button" className="btn btn-secondary" onClick={handleCopyTracking}>
                Копировать
              </button>
            </div>
            <div className="auth-preauth-copy-value">{trackingUrl}</div>
          </div>
        )}
      </PreAuthLayout>
    );
  }

  if (step === 'code') {
    return (
      <PreAuthLayout
        badge="Восстановление по резервному коду"
        title="Подтверди владение аккаунтом через backup code."
        subtitle="Это быстрый сценарий, если код сохранился, а доступ к аккаунту потерян."
        heroTitle="Один код — и можно задать новый пароль"
        heroText="Имя и фамилия используются для сборки адреса входа, а резервный код подтверждает, что это действительно твой аккаунт."
        stats={[
          { value: '2', label: 'поля' },
          { value: 'temp', label: 'token' },
          { value: 'fast', label: 'flow' },
        ]}
        pills={['backup code', 'temp token', 'reset password']}
        panelEyebrow="Шаг 1"
        panelTitle="Резервный код"
        panelSubtitle="После подтверждения система сразу откроет экран смены пароля."
        footer={<div className="auth-footer"><button onClick={resetMethodState} className="link-btn" type="button">← Выбрать другой способ</button></div>}
      >
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleBackupCodeSubmit} className="register-form">
          {renderIdentityFields()}

          <div className="form-group">
            <label>Резервный код</label>
            <div className="input-wrapper">
              <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input type="text" value={backupCode} onChange={(e) => setBackupCode(e.target.value)} placeholder="XXXX-XXXX" required />
            </div>
            <div className="hint">
              <span>Код нужен ровно для одного входа</span>
              <span>После входа задай новый пароль и заново настрой защиту</span>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
            {loading ? <span className="btn-loader"></span> : 'Подтвердить код'}
          </button>
        </form>
      </PreAuthLayout>
    );
  }

  if (step === 'support') {
    return (
      <PreAuthLayout
        badge="Заявка в поддержку"
        title="Создай заявку, если backup codes тоже потеряны."
        subtitle="Этот путь нужен для более тяжёлого случая, когда быстрый recovery-код недоступен."
        heroTitle="Сохрани ссылку и вернись позже"
        heroText="После создания заявки система даст код и tracking link. Их нужно обязательно сохранить, потому что дальше они заменят обычный вход до завершения восстановления."
        stats={[
          { value: 'manual', label: 'review' },
          { value: '1', label: 'request' },
          { value: 'link', label: 'tracking' },
        ]}
        pills={['support', 'tracking link', 'manual review']}
        panelEyebrow="Шаг 2"
        panelTitle="Создать заявку"
        panelSubtitle="Укажи имя и фамилию так же, как при регистрации, чтобы support смог найти аккаунт."
        footer={<div className="auth-footer"><button onClick={resetMethodState} className="link-btn" type="button">← Выбрать другой способ</button></div>}
      >
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleSupportSubmit} className="register-form">
          {renderIdentityFields()}
          <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
            {loading ? <span className="btn-loader"></span> : 'Отправить заявку'}
          </button>
        </form>
      </PreAuthLayout>
    );
  }

  return (
    <PreAuthLayout
      badge="Восстановление доступа"
      title="Выбери путь, который быстрее вернёт тебя в аккаунт."
      subtitle="Сначала пробуем резервный код. Если его тоже нет, создаём tracking-заявку и двигаемся через support flow."
      heroTitle="Recovery уже живёт в новом визуальном слое"
      heroText="Этот экран должен не пугать, а быстро объяснять, какой путь выбрать: быстрый по коду или длинный через support с отслеживанием статуса."
      stats={[
        { value: '2', label: 'пути' },
        { value: 'code', label: 'быстро' },
        { value: 'support', label: 'заявка' },
      ]}
      pills={['backup code', 'support request', 'status tracking']}
      panelEyebrow="Выбор сценария"
      panelTitle="Как восстановить доступ"
      panelSubtitle="Если код под рукой — это самый быстрый путь. Если нет — создавай заявку и сохраняй tracking link."
      footer={<div className="auth-footer">Вспомнил пароль? <Link to="/login">Вернуться ко входу</Link></div>}
    >
      {error && <div className="error">{error}</div>}

      <div className="auth-preauth-method-grid">
        <button type="button" className="auth-preauth-method-card" onClick={() => setStep('code')}>
          <div className="auth-preauth-method-icon">🔐</div>
          <div className="auth-preauth-method-title">Резервный код</div>
          <div className="auth-preauth-method-text">Подтверди аккаунт backup code и сразу переходи к смене пароля.</div>
          <div className="auth-preauth-method-meta">Самый быстрый вариант</div>
        </button>

        <button type="button" className="auth-preauth-method-card auth-preauth-method-card-accent" onClick={() => setStep('support')}>
          <div className="auth-preauth-method-icon">🧭</div>
          <div className="auth-preauth-method-title">Заявка в поддержку</div>
          <div className="auth-preauth-method-text">Если backup codes потеряны, создай заявку и отслеживай её по коду и ссылке.</div>
          <div className="auth-preauth-method-meta">Подходит для сложного случая</div>
        </button>
      </div>
    </PreAuthLayout>
  );
}

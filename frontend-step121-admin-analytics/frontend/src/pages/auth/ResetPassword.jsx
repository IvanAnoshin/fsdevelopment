import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import PreAuthLayout from '../../components/auth/PreAuthLayout';
import { resetPassword, getApiErrorMessage, showToast } from '../../services/api';
import { clearTempToken, getTempToken } from '../../services/authStorage';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const tempToken = getTempToken();
    if (!tempToken) {
      navigate('/login');
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    if (password.length < 8) {
      setError('Пароль должен быть не менее 8 символов');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      setLoading(false);
      return;
    }

    try {
      await resetPassword({ password });
      setSuccess(true);
      clearTempToken();
      showToast('Пароль обновлён. Войдите заново.', { tone: 'success' });
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Ошибка смены пароля'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <PreAuthLayout
        badge="Новый пароль сохранён"
        title="Доступ восстановлен — можно возвращаться ко входу."
        subtitle="Старые access-токены уже недействительны, поэтому дальше нужен обычный вход с новым паролем."
        heroTitle="Смена пароля завершена"
        heroText="Экран успеха должен быть простым и спокойным: задача выполнена, осталось только снова войти в аккаунт."
        stats={[
          { value: 'done', label: 'reset' },
          { value: 'login', label: 'next' },
          { value: '2s', label: 'redirect' },
        ]}
        pills={['success', 'token invalidation', 'login next']}
        panelEyebrow="Готово"
        panelTitle="Пароль изменён"
        panelSubtitle="Через пару секунд откроется экран входа. Можно перейти туда и вручную."
        footer={<div className="auth-footer"><Link to="/login">Перейти ко входу</Link></div>}
      >
        <div className="success auth-preauth-success-block">
          ✅ Пароль успешно изменён. Войдите с новым паролем.
        </div>
      </PreAuthLayout>
    );
  }

  return (
    <PreAuthLayout
      badge="Смена пароля"
      title="Задай новый пароль после подтверждения восстановления."
      subtitle="Этот экран открывается только с временным recovery-токеном, поэтому здесь можно безопасно завершить возврат доступа."
      heroTitle="Новый пароль завершает recovery flow"
      heroText="Сразу после сохранения все старые сессии должны считаться устаревшими, а дальше человек возвращается на обычный экран входа."
      stats={[
        { value: '8+', label: 'символов' },
        { value: 'temp', label: 'auth' },
        { value: 'login', label: 'after' },
      ]}
      pills={['reset password', 'temp token', 'new login']}
      panelEyebrow="Последний шаг"
      panelTitle="Новый пароль"
      panelSubtitle="Используй пароль, который не пересекается со старым и содержит хотя бы 8 символов."
      footer={<div className="auth-footer"><Link to="/login">← Вернуться ко входу</Link></div>}
    >
      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit} className="register-form">
        <div className="form-group">
          <label>Новый пароль</label>
          <div className="input-wrapper">
            <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Придумайте новый пароль"
              required
            />
          </div>
          <div className="hint">
            <span>Минимум 8 символов</span>
            <span>После смены пароля старые сессии становятся недействительными</span>
          </div>
        </div>

        <div className="form-group">
          <label>Подтвердите пароль</label>
          <div className="input-wrapper">
            <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Повторите новый пароль"
              required
            />
          </div>
          {confirmPassword && password !== confirmPassword && (
            <div className="hint error-hint">Пароли не совпадают</div>
          )}
          {confirmPassword && password === confirmPassword && password && (
            <div className="hint success-hint">Пароли совпадают</div>
          )}
        </div>

        <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
          {loading ? <span className="btn-loader"></span> : 'Сменить пароль'}
        </button>
      </form>
    </PreAuthLayout>
  );
}

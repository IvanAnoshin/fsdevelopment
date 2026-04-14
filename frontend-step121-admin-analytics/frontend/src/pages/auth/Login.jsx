import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import PreAuthLayout from '../../components/auth/PreAuthLayout';
import { clearPostLoginRedirect, getApiErrorMessage, login, loginWithBackupCode, readPostLoginRedirect, updateBehavioralData, verifySecurityAnswer } from '../../services/api';
import {
  clearTempToken,
  getSavedAccounts,
  getToken,
  removeSavedAccount,
  setBehaviorAuthOutcome,
  setStoredUser,
  setToken,
  switchToSavedAccount,
} from '../../services/authStorage';

export default function Login() {
  const [step, setStep] = useState('credentials');
  const [form, setForm] = useState({ first_name: '', last_name: '', password: '' });
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState(() => getSavedAccounts());
  const navigate = useNavigate();
  const location = useLocation();

  const capitalizeFirstLetter = (str) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  };

  const buildUsername = () => `${form.first_name.trim().toLowerCase()}.${form.last_name.trim().toLowerCase()}`;

  const persistSession = (data, outcome = 'authenticated_session') => {
    setToken(data.token);
    setStoredUser(data.user);
    setBehaviorAuthOutcome(outcome);
  };

  const refreshSavedAccounts = () => {
    setSavedAccounts(getSavedAccounts());
  };

  const handleSwitchSavedAccount = (accountKey) => {
    const switched = switchToSavedAccount(accountKey);
    if (!switched) {
      setError('Быстрое переключение отключено ради защиты сессии. Войдите в аккаунт заново.');
      refreshSavedAccounts();
      return;
    }
    navigate(resolvePostLoginTarget(), { replace: true });
  };

  const handleRemoveSavedAccount = (accountKey) => {
    removeSavedAccount(accountKey);
    refreshSavedAccounts();
  };

  const resolvePostLoginTarget = () => {
    const next = location.state?.from;
    if (typeof next === 'string' && next.startsWith('/')) {
      clearPostLoginRedirect();
      return next;
    }
    const stored = readPostLoginRedirect();
    if (stored) {
      clearPostLoginRedirect();
      return stored;
    }
    return '/feed';
  };

  const handleFirstNameChange = (e) => {
    const value = e.target.value;
    const formatted = value ? capitalizeFirstLetter(value) : '';
    setForm({ ...form, first_name: formatted });
  };

  const handleLastNameChange = (e) => {
    const value = e.target.value;
    const formatted = value ? capitalizeFirstLetter(value) : '';
    setForm({ ...form, last_name: formatted });
  };

  const handleCredentialsSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('Введите имя и фамилию');
      setLoading(false);
      return;
    }

    try {
      const username = buildUsername();
      const res = await login({ username, password: form.password });

      if (res.data.requires_2fa) {
        setBehaviorAuthOutcome('login_requires_security');
        setSecurityQuestion(res.data.security_question);
        setSecurityAnswer('');
        setBackupCode('');
        clearTempToken();
        setStep('security');
      } else if (res.data.token) {
        clearTempToken();
        persistSession(res.data, 'login_success_password_only');
        navigate(resolvePostLoginTarget(), { replace: true });
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Ошибка входа'));
    } finally {
      setLoading(false);
    }
  };

  const handleSecuritySubmit = async (e) => {
    e.preventDefault();
    if (!securityAnswer.trim()) {
      setError('Введите ответ на секретный вопрос');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await verifySecurityAnswer({
        username: buildUsername(),
        answer: securityAnswer.trim(),
      });

      clearTempToken();
      persistSession(res.data, 'login_success_security_answer');
      navigate(resolvePostLoginTarget(), { replace: true });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Неверный ответ'));
      setSecurityAnswer('');
    } finally {
      setLoading(false);
    }
  };

  const handleBackupCodeSubmit = async (e) => {
    e.preventDefault();
    if (!backupCode.trim()) {
      setError('Введите резервный код');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await loginWithBackupCode({
        username: buildUsername(),
        backup_code: backupCode.trim(),
      });
      clearTempToken();
      persistSession(res.data, 'login_success_backup_code');
      navigate('/setup-security', {
        state: {
          fromBackupCode: true,
          message: res.data?.message || 'Вход выполнен по резервному коду. Настройте новый секретный вопрос.',
        },
      });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Не удалось войти по резервному коду'));
      setBackupCode('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSavedAccounts(getSavedAccounts());
    const handleAuthChanged = () => setSavedAccounts(getSavedAccounts());
    window.addEventListener('app:auth-changed', handleAuthChanged);
    return () => window.removeEventListener('app:auth-changed', handleAuthChanged);
  }, []);

  useEffect(() => {
    let keyTimes = [];
    let lastKeyTime = null;
    let mouseMovements = [];
    let lastMousePos = null;
    let lastMouseTime = null;

    const handleKeyDown = () => {
      const now = Date.now();
      if (lastKeyTime) {
        const delay = now - lastKeyTime;
        if (delay < 1000) {
          keyTimes.push(delay);
        }
      }
      lastKeyTime = now;
    };

    const handleMouseMove = (e) => {
      const now = Date.now();
      if (lastMousePos && lastMouseTime) {
        const dx = e.clientX - lastMousePos.x;
        const dy = e.clientY - lastMousePos.y;
        const dt = now - lastMouseTime;
        if (dt > 0) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          const speed = (distance / dt) * 1000;
          mouseMovements.push(speed);
        }
      }
      lastMousePos = { x: e.clientX, y: e.clientY };
      lastMouseTime = now;
    };

    const interval = setInterval(() => {
      if (keyTimes.length > 0 || mouseMovements.length > 0) {
        const avgKeyDelay = keyTimes.length > 0
          ? keyTimes.reduce((a, b) => a + b, 0) / keyTimes.length
          : 0;
        const typingSpeed = avgKeyDelay > 0 ? 60000 / avgKeyDelay : 0;
        const typingVariance = keyTimes.length > 0
          ? keyTimes.reduce((a, b) => a + Math.pow(b - avgKeyDelay, 2), 0) / keyTimes.length
          : 0;

        const avgMouseSpeed = mouseMovements.length > 0
          ? mouseMovements.reduce((a, b) => a + b, 0) / mouseMovements.length
          : 0;

        const token = getToken();
        if (token) {
          updateBehavioralData({
            typing_speed: typingSpeed,
            typing_variance: typingVariance,
            mouse_speed: avgMouseSpeed,
            mouse_accuracy: 0.85,
            scroll_depth: 0,
            session_time: 30,
          }).catch(console.error);
        }

        keyTimes = [];
        mouseMovements = [];
      }
    }, 30000);

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      clearInterval(interval);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  const stepContent = {
    credentials: {
      badge: 'Вход в аккаунт',
      title: 'Вернись в ленту, чаты и свой профиль.',
      subtitle: 'Имя и фамилия используются как адрес входа. После авторизации ты вернёшься туда, где остановился.',
      heroTitle: 'Одна точка входа для всего приложения',
      heroText: 'Лента, люди, сообщения и уведомления уже собраны в новом интерфейсе. Здесь осталось только красиво и надёжно войти.',
      stats: [
        { value: 'Feed', label: 'лента' },
        { value: 'Chat', label: 'сообщения' },
        { value: 'Secure', label: 'защита' },
      ],
      pills: ['mobile-first', '2FA', 'backup code'],
      panelEyebrow: 'Авторизация',
      panelTitle: 'Войти в аккаунт',
      panelSubtitle: 'Используй имя, фамилию и пароль, чтобы продолжить работу в аккаунте.',
    },
    security: {
      badge: 'Проверка входа',
      title: 'Подтверди, что это действительно ты.',
      subtitle: 'Мы запрашиваем секретный ответ только после правильного логина. Это второй шаг входа, а не отдельная регистрация.',
      heroTitle: 'Дополнительный слой защиты',
      heroText: 'Если пароль уже введён правильно, система попросит подтвердить вход ответом на секретный вопрос.',
      stats: [
        { value: '2/2', label: 'шаг входа' },
        { value: '1', label: 'секретный ответ' },
        { value: 'Alt', label: 'backup' },
      ],
      pills: ['secret question', 'session check', 'safe login'],
      panelEyebrow: 'Шаг 2',
      panelTitle: 'Подтверждение личности',
      panelSubtitle: 'Ответь на секретный вопрос, чтобы завершить вход в аккаунт.',
    },
    backup: {
      badge: 'Резервный доступ',
      title: 'Если нет ответа под рукой, используй backup code.',
      subtitle: 'После такого входа система сразу отправит тебя на настройку нового секретного вопроса.',
      heroTitle: 'План Б без паники',
      heroText: 'Один резервный код заменяет второй фактор ровно на один вход. Дальше доступ нужно снова защитить.',
      stats: [
        { value: '1x', label: 'одноразовый' },
        { value: 'Safe', label: 'замена 2FA' },
        { value: 'Next', label: 'setup security' },
      ],
      pills: ['backup code', 'recovery-safe', 'single use'],
      panelEyebrow: 'Резервный вход',
      panelTitle: 'Войти по резервному коду',
      panelSubtitle: 'Используй сохранённый backup code и затем настрой новый секретный вопрос.',
    },
  }[step];

  return (
    <PreAuthLayout
      badge={stepContent.badge}
      title="Friendscape"
      subtitle={stepContent.title}
      heroTitle={stepContent.heroTitle}
      heroText={stepContent.heroText}
      stats={stepContent.stats}
      pills={stepContent.pills}
      panelEyebrow={stepContent.panelEyebrow}
      panelTitle={stepContent.panelTitle}
      panelSubtitle={stepContent.panelSubtitle}
      footer={step === 'credentials' ? (
        <>
          <div className="auth-footer">
            Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
          </div>
          <div className="auth-footer">
            <Link to="/recovery">Забыли пароль?</Link>
          </div>
        </>
      ) : null}
    >
      {error && <div className="error">{error}</div>}

      {step === 'credentials' && savedAccounts.length > 0 && (
        <div className="auth-saved-accounts">
          <div className="auth-saved-accounts-head">
            <div className="auth-saved-accounts-title">Аккаунты на этом устройстве</div>
            <div className="auth-saved-accounts-text">Можно быстро переключаться между сохранёнными профилями без повторного ввода имени и фамилии.</div>
          </div>
          <div className="auth-saved-accounts-list">
            {savedAccounts.map((account) => (
              <div key={account.key} className="auth-saved-account-item">
                <button
                  type="button"
                  className="auth-saved-account-main"
                  onClick={() => handleSwitchSavedAccount(account.key)}
                >
                  <div className="auth-saved-account-avatar">{String(account.label || 'A').trim().charAt(0).toUpperCase() || 'A'}</div>
                  <div className="auth-saved-account-meta">
                    <div className="auth-saved-account-name">{account.label}</div>
                    <div className="auth-saved-account-sub">{account.subtitle || 'Сохранённый аккаунт'}</div>
                  </div>
                  {account.isActive && <span className="auth-saved-account-badge">Активен</span>}
                </button>
                <button
                  type="button"
                  className="auth-saved-account-remove"
                  onClick={() => handleRemoveSavedAccount(account.key)}
                  aria-label={`Убрать аккаунт ${account.label} с устройства`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'credentials' && (
        <form onSubmit={handleCredentialsSubmit} className="register-form">
          <div className="form-row">
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

          <div className="form-group">
            <label>Пароль</label>
            <div className="input-wrapper">
              <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Введите пароль"
                required
              />
            </div>
            <div className="hint">
              <span>Имя и фамилия превращаются в адрес входа</span>
              <span>{form.first_name || form.last_name ? `Логин: ${buildUsername()}` : 'Пример логина: ivan.ivanov'}</span>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
            {loading ? <span className="btn-loader"></span> : 'Войти'}
          </button>
        </form>
      )}

      {step === 'security' && (
        <>
          <div className="security-info auth-preauth-security-box">
            <div className="info-icon">🔐</div>
            <div className="info-content">
              <div className="info-title">Секретный вопрос</div>
              <div className="info-question">{securityQuestion || 'Мой секрет, который я не выдам никому'}</div>
            </div>
          </div>

          <form onSubmit={handleSecuritySubmit} className="register-form">
            <div className="form-group">
              <label>Ваш секретный ответ</label>
              <div className="input-wrapper">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                  <circle cx="12" cy="9" r="3"/>
                </svg>
                <input
                  type="text"
                  value={securityAnswer}
                  onChange={(e) => setSecurityAnswer(e.target.value)}
                  placeholder="Введите секретный ответ"
                  autoFocus
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
              {loading ? <span className="btn-loader"></span> : 'Подтвердить вход'}
            </button>
          </form>

          <div className="auth-footer auth-footer-spaced">
            Нет доступа к ответу?{' '}
            <button type="button" className="link-btn" onClick={() => { setError(''); setStep('backup'); }}>
              Войти по резервному коду
            </button>
          </div>
        </>
      )}

      {step === 'backup' && (
        <>
          <div className="security-info auth-preauth-security-box">
            <div className="info-icon">🗝️</div>
            <div className="info-content">
              <div className="info-title">Резервный код</div>
              <div className="info-question auth-preauth-small-copy">
                Используй один из сохранённых backup codes. После входа система попросит заново настроить секретный вопрос.
              </div>
            </div>
          </div>

          <form onSubmit={handleBackupCodeSubmit} className="register-form">
            <div className="form-group">
              <label>Резервный код</label>
              <div className="input-wrapper">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M14 7h.01"/>
                  <path d="M7 14h.01"/>
                  <path d="M10 11h.01"/>
                  <path d="M14 11h.01"/>
                  <path d="M18 11h.01"/>
                  <path d="M10 7h.01"/>
                  <path d="M6 18 18 6"/>
                </svg>
                <input
                  type="text"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                  placeholder="XXXX-XXXX"
                  autoFocus
                  required
                />
              </div>
              <div className="hint">
                <span>Код используется для одного входа</span>
                <span>После входа нужно обновить защиту</span>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
              {loading ? <span className="btn-loader"></span> : 'Войти по коду'}
            </button>
          </form>

          <div className="auth-footer auth-footer-spaced">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setError('');
                setBackupCode('');
                setStep('security');
              }}
            >
              ← Вернуться к секретному вопросу
            </button>
          </div>
        </>
      )}
    </PreAuthLayout>
  );
}

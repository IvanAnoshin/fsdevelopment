import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import PreAuthLayout from '../../components/auth/PreAuthLayout';
import { register, getApiErrorMessage, showToast } from '../../services/api';
import { clearTempToken, setBehaviorAuthOutcome, setStoredUser, setToken } from '../../services/authStorage';

export default function Register() {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    password: '',
    confirm_password: ''
  });
  const [passwordStrength, setPasswordStrength] = useState({
    score: 0,
    message: '',
    color: '#ef4444'
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const capitalizeFirstLetter = (str) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  };

  const checkPasswordStrength = (password) => {
    let score = 0;
    let message = '';
    let color = '#ef4444';

    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 1) {
      message = 'Слишком простой';
      color = '#ef4444';
    } else if (score === 2) {
      message = 'Слабый';
      color = '#f59e0b';
    } else if (score === 3) {
      message = 'Средний';
      color = '#fbbf24';
    } else if (score === 4) {
      message = 'Хороший';
      color = '#22c55e';
    } else {
      message = 'Отличный';
      color = '#10b981';
    }

    return { score, message, color };
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

  const handlePasswordChange = (e) => {
    const password = e.target.value;
    setForm({ ...form, password });
    setPasswordStrength(checkPasswordStrength(password));
  };

  const handleConfirmPasswordChange = (e) => {
    setForm({ ...form, confirm_password: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    if (!form.first_name.trim()) {
      setError('Введите имя');
      return;
    }
    if (!form.last_name.trim()) {
      setError('Введите фамилию');
      return;
    }
    if (form.password.length < 8) {
      setError('Пароль должен быть не менее 8 символов');
      return;
    }
    if (passwordStrength.score < 2) {
      setError('Пароль слишком простой. Используйте буквы разного регистра, цифры или спецсимволы');
      return;
    }
    if (form.password !== form.confirm_password) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);

    try {
      const response = await register({
        username: `${form.first_name.trim().toLowerCase()}.${form.last_name.trim().toLowerCase()}`,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        password: form.password
      });

      setToken(response.data.token);
      setStoredUser(response.data.user);
      setBehaviorAuthOutcome('register_success');
      clearTempToken();
      showToast('Аккаунт создан. Настройте защиту аккаунта.', { tone: 'success' });
      navigate('/setup-security');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Ошибка регистрации'));
    } finally {
      setLoading(false);
    }
  };

  const strengthWidth = (passwordStrength.score / 5) * 100;

  return (
    <PreAuthLayout
      badge="Создание аккаунта"
      title="Friendscape"
      subtitle="Собери новый аккаунт в том же стиле, в котором уже живёт post-auth часть приложения."
      heroTitle="Регистрация без старого тёмного экрана"
      heroText="Создай аккаунт, сразу настрой защиту и переходи в новый интерфейс: лента, профиль, люди, сообщения и уведомления уже готовы к использованию."
      stats={[
        { value: '1', label: 'аккаунт' },
        { value: '2', label: 'шаг: защита' },
        { value: 'Ready', label: 'post-auth' },
      ]}
      pills={['new UI', 'password check', 'setup security']}
      panelEyebrow="Регистрация"
      panelTitle="Создать аккаунт"
      panelSubtitle="После регистрации система сразу предложит настроить секретный вопрос и резервные коды."
      footer={<div className="auth-footer">Уже есть аккаунт? <Link to="/login">Войти</Link></div>}
    >
      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit} className="register-form">
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
              onChange={handlePasswordChange}
              placeholder="Придумайте пароль"
              required
            />
          </div>

          {form.password && (
            <div className="password-strength">
              <div className="strength-bar">
                <div className="strength-fill" style={{ width: `${strengthWidth}%`, background: passwordStrength.color }}></div>
              </div>
              <div className="strength-text" style={{ color: passwordStrength.color }}>
                {passwordStrength.message}
              </div>
            </div>
          )}
          <div className="hint">
            <span>Минимум 8 символов</span>
            <span>Лучше добавить цифры и спецсимволы</span>
            <span>Имя и фамилия станут адресом входа</span>
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
              value={form.confirm_password}
              onChange={handleConfirmPasswordChange}
              placeholder="Повторите пароль"
              required
            />
          </div>
          {form.confirm_password && form.password !== form.confirm_password && (
            <div className="hint error-hint">Пароли не совпадают</div>
          )}
          {form.confirm_password && form.password === form.confirm_password && form.password && (
            <div className="hint success-hint">Пароли совпадают</div>
          )}
        </div>

        <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
          {loading ? <span className="btn-loader"></span> : 'Создать аккаунт'}
        </button>
      </form>
    </PreAuthLayout>
  );
}

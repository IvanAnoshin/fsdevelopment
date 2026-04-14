import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PreAuthLayout from '../../components/auth/PreAuthLayout';
import { completeRecoverySetup, getApiErrorMessage, getRecoveryStatus, showToast } from '../../services/api';

export default function RecoverySetup() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(true);
  const [valid, setValid] = useState(false);
  const [backupCodes, setBackupCodes] = useState([]);

  useEffect(() => {
    validateRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const validateRequest = async () => {
    try {
      const res = await getRecoveryStatus(code);
      if (res.data.status === 'approved') {
        setValid(true);
      } else if (res.data.status === 'completed') {
        navigate('/login', { replace: true });
      } else {
        navigate('/recovery', { replace: true });
      }
    } catch {
      navigate('/recovery', { replace: true });
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    const answer = securityAnswer.trim();
    if (!answer) {
      setError('Введите ответ на секретный вопрос');
      return;
    }
    if (answer.length < 3) {
      setError('Ответ должен быть не короче 3 символов');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await completeRecoverySetup({ code, answer });
      setBackupCodes(Array.isArray(res.data?.codes) ? res.data.codes : []);
      showToast('Восстановление завершено. Сохрани новые коды.', { tone: 'success' });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Ошибка завершения восстановления'));
    } finally {
      setLoading(false);
    }
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      showToast('Резервные коды скопированы.', { tone: 'success' });
    } catch {
      setError('Не удалось скопировать коды автоматически');
    }
  };

  if (validating) {
    return (
      <PreAuthLayout
        badge="Recovery setup"
        title="Проверяем, можно ли завершить восстановление."
        subtitle="Сначала убедимся, что заявка одобрена и код всё ещё активен."
        heroTitle="Recovery pipeline"
        heroText="Как только проверка закончится, экран даст задать новый секретный ответ и получить свежие резервные коды."
        stats={[{ value: 'verify', label: 'request' }, { value: 'approved', label: 'needed' }, { value: 'secure', label: 'handoff' }]}
        pills={['approved only', 'new answer', 'backup codes']}
        panelEyebrow="Recovery setup"
        panelTitle="Проверяем заявку"
        panelSubtitle="Подождите пару секунд, пока система подтвердит статус восстановления."
      >
        <div className="auth-preauth-loading-block"><span className="loading-spinner"></span></div>
      </PreAuthLayout>
    );
  }

  if (!valid) return null;

  if (backupCodes.length > 0) {
    return (
      <PreAuthLayout
        badge="Восстановление завершено"
        title="Новый секретный ответ сохранён. Осталось только забрать новые резервные коды."
        subtitle="С этого момента старые recovery-коды больше не актуальны. Вход дальше будет идти уже с новым набором."
        heroTitle="Сохрани коды до следующего входа"
        heroText="Эти коды помогут войти даже если снова потеряется второй фактор. Сохрани их в безопасном месте и никому не показывай."
        stats={[{ value: backupCodes.length, label: 'codes' }, { value: 'new', label: 'set' }, { value: 'login', label: 'next' }]}
        pills={['backup codes', 'recovery complete', 'login ready']}
        panelEyebrow="Recovery complete"
        panelTitle="Сохранить новые коды"
        panelSubtitle="Перед входом обязательно скопируй или выпиши их в надёжное место."
        footer={
          <div className="auth-actions-row auth-preauth-actions-row">
            <button type="button" className="btn btn-secondary btn-large" onClick={copyCodes}>Скопировать коды</button>
            <Link to="/login" className="btn btn-primary btn-large">Перейти ко входу</Link>
          </div>
        }
      >
        {error ? <div className="error">{error}</div> : null}
        <div className="success auth-preauth-success-block">Новый секретный ответ уже сохранён. Теперь можно возвращаться к обычному входу.</div>
        <div className="auth-preauth-code-grid">
          {backupCodes.map((item) => (
            <div key={item} className="auth-preauth-code-chip">{item}</div>
          ))}
        </div>
      </PreAuthLayout>
    );
  }

  return (
    <PreAuthLayout
      badge="Завершение recovery"
      title="Теперь задай новый секретный ответ и верни аккаунт в рабочее состояние."
      subtitle="После сохранения ты сразу получишь новый набор резервных кодов и сможешь снова входить обычным способом."
      heroTitle="Новый секрет вместо старого"
      heroText="Это финальный шаг восстановления: новый ответ заменит старый второй фактор, а старые коды будут автоматически выведены из обращения."
      stats={[{ value: '1', label: 'answer' }, { value: 'new', label: 'codes' }, { value: 'secure', label: 'account' }]}
      pills={['approved request', 'new secret', 'backup refresh']}
      panelEyebrow="Recovery setup"
      panelTitle="Новый секретный ответ"
      panelSubtitle="Ответ должен быть достаточно понятным тебе, но не очевидным для других."
      footer={<div className="auth-footer"><Link to="/recovery">← Вернуться к восстановлению</Link></div>}
    >
      {error ? <div className="error">{error}</div> : null}
      <div className="auth-preauth-security-box glass-panel-lite">
        <div className="auth-preauth-copy-title">Секретный вопрос</div>
        <div className="auth-preauth-copy-subtitle">Мой секрет, который я не выдам никому</div>
        <div className="auth-preauth-small-copy">После сохранения система сразу покажет свежие резервные коды для безопасного входа.</div>
      </div>

      <form onSubmit={handleSubmit} className="register-form">
        <div className="form-group security-form-group">
          <label>Новый секретный ответ</label>
          <div className="input-wrapper">
            <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="3"/>
            </svg>
            <input type="text" value={securityAnswer} onChange={(e) => setSecurityAnswer(e.target.value)} placeholder="Например: название книги, место или кличка" autoFocus required />
          </div>
          <div className="hint">
            <span>Минимум 3 символа</span>
            <span>Запомни ответ — он понадобится при входе</span>
          </div>
        </div>

        <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
          {loading ? <span className="btn-loader"></span> : 'Завершить восстановление'}
        </button>
      </form>
    </PreAuthLayout>
  );
}

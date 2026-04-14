import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PreAuthLayout from '../../components/auth/PreAuthLayout';
import { getApiErrorMessage, setupSecurity, showToast } from '../../services/api';

const QUESTION_OPTIONS = [
  'Как звали моего первого питомца?',
  'В каком городе я впервые почувствовал себя дома?',
  'Какую книгу я перечитывал больше всего?',
  'Как называлась улица моего детства?',
  'Мой секрет, который я не выдам никому',
];

export default function SetupSecurity() {
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState(QUESTION_OPTIONS[0]);
  const [customQuestion, setCustomQuestion] = useState('');
  const [useCustomQuestion, setUseCustomQuestion] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const navigate = useNavigate();
  const location = useLocation();
  const entryMessage = useMemo(() => location.state?.message || '', [location.state]);

  const resolvedQuestion = useMemo(() => {
    if (useCustomQuestion) {
      return customQuestion.trim();
    }
    return selectedQuestion;
  }, [customQuestion, selectedQuestion, useCustomQuestion]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    const answer = securityAnswer.trim();
    const question = resolvedQuestion.trim();
    if (!question) {
      setError('Выберите или введите секретный вопрос');
      return;
    }
    if (question.length < 8) {
      setError('Секретный вопрос должен быть понятным и чуть длиннее');
      return;
    }
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
      const res = await setupSecurity({ question, answer });
      setBackupCodes(Array.isArray(res.data?.codes) ? res.data.codes : []);
      showToast('Секретный вопрос сохранён.', { tone: 'success' });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Ошибка настройки безопасности'));
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

  if (backupCodes.length > 0) {
    return (
      <PreAuthLayout
        badge="Защита настроена"
        title="Секретный вопрос сохранён. Теперь забери резервные коды, чтобы не потерять доступ позже."
        subtitle="Этот шаг закрывает настройку безопасности для нового аккаунта или входа по backup code."
        heroTitle="Резервные коды — последний шаг before post-auth"
        heroText="Сохрани их прямо сейчас: они помогут войти, если потеряется второй фактор или recovery-сценарий понадобится снова."
        stats={[{ value: backupCodes.length, label: 'codes' }, { value: 'saved', label: 'after copy' }, { value: 'next', label: 'DFSN' }]}
        pills={['backup codes', 'setup complete', 'security']}
        panelEyebrow="Security complete"
        panelTitle="Сохранить резервные коды"
        panelSubtitle="Эти коды показываются только один раз. После перехода дальше экран их уже не повторит."
        footer={
          <div className="auth-actions-row auth-preauth-actions-row">
            <button type="button" className="btn btn-secondary btn-large" onClick={copyCodes}>Скопировать коды</button>
            <button type="button" className="btn btn-primary btn-large" onClick={() => navigate('/setup-dfsn')}>Я сохранил коды</button>
          </div>
        }
      >
        {error ? <div className="error">{error}</div> : null}
        <div className="success auth-preauth-success-block">Секретный вопрос настроен. Теперь у аккаунта есть второй фактор и резервный fallback.</div>
        <div className="auth-preauth-security-box glass-panel-lite" style={{ marginBottom: 12 }}>
          <div className="auth-preauth-copy-title">Выбранный вопрос</div>
          <div className="auth-preauth-copy-subtitle">{resolvedQuestion}</div>
        </div>
        <div className="auth-preauth-code-grid">
          {backupCodes.map((code) => (
            <div key={code} className="auth-preauth-code-chip">{code}</div>
          ))}
        </div>
      </PreAuthLayout>
    );
  }

  return (
    <PreAuthLayout
      badge="Setup security"
      title="Защити аккаунт сразу после регистрации или входа по backup code."
      subtitle="Этот экран больше не выбивается из нового интерфейса: настройка безопасности теперь выглядит как часть одной системы."
      heroTitle="Новый второй фактор без старого тёмного экрана"
      heroText="Выбери вопрос, который легко вспомнить тебе и сложно угадать другим. После сохранения ты получишь резервные коды на случай потери доступа."
      stats={[{ value: 'answer', label: '2FA step' }, { value: 'codes', label: 'backup' }, { value: 'secure', label: 'account' }]}
      pills={['secret answer', 'backup codes', 'account safety']}
      panelEyebrow="Security"
      panelTitle="Настроить секретный вопрос"
      panelSubtitle="После этого шага аккаунт будет защищён секретным ответом и recovery-кодами."
      footer={<div className="auth-footer"><Link to="/login">← Вернуться ко входу</Link></div>}
    >
      {entryMessage ? <div className="success">{entryMessage}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <div className="auth-preauth-qa-block glass-panel-lite" style={{ marginBottom: 14 }}>
        <div className="auth-preauth-subsection-title">Выбери секретный вопрос</div>
        <div className="auth-preauth-subsection-copy">
          Лучше выбрать вопрос, ответ на который знаешь только ты. При входе после пароля система будет показывать именно его.
        </div>
        <div className="auth-preauth-choice-list" style={{ marginTop: 12 }}>
          {QUESTION_OPTIONS.map((question) => {
            const active = !useCustomQuestion && selectedQuestion === question;
            return (
              <button
                key={question}
                type="button"
                className={`auth-preauth-choice-card ${active ? 'active' : ''}`}
                onClick={() => {
                  setUseCustomQuestion(false);
                  setSelectedQuestion(question);
                  setError('');
                }}
              >
                <div className="auth-preauth-choice-card-text">{question}</div>
                <div className="auth-preauth-choice-card-meta">Будет показан как второй шаг входа после пароля.</div>
              </button>
            );
          })}
          <button
            type="button"
            className={`auth-preauth-choice-card ${useCustomQuestion ? 'active' : ''}`}
            onClick={() => {
              setUseCustomQuestion(true);
              setError('');
            }}
          >
            <div className="auth-preauth-choice-card-text">Свой вариант вопроса</div>
            <div className="auth-preauth-choice-card-meta">Подходит, если хочешь использовать полностью свой текст.</div>
          </button>
        </div>
        {useCustomQuestion && (
          <div className="form-group security-form-group" style={{ marginTop: 12 }}>
            <label>Свой вопрос</label>
            <div className="input-wrapper">
              <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9.09 9a3 3 0 1 1 5.82 1c0 2-3 3-3 3"/>
                <path d="M12 17h.01"/>
                <circle cx="12" cy="12" r="10"/>
              </svg>
              <input
                type="text"
                value={customQuestion}
                onChange={(e) => setCustomQuestion(e.target.value)}
                placeholder="Например: какой момент жизни я всегда вспоминаю с улыбкой?"
                maxLength={255}
              />
            </div>
          </div>
        )}
      </div>

      <div className="auth-preauth-security-box glass-panel-lite">
        <div className="auth-preauth-copy-title">Вход будет выглядеть так</div>
        <div className="auth-preauth-copy-subtitle">Шаг 1: пароль → Шаг 2: секретный вопрос</div>
        <div className="auth-preauth-small-copy">Текущий вопрос: {resolvedQuestion || 'выберите вопрос'}</div>
      </div>

      <form onSubmit={handleSubmit} className="register-form">
        <div className="form-group security-form-group">
          <label>Ваш секретный ответ</label>
          <div className="input-wrapper">
            <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="3"/>
            </svg>
            <input type="text" value={securityAnswer} onChange={(e) => setSecurityAnswer(e.target.value)} placeholder="Например: название книги, города или питомца" autoFocus required />
          </div>
          <div className="hint">
            <span>Минимум 3 символа</span>
            <span>Ответ можно вводить без оглядки на регистр</span>
            <span>Запомни его — он понадобится после пароля</span>
          </div>
        </div>

        <button type="submit" className="btn btn-primary btn-large" disabled={loading}>
          {loading ? <span className="btn-loader"></span> : 'Завершить настройку'}
        </button>
      </form>
    </PreAuthLayout>
  );
}

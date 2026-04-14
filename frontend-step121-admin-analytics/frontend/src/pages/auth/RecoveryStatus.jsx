import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PreAuthLayout from '../../components/auth/PreAuthLayout';
import { generateRecoveryQuestions, getApiErrorMessage, getRecoveryStatus, submitRecoveryAnswers, showToast } from '../../services/api';

const STATUS_META = {
  approved: {
    icon: '✅',
    title: 'Заявка одобрена',
    tone: 'success',
    text: 'Теперь можно задать новый секретный ответ и заново получить резервные коды.',
  },
  rejected: {
    icon: '❌',
    title: 'Заявка отклонена',
    tone: 'danger',
    text: 'Поддержка не смогла подтвердить личность по этой заявке. Можно создать новую и приложить более точные данные.',
  },
  pending: {
    icon: '⏳',
    title: 'Заявка рассматривается',
    tone: 'accent',
    text: 'Пока support проверяет заявку, можно ответить на дополнительные вопросы и ускорить решение.',
  },
  expired: {
    icon: '⌛',
    title: 'Срок заявки истёк',
    tone: 'info',
    text: 'Заявка больше не активна. Для нового восстановления придётся отправить новую заявку.',
  },
  completed: {
    icon: '🎉',
    title: 'Восстановление завершено',
    tone: 'success',
    text: 'Новый секретный ответ уже сохранён. Теперь можно снова войти в аккаунт.',
  },
};

export default function RecoveryStatus() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showQuestions, setShowQuestions] = useState(false);
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState({ friends: [], posts: [] });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const loadStatus = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getRecoveryStatus(code);
      setStatus(res.data);
      if (res.data.status === 'pending' || res.data.auto_decision === 'manual') {
        await loadQuestions();
      } else {
        setShowQuestions(false);
        setQuestions(null);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Заявка не найдена'));
    } finally {
      setLoading(false);
    }
  };

  const loadQuestions = async () => {
    try {
      const res = await generateRecoveryQuestions(code);
      setQuestions(res.data);
      setShowQuestions(true);
    } catch {
      setQuestions(null);
      setShowQuestions(false);
    }
  };

  const toggleAnswer = (key, id) => {
    setAnswers((prev) => ({
      ...prev,
      [key]: prev[key].includes(id) ? prev[key].filter((item) => item !== id) : [...prev[key], id],
    }));
  };

  const canSubmitAnswers = answers.friends.length > 0 || answers.posts.length > 0;

  const handleSubmitAnswers = async () => {
    if (!canSubmitAnswers || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await submitRecoveryAnswers({
        code,
        friend_answers: answers.friends.map(String),
        post_answers: answers.posts.map(String),
      });
      showToast('Ответы отправлены. Статус обновлён.', { tone: 'success' });
      setShowQuestions(false);
      await loadStatus();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Ошибка отправки ответов'));
    } finally {
      setSubmitting(false);
    }
  };

  const statusMeta = useMemo(() => STATUS_META[status?.status] || STATUS_META.pending, [status?.status]);
  const stats = useMemo(() => {
    if (!status) return [];
    return [
      { value: status.code || code, label: 'код' },
      { value: status.status || 'pending', label: 'статус' },
      { value: status.auto_decision || 'manual', label: 'режим' },
    ];
  }, [status, code]);

  if (loading) {
    return (
      <PreAuthLayout
        badge="Проверка статуса"
        title="Восстановление доступа"
        subtitle="Проверяем код заявки и загружаем свежий статус."
        heroTitle="Подготовка recovery-сценария"
        heroText="Если код валиден, экран покажет текущее решение и предложит следующий шаг."
        stats={[{ value: 'status', label: 'loading' }, { value: 'secure', label: 'flow' }, { value: 'beta', label: 'ready' }]}
        pills={['tracking code', 'support review', 'recovery']}
        panelEyebrow="Recovery"
        panelTitle="Загружаем заявку"
        panelSubtitle="Подождите пару секунд, пока система подтянет статус заявки."
      >
        <div className="auth-preauth-loading-block"><span className="loading-spinner"></span></div>
      </PreAuthLayout>
    );
  }

  return (
    <PreAuthLayout
      badge="Статус recovery"
      title="Следи за решением по заявке и заверши восстановление без старого тёмного экрана."
      subtitle="Этот экран теперь живёт в том же визуальном языке, что и вход, регистрация и post-auth часть приложения."
      heroTitle={statusMeta.title}
      heroText={statusMeta.text}
      stats={stats}
      pills={['status', 'tracking', status?.user ? `${status.user.first_name} ${status.user.last_name}` : 'account']}
      panelEyebrow="Recovery status"
      panelTitle={statusMeta.title}
      panelSubtitle={status?.created_at ? `Создана ${new Date(status.created_at).toLocaleString('ru-RU')}` : 'Статус заявки и дополнительные действия'}
      footer={
        <div className="auth-footer auth-footer-spaced">
          <Link to="/recovery">← Вернуться к восстановлению</Link>
        </div>
      }
    >
      {error ? <div className="error">{error}</div> : null}

      <div className={`auth-preauth-status-card tone-${statusMeta.tone}`}>
        <div className="auth-preauth-status-icon">{statusMeta.icon}</div>
        <div className="auth-preauth-status-main">
          <div className="auth-preauth-status-title">{statusMeta.title}</div>
          <div className="auth-preauth-status-text">{statusMeta.text}</div>
          <div className="auth-preauth-pills auth-preauth-status-pills">
            {status?.expires_at ? <span className="auth-preauth-pill">до {new Date(status.expires_at).toLocaleString('ru-RU')}</span> : null}
            {status?.auto_decision === 'auto_approve' ? <span className="auth-preauth-pill">автоодобрено DFSN</span> : null}
            {status?.user ? <span className="auth-preauth-pill">{status.user.first_name} {status.user.last_name}</span> : null}
          </div>
        </div>
      </div>

      {status?.status === 'approved' && (
        <button onClick={() => navigate(`/recovery/setup/${code}`)} className="btn btn-primary btn-large" style={{ width: '100%' }}>
          Настроить новый секретный вопрос
        </button>
      )}

      {status?.status === 'completed' && (
        <div className="success auth-preauth-success-block">
          Новый секретный ответ уже сохранён. Можно возвращаться ко входу.
        </div>
      )}

      {status?.status === 'completed' && (
        <div className="auth-actions-row auth-preauth-actions-row">
          <Link className="btn btn-primary btn-large" to="/login">Перейти ко входу</Link>
          <Link className="btn btn-secondary btn-large" to="/recovery">Новая заявка</Link>
        </div>
      )}

      {status?.status === 'pending' && showQuestions && questions && (
        <div className="auth-preauth-qa-block">
          <div className="auth-preauth-panel-eyebrow">Дополнительная проверка</div>
          <h3 className="auth-preauth-subsection-title">Ответь на вопросы о своём профиле</h3>
          <p className="auth-preauth-subsection-copy">Это может ускорить ручную проверку. Можно выбрать друзей и посты, которые действительно принадлежат твоему аккаунту.</p>

          {questions.friends?.length > 0 && (
            <div className="form-group">
              <label>Выбери своих друзей</label>
              <div className="auth-preauth-choice-grid">
                {questions.friends.map((friend) => {
                  const active = answers.friends.includes(friend.id);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      className={`auth-preauth-choice-chip ${active ? 'active' : ''}`}
                      onClick={() => toggleAnswer('friends', friend.id)}
                    >
                      {friend.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {questions.posts?.length > 0 && (
            <div className="form-group">
              <label>Выбери свои посты</label>
              <div className="auth-preauth-choice-list">
                {questions.posts.map((post) => {
                  const active = answers.posts.includes(post.id);
                  return (
                    <button
                      key={post.id}
                      type="button"
                      className={`auth-preauth-choice-card ${active ? 'active' : ''}`}
                      onClick={() => toggleAnswer('posts', post.id)}
                    >
                      <div className="auth-preauth-choice-card-text">{post.content}</div>
                      <div className="auth-preauth-choice-card-meta">{new Date(post.created_at || post.date).toLocaleDateString('ru-RU')}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button onClick={handleSubmitAnswers} disabled={!canSubmitAnswers || submitting} className="btn btn-primary btn-large" style={{ width: '100%' }}>
            {submitting ? <span className="btn-loader"></span> : 'Отправить ответы'}
          </button>
        </div>
      )}

      {status?.status === 'pending' && (!showQuestions || !questions) && (
        <div className="auth-preauth-copy-card glass-panel-lite">
          <div className="auth-preauth-copy-title">Support ещё проверяет заявку</div>
          <div className="auth-preauth-copy-subtitle">Ты можешь закрыть страницу и вернуться по этому же коду позже. Когда решение будет готово, экран покажет следующий шаг.</div>
        </div>
      )}

      {status?.status === 'rejected' && (
        <div className="auth-actions-row auth-preauth-actions-row">
          <Link className="btn btn-primary btn-large" to="/recovery">Создать новую заявку</Link>
          <Link className="btn btn-secondary btn-large" to="/login">Ко входу</Link>
        </div>
      )}

      {status?.status === 'expired' && (
        <div className="auth-actions-row auth-preauth-actions-row">
          <Link className="btn btn-primary btn-large" to="/recovery">Создать новую заявку</Link>
        </div>
      )}
    </PreAuthLayout>
  );
}

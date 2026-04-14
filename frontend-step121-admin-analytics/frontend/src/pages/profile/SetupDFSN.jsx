import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupDFSN } from '../../services/api';

export default function SetupDFSN() {
  const [step, setStep] = useState('info');
  const [typingSpeed, setTypingSpeed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [keyCount, setKeyCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const navigate = useNavigate();

  const sampleText = `Friendscape — это цифровая крепость, где ваша безопасность строится на поведении. Система DFSN анализирует как вы печатаете, двигаете мышью и взаимодействуете с интерфейсом. Это создаёт уникальный цифровой почерк, который невозможно подделать. Дополнительный уровень защиты делает ваш аккаунт более устойчивым к взлому. Friendscape запоминает вас и защищает от злоумышленников. Добро пожаловать в новую эру безопасности.`;

  useEffect(() => {
    if (step !== 'typing') return;

    let startTime = Date.now();
    let delays = [];
    let count = 0;

    const handleKeyPress = () => {
      count++;
      setKeyCount(count);
      const now = Date.now();
      if (startTime) {
        delays.push(now - startTime);
      }
      startTime = now;
    };

    window.addEventListener('keydown', handleKeyPress);

    const timerInterval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerInterval);
          
          const totalTime = 60000;
          const speed = (count / totalTime) * 60000;
          setTypingSpeed(Math.round(speed));
          setStep('complete');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const progressInterval = setInterval(() => {
      setProgress(prev => {
        const newProgress = prev + (100 / 60);
        return Math.min(newProgress, 100);
      });
    }, 1000);

    return () => {
      clearInterval(timerInterval);
      clearInterval(progressInterval);
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [step]);

  const handleStartTyping = () => {
    setStep('typing');
    setText('');
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    
    try {
      await setupDFSN({ typing_speed: typingSpeed });
      navigate('/profile');
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка настройки DFSN');
      setLoading(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (step === 'info') {
    return (
      <div className="auth-container">
        <div className="setup-dfsn-card">
          <div className="dfs-header">
            <div className="dfs-icon">🛡️</div>
            <h1>DFSN — Digital Fortress Social Network (Цифровая крепость для социальной сети)</h1>
            <p className="dfs-subtitle">Ваш цифровой почерк — дополнительный уровень защиты</p>
          </div>

          <div className="dfs-info-grid">
            <div className="info-item">
              <div className="info-icon">⌨️</div>
              <div className="info-text">
                <h3>Анализ печати</h3>
                <p>Система запоминает вашу скорость печати, ритм и характерные задержки между нажатиями</p>
              </div>
            </div>
            <div className="info-item">
              <div className="info-icon">🖱️</div>
              <div className="info-text">
                <h3>Движения мыши</h3>
                <p>Траектории, скорость и точность движений создают уникальный поведенческий профиль</p>
              </div>
            </div>
            <div className="info-item">
              <div className="info-icon">⏰</div>
              <div className="info-text">
                <h3>Время активности</h3>
                <p>Ваши привычные часы использования и длительность сессий — часть цифрового почерка</p>
              </div>
            </div>
            <div className="info-item">
              <div className="info-icon">🔒</div>
              <div className="info-text">
                <h3>Невозможно подделать</h3>
                <p>Даже зная пароль, злоумышленник не сможет имитировать ваш уникальный стиль</p>
              </div>
            </div>
          </div>

          <div className="dfs-benefits">
            <h3>Что вы получаете</h3>
            <ul>
              <li>🛡️ Дополнительный уровень защиты аккаунта</li>
              <li>🔍 Обнаружение подозрительной активности</li>
              <li>📱 Работает на любом устройстве</li>
              <li>⚡ Мгновенный анализ без задержек</li>
            </ul>
          </div>

          <button className="btn-dfsn-start" onClick={handleStartTyping}>
            Начать настройку
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M5 12h14M12 5l7 7-7 7" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>

          <div className="dfs-footer">
            <p>🔒 Ваши поведенческие данные хранятся в зашифрованном виде</p>
            <p>📖 Настройка займёт около 1 минуты</p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'typing') {
    return (
      <div className="auth-container">
        <div className="setup-dfsn-card typing-card">
          <div className="typing-header">
            <div className="progress-ring">
              <svg width="80" height="80" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="35" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4"/>
                <circle
                  cx="40" cy="40" r="35"
                  fill="none"
                  stroke="url(#gradient)"
                  strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 35}`}
                  strokeDashoffset={`${2 * Math.PI * 35 * (1 - progress / 100)}`}
                  transform="rotate(-90 40 40)"
                />
                <defs>
                  <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#8b5cf6"/>
                    <stop offset="100%" stopColor="#d946ef"/>
                  </linearGradient>
                </defs>
              </svg>
              <div className="progress-time">{formatTime(timeLeft)}</div>
            </div>
            <div className="typing-stats">
              <div className="stat">
                <span className="stat-value">{keyCount}</span>
                <span className="stat-label">символов</span>
              </div>
              <div className="stat">
                <span className="stat-value">{Math.round(keyCount / (60 - timeLeft) * 60) || 0}</span>
                <span className="stat-label">зн/мин</span>
              </div>
            </div>
          </div>

          <div className="sample-text">
            <p>{sampleText}</p>
          </div>

          <textarea
            ref={textarea => textarea && textarea.focus()}
            className="typing-area"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Начните печатать текст выше..."
            autoFocus
          />

          <div className="typing-hint">
            <p>💡 Печатайте естественно, как обычно. Система анализирует ваш ритм, а не точность.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="setup-dfsn-card complete-card">
        <div className="complete-icon">✅</div>
        <h2>DFSN настроен!</h2>
        <p className="complete-text">
          Ваш цифровой почерк сохранён. Теперь Friendscape использует его для дополнительной защиты.
        </p>
        
        <div className="typing-stats-final">
          <div className="stat-final">
            <span className="stat-value-final">{typingSpeed}</span>
            <span className="stat-label-final">знаков/мин</span>
          </div>
          <div className="stat-final">
            <span className="stat-value-final">{keyCount}</span>
            <span className="stat-label-final">символов</span>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <button className="btn-dfsn-complete" onClick={handleSubmit} disabled={loading}>
          {loading ? (
            <span className="btn-loader"></span>
          ) : (
            'Перейти в профиль'
          )}
        </button>
      </div>
    </div>
  );
}
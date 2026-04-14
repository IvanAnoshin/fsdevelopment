import { Link } from 'react-router-dom';
import PreAuthLayout from '../../components/auth/PreAuthLayout';

export default function NotFound() {
  return (
    <PreAuthLayout
      badge="404"
      title="Этой страницы здесь нет, но вся навигация уже живёт в новом интерфейсе."
      subtitle="Страница не найдена, но из этого состояния всё равно можно быстро вернуться ко входу или в ленту."
      heroTitle="Без тупика даже на неправильном адресе"
      heroText="Мы уже выровняли pre-auth и post-auth слои в один визуальный язык, поэтому даже 404 теперь выглядит как часть приложения, а не как случайная выбившаяся страница."
      stats={[{ value: '404', label: 'route' }, { value: 'login', label: 'fallback' }, { value: 'feed', label: 'shortcut' }]}
      pills={['not found', 'pre-auth', 'navigation']}
      panelEyebrow="Unknown route"
      panelTitle="Страница не найдена"
      panelSubtitle="Такого адреса здесь нет. Можно вернуться ко входу или сразу открыть ленту, если сессия уже активна."
      footer={
        <div className="auth-actions-row auth-preauth-actions-row">
          <Link className="btn btn-secondary btn-large" to="/login">Ко входу</Link>
          <Link className="btn btn-primary btn-large" to="/feed">Открыть ленту</Link>
        </div>
      }
    >
      <div className="auth-preauth-status-card tone-info">
        <div className="auth-preauth-status-icon">🧭</div>
        <div className="auth-preauth-status-main">
          <div className="auth-preauth-status-title">Маршрут не существует</div>
          <div className="auth-preauth-status-text">Если адрес был открыт из старой ссылки, проще вернуться на вход или сразу продолжить из основного интерфейса.</div>
        </div>
      </div>
    </PreAuthLayout>
  );
}

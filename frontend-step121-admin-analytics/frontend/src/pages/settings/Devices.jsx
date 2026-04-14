import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDevices, logout, removeDevice, confirmAction, showToast } from '../../services/api';
import { getSavedAccounts, getStoredUser, removeSavedAccount, switchToSavedAccount } from '../../services/authStorage';
import {
  PostAuthAvatarStack,
  PostAuthEmptyState,
  PostAuthHero,
  PostAuthMetaGrid,
  PostAuthNoticeCard,
  PostAuthSummaryCard,
} from '../../components/postauth';

function deviceEmoji(name = '') {
  return /iphone|android|mobile|phone/i.test(name) ? '📱' : '💻';
}

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionDeviceId, setActionDeviceId] = useState('');
  const [savedAccounts, setSavedAccounts] = useState(() => getSavedAccounts());
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [showProfileLinkModal, setShowProfileLinkModal] = useState(false);

  const loadDevices = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getDevices();
      setDevices(Array.isArray(res.data?.devices) ? res.data.devices : []);
    } catch (err) {
      console.error('Ошибка устройств:', err);
      setError(err.response?.data?.error || 'Не удалось загрузить устройства');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDevices();
    const handleAuthChanged = () => {
      setSavedAccounts(getSavedAccounts());
      setCurrentUser(getStoredUser());
    };
    window.addEventListener('app:auth-changed', handleAuthChanged);
    return () => window.removeEventListener('app:auth-changed', handleAuthChanged);
  }, [loadDevices]);

  const currentDevice = useMemo(() => devices.find((item) => item.is_current), [devices]);
  const trustedDevices = useMemo(
    () => devices.filter((item) => (typeof item.trust_is_active === 'boolean'
      ? item.trust_is_active
      : (item.expires_at ? new Date(item.expires_at) > new Date() : false))),
    [devices],
  );
  const pinEnabledCount = useMemo(() => devices.filter((item) => item.pin_enabled).length, [devices]);
  const profilePath = useMemo(() => (currentUser?.id ? `/profile/${currentUser.id}` : '/profile'), [currentUser]);
  const profileUrl = useMemo(() => {
    if (typeof window === 'undefined') return profilePath;
    return `${window.location.origin}${profilePath}`;
  }, [profilePath]);
  const canShareProfile = Boolean(typeof navigator !== 'undefined' && navigator.share && profileUrl);

  const handleSwitchAccount = (accountKey) => {
    const switched = switchToSavedAccount(accountKey);
    if (!switched) {
      setError('Не удалось переключить аккаунт на этом устройстве');
      setSavedAccounts(getSavedAccounts());
      return;
    }
    window.location.replace('/settings/devices');
  };

  const handleRemoveSavedAccount = async (account) => {
    const confirmed = await confirmAction({
      title: 'Убрать аккаунт с устройства',
      message: `Аккаунт ${account.label} будет удалён из списка быстрых переключений на этом устройстве.`,
      confirmLabel: 'Убрать',
      tone: 'danger',
    });
    if (!confirmed) return;
    removeSavedAccount(account.key);
    setSavedAccounts(getSavedAccounts());
    showToast('Аккаунт убран с устройства', { tone: 'success' });
  };

  const handleAddAccount = () => {
    logout({ redirectTo: '/login?add-account=1' });
  };

  const handleCopyProfileLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl);
      showToast('Ссылка на профиль скопирована', { tone: 'success' });
    } catch {
      showToast('Не удалось скопировать ссылку', { tone: 'danger' });
    }
  };

  const handleShareProfile = async () => {
    if (!canShareProfile) return;
    try {
      await navigator.share({
        title: currentUser?.first_name ? `${currentUser.first_name} в Friendscape` : 'Мой профиль Friendscape',
        text: 'Открой мой профиль в Friendscape',
        url: profileUrl,
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        showToast('Не удалось открыть системное меню шаринга', { tone: 'danger' });
      }
    }
  };

  const handleRemove = async (device) => {
    const isCurrent = Boolean(device?.is_current);
    const confirmed = await confirmAction({
      title: isCurrent ? 'Удалить текущее устройство' : 'Удалить устройство',
      message: isCurrent
        ? 'После удаления этого устройства вы сразу выйдете из аккаунта на нём.'
        : 'Устройство будет удалено из доверенных. При следующем входе потребуется полная аутентификация.',
      confirmLabel: isCurrent ? 'Выйти и удалить' : 'Удалить',
      tone: 'danger',
    });
    if (!confirmed) return;

    try {
      setActionDeviceId(device.device_id);
      setError('');
      const res = await removeDevice(device.device_id);
      if (res.data?.removed_current || isCurrent) {
        logout();
        return;
      }
      setDevices((prev) => prev.filter((item) => item.device_id !== device.device_id));
      showToast(isCurrent ? 'Устройство удалено' : 'Устройство удалено из доверенных', { tone: 'success' });
    } catch (err) {
      console.error('Ошибка удаления:', err);
      setError(err.response?.data?.error || 'Не удалось удалить устройство');
    } finally {
      setActionDeviceId('');
    }
  };

  return (
    <div className="pa-list pa-settings-page">
      <PostAuthHero
        className="pa-settings-hero"
        badge={<div className="pa-discovery-badge">Безопасность и доступ</div>}
        title="Устройства и быстрый вход"
        text="Управляй доверенными сессиями, контролируй PIN-вход и быстро отключай устройства, которым больше не доверяешь. Общий hero-слой теперь синхронизирован и для security-экрана."
        titleTag="h1"
        stats={[
          { key: 'total', value: devices.length, label: 'всего устройств', tone: 'accent' },
          { key: 'trusted', value: trustedDevices.length, label: 'доверенных', tone: 'green' },
          { key: 'pin', value: pinEnabledCount, label: 'с PIN', tone: 'blue' },
          { key: 'current', value: currentDevice ? '1' : '0', label: 'текущее', tone: 'warning' },
        ]}
        actions={(
          <>
            <button className="pa-secondary-btn" onClick={loadDevices} disabled={loading}>Обновить</button>
            <button className="pa-soft-btn" onClick={() => setShowProfileLinkModal(true)} disabled={!currentUser?.id}>Быстрая ссылка</button>
            <Link
              to="/settings/support"
              className="pa-soft-btn"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              Поддержка
            </Link>
            {currentDevice && (
              <Link
                to={`/settings/devices/${currentDevice.device_id}`}
                className="pa-soft-btn"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                Текущее устройство
              </Link>
            )}
          </>
        )}
        visual={(
          <>
            <div className="pa-settings-hero-orb"><span>{currentDevice ? deviceEmoji(currentDevice.device_name) : '🔐'}</span></div>
            <PostAuthAvatarStack
              className="pa-avatar-stack"
              avatarClassName="pa-stack-avatar"
              items={devices}
              getKey={(device) => device.device_id}
              getLabel={(device) => deviceEmoji(device.device_name)}
              emptyLabel="🔐"
            />
          </>
        )}
      />

      {currentDevice && (
        <PostAuthSummaryCard
          className="pa-settings-summary-card"
          badge={(
            <>
              <span className="pa-pill blue">Это устройство</span>
              {currentDevice.pin_enabled && <span className="pa-pill green">PIN активен</span>}
            </>
          )}
          value={currentDevice.device_name || 'Без названия'}
          title="Сейчас используется"
          text={currentDevice.ip || 'IP неизвестен'}
          meta={currentDevice.is_current ? 'Активная сессия' : null}
        />
      )}

      {error && (
        <PostAuthNoticeCard
          className="pa-settings-error-card"
          tone="danger"
          icon="⚠️"
          title="Не получилось загрузить устройства"
          text={error}
          actions={[
            { key: 'retry', label: 'Повторить', onClick: loadDevices, disabled: loading, className: 'pa-primary-btn' },
            { key: 'refresh', label: 'Обновить экран', to: '/settings/devices', className: 'pa-secondary-btn' },
          ]}
        />
      )}

      <section className="pa-card pa-settings-qr-card">
        <div className="pa-settings-panel-head pa-settings-qr-head">
          <div>
            <div className="pa-settings-panel-title">Быстрый доступ к профилю</div>
            <div className="pa-device-text">Открой, скопируй или безопасно отправь прямую ссылку на свой профиль без внешних QR-сервисов и лишних посредников.</div>
          </div>
          <button className="pa-primary-btn" onClick={() => setShowProfileLinkModal(true)} disabled={!currentUser?.id}>Открыть ссылку</button>
        </div>
        <div className="pa-settings-qr-preview">
          <div className="pa-settings-qr-preview-badge">🔗</div>
          <div className="pa-settings-qr-preview-main">
            <div className="pa-name">{currentUser ? (`${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() || currentUser.username || 'Мой профиль') : 'Мой профиль'}</div>
            <div className="pa-device-text">{currentUser?.username ? `@${currentUser.username}` : 'Личный профиль Friendscape'}</div>
          </div>
          <Link className="pa-secondary-btn" to={profilePath} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            Открыть профиль
          </Link>
        </div>
      </section>

      <section className="pa-card pa-settings-account-switch-card">
        <div className="pa-settings-panel-head">
          <div>
            <div className="pa-settings-panel-title">Смена аккаунта</div>
            <div className="pa-device-text">Сервис теперь поддерживает быстрый переход между сохранёнными аккаунтами на одном устройстве.</div>
          </div>
          <button className="pa-primary-btn" onClick={handleAddAccount}>Добавить аккаунт</button>
        </div>
        {savedAccounts.length === 0 ? (
          <div className="pa-empty pa-settings-account-empty">
            <div className="pa-empty-icon">👤</div>
            <h3>Пока сохранён только текущий сеанс</h3>
            <p>Нажми «Добавить аккаунт», войди в другой профиль, и после этого быстрый переключатель появится здесь.</p>
          </div>
        ) : (
          <div className="pa-settings-account-list">
            {savedAccounts.map((account) => (
              <article key={account.key} className="pa-settings-account-item">
                <button type="button" className="pa-settings-account-main" onClick={() => handleSwitchAccount(account.key)}>
                  <div className="pa-settings-account-avatar">{String(account.label || 'A').trim().charAt(0).toUpperCase() || 'A'}</div>
                  <div className="pa-settings-account-meta">
                    <div className="pa-name">{account.label}</div>
                    <div className="pa-device-text">{account.subtitle || 'Сохранённый аккаунт на этом устройстве'}</div>
                  </div>
                  {account.isActive && <span className="pa-pill blue">Сейчас</span>}
                </button>
                <div className="pa-settings-account-actions">
                  {!account.isActive && <button className="pa-secondary-btn" onClick={() => handleSwitchAccount(account.key)}>Переключить</button>}
                  <button className="pa-danger-btn" onClick={() => handleRemoveSavedAccount(account)}>Убрать</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {showProfileLinkModal && (
        <div className="pa-overlay" onClick={() => setShowProfileLinkModal(false)}>
          <div className="pa-modal-wrap" onClick={(e) => e.stopPropagation()}>
            <div className="pa-modal pa-settings-qr-modal">
              <div className="pa-discovery-badge">Ссылка профиля</div>
              <div className="pa-settings-qr-modal-head">
                <div>
                  <div className="pa-section-title" style={{ marginTop: 10 }}>Открой или отправь профиль напрямую</div>
                  <div className="pa-bio" style={{ marginTop: 8 }}>
                    Здесь только прямая ссылка на профиль. Она открывается локально внутри Friendscape и не требует внешних QR-генераторов.
                  </div>
                </div>
                <button className="pa-icon-btn" type="button" aria-label="Закрыть окно со ссылкой" onClick={() => setShowProfileLinkModal(false)}>✕</button>
              </div>
              <div className="pa-settings-qr-code-shell pa-settings-link-shell">
                <div className="pa-settings-link-hero">🔗</div>
                <div className="pa-meta">Профиль доступен по прямой ссылке</div>
                <div className="pa-device-text">Открой ссылку на этом устройстве, скопируй её или передай через системное меню шаринга.</div>
              </div>
              <div className="pa-settings-qr-profile-chip">
                <div className="pa-settings-account-avatar pa-settings-qr-avatar">{String((currentUser?.first_name || currentUser?.username || 'P')).trim().charAt(0).toUpperCase()}</div>
                <div className="pa-settings-qr-profile-meta">
                  <div className="pa-name">{currentUser ? (`${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() || currentUser.username || 'Мой профиль') : 'Мой профиль'}</div>
                  <div className="pa-device-text">{currentUser?.username ? `@${currentUser.username}` : 'Публичная ссылка профиля'}</div>
                </div>
              </div>
              <div className="pa-settings-qr-link">{profileUrl}</div>
              <div className="pa-action-row pa-settings-qr-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                <Link className="pa-primary-btn" to={profilePath} onClick={() => setShowProfileLinkModal(false)} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  Открыть профиль
                </Link>
                <button className="pa-secondary-btn" onClick={handleCopyProfileLink}>Скопировать ссылку</button>
                {canShareProfile && <button className="pa-soft-btn" onClick={handleShareProfile}>Поделиться</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? <div className="pa-loading">Загружаю устройства…</div> : devices.length === 0 ? (
        <PostAuthEmptyState
          className="pa-settings-empty-card"
          title="Устройств пока нет"
          text="Когда войдёшь в аккаунт с нового устройства, оно появится здесь и его можно будет сделать доверенным."
          icon="🔐"
          primaryAction={{ label: 'Проверить снова', onClick: loadDevices }}
        />
      ) : (
        <div className="pa-list pa-settings-device-list">
          {devices.map((device) => {
            const trusted = typeof device.trust_is_active === 'boolean'
              ? device.trust_is_active
              : (device.expires_at ? new Date(device.expires_at) > new Date() : false);
            const isRemoving = actionDeviceId === device.device_id;
            return (
              <article key={device.device_id} className="pa-device-item pa-settings-device-card">
                <div className="pa-settings-device-top">
                  <div className="pa-inline-row pa-settings-device-ident" style={{ minWidth: 0 }}>
                    <div className="pa-settings-device-avatar">{deviceEmoji(device.device_name)}</div>
                    <div className="pa-device-main">
                      <div className="pa-name">{device.device_name || 'Неизвестное устройство'}</div>
                      <div className="pa-device-text">{device.user_agent || 'Без user-agent'}</div>
                      <div className="pa-meta">Последняя активность: {device.last_used ? new Date(device.last_used).toLocaleString('ru-RU') : '—'}</div>
                    </div>
                  </div>
                  <div className="pa-settings-device-score">{device.is_current ? 'Сейчас' : 'Устройство'}</div>
                </div>

                <div className="pa-pill-row" style={{ marginTop: 10 }}>
                  {device.is_current && <span className="pa-pill blue">Это устройство</span>}
                  {device.pin_enabled && <span className="pa-pill blue">PIN включён</span>}
                  {device.trusted_by_dfsn && <span className="pa-pill green">DFSN</span>}
                  <span className={`pa-pill ${trusted ? 'green' : 'warning'}`}>{trusted ? 'Доверено' : 'Требует проверки'}</span>
                </div>

                <PostAuthMetaGrid
                  className="pa-settings-meta-grid"
                  itemClassName="pa-settings-meta-card"
                  labelClassName="pa-settings-meta-label"
                  valueClassName="pa-settings-meta-value"
                  items={[
                    { key: 'ip', label: 'IP', value: device.ip || '—' },
                    { key: 'pin', label: 'PIN', value: device.pin_enabled ? 'Активен' : 'Не настроен' },
                    { key: 'trust', label: 'Доверие', value: trusted ? 'Активно' : 'Истекло' },
                  ]}
                />

                <div className="pa-action-row pa-settings-device-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                  <Link
                    to={`/settings/devices/${device.device_id}`}
                    className="pa-secondary-btn"
                    style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    Открыть
                  </Link>
                  <button className="pa-danger-btn" onClick={() => handleRemove(device)} disabled={isRemoving}>
                    {isRemoving ? 'Удаляю…' : (device.is_current ? 'Выйти и удалить' : 'Удалить')}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

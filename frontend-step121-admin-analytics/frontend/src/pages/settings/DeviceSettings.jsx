import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PostAuthHero,
  PostAuthMetaGrid,
  PostAuthNoticeCard,
  PostAuthSummaryCard,
} from '../../components/postauth';
import { confirmAction, getApiErrorMessage, getDevice, logout, removeDevice, showToast, updateDevicePIN } from '../../services/api';
import { getStoredUser, setStoredUser } from '../../services/authStorage';
import { createEncryptedE2EEBackup, deleteEncryptedE2EEBackup, getCurrentLocalE2EEDeviceSummary, getE2EEBackupStatus, getE2EEStatus, resetCurrentE2EEDevice, restoreEncryptedE2EEBackup } from '../../services/e2ee';
import { useDocumentTitle } from '../../utils/pageTitle';

function deviceEmoji(name = '') {
  return /iphone|android|mobile|phone/i.test(name) ? '📱' : '💻';
}

function syncStoredUserPin(deviceId, pinEnabled) {
  const storedUser = getStoredUser();
  if (!storedUser || storedUser.current_device_id !== deviceId) return;
  setStoredUser({
    ...storedUser,
    current_device_pin_enabled: Boolean(pinEnabled),
    needs_pin_setup: !pinEnabled,
  });
}

export default function DeviceSettings() {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [success, setSuccess] = useState('');
  const [e2eeStatus, setE2eeStatus] = useState(null);
  const [e2eeLocalSummary, setE2eeLocalSummary] = useState(null);
  const [resettingE2EE, setResettingE2EE] = useState(false);
  const [backupStatus, setBackupStatus] = useState(null);
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupConfirm, setBackupConfirm] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [savingBackup, setSavingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [deletingBackup, setDeletingBackup] = useState(false);

  useDocumentTitle('Устройство', device?.device_name || device?.name || '');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getDevice(deviceId);
      setDevice(res.data);
      if (res.data?.is_current) {
        const [statusRes, localSummary, backupRes] = await Promise.all([
          getE2EEStatus().catch(() => null),
          getCurrentLocalE2EEDeviceSummary(getStoredUser()).catch(() => null),
          getE2EEBackupStatus().catch(() => null),
        ]);
        setE2eeStatus(statusRes?.data || null);
        setE2eeLocalSummary(localSummary || null);
        setBackupStatus(backupRes?.data?.backup || (backupRes?.data?.exists ? backupRes.data : null));
      } else {
        setE2eeStatus(null);
        setE2eeLocalSummary(null);
        setBackupStatus(null);
      }
      setError('');
      setSuccess('');
    } catch (err) {
      console.error('Ошибка устройства:', err);
      setError(getApiErrorMessage(err, 'Не удалось загрузить устройство'));
      setDevice(null);
      setE2eeStatus(null);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    load();
  }, [load]);

  const pinLocked = device ? !device.is_current : false;

  const savePin = async () => {
    if (savingPin || pinLocked) return;
    if (pin.length !== 4 || pin !== confirmPin) {
      setError('Введите одинаковый PIN из 4 цифр');
      return;
    }
    try {
      setSavingPin(true);
      setError('');
      setSuccess('');
      await updateDevicePIN(deviceId, pin);
      setShowPinModal(false);
      setPin('');
      setConfirmPin('');
      setSuccess('PIN сохранён для этого устройства');
      syncStoredUserPin(deviceId, true);
      showToast('PIN сохранён', { tone: 'success' });
      await load();
    } catch (err) {
      console.error('Ошибка PIN:', err);
      setError(getApiErrorMessage(err, 'Не удалось сохранить PIN'));
    } finally {
      setSavingPin(false);
    }
  };

  const disablePin = async () => {
    if (savingPin || pinLocked) return;
    const confirmed = await confirmAction({
      title: 'Отключить PIN',
      message: 'Быстрый вход по PIN будет выключен только для этого устройства.',
      confirmLabel: 'Отключить',
      tone: 'warning',
    });
    if (!confirmed) return;
    try {
      setSavingPin(true);
      setError('');
      setSuccess('');
      await updateDevicePIN(deviceId, null);
      setSuccess('PIN отключён для этого устройства');
      syncStoredUserPin(deviceId, false);
      showToast('PIN отключён', { tone: 'success' });
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Не удалось отключить PIN'));
    } finally {
      setSavingPin(false);
    }
  };

  const rotateE2EE = async () => {
    if (!device?.is_current || resettingE2EE) return;
    const confirmed = await confirmAction({
      title: 'Сбросить E2EE-ключи',
      message: 'Для этого устройства будет создан новый набор ключей. Старые encrypted-сообщения, адресованные только старому ключу этого устройства, могут перестать расшифровываться здесь, но новые сообщения начнут идти на новый ключ.',
      confirmLabel: 'Сбросить ключи',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      setResettingE2EE(true);
      setError('');
      setSuccess('');
      const currentUser = getStoredUser();
      await resetCurrentE2EEDevice(currentUser);
      showToast('E2EE-ключи обновлены', { tone: 'success' });
      setSuccess('Для текущего устройства выпущены новые E2EE-ключи.');
      await load();
    } catch (err) {
      console.error('Ошибка сброса E2EE:', err);
      setError(getApiErrorMessage(err, 'Не удалось обновить E2EE-ключи'));
    } finally {
      setResettingE2EE(false);
    }
  };


  const saveEncryptedBackup = async () => {
    if (!device?.is_current || savingBackup) return;
    if (backupPassphrase.trim().length < 8) {
      setError('Для E2EE backup нужна парольная фраза минимум из 8 символов');
      return;
    }
    if (backupPassphrase !== backupConfirm) {
      setError('Парольные фразы для E2EE backup не совпадают');
      return;
    }
    try {
      setSavingBackup(true);
      setError('');
      setSuccess('');
      const currentUser = getStoredUser();
      await createEncryptedE2EEBackup(currentUser, backupPassphrase);
      setBackupPassphrase('');
      setBackupConfirm('');
      showToast('Зашифрованный E2EE backup сохранён', { tone: 'success' });
      setSuccess('Зашифрованный E2EE backup обновлён и сохранён на сервере.');
      await load();
    } catch (err) {
      console.error('Ошибка E2EE backup:', err);
      setError(getApiErrorMessage(err, err?.message || 'Не удалось сохранить E2EE backup'));
    } finally {
      setSavingBackup(false);
    }
  };

  const restoreBackup = async () => {
    if (!device?.is_current || restoringBackup) return;
    if (restorePassphrase.trim().length < 8) {
      setError('Введите парольную фразу для восстановления E2EE backup');
      return;
    }
    const confirmed = await confirmAction({
      title: 'Восстановить E2EE-ключи из backup',
      message: 'Текущий локальный набор E2EE-ключей будет заменён восстановленной копией. После этого устройство заново зарегистрирует E2EE bundle.',
      confirmLabel: 'Восстановить',
      tone: 'warning',
    });
    if (!confirmed) return;
    try {
      setRestoringBackup(true);
      setError('');
      setSuccess('');
      const currentUser = getStoredUser();
      await restoreEncryptedE2EEBackup(currentUser, restorePassphrase);
      setRestorePassphrase('');
      showToast('E2EE backup восстановлен', { tone: 'success' });
      setSuccess('Локальные E2EE-ключи восстановлены из зашифрованного backup.');
      await load();
    } catch (err) {
      console.error('Ошибка восстановления E2EE backup:', err);
      setError(getApiErrorMessage(err, err?.message || 'Не удалось восстановить E2EE backup'));
    } finally {
      setRestoringBackup(false);
    }
  };

  const deleteBackup = async () => {
    if (!device?.is_current || deletingBackup || !backupStatus) return;
    const confirmed = await confirmAction({
      title: 'Удалить E2EE backup',
      message: 'Серверная зашифрованная копия ключей будет удалена. Без неё перенос или восстановление ключей станет сложнее.',
      confirmLabel: 'Удалить backup',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      setDeletingBackup(true);
      setError('');
      setSuccess('');
      await deleteEncryptedE2EEBackup();
      setBackupStatus(null);
      showToast('E2EE backup удалён', { tone: 'success' });
      setSuccess('Серверная зашифрованная копия E2EE-ключей удалена.');
    } catch (err) {
      console.error('Ошибка удаления E2EE backup:', err);
      setError(getApiErrorMessage(err, err?.message || 'Не удалось удалить E2EE backup'));
    } finally {
      setDeletingBackup(false);
    }
  };

  const remove = async () => {
    const confirmed = await confirmAction({
      title: device?.is_current ? 'Удалить текущее устройство' : 'Удалить устройство',
      message: device?.is_current
        ? 'После удаления этого устройства вы сразу выйдете из аккаунта.'
        : 'Устройство будет удалено из доверенных.',
      confirmLabel: device?.is_current ? 'Выйти и удалить' : 'Удалить',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      setRemoving(true);
      setError('');
      const res = await removeDevice(deviceId);
      if (res.data?.removed_current || device?.is_current) {
        logout();
        return;
      }
      showToast('Устройство удалено', { tone: 'success' });
      navigate('/settings/devices');
    } catch (err) {
      console.error('Ошибка удаления:', err);
      setError(getApiErrorMessage(err, 'Не удалось удалить устройство'));
    } finally {
      setRemoving(false);
    }
  };

  const trusted = useMemo(() => {
    if (!device) return false;
    return typeof device.trust_is_active === 'boolean'
      ? device.trust_is_active
      : (device.expires_at ? new Date(device.expires_at) > new Date() : false);
  }, [device]);

  if (loading) return <div className="pa-loading">Загружаю устройство…</div>;

  if (!device) {
    return (
      <div className="pa-empty pa-card pa-settings-empty-card">
        <div className="pa-empty-icon">🔒</div>
        <h3>Устройство не найдено</h3>
        <p>{error || 'Попробуйте вернуться к списку устройств.'}</p>
        <div className="pa-action-row" style={{ marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="pa-primary-btn" onClick={() => navigate('/settings/devices')}>К устройствам</button>
          <button className="pa-secondary-btn" onClick={load}>Повторить</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pa-list pa-settings-page">
      <PostAuthHero
        className="pa-settings-hero pa-settings-detail-hero"
        badge={<div className="pa-discovery-badge">Защита устройства</div>}
        title={device.device_name || 'Неизвестное устройство'}
        titleTag="h1"
        text="Настрой короткий PIN, следи за доверием DFSN и отключай устройство, если больше не хочешь держать его в списке доверенных."
        stats={[
          { key: 'pin', value: device.pin_enabled ? 'ON' : 'OFF', label: 'PIN', tone: 'accent' },
          { key: 'trust', value: trusted ? 'OK' : '—', label: 'доверие', tone: trusted ? 'green' : 'warning' },
          { key: 'current', value: device.is_current ? 'Да' : 'Нет', label: 'текущее', tone: device.is_current ? 'blue' : 'neutral' },
          { key: 'ip', value: device.ip || '—', label: 'IP', tone: 'neutral' },
        ]}
        actions={<button className="pa-link-btn" onClick={() => navigate('/settings/devices')}>← Назад к устройствам</button>}
        visual={<div className="pa-settings-hero-orb"><span>{deviceEmoji(device.device_name)}</span></div>}
      >
        <div className="pa-pill-row" style={{ marginTop: 10 }}>
          {device.is_current && <span className="pa-pill blue">Текущее устройство</span>}
          <span className={`pa-pill ${device.pin_enabled ? 'blue' : 'neutral'}`}>{device.pin_enabled ? 'PIN включён' : 'PIN не настроен'}</span>
          <span className={`pa-pill ${trusted ? 'green' : 'warning'}`}>{trusted ? 'Доверие активно' : 'Доверие истекло'}</span>
        </div>
      </PostAuthHero>

      {success && (
        <PostAuthNoticeCard
          className="pa-settings-success-card"
          tone="success"
          icon="✅"
          title="Готово"
          text={success}
        />
      )}
      {error && !showPinModal && (
        <PostAuthNoticeCard
          className="pa-settings-error-card"
          tone="danger"
          icon="⚠️"
          title="Нужна проверка"
          text={error}
        />
      )}

      {pinLocked && (
        <PostAuthNoticeCard
          className="pa-settings-info-card"
          tone="info"
          icon="🔒"
          title="PIN можно менять только на текущем устройстве"
          text="Для beta-версии мы ограничили настройку PIN только активной сессией. Это уменьшает риск случайно включить быстрый вход на другом устройстве."
        />
      )}

      <div className="pa-grid-2 pa-settings-detail-grid">
        <section className="pa-card pa-settings-panel">
          <div className="pa-settings-panel-head">
            <div>
              <div className="pa-section-title">Быстрый вход по PIN</div>
              <div className="pa-bio" style={{ marginTop: 6 }}>
                Сохрани 4-значный код для быстрого входа именно на этом устройстве.
              </div>
            </div>
            <div className="pa-pill-row">
              <span className={`pa-pill ${device.pin_enabled ? 'blue' : 'neutral'}`}>{device.pin_enabled ? 'PIN активен' : 'PIN выключен'}</span>
            </div>
          </div>
          <div className="pa-postauth-summary-grid pa-settings-meta-grid" style={{ marginTop: 12 }}>
            <PostAuthSummaryCard
              className="pa-settings-meta-card"
              title="Режим"
              text={device.pin_enabled ? 'Быстрый вход включён' : 'Только полный вход'}
              badge={<span className={`pa-pill ${device.pin_enabled ? 'blue' : 'neutral'}`}>{device.pin_enabled ? 'PIN ON' : 'PIN OFF'}</span>}
            />
            <PostAuthSummaryCard
              className="pa-settings-meta-card"
              title="Риск"
              text={device.is_current ? 'Низкий — личное устройство' : 'Проверь перед включением PIN'}
              badge={<span className={`pa-pill ${device.is_current ? 'green' : 'warning'}`}>{device.is_current ? 'Личное' : 'Проверить'}</span>}
            />
          </div>
          <div className="pa-action-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <button
              className="pa-primary-btn"
              onClick={() => {
                setShowPinModal(true);
                setError('');
                setPin('');
                setConfirmPin('');
              }}
              disabled={savingPin || pinLocked}
            >
              {device.pin_enabled ? 'Изменить PIN' : 'Установить PIN'}
            </button>
            {device.pin_enabled && (
              <button className="pa-secondary-btn" onClick={disablePin} disabled={savingPin || pinLocked}>
                {savingPin ? 'Сохраняю…' : 'Отключить PIN'}
              </button>
            )}
          </div>
        </section>

        <section className="pa-card pa-settings-panel">
          <div className="pa-section-title">Сведения об устройстве</div>
          <PostAuthMetaGrid
            className="pa-settings-meta-grid"
            itemClassName="pa-settings-meta-card"
            labelClassName="pa-settings-meta-label"
            valueClassName="pa-settings-meta-value"
            items={[
              { key: 'last', label: 'Последний вход', value: device.last_used ? new Date(device.last_used).toLocaleString('ru-RU') : '—' },
              { key: 'ip', label: 'IP-адрес', value: device.ip || '—' },
              { key: 'name', label: 'Имя устройства', value: device.device_name || '—' },
              { key: 'dfsn', label: 'DFSN', value: device.trusted_by_dfsn ? 'Подтверждено' : 'Не использовалось' },
              { key: 'expires', label: 'Доверие до', value: device.expires_at ? new Date(device.expires_at).toLocaleString('ru-RU') : '—' },
            ]}
          />
          <PostAuthNoticeCard
            className="pa-settings-info-card"
            tone="info"
            title="User-Agent"
            text={device.user_agent || '—'}
          />
        </section>
      </div>

      {device.is_current && (
        <section className="pa-card pa-settings-panel">
          <div className="pa-settings-panel-head">
            <div>
              <div className="pa-section-title">E2EE-ключи устройства</div>
              <div className="pa-bio" style={{ marginTop: 6 }}>
                Для личных чатов это устройство использует отдельный набор end-to-end ключей. При подозрении на компрометацию их можно перевыпустить.
              </div>
            </div>
            <div className="pa-pill-row">
              <span className={`pa-pill ${e2eeStatus?.current_device_registered ? 'green' : 'warning'}`}>{e2eeStatus?.current_device_registered ? 'E2EE активно' : 'Нужна регистрация'}</span>
            </div>
          </div>
          <PostAuthMetaGrid
            className="pa-settings-meta-grid"
            itemClassName="pa-settings-meta-card"
            labelClassName="pa-settings-meta-label"
            valueClassName="pa-settings-meta-value"
            items={[
              { key: 'device', label: 'Device ID', value: e2eeStatus?.current_device_id || device.device_id || '—' },
              { key: 'prekeys', label: 'One-time prekeys', value: e2eeStatus?.current_device?.available_one_time_prekeys ?? '—' },
              { key: 'alg', label: 'Алгоритм', value: e2eeStatus?.current_device?.algorithm || 'p256-e2ee-v1' },
              { key: 'seen', label: 'Обновление', value: e2eeStatus?.current_device?.updated_at ? new Date(e2eeStatus.current_device.updated_at).toLocaleString('ru-RU') : '—' },
              { key: 'fingerprint', label: 'Fingerprint', value: e2eeLocalSummary?.fingerprint_formatted || '—' },
            ]}
          />
          <div className="pa-action-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <button className="pa-secondary-btn" onClick={load} disabled={loading || resettingE2EE}>Обновить статус</button>
            <button className="pa-danger-btn" onClick={rotateE2EE} disabled={resettingE2EE}>
              {resettingE2EE ? 'Перевыпускаю…' : 'Перевыпустить E2EE-ключи'}
            </button>
          </div>
        </section>
      )}


      {device.is_current && (
        <section className="pa-card pa-settings-panel">
          <div className="pa-settings-panel-head">
            <div>
              <div className="pa-section-title">Зашифрованный backup E2EE-ключей</div>
              <div className="pa-bio" style={{ marginTop: 6 }}>
                Создай зашифрованную копию identity-ключей и trust-данных, чтобы восстановить E2EE после очистки браузера или перенести его на новое устройство через парольную фразу.
              </div>
            </div>
            <div className="pa-pill-row">
              <span className={`pa-pill ${backupStatus ? 'green' : 'warning'}`}>{backupStatus ? 'Backup есть' : 'Backup не создан'}</span>
            </div>
          </div>
          <PostAuthMetaGrid
            className="pa-settings-meta-grid"
            itemClassName="pa-settings-meta-card"
            labelClassName="pa-settings-meta-label"
            valueClassName="pa-settings-meta-value"
            items={[
              { key: 'state', label: 'Статус', value: backupStatus ? 'Зашифрованная копия на сервере' : 'Нет сохранённой копии' },
              { key: 'updated', label: 'Обновлён', value: backupStatus?.updated_at ? new Date(backupStatus.updated_at).toLocaleString('ru-RU') : '—' },
              { key: 'source', label: 'Источник', value: backupStatus?.source_device_id || e2eeStatus?.current_device_id || '—' },
              { key: 'restored', label: 'Последнее восстановление', value: backupStatus?.last_restored_at ? new Date(backupStatus.last_restored_at).toLocaleString('ru-RU') : '—' },
            ]}
          />
          <div className="pa-grid-2 pa-settings-detail-grid" style={{ marginTop: 12 }}>
            <section className="pa-card pa-settings-input-card" style={{ padding: 14 }}>
              <div className="pa-meta">Создать или обновить backup</div>
              <div className="pa-bio" style={{ marginTop: 6 }}>Эта парольная фраза не отправляется на сервер и нужна только для локального шифрования копии.</div>
              <div className="pa-list" style={{ marginTop: 10 }}>
                <input className="pa-input" type="password" value={backupPassphrase} placeholder="Парольная фраза (минимум 8 символов)" onChange={(e) => setBackupPassphrase(e.target.value)} />
                <input className="pa-input" type="password" value={backupConfirm} placeholder="Повтори парольную фразу" onChange={(e) => setBackupConfirm(e.target.value)} />
              </div>
              <div className="pa-action-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <button className="pa-primary-btn" onClick={saveEncryptedBackup} disabled={savingBackup}>{savingBackup ? 'Сохраняю…' : (backupStatus ? 'Обновить backup' : 'Создать backup')}</button>
                {backupStatus && <button className="pa-danger-btn" onClick={deleteBackup} disabled={deletingBackup}>{deletingBackup ? 'Удаляю…' : 'Удалить backup'}</button>}
              </div>
            </section>
            <section className="pa-card pa-settings-input-card" style={{ padding: 14 }}>
              <div className="pa-meta">Восстановить на этом устройстве</div>
              <div className="pa-bio" style={{ marginTop: 6 }}>Используй парольную фразу, чтобы восстановить сохранённую E2EE-копию и заново зарегистрировать устройство.</div>
              <div className="pa-list" style={{ marginTop: 10 }}>
                <input className="pa-input" type="password" value={restorePassphrase} placeholder="Парольная фраза для восстановления" onChange={(e) => setRestorePassphrase(e.target.value)} />
              </div>
              <div className="pa-action-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <button className="pa-secondary-btn" onClick={restoreBackup} disabled={restoringBackup || !backupStatus}>{restoringBackup ? 'Восстанавливаю…' : 'Восстановить E2EE backup'}</button>
              </div>
            </section>
          </div>
        </section>
      )}

      <section className="pa-card pa-settings-danger-card">
        <div className="pa-settings-panel-head">
          <div>
            <div className="pa-section-title">Удаление устройства</div>
            <div className="pa-bio" style={{ marginTop: 6 }}>
              {device.is_current
                ? 'Если удалить текущее устройство, ты сразу выйдешь из аккаунта и доверие будет сброшено.'
                : 'После удаления при следующем входе потребуется полная проверка безопасности.'}
            </div>
          </div>
          <span className="pa-pill red">Опасное действие</span>
        </div>
        <div className="pa-action-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button className="pa-danger-btn" onClick={remove} disabled={removing}>
            {removing ? 'Удаляю…' : (device.is_current ? 'Выйти и удалить устройство' : 'Удалить устройство')}
          </button>
          <button className="pa-secondary-btn" onClick={() => navigate('/settings/devices')}>Вернуться к списку</button>
        </div>
      </section>

      {showPinModal && (
        <div className="pa-overlay" onClick={() => !savingPin && setShowPinModal(false)}>
          <div className="pa-modal-wrap" onClick={(e) => e.stopPropagation()}>
            <div className="pa-modal pa-settings-modal">
              <div className="pa-discovery-badge">Быстрый вход</div>
              <div className="pa-section-title" style={{ marginTop: 10 }}>{device.pin_enabled ? 'Измени PIN-код' : 'Установи PIN-код'}</div>
              <div className="pa-bio" style={{ marginTop: 8 }}>
                Используй 4 цифры, которые легко запомнить, но трудно угадать. Этот PIN будет работать только на текущем устройстве.
              </div>
              <div className="pa-list" style={{ marginTop: 12 }}>
                <label className="pa-card pa-settings-input-card" style={{ padding: 12 }}>
                  <div className="pa-meta">PIN-код</div>
                  <input
                    className="pa-input"
                    type="password"
                    inputMode="numeric"
                    maxLength="4"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
                <label className="pa-card pa-settings-input-card" style={{ padding: 12 }}>
                  <div className="pa-meta">Подтверждение</div>
                  <input
                    className="pa-input"
                    type="password"
                    inputMode="numeric"
                    maxLength="4"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
                {error && <div className="pa-pill red">{error}</div>}
              </div>
              <div className="pa-action-row" style={{ justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
                <button className="pa-secondary-btn" onClick={() => setShowPinModal(false)} disabled={savingPin}>Отмена</button>
                <button className="pa-primary-btn" onClick={savePin} disabled={savingPin}>{savingPin ? 'Сохраняю…' : 'Сохранить PIN'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

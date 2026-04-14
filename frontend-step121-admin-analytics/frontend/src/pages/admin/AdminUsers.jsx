import { useEffect, useMemo, useState } from 'react';
import {
  getAdminUsers,
  getMe,
  makeAdmin,
  removeAdmin,
  makeModerator,
  removeModerator,
  searchUsers,
  confirmAction,
  showToast,
} from '../../services/api';
import { canAccessAdminPanel } from '../../services/permissions';

function initials(user) {
  return `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}` || 'U';
}

function resolveRole(user) {
  if (user?.is_admin || user?.role === 'admin') return 'admin';
  if (user?.role === 'moderator') return 'moderator';
  return 'member';
}

function roleLabel(role) {
  if (role === 'admin') return 'Администратор';
  if (role === 'moderator') return 'Модератор';
  return 'Пользователь';
}

export default function AdminUsers() {
  const [admins, setAdmins] = useState([]);
  const [moderators, setModerators] = useState([]);
  const [ownerId, setOwnerId] = useState(1);
  const [currentUser, setCurrentUser] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');

  const privilegedMap = useMemo(() => {
    const map = new Map();
    [...admins, ...moderators].forEach((user) => map.set(user.id, resolveRole(user)));
    return map;
  }, [admins, moderators]);

  useEffect(() => {
    let ignore = false;
    const bootstrap = async () => {
      try {
        const me = await getMe();
        if (ignore) return;
        setCurrentUser(me.data);
        const allowed = canAccessAdminPanel(me.data);
        setIsAdmin(allowed);
        if (!allowed) {
          setError('У вас нет доступа к управлению ролями.');
        } else {
          await loadPrivilegedUsers();
        }
      } catch (err) {
        if (!ignore) setError(err.response?.data?.error || 'Не удалось проверить доступ');
      } finally {
        if (!ignore) setAccessChecked(true);
      }
    };
    bootstrap();
    return () => { ignore = true; };
  }, []);

  const loadPrivilegedUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getAdminUsers();
      setAdmins(Array.isArray(res.data?.admins) ? res.data.admins : []);
      setModerators(Array.isArray(res.data?.moderators) ? res.data.moderators : []);
      setOwnerId(Number(res.data?.owner_id) || 1);
    } catch (err) {
      console.error('Ошибка загрузки ролей:', err);
      setError(err.response?.data?.error || 'Не удалось загрузить список ролей');
    } finally {
      setLoading(false);
    }
  };

  const search = async () => {
    if (!query.trim()) return setResults([]);
    try {
      setError('');
      const res = await searchUsers(query.trim());
      setResults(Array.isArray(res.data?.users) ? res.data.users : []);
    } catch (err) {
      console.error('Ошибка поиска:', err);
      setError(err.response?.data?.error || 'Не удалось выполнить поиск');
    }
  };

  const runRoleAction = async ({ title, message, confirmLabel, action, successMessage }) => {
    const confirmed = await confirmAction({ title, message, confirmLabel, tone: 'warning' });
    if (!confirmed) return;
    try {
      setBusy(true);
      await action();
      await loadPrivilegedUsers();
      await search();
      showToast(successMessage, { tone: 'success' });
    } catch (err) {
      console.error('Ошибка изменения роли:', err);
      setError(err.response?.data?.error || 'Не удалось обновить роль');
    } finally {
      setBusy(false);
    }
  };

  const handleMakeAdmin = async (user) => runRoleAction({
    title: 'Назначить администратора',
    message: `Пользователь @${user.username} получит полный административный доступ.`,
    confirmLabel: 'Назначить',
    action: () => makeAdmin(user.id),
    successMessage: `@${user.username} назначен администратором`,
  });

  const handleRemoveAdmin = async (user) => runRoleAction({
    title: 'Снять права администратора',
    message: `Пользователь @${user.username} перестанет быть администратором.`,
    confirmLabel: 'Снять права',
    action: () => removeAdmin(user.id),
    successMessage: `Права администратора сняты у @${user.username}`,
  });

  const handleMakeModerator = async (user) => runRoleAction({
    title: 'Назначить модератора',
    message: `Пользователь @${user.username} сможет обрабатывать жалобы и обращения.`,
    confirmLabel: 'Назначить',
    action: () => makeModerator(user.id),
    successMessage: `@${user.username} назначен модератором`,
  });

  const handleRemoveModerator = async (user) => runRoleAction({
    title: 'Снять права модератора',
    message: `Пользователь @${user.username} перестанет быть модератором.`,
    confirmLabel: 'Снять права',
    action: () => removeModerator(user.id),
    successMessage: `Права модератора сняты у @${user.username}`,
  });

  if (!accessChecked) {
    return <div className="pa-loading">Проверяю доступ…</div>;
  }

  if (!isAdmin) {
    return <div className="pa-empty pa-card"><h3>Доступ ограничен</h3><p>{error || 'Эта секция доступна только администраторам.'}</p></div>;
  }

  const renderUserCard = (user, mode = 'search') => {
    const role = privilegedMap.get(user.id) || resolveRole(user);
    const isOwner = Number(user.id) === Number(ownerId) || Boolean(user.is_owner);
    const isSelf = Number(user.id) === Number(currentUser?.id);

    return (
      <div key={user.id} className="pa-admin-item">
        <div className="pa-admin-row" style={{ alignItems: 'flex-start' }}>
          <div className="pa-inline-row">
            <div className="pa-avatar-sm">{initials(user)}</div>
            <div className="pa-admin-main">
              <div className="pa-name">{user.first_name} {user.last_name}</div>
              <div className="pa-handle">@{user.username}</div>
              <div className="pa-pill-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <span className={`pa-pill ${role === 'admin' ? 'warning' : role === 'moderator' ? 'blue' : 'neutral'}`}>{roleLabel(role)}</span>
                {isOwner && <span className="pa-pill accent">Владелец системы</span>}
                {isSelf && <span className="pa-pill green">Это вы</span>}
              </div>
            </div>
          </div>
          <div className="pa-inline-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {role !== 'admin' && (
              <button className="pa-primary-btn" onClick={() => handleMakeAdmin(user)} disabled={busy}>Сделать админом</button>
            )}
            {role === 'admin' && !isOwner && !isSelf && (
              <button className="pa-danger-btn" onClick={() => handleRemoveAdmin(user)} disabled={busy}>Снять admin</button>
            )}
            {role !== 'moderator' && role !== 'admin' && (
              <button className="pa-secondary-btn" onClick={() => handleMakeModerator(user)} disabled={busy}>Сделать модератором</button>
            )}
            {role === 'moderator' && (
              <button className="pa-danger-btn" onClick={() => handleRemoveModerator(user)} disabled={busy}>Снять moderator</button>
            )}
          </div>
        </div>
        {mode === 'search' && role === 'member' && (
          <div className="pa-bio" style={{ marginTop: 10 }}>Назначьте роль только тем, кому действительно нужен доступ к жалобам, обращениям или административным действиям.</div>
        )}
      </div>
    );
  };

  return (
    <div className="pa-list">
      <section className="pa-card">
        <div className="pa-section-head" style={{ marginTop: 0 }}>
          <div className="pa-section-title">Управление ролями</div>
          <button className="pa-secondary-btn" onClick={loadPrivilegedUsers} disabled={busy}>Обновить</button>
        </div>
        <div className="pa-bio">Пользователь с id = 1 считается владельцем системы и всегда сохраняет права администратора. Назначать и снимать роли могут только действующие администраторы.</div>
        <div className="pa-action-row" style={{ marginTop: 12 }}>
          <label className="pa-search" style={{ marginTop: 0, flex: 1 }}>
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя или username" onKeyDown={(e) => e.key === 'Enter' && search()} />
          </label>
          <button className="pa-primary-btn" onClick={search} disabled={busy}>Найти</button>
        </div>
        {error && <div className="pa-error" style={{ marginTop: 12 }}>{error}</div>}
      </section>

      {results.length > 0 && (
        <section className="pa-card">
          <div className="pa-section-title">Результаты поиска</div>
          <div className="pa-list" style={{ marginTop: 12 }}>
            {results.map((user) => renderUserCard(user, 'search'))}
          </div>
        </section>
      )}

      <section className="pa-card">
        <div className="pa-section-head" style={{ marginTop: 0 }}>
          <div className="pa-section-title">Текущие администраторы</div>
          <div className="pa-section-meta">{admins.length}</div>
        </div>
        {loading ? <div className="pa-loading">Загружаю список…</div> : admins.length === 0 ? <div className="pa-empty"><h3>Список пуст</h3><p>Пока нет пользователей с правами администратора.</p></div> : (
          <div className="pa-list">
            {admins.map((admin) => renderUserCard(admin, 'list'))}
          </div>
        )}
      </section>

      <section className="pa-card">
        <div className="pa-section-head" style={{ marginTop: 0 }}>
          <div className="pa-section-title">Текущие модераторы</div>
          <div className="pa-section-meta">{moderators.length}</div>
        </div>
        {loading ? <div className="pa-loading">Загружаю список…</div> : moderators.length === 0 ? <div className="pa-empty"><h3>Пока нет модераторов</h3><p>Назначайте модераторов из поиска пользователей.</p></div> : (
          <div className="pa-list">
            {moderators.map((moderator) => renderUserCard(moderator, 'list'))}
          </div>
        )}
      </section>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAdminAnalytics, getApiErrorMessage, showToast } from '../../services/api';

function formatNumber(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat('ru-RU').format(num);
}

function formatDecimal(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: num % 1 === 0 ? 0 : 1 }).format(num);
}

function humanLabel(label) {
  const map = {
    public: 'Публичные',
    private: 'Приватные',
    pending: 'Ожидают',
    open: 'Открытые',
    resolved: 'Решённые',
    rejected: 'Отклонённые',
    closed: 'Закрытые',
    success: 'Успешно',
    failed: 'Неуспешно',
    suspicious: 'Подозрительные',
    uncertain: 'Неуверенные',
    trusted: 'Доверенные',
    unknown: 'Не указано',
  };
  return map[label] || label;
}

function MetricCard({ label, value, hint }) {
  return (
    <div className="pa-card fs-analytics-metric">
      <div className="fs-analytics-metric-label">{label}</div>
      <div className="fs-analytics-metric-value">{typeof value === 'number' ? formatNumber(value) : value}</div>
      {hint ? <div className="fs-analytics-metric-hint">{hint}</div> : null}
    </div>
  );
}

function BreakdownList({ items, emptyText = 'Данных пока нет' }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="pa-empty"><p>{emptyText}</p></div>;
  }
  return (
    <div className="pa-list">
      {items.map((item) => (
        <div className="pa-list-item fs-analytics-breakdown-item" key={`${item.label}-${item.count}`}>
          <span className="fs-analytics-breakdown-label">{humanLabel(item.label)}</span>
          <strong className="fs-analytics-breakdown-value">{formatNumber(item.count)}</strong>
        </div>
      ))}
    </div>
  );
}

function SeriesBars({ items, compact = false }) {
  const max = useMemo(() => Math.max(1, ...(Array.isArray(items) ? items.map((item) => Number(item.count || 0)) : [1])), [items]);
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="pa-empty"><p>История ещё не накопилась.</p></div>;
  }
  return (
    <div className={`fs-analytics-series ${compact ? 'compact' : ''}`.trim()}>
      {items.map((item) => {
        const count = Number(item.count || 0);
        const width = Math.max(4, Math.round((count / max) * 100));
        return (
          <div className="fs-analytics-series-row" key={`${item.label}-${item.count}`}>
            <div className="fs-analytics-series-label">{item.label}</div>
            <div className="fs-analytics-series-bar-wrap">
              <div className="fs-analytics-series-bar" style={{ width: `${width}%` }} />
            </div>
            <div className="fs-analytics-series-value">{formatNumber(count)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async (isManual = false) => {
    try {
      setError('');
      if (isManual) setRefreshing(true);
      else setLoading(true);
      const res = await getAdminAnalytics();
      setData(res.data || null);
      if (isManual) showToast('Аналитика обновлена', { tone: 'success' });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Не удалось загрузить аналитику'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoading(true);
        const res = await getAdminAnalytics();
        if (!ignore) setData(res.data || null);
      } catch (err) {
        if (!ignore) setError(getApiErrorMessage(err, 'Не удалось загрузить аналитику'));
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, []);

  const overview = data?.overview || {};
  const messaging = data?.messaging || {};
  const content = data?.content || {};
  const social = data?.social || {};
  const security = data?.security || {};
  const support = data?.support || {};
  const traffic = data?.traffic || {};
  const series = data?.series || {};
  const highlights = Array.isArray(data?.highlights) ? data.highlights : [];
  const quickHealth = data?.quick_health || {};

  if (loading) {
    return <div className="pa-loading">Собираю полную статистику…</div>;
  }

  return (
    <div className="pa-list fs-analytics-page">
      <section className="pa-card">
        <div className="pa-section-head" style={{ marginTop: 0 }}>
          <div>
            <div className="pa-section-title">Приватная аналитика проекта</div>
            <div className="pa-section-meta" style={{ marginTop: 6 }}>
              Срез на {data?.generated_at ? new Date(data.generated_at).toLocaleString('ru-RU') : 'сейчас'} · таймзона {data?.timezone || '—'}
            </div>
          </div>
          <button className="pa-secondary-btn" onClick={() => loadData(true)} disabled={refreshing}>
            {refreshing ? 'Обновляю…' : 'Обновить'}
          </button>
        </div>
        <div className="pa-bio" style={{ marginTop: 10 }}>
          Здесь собрана сводная статистика по пользователям, сообщениям, контенту, активности, устройствам, обращениям и поведенческому трафику. Страница доступна только администраторам.
        </div>
        {error ? <div className="pa-error" style={{ marginTop: 12 }}>{error}</div> : null}
      </section>

      {highlights.length > 0 && (
        <section className="fs-analytics-grid">
          {highlights.map((item) => (
            <MetricCard key={item.label} label={item.label} value={item.value} />
          ))}
        </section>
      )}

      <section className="pa-card">
        <div className="pa-section-title">Пользователи и рост</div>
        <div className="fs-analytics-grid" style={{ marginTop: 12 }}>
          <MetricCard label="Всего пользователей" value={overview.users_total} />
          <MetricCard label="Новых сегодня" value={overview.users_new_today} />
          <MetricCard label="Новых за 24 часа" value={overview.users_new_24h} />
          <MetricCard label="Новых за 7 дней" value={overview.users_new_7d} />
          <MetricCard label="Новых за 30 дней" value={overview.users_new_30d} />
          <MetricCard label="Приватных профилей" value={overview.users_private_total} />
          <MetricCard label="Пионеров" value={overview.users_pioneer_total} />
          <MetricCard label="DAU / WAU / MAU" value={`${formatNumber(overview.dau)}/${formatNumber(overview.wau)}/${formatNumber(overview.mau)}`} />
        </div>
        <div className="fs-analytics-two-col" style={{ marginTop: 16 }}>
          <div className="pa-list-item">
            <div className="pa-section-title">Регистрации за 14 дней</div>
            <SeriesBars items={series.registrations_14d} compact />
          </div>
          <div className="pa-list-item">
            <div className="pa-section-title">Роли</div>
            <div className="pa-pill-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <span className="pa-pill warning">Администраторы: {formatNumber(overview.admins_total)}</span>
              <span className="pa-pill blue">Модераторы: {formatNumber(overview.moderators_total)}</span>
              <span className="pa-pill accent">Рабочих задач: {formatNumber(overview.pending_work_items)}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="pa-card">
        <div className="pa-section-title">Сообщения и чаты</div>
        <div className="fs-analytics-grid" style={{ marginTop: 12 }}>
          <MetricCard label="Всего сообщений" value={messaging.messages_total} />
          <MetricCard label="За 24 часа" value={messaging.messages_24h} />
          <MetricCard label="Непрочитанных" value={messaging.messages_unread_total} />
          <MetricCard label="Зашифрованных" value={messaging.messages_encrypted_total} />
          <MetricCard label="С медиа" value={messaging.messages_with_media_total} />
          <MetricCard label="Всего чатов" value={messaging.chats_total} />
          <MetricCard label="Активных чатов 24ч" value={messaging.active_chats_24h} />
          <MetricCard label="Отправителей 24ч" value={messaging.unique_message_senders_24h} />
          <MetricCard label="Среднее на отправителя 24ч" value={formatDecimal(messaging.avg_messages_per_sender_24h)} />
        </div>
        <div className="pa-list-item" style={{ marginTop: 16 }}>
          <div className="pa-section-title">Сообщения за 14 дней</div>
          <SeriesBars items={series.messages_14d} compact />
        </div>
      </section>

      <section className="pa-card">
        <div className="pa-section-title">Контент и медиа</div>
        <div className="fs-analytics-grid" style={{ marginTop: 12 }}>
          <MetricCard label="Постов всего" value={content.posts_total} />
          <MetricCard label="Постов за 24ч" value={content.posts_24h} />
          <MetricCard label="Постов за 7д" value={content.posts_7d} />
          <MetricCard label="Постов в сообществах" value={content.community_posts_total} />
          <MetricCard label="Комментариев всего" value={content.comments_total} />
          <MetricCard label="Комментариев за 24ч" value={content.comments_24h} />
          <MetricCard label="Лайков всего" value={content.likes_total} />
          <MetricCard label="Лайков за 24ч" value={content.likes_24h} />
          <MetricCard label="Историй активных" value={content.stories_active} />
          <MetricCard label="Историй за 24ч" value={content.stories_24h} />
          <MetricCard label="Просмотров историй 24ч" value={content.story_views_24h} />
          <MetricCard label="Ответов на истории 24ч" value={content.story_replies_24h} />
          <MetricCard label="Коллекций" value={content.collections_total} />
          <MetricCard label="Элементов в коллекциях" value={content.collection_items_total} />
          <MetricCard label="Сохранённых постов" value={content.saved_posts_total} />
          <MetricCard label="Медиа-ассетов всего" value={content.media_assets_total} />
          <MetricCard label="Медиа-ассетов за 24ч" value={content.media_assets_24h} />
          <MetricCard label="Голосов по медиа" value={content.media_votes_total} />
          <MetricCard label="Комментариев к медиа" value={content.media_comments_total} />
        </div>
        <div className="pa-list-item" style={{ marginTop: 16 }}>
          <div className="pa-section-title">Посты за 14 дней</div>
          <SeriesBars items={series.posts_14d} compact />
        </div>
      </section>

      <section className="pa-card">
        <div className="pa-section-title">Социальный граф и сообщества</div>
        <div className="fs-analytics-grid" style={{ marginTop: 12 }}>
          <MetricCard label="Сообществ всего" value={social.communities_total} />
          <MetricCard label="Новых сообществ 24ч" value={social.communities_new_24h} />
          <MetricCard label="Участников сообществ" value={social.community_members_total} />
          <MetricCard label="Вступлений 24ч" value={social.community_joins_24h} />
          <MetricCard label="Дружб" value={social.friendships_total} />
          <MetricCard label="Новых дружб 24ч" value={social.friendships_new_24h} />
          <MetricCard label="Подписок" value={social.subscriptions_total} />
          <MetricCard label="Новых подписок 24ч" value={social.subscriptions_new_24h} />
          <MetricCard label="Поручительств" value={social.vouches_total} />
          <MetricCard label="Новых поручительств 24ч" value={social.vouches_24h} />
        </div>
        <div className="fs-analytics-two-col" style={{ marginTop: 16 }}>
          <div className="pa-list-item">
            <div className="pa-section-title">Типы сообществ</div>
            <BreakdownList items={social.communities_by_type} emptyText="Типы сообществ появятся после первых запусков." />
          </div>
          <div className="pa-list-item">
            <div className="pa-section-title">Быстрые доли</div>
            <div className="pa-pill-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <span className="pa-pill accent">Приватных сообществ: {quickHealth.private_community_share || '0%'}</span>
              <span className="pa-pill green">Зашифрованных сообщений: {quickHealth.encrypted_message_share || '0%'}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="pa-card">
        <div className="pa-section-title">Сессии, безопасность и устройства</div>
        <div className="fs-analytics-grid" style={{ marginTop: 12 }}>
          <MetricCard label="Сессий всего" value={security.auth_sessions_total} />
          <MetricCard label="Сессий активных" value={security.auth_sessions_active} />
          <MetricCard label="Сессий за 24ч" value={security.auth_sessions_new_24h} />
          <MetricCard label="Сессий отозвано" value={security.auth_sessions_revoked} />
          <MetricCard label="Сессий истекло" value={security.auth_sessions_expired} />
          <MetricCard label="Доверенных устройств" value={security.trusted_devices_total} />
          <MetricCard label="Новых устройств 24ч" value={security.trusted_devices_new_24h} />
          <MetricCard label="DFSN-доверенных" value={security.trusted_devices_dfsn} />
          <MetricCard label="PIN включён" value={security.pin_enabled_devices} />
          <MetricCard label="E2EE-устройств" value={security.e2ee_devices_total} />
          <MetricCard label="Доступных prekey" value={security.e2ee_prekeys_available} />
          <MetricCard label="Бэкапов ключей" value={security.e2ee_backups_total} />
          <MetricCard label="Неисп. backup codes" value={security.backup_codes_unused} />
          <MetricCard label="Push-подписок" value={security.push_subscriptions_total} />
        </div>
        <div className="pa-pill-row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
          <span className="pa-pill green">Доля DFSN-доверия: {quickHealth.trusted_device_share || '0%'}</span>
        </div>
      </section>

      <section className="pa-card">
        <div className="pa-section-title">Поддержка и модерация</div>
        <div className="fs-analytics-grid" style={{ marginTop: 12 }}>
          <MetricCard label="Жалоб всего" value={support.reports_total} />
          <MetricCard label="Жалоб за 24ч" value={support.reports_new_24h} />
          <MetricCard label="Жалоб pending" value={support.reports_pending} />
          <MetricCard label="Тикетов всего" value={support.tickets_total} />
          <MetricCard label="Тикетов за 24ч" value={support.tickets_new_24h} />
          <MetricCard label="Тикетов open" value={support.tickets_open} />
          <MetricCard label="Recovery-заявок всего" value={support.recovery_requests_total} />
          <MetricCard label="Recovery за 24ч" value={support.recovery_requests_24h} />
          <MetricCard label="Recovery pending" value={support.recovery_requests_pending} />
        </div>
        <div className="fs-analytics-two-col" style={{ marginTop: 16 }}>
          <div className="pa-list-item">
            <div className="pa-section-title">Статусы жалоб</div>
            <BreakdownList items={support.report_statuses} />
          </div>
          <div className="pa-list-item">
            <div className="pa-section-title">Статусы тикетов</div>
            <BreakdownList items={support.ticket_statuses} />
          </div>
        </div>
      </section>

      <section className="pa-card">
        <div className="pa-section-title">Трафик и поведенческая активность</div>
        <div className="fs-analytics-grid" style={{ marginTop: 12 }}>
          <MetricCard label="Behavior events всего" value={traffic.behavior_events_total} />
          <MetricCard label="Behavior events 24ч" value={traffic.behavior_events_24h} />
          <MetricCard label="Уникальных пользователей 24ч" value={traffic.behavior_unique_users_24h} />
          <MetricCard label="Уникальных маршрутов 24ч" value={traffic.behavior_unique_routes_24h} />
          <MetricCard label="Новых device flags 24ч" value={traffic.behavior_new_devices_24h} />
          <MetricCard label="Подозрительных сессий 24ч" value={traffic.behavior_suspicious_sessions_24h} />
          <MetricCard label="Неуверенных сессий 24ч" value={traffic.behavior_uncertain_sessions_24h} />
          <MetricCard label="Среднее событий на пользователя" value={formatDecimal(traffic.avg_events_per_user_24h)} />
          <MetricCard label="Уведомлений всего" value={traffic.notifications_total} />
          <MetricCard label="Непрочитанных уведомлений" value={traffic.notifications_unread_total} />
          <MetricCard label="Уведомлений за 24ч" value={traffic.notifications_24h} />
        </div>
        <div className="fs-analytics-two-col" style={{ marginTop: 16 }}>
          <div className="pa-list-item">
            <div className="pa-section-title">Топ маршрутов за 24 часа</div>
            <BreakdownList items={traffic.top_routes_24h} emptyText="Маршруты появятся после активности пользователей." />
          </div>
          <div className="pa-list-item">
            <div className="pa-section-title">Исходы аутентификации за 7 дней</div>
            <BreakdownList items={traffic.auth_outcomes_7d} emptyText="Пока нет данных по исходам." />
            <div className="pa-pill-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <span className="pa-pill green">Успешных входов: {formatNumber(quickHealth.auth_success_7d || 0)}</span>
              <span className="pa-pill warning">Доля suspicious: {quickHealth.suspicious_session_share || '0%'}</span>
            </div>
          </div>
        </div>
        <div className="fs-analytics-two-col" style={{ marginTop: 16 }}>
          <div className="pa-list-item">
            <div className="pa-section-title">Trust labels за 7 дней</div>
            <BreakdownList items={traffic.trust_labels_7d} emptyText="Trust labels ещё не накопились." />
          </div>
          <div className="pa-list-item">
            <div className="pa-section-title">Почасовая активность за 24 часа</div>
            <SeriesBars items={traffic.hourly_activity_24h} compact />
          </div>
        </div>
      </section>

      <section className="pa-card">
        <div className="pa-section-title">Сессии за 14 дней</div>
        <div style={{ marginTop: 12 }}>
          <SeriesBars items={series.sessions_14d} compact />
        </div>
      </section>
    </div>
  );
}

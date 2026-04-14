package handlers

import (
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"friendscape/internal/database"
	"github.com/gin-gonic/gin"
)

type AdminAnalyticsHandler struct{}

func NewAdminAnalyticsHandler() *AdminAnalyticsHandler {
	return &AdminAnalyticsHandler{}
}

type analyticsCountPair struct {
	Label string `json:"label"`
	Count int64  `json:"count"`
}

type analyticsSeriesPoint struct {
	Label string `json:"label"`
	Count int64  `json:"count"`
}

type analyticsTimeBucket struct {
	Bucket string `json:"bucket"`
	Count  int64  `json:"count"`
}

type analyticsLabelCountRow struct {
	Label string `gorm:"column:label"`
	Count int64  `gorm:"column:count"`
}

func analyticsLocation() *time.Location {
	candidates := []string{
		strings.TrimSpace(os.Getenv("APP_TIMEZONE")),
		strings.TrimSpace(os.Getenv("DB_TIMEZONE")),
		"Europe/Vilnius",
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		loc, err := time.LoadLocation(candidate)
		if err == nil {
			return loc
		}
	}
	return time.Local
}

func countTable(table string, where string, args ...any) int64 {
	var count int64
	query := database.DB.Table(table)
	if strings.TrimSpace(where) != "" {
		query = query.Where(where, args...)
	}
	if err := query.Count(&count).Error; err != nil {
		return 0
	}
	return count
}

func countDistinct(table string, column string, where string, args ...any) int64 {
	var count int64
	query := database.DB.Table(table)
	if strings.TrimSpace(where) != "" {
		query = query.Where(where, args...)
	}
	if err := query.Distinct(column).Count(&count).Error; err != nil {
		return 0
	}
	return count
}

func countByLabel(query string, args ...any) []analyticsCountPair {
	rows := make([]analyticsLabelCountRow, 0)
	if err := database.DB.Raw(query, args...).Scan(&rows).Error; err != nil {
		return []analyticsCountPair{}
	}
	result := make([]analyticsCountPair, 0, len(rows))
	for _, row := range rows {
		label := strings.TrimSpace(row.Label)
		if label == "" {
			label = "unknown"
		}
		result = append(result, analyticsCountPair{Label: label, Count: row.Count})
	}
	return result
}

func buildDailySeries(table string, column string, days int, loc *time.Location) []analyticsSeriesPoint {
	if days <= 0 {
		return []analyticsSeriesPoint{}
	}
	start := time.Now().In(loc).AddDate(0, 0, -(days - 1))
	start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, loc)
	query := fmt.Sprintf(`
        SELECT to_char(date_trunc('day', %s AT TIME ZONE ?), 'YYYY-MM-DD') AS label, COUNT(*)::bigint AS count
        FROM %s
        WHERE %s >= ?
        GROUP BY 1
        ORDER BY 1 ASC
    `, column, table, column)
	rows := make([]analyticsLabelCountRow, 0)
	if err := database.DB.Raw(query, loc.String(), start.UTC()).Scan(&rows).Error; err != nil {
		return []analyticsSeriesPoint{}
	}
	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.Label] = row.Count
	}
	series := make([]analyticsSeriesPoint, 0, days)
	for i := 0; i < days; i++ {
		day := start.AddDate(0, 0, i)
		label := day.Format("2006-01-02")
		series = append(series, analyticsSeriesPoint{Label: label, Count: counts[label]})
	}
	return series
}

func buildHourlySeries(table string, column string, since time.Time, loc *time.Location) []analyticsTimeBucket {
	query := fmt.Sprintf(`
        SELECT to_char(date_trunc('hour', %s AT TIME ZONE ?), 'YYYY-MM-DD HH24:00') AS bucket, COUNT(*)::bigint AS count
        FROM %s
        WHERE %s >= ?
        GROUP BY 1
        ORDER BY 1 ASC
    `, column, table, column)
	rows := make([]analyticsLabelCountRow, 0)
	if err := database.DB.Raw(query, loc.String(), since.UTC()).Scan(&rows).Error; err != nil {
		return []analyticsTimeBucket{}
	}
	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.Label] = row.Count
	}
	start := since.In(loc).Truncate(time.Hour)
	series := make([]analyticsTimeBucket, 0, 25)
	for i := 0; i <= 24; i++ {
		hour := start.Add(time.Duration(i) * time.Hour)
		label := hour.Format("2006-01-02 15:00")
		series = append(series, analyticsTimeBucket{Bucket: label, Count: counts[label]})
	}
	return series
}

func firstCountByLabel(items []analyticsCountPair, key string) int64 {
	for _, item := range items {
		if strings.EqualFold(item.Label, key) {
			return item.Count
		}
	}
	return 0
}

func sumCounts(items []analyticsCountPair) int64 {
	var total int64
	for _, item := range items {
		total += item.Count
	}
	return total
}

func topN(items []analyticsCountPair, n int) []analyticsCountPair {
	if n <= 0 || len(items) == 0 {
		return []analyticsCountPair{}
	}
	copied := append([]analyticsCountPair(nil), items...)
	sort.SliceStable(copied, func(i, j int) bool {
		if copied[i].Count == copied[j].Count {
			return copied[i].Label < copied[j].Label
		}
		return copied[i].Count > copied[j].Count
	})
	if len(copied) > n {
		copied = copied[:n]
	}
	return copied
}

func (h *AdminAnalyticsHandler) GetOverview(c *gin.Context) {
	loc := analyticsLocation()
	now := time.Now().In(loc)
	nowUTC := now.UTC()
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	yesterday := now.Add(-24 * time.Hour)
	last7d := now.AddDate(0, 0, -7)
	last30d := now.AddDate(0, 0, -30)

	usersTotal := countTable("users", "")
	usersNewToday := countTable("users", "created_at >= ?", startOfToday.UTC())
	usersNew24h := countTable("users", "created_at >= ?", yesterday.UTC())
	usersNew7d := countTable("users", "created_at >= ?", last7d.UTC())
	usersNew30d := countTable("users", "created_at >= ?", last30d.UTC())
	privateUsers := countTable("users", "is_private = ?", true)
	pioneerUsers := countTable("users", "is_pioneer = ?", true)
	adminUsers := countTable("users", "is_admin = ?", true)
	moderatorUsers := countTable("users", "role = ? AND is_admin = ?", "moderator", false)

	dau := countDistinct("auth_sessions", "user_id", "last_seen >= ?", yesterday.UTC())
	wau := countDistinct("auth_sessions", "user_id", "last_seen >= ?", last7d.UTC())
	mau := countDistinct("auth_sessions", "user_id", "last_seen >= ?", last30d.UTC())

	messagesTotal := countTable("messages", "")
	messages24h := countTable("messages", "created_at >= ?", yesterday.UTC())
	messagesEncrypted := countTable("messages", "is_encrypted = ?", true)
	messagesUnread := countTable("messages", "is_read = ?", false)
	messagesWithMedia := countTable("messages", "COALESCE(media_url, '') <> ''")
	uniqueMessageSenders24h := countDistinct("messages", "from_user_id", "created_at >= ?", yesterday.UTC())

	chatsTotal := countTable("chats", "")
	activeChats24h := countDistinct("messages", "LEAST(from_user_id, to_user_id)::text || ':' || GREATEST(from_user_id, to_user_id)::text", "created_at >= ?", yesterday.UTC())

	postsTotal := countTable("posts", "")
	posts24h := countTable("posts", "created_at >= ?", yesterday.UTC())
	posts7d := countTable("posts", "created_at >= ?", last7d.UTC())
	communityPostsTotal := countTable("posts", "community_id IS NOT NULL")
	commentsTotal := countTable("comments", "")
	comments24h := countTable("comments", "created_at >= ?", yesterday.UTC())
	likesTotal := countTable("likes", "")
	likes24h := countTable("likes", "created_at >= ?", yesterday.UTC())
	savesTotal := countTable("save_posts", "")
	collectionsTotal := countTable("collections", "")
	collectionItemsTotal := countTable("collection_items", "")

	storiesTotal := countTable("stories", "")
	stories24h := countTable("stories", "created_at >= ?", yesterday.UTC())
	storiesActive := countTable("stories", "expires_at > ?", nowUTC)
	storyViews24h := countTable("story_views", "viewed_at >= ?", yesterday.UTC())
	storyReplies24h := countTable("story_replies", "created_at >= ?", yesterday.UTC())

	communitiesTotal := countTable("communities", "")
	communities24h := countTable("communities", "created_at >= ?", yesterday.UTC())
	communitiesPrivate := countTable("communities", "is_private = ?", true)
	communityMembersTotal := countTable("community_members", "")
	communityJoins24h := countTable("community_members", "created_at >= ?", yesterday.UTC())

	friendshipsAccepted := countTable("friendships", "status = ?", "accepted")
	friendships24h := countTable("friendships", "status = ? AND updated_at >= ?", "accepted", yesterday.UTC())
	subscriptionsTotal := countTable("subscriptions", "")
	subscriptions24h := countTable("subscriptions", "created_at >= ?", yesterday.UTC())
	vouchesTotal := countTable("vouches", "")
	vouches24h := countTable("vouches", "created_at >= ?", yesterday.UTC())

	notificationsTotal := countTable("notifications", "")
	notificationsUnread := countTable("notifications", "is_read = ?", false)
	notifications24h := countTable("notifications", "created_at >= ?", yesterday.UTC())
	pushSubscriptionsTotal := countTable("push_subscriptions", "")

	sessionsTotal := countTable("auth_sessions", "")
	sessionsActive := countTable("auth_sessions", "revoked_at IS NULL AND expires_at > ?", nowUTC)
	sessions24h := countTable("auth_sessions", "created_at >= ?", yesterday.UTC())
	sessionsRevoked := countTable("auth_sessions", "revoked_at IS NOT NULL")
	sessionsExpired := countTable("auth_sessions", "expires_at <= ?", nowUTC)

	trustedDevicesTotal := countTable("trusted_devices", "")
	trustedByDFSN := countTable("trusted_devices", "trusted_by_dfsn = ?", true)
	pinEnabledDevices := countTable("trusted_devices", "pin_enabled = ?", true)
	trustedDevices24h := countTable("trusted_devices", "created_at >= ?", yesterday.UTC())
	e2eeDevicesTotal := countTable("e2ee_devices", "revoked_at IS NULL")
	oneTimePrekeysTotal := countTable("e2ee_one_time_pre_keys", "claimed_at IS NULL")
	keyBackupsTotal := countTable("e2ee_key_backups", "")
	backupCodesUnused := countTable("backup_codes", "used = ?", false)

	reportsTotal := countTable("moderation_reports", "")
	reports24h := countTable("moderation_reports", "created_at >= ?", yesterday.UTC())
	reportsPending := countTable("moderation_reports", "status = ?", "pending")
	ticketsTotal := countTable("support_tickets", "")
	tickets24h := countTable("support_tickets", "created_at >= ?", yesterday.UTC())
	ticketsOpen := countTable("support_tickets", "status = ?", "open")
	recoveryRequestsTotal := countTable("recovery_requests", "")
	recoveryRequests24h := countTable("recovery_requests", "created_at >= ?", yesterday.UTC())
	recoveryPending := countTable("recovery_requests", "status = ?", "pending")

	behaviorEventsTotal := countTable("behavioral_data", "")
	behaviorEvents24h := countTable("behavioral_data", "created_at >= ?", yesterday.UTC())
	behaviorUsers24h := countDistinct("behavioral_data", "user_id", "created_at >= ?", yesterday.UTC())
	uniqueRoutes24h := countDistinct("behavioral_data", "route_name", "created_at >= ?", yesterday.UTC())
	newDevicesBehavior24h := countTable("behavioral_data", "created_at >= ? AND new_device = ?", yesterday.UTC(), true)
	suspiciousSessions24h := countTable("behavioral_data", "created_at >= ? AND session_trust_label = ?", yesterday.UTC(), "suspicious")
	uncertainSessions24h := countTable("behavioral_data", "created_at >= ? AND session_trust_label = ?", yesterday.UTC(), "uncertain")

	mediaAssetsTotal := countTable("media_assets", "")
	mediaAssets24h := countTable("media_assets", "created_at >= ?", yesterday.UTC())
	mediaVotesTotal := countTable("media_votes", "")
	mediaCommentsTotal := countTable("media_comments", "")
	mediaReportsTotal := countTable("media_reports", "")

	routeBreakdown24h := topN(countByLabel(`
        SELECT COALESCE(NULLIF(route_name, ''), 'unknown') AS label, COUNT(*)::bigint AS count
        FROM behavioral_data
        WHERE created_at >= ?
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 10
    `, yesterday.UTC()), 10)

	authOutcome7d := countByLabel(`
        SELECT COALESCE(NULLIF(auth_outcome_label, ''), 'unknown') AS label, COUNT(*)::bigint AS count
        FROM behavioral_data
        WHERE created_at >= ?
        GROUP BY 1
        ORDER BY count DESC, label ASC
    `, last7d.UTC())

	trustLabels7d := countByLabel(`
        SELECT COALESCE(NULLIF(session_trust_label, ''), 'unknown') AS label, COUNT(*)::bigint AS count
        FROM behavioral_data
        WHERE created_at >= ?
        GROUP BY 1
        ORDER BY count DESC, label ASC
    `, last7d.UTC())

	reportStatuses := countByLabel(`
        SELECT COALESCE(NULLIF(status, ''), 'unknown') AS label, COUNT(*)::bigint AS count
        FROM moderation_reports
        GROUP BY 1
        ORDER BY count DESC, label ASC
    `)

	ticketStatuses := countByLabel(`
        SELECT COALESCE(NULLIF(status, ''), 'unknown') AS label, COUNT(*)::bigint AS count
        FROM support_tickets
        GROUP BY 1
        ORDER BY count DESC, label ASC
    `)

	communitiesByType := []analyticsCountPair{
		{Label: "public", Count: communitiesTotal - communitiesPrivate},
		{Label: "private", Count: communitiesPrivate},
	}

	registrations14d := buildDailySeries("users", "created_at", 14, loc)
	messages14d := buildDailySeries("messages", "created_at", 14, loc)
	posts14d := buildDailySeries("posts", "created_at", 14, loc)
	sessions14d := buildDailySeries("auth_sessions", "created_at", 14, loc)
	hourlyActivity24h := buildHourlySeries("behavioral_data", "created_at", yesterday, loc)

	avgMessagesPerSender24h := 0.0
	if uniqueMessageSenders24h > 0 {
		avgMessagesPerSender24h = float64(messages24h) / float64(uniqueMessageSenders24h)
	}

	avgEventsPerBehaviorUser24h := 0.0
	if behaviorUsers24h > 0 {
		avgEventsPerBehaviorUser24h = float64(behaviorEvents24h) / float64(behaviorUsers24h)
	}

	pendingWorkItems := reportsPending + ticketsOpen + recoveryPending

	c.JSON(http.StatusOK, gin.H{
		"generated_at": now.Format(time.RFC3339),
		"timezone":     loc.String(),
		"overview": gin.H{
			"users_total":         usersTotal,
			"users_new_today":     usersNewToday,
			"users_new_24h":       usersNew24h,
			"users_new_7d":        usersNew7d,
			"users_new_30d":       usersNew30d,
			"users_private_total": privateUsers,
			"users_pioneer_total": pioneerUsers,
			"admins_total":        adminUsers,
			"moderators_total":    moderatorUsers,
			"dau":                 dau,
			"wau":                 wau,
			"mau":                 mau,
			"pending_work_items":  pendingWorkItems,
		},
		"messaging": gin.H{
			"messages_total":              messagesTotal,
			"messages_24h":                messages24h,
			"messages_unread_total":       messagesUnread,
			"messages_encrypted_total":    messagesEncrypted,
			"messages_with_media_total":   messagesWithMedia,
			"active_chats_24h":            activeChats24h,
			"unique_message_senders_24h":  uniqueMessageSenders24h,
			"avg_messages_per_sender_24h": avgMessagesPerSender24h,
			"chats_total":                 chatsTotal,
		},
		"content": gin.H{
			"posts_total":            postsTotal,
			"posts_24h":              posts24h,
			"posts_7d":               posts7d,
			"community_posts_total":  communityPostsTotal,
			"comments_total":         commentsTotal,
			"comments_24h":           comments24h,
			"likes_total":            likesTotal,
			"likes_24h":              likes24h,
			"stories_total":          storiesTotal,
			"stories_24h":            stories24h,
			"stories_active":         storiesActive,
			"story_views_24h":        storyViews24h,
			"story_replies_24h":      storyReplies24h,
			"collections_total":      collectionsTotal,
			"collection_items_total": collectionItemsTotal,
			"saved_posts_total":      savesTotal,
			"media_assets_total":     mediaAssetsTotal,
			"media_assets_24h":       mediaAssets24h,
			"media_votes_total":      mediaVotesTotal,
			"media_comments_total":   mediaCommentsTotal,
			"media_reports_total":    mediaReportsTotal,
		},
		"social": gin.H{
			"communities_total":       communitiesTotal,
			"communities_new_24h":     communities24h,
			"community_members_total": communityMembersTotal,
			"community_joins_24h":     communityJoins24h,
			"friendships_total":       friendshipsAccepted,
			"friendships_new_24h":     friendships24h,
			"subscriptions_total":     subscriptionsTotal,
			"subscriptions_new_24h":   subscriptions24h,
			"vouches_total":           vouchesTotal,
			"vouches_24h":             vouches24h,
			"communities_by_type":     communitiesByType,
		},
		"security": gin.H{
			"auth_sessions_total":      sessionsTotal,
			"auth_sessions_active":     sessionsActive,
			"auth_sessions_new_24h":    sessions24h,
			"auth_sessions_revoked":    sessionsRevoked,
			"auth_sessions_expired":    sessionsExpired,
			"trusted_devices_total":    trustedDevicesTotal,
			"trusted_devices_new_24h":  trustedDevices24h,
			"trusted_devices_dfsn":     trustedByDFSN,
			"pin_enabled_devices":      pinEnabledDevices,
			"e2ee_devices_total":       e2eeDevicesTotal,
			"e2ee_prekeys_available":   oneTimePrekeysTotal,
			"e2ee_backups_total":       keyBackupsTotal,
			"backup_codes_unused":      backupCodesUnused,
			"push_subscriptions_total": pushSubscriptionsTotal,
		},
		"support": gin.H{
			"reports_total":             reportsTotal,
			"reports_new_24h":           reports24h,
			"reports_pending":           reportsPending,
			"report_statuses":           reportStatuses,
			"tickets_total":             ticketsTotal,
			"tickets_new_24h":           tickets24h,
			"tickets_open":              ticketsOpen,
			"ticket_statuses":           ticketStatuses,
			"recovery_requests_total":   recoveryRequestsTotal,
			"recovery_requests_24h":     recoveryRequests24h,
			"recovery_requests_pending": recoveryPending,
		},
		"traffic": gin.H{
			"behavior_events_total":            behaviorEventsTotal,
			"behavior_events_24h":              behaviorEvents24h,
			"behavior_unique_users_24h":        behaviorUsers24h,
			"behavior_unique_routes_24h":       uniqueRoutes24h,
			"behavior_new_devices_24h":         newDevicesBehavior24h,
			"behavior_suspicious_sessions_24h": suspiciousSessions24h,
			"behavior_uncertain_sessions_24h":  uncertainSessions24h,
			"avg_events_per_user_24h":          avgEventsPerBehaviorUser24h,
			"notifications_total":              notificationsTotal,
			"notifications_unread_total":       notificationsUnread,
			"notifications_24h":                notifications24h,
			"top_routes_24h":                   routeBreakdown24h,
			"auth_outcomes_7d":                 authOutcome7d,
			"trust_labels_7d":                  trustLabels7d,
			"hourly_activity_24h":              hourlyActivity24h,
		},
		"series": gin.H{
			"registrations_14d": registrations14d,
			"messages_14d":      messages14d,
			"posts_14d":         posts14d,
			"sessions_14d":      sessions14d,
		},
		"highlights": []gin.H{
			{"label": "Новых пользователей сегодня", "value": usersNewToday},
			{"label": "Сообщений за 24 часа", "value": messages24h},
			{"label": "Активных пользователей за 24 часа", "value": dau},
			{"label": "Открытых тикетов и жалоб", "value": pendingWorkItems},
			{"label": "Активных историй сейчас", "value": storiesActive},
			{"label": "Новых сообществ за 24 часа", "value": communities24h},
		},
		"quick_health": gin.H{
			"report_pending_ratio":     fmt.Sprintf("%d/%d", reportsPending, maxInt64(reportsTotal, 1)),
			"ticket_open_ratio":        fmt.Sprintf("%d/%d", ticketsOpen, maxInt64(ticketsTotal, 1)),
			"encrypted_message_share":  percentage(messagesEncrypted, maxInt64(messagesTotal, 1)),
			"private_community_share":  percentage(communitiesPrivate, maxInt64(communitiesTotal, 1)),
			"trusted_device_share":     percentage(trustedByDFSN, maxInt64(trustedDevicesTotal, 1)),
			"suspicious_session_share": percentage(suspiciousSessions24h, maxInt64(sumCounts(trustLabels7d), 1)),
			"auth_success_7d":          firstCountByLabel(authOutcome7d, "success"),
		},
	})
}

func maxInt64(value int64, fallback int64) int64 {
	if value <= 0 {
		return fallback
	}
	return value
}

func percentage(part int64, total int64) string {
	if total <= 0 {
		return "0%"
	}
	return fmt.Sprintf("%.1f%%", (float64(part)/float64(total))*100)
}

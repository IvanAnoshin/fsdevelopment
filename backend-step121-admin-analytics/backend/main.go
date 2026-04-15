package main

import (
	"context"
	"crypto/subtle"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"friendscape/internal/access"
	"friendscape/internal/auth"
	"friendscape/internal/database"
	"friendscape/internal/handlers"
	"friendscape/internal/media"
	"friendscape/internal/middleware"
	"friendscape/internal/models"
	"friendscape/internal/observability"
	"friendscape/utils"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	appVersion := getEnv("APP_VERSION", "dev")
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️ .env файл не найден, используются переменные окружения")
	}

	validateEnvironment()

	appEnv := getAppEnv()
	if appEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	auth.InitJWT()
	utils.InitVAPID()
	database.Connect()
	if err := access.EnsureBootstrapOwnerAccount(); err != nil {
		log.Printf("⚠️ Не удалось выдать bootstrap-admin владельцу: %v", err)
	}
	startMessageMediaMaintenance()

	r := gin.New()
	if err := r.SetTrustedProxies(parseTrustedProxies()); err != nil {
		log.Fatal("❌ Ошибка настройки trusted proxies:", err)
	}
	r.Use(observability.RequestContextMiddleware())
	r.Use(observability.RequestLoggerMiddleware(map[string]struct{}{
		"/api/auth/login":    {},
		"/api/auth/register": {},
	}))
	r.Use(observability.RecoveryMiddleware())

	r.Use(func(c *gin.Context) {
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Header("Cross-Origin-Opener-Policy", "same-origin")
		c.Header("Cross-Origin-Resource-Policy", "same-site")
		c.Header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		if appEnv == "production" {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		handlers.EnsureClientDeviceID(c)
		maxBodyBytes := int64(2 << 20)
		if strings.HasPrefix(c.Request.URL.Path, "/api/media/upload-message") {
			maxBodyBytes = 26 << 20
		} else if strings.HasPrefix(c.Request.URL.Path, "/api/media/upload") {
			maxBodyBytes = 12 << 20
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
		c.Next()
	})

	rateLimiter := middleware.NewRateLimiter(100, time.Minute)

	allowedOrigins := parseAllowedOrigins()
	corsConfig := cors.Config{
		AllowOrigins:     allowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "Accept", "X-Admin-Bootstrap-Token", "X-Requested-With", "X-E2EE-Device-ID", "X-Client-Device-ID"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
	}
	if len(allowedOrigins) == 1 && allowedOrigins[0] == "*" {
		corsConfig.AllowAllOrigins = true
		corsConfig.AllowOrigins = nil
		corsConfig.AllowCredentials = false
	}
	r.Use(cors.New(corsConfig))

	r.Use(rateLimiter.RateLimit())

	authHandler := handlers.NewAuthHandler()
	postHandler := handlers.NewPostHandler()
	friendHandler := handlers.NewFriendHandler()
	messageHandler := handlers.NewMessageHandler()
	searchHandler := handlers.NewSearchHandler()
	notificationHandler := handlers.NewNotificationHandler()
	vouchHandler := handlers.NewVouchHandler()
	recoveryHandler := handlers.NewRecoveryHandler()
	adminHandler := handlers.NewAdminHandler()
	adminUsersHandler := handlers.NewAdminUsersHandler()
	adminAnalyticsHandler := handlers.NewAdminAnalyticsHandler()
	behaviorHandler := handlers.NewBehaviorHandler()
	deviceHandler := handlers.NewDeviceHandler()
	eventsHandler := handlers.NewEventsHandler()
	chatWSHandler := handlers.NewChatWSHandler()
	callsConfigHandler := handlers.NewCallsConfigHandler()
	mediaHandler := handlers.NewMediaHandler()
	mediaInteractionHandler := handlers.NewMediaInteractionHandler()
	collectionHandler := handlers.NewCollectionHandler()
	e2eeHandler := handlers.NewE2EEHandler()
	storyHandler := handlers.NewStoryHandler()
	communityHandler := handlers.NewCommunityHandler()
	moderationHandler := handlers.NewModerationHandler()

	serverPort := getEnv("PORT", "8080")
	publicAppURL := getEnv("APP_PUBLIC_URL", "")
	r.MaxMultipartMemory = 12 << 20

	// Локальная раздача оптимизированного медиа-контента
	r.Static("/media", media.NewStorage().RootDir())

	// Служебные маршруты
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "friendscape-backend",
			"env":     appEnv,
			"version": appVersion,
		})
	})
	r.GET("/readyz", readinessHandler)
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "friendscape-backend",
			"env":     appEnv,
			"version": appVersion,
		})
	})
	r.GET("/version", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"service": "friendscape-backend", "env": appEnv, "version": appVersion})
	})
	r.GET("/api/version", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"service": "friendscape-backend", "env": appEnv, "version": appVersion})
	})
	r.GET("/api/ready", readinessHandler)

	// Публичные маршруты
	auth := r.Group("/api/auth")
	{
		auth.POST("/register", authHandler.Register)
		auth.POST("/login", authHandler.Login)
		auth.POST("/login-with-backup-code", authHandler.LoginWithBackupCode)
		auth.POST("/verify-security", authHandler.VerifySecurityAnswer)
		auth.POST("/get-security-question", authHandler.GetSecurityQuestion)
		auth.POST("/recovery", authHandler.Recovery)
		auth.POST("/refresh", authHandler.RefreshSession)
		auth.POST("/reset-password", middleware.TempAuthMiddleware(), authHandler.ResetPassword)

		// Восстановление
		auth.POST("/recovery-request", recoveryHandler.CreateRecoveryRequest)
		auth.GET("/recovery-status/:code", recoveryHandler.GetRecoveryStatus)
		auth.POST("/recovery-submit-answers", recoveryHandler.SubmitAnswers)
		auth.GET("/recovery-questions/:code", recoveryHandler.GenerateRecoveryQuestions)
		auth.POST("/recovery-complete", recoveryHandler.CompleteRecoverySetup)

		// VAPID публичный ключ для push-уведомлений
		auth.GET("/vapid-public-key", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"public_key": utils.GetVAPIDPublicKey(),
			})
		})
	}

	// Realtime stream (SSE only with short-lived realtime ticket)
	r.GET("/api/events/stream", eventsHandler.Stream)
	// Chat realtime over WebSocket
	r.GET("/api/ws/chat", chatWSHandler.Stream)

	// Защищённые маршруты
	api := r.Group("/api")
	api.Use(middleware.AuthMiddleware())
	{
		// Профиль
		api.GET("/me", authHandler.GetMe)
		api.PUT("/profile", authHandler.UpdateProfile)
		api.GET("/users/:id", authHandler.GetUser)
		api.GET("/users/:id/online-status", authHandler.GetUserOnlineStatus)

		// Безопасность
		api.POST("/auth/logout", authHandler.Logout)
		api.POST("/auth/logout-all", authHandler.LogoutAll)
		api.POST("/realtime-ticket", authHandler.CreateRealtimeTicket)
		api.GET("/e2ee/status", e2eeHandler.GetStatus)
		api.GET("/e2ee/devices", e2eeHandler.GetDevices)
		api.POST("/e2ee/devices/register", e2eeHandler.RegisterDevice)
		api.POST("/e2ee/devices/reset-current", e2eeHandler.ResetCurrentDevice)
		api.DELETE("/e2ee/devices/:deviceId", e2eeHandler.RevokeDevice)
		api.GET("/e2ee/prekeys/:userId", e2eeHandler.GetPreKeyBundle)
		api.GET("/e2ee/backup/status", e2eeHandler.GetBackupStatus)
		api.GET("/e2ee/backup/download", e2eeHandler.DownloadBackup)
		api.PUT("/e2ee/backup", e2eeHandler.UpsertBackup)
		api.POST("/e2ee/backup/restore-complete", e2eeHandler.MarkBackupRestored)
		api.DELETE("/e2ee/backup", e2eeHandler.DeleteBackup)
		api.POST("/setup-security", authHandler.SetupSecurity)
		api.POST("/setup-dfsn", authHandler.SetupDFSN)

		// Посты
		api.POST("/posts", postHandler.CreatePost)
		api.GET("/feed", postHandler.GetFeed)
		api.GET("/feed/preferences", postHandler.ListFeedPreferences)
		api.POST("/feed/preferences", postHandler.SaveFeedPreference)
		api.DELETE("/feed/preferences/:id", postHandler.DeleteFeedPreference)
		api.GET("/users/:id/posts", postHandler.GetUserPosts)
		api.GET("/users/:id/media", mediaHandler.GetUserMedia)
		api.POST("/posts/:id/like", postHandler.LikePost)
		api.DELETE("/posts/:id/like", postHandler.UnlikePost)
		api.POST("/posts/:id/comments", postHandler.AddComment)
		api.GET("/posts/:id/comments", postHandler.GetComments)
		api.POST("/comments/:id/vote", postHandler.VoteComment)
		api.PUT("/comments/:id", postHandler.UpdateComment)
		api.DELETE("/comments/:id", postHandler.DeleteComment)
		api.GET("/posts/:id", postHandler.GetPost)
		api.DELETE("/posts/:id", postHandler.DeletePost)

		// Друзья и подписки
		api.POST("/friends/:id/request", friendHandler.SendFriendRequest)
		api.POST("/friends/:id/accept", friendHandler.AcceptFriendRequest)
		api.DELETE("/friends/:id/reject", friendHandler.RejectFriendRequest)
		api.DELETE("/friends/:id", friendHandler.Unfriend)
		api.GET("/users/:id/friends", friendHandler.GetFriends)
		api.GET("/users/:id/friends/count", friendHandler.GetFriendsCount)
		api.GET("/friends/requests", friendHandler.GetFriendRequests)
		api.POST("/users/:id/subscribe", friendHandler.Subscribe)
		api.DELETE("/users/:id/subscribe", friendHandler.Unsubscribe)
		api.GET("/users/:id/subscribers", friendHandler.GetSubscribers)
		api.GET("/users/:id/subscribers/count", friendHandler.GetSubscribersCount)
		api.GET("/users/:id/subscriptions", friendHandler.GetSubscriptions)
		api.GET("/users/:id/subscriptions/count", friendHandler.GetSubscriptionsCount)
		api.GET("/friendship/:id", friendHandler.CheckFriendship)

		// Сообщения
		api.GET("/calls/config", callsConfigHandler.GetConfig)
		api.POST("/messages/:id", messageHandler.SendMessage)
		api.GET("/messages/:id", messageHandler.GetMessages)
		api.GET("/chats", messageHandler.GetChats)
		api.GET("/messages/unread/count", messageHandler.GetUnreadCount)
		api.POST("/messages/:id/read", messageHandler.MarkConversationRead)
		api.DELETE("/messages/:id", messageHandler.DeleteMessage)
		api.PUT("/messages/:id", messageHandler.UpdateMessage)

		// Поиск
		api.GET("/search/users", searchHandler.SearchUsers)
		api.GET("/search/posts", searchHandler.SearchPosts)
		api.GET("/search/communities", searchHandler.SearchCommunities)

		// Сообщества
		api.GET("/communities", communityHandler.ListCommunities)
		api.POST("/communities", communityHandler.CreateCommunity)
		api.GET("/communities/:id", communityHandler.GetCommunity)
		api.POST("/communities/:id/join", communityHandler.JoinCommunity)
		api.DELETE("/communities/:id/leave", communityHandler.LeaveCommunity)
		api.GET("/communities/:id/posts", communityHandler.GetCommunityPosts)
		api.POST("/communities/:id/posts", communityHandler.CreateCommunityPost)

		// Stories
		api.GET("/stories", storyHandler.ListStories)
		api.POST("/stories", storyHandler.CreateStory)
		api.POST("/stories/:id/view", storyHandler.ViewStory)
		api.GET("/stories/:id/replies", storyHandler.ListReplies)
		api.POST("/stories/:id/replies", storyHandler.AddReply)
		api.POST("/stories/:id/extend", storyHandler.ExtendStory)
		api.DELETE("/stories/:id", storyHandler.DeleteStory)

		// Жалобы и обращения
		api.POST("/reports/posts/:id", moderationHandler.CreatePostReport)
		api.POST("/support/tickets", moderationHandler.CreateSupportTicket)
		api.GET("/support/tickets", moderationHandler.GetMySupportTickets)

		// Уведомления
		api.GET("/notifications", notificationHandler.GetNotifications)
		api.GET("/notifications/unread/count", notificationHandler.GetUnreadCount)
		api.PUT("/notifications/:id/read", notificationHandler.MarkAsRead)
		api.PUT("/notifications/read-all", notificationHandler.MarkAllAsRead)

		// Поручительства
		api.POST("/vouch/:id", vouchHandler.VouchForUser)
		api.DELETE("/vouch/:id", vouchHandler.UnvouchForUser)
		api.GET("/users/:id/vouches", vouchHandler.GetUserVouches)

		// DFSN
		api.POST("/behavior/update", behaviorHandler.UpdateBehavior)
		api.POST("/behavior/batch", behaviorHandler.UpdateBehaviorBatch)

		// Push-уведомления
		api.POST("/push-subscribe", recoveryHandler.SavePushSubscription)

		// Устройства
		api.GET("/devices", deviceHandler.GetDevices)
		api.GET("/devices/:deviceId", deviceHandler.GetDevice)
		api.PUT("/devices/:deviceId/pin", deviceHandler.UpdateDevicePIN)
		api.DELETE("/devices/:deviceId", deviceHandler.RemoveDevice)

		// Сохранённое и подборки
		api.GET("/collections", collectionHandler.GetCollections)
		api.POST("/collections", collectionHandler.CreateCollection)
		api.PUT("/collections/:id", collectionHandler.UpdateCollection)
		api.DELETE("/collections/:id", collectionHandler.DeleteCollection)
		api.GET("/collections/:id/items", collectionHandler.GetCollectionItems)
		api.POST("/collections/:id/items", collectionHandler.AddCollectionItem)
		api.DELETE("/collections/:id/items/:itemId", collectionHandler.DeleteCollectionItem)

		// Медиа-пайплайн (точка роста для CDN/object storage)
		api.GET("/media/config", mediaHandler.GetConfig)
		api.POST("/media/presign", mediaHandler.CreateUploadDraft)
		api.POST("/media/upload", mediaHandler.UploadImage)
		api.POST("/media/upload-message", mediaHandler.UploadMessageMedia)
		api.POST("/media/upload-message-encrypted", mediaHandler.UploadEncryptedMessageMedia)
		api.GET("/media/interactions", mediaInteractionHandler.GetContext)
		api.POST("/media/interactions/vote", mediaInteractionHandler.Vote)
		api.POST("/media/interactions/comments", mediaInteractionHandler.Comment)
		api.POST("/media/interactions/report", mediaInteractionHandler.Report)

		// Тестовый эндпоинт для отправки push
		api.POST("/test-push", func(c *gin.Context) {
			userID, _ := c.Get("user_id")

			var subs []models.PushSubscription
			database.DB.Where("user_id = ?", userID).Find(&subs)

			for _, sub := range subs {
				go utils.SendPushNotification(&sub,
					"🔔 Тест уведомлений",
					"Если вы это видите — push работает!",
					"/feed")
			}

			c.JSON(http.StatusOK, gin.H{"message": "Отправлено"})
		})
	}

	// Админские маршруты для заявок на восстановление
	admin := r.Group("/api/admin")
	admin.Use(middleware.AuthMiddleware())
	admin.Use(middleware.RequirePermission(access.PermissionRecoveryReview))
	{
		admin.GET("/recovery-requests", adminHandler.GetPendingRecoveryRequests)
		admin.GET("/recovery-requests/:id", adminHandler.GetRecoveryRequestDetails)
		admin.POST("/recovery-requests/:id/approve", adminHandler.ApproveRecoveryRequest)
		admin.POST("/recovery-requests/:id/reject", adminHandler.RejectRecoveryRequest)
	}

	// Админские маршруты для модерации жалоб и обращений
	adminModeration := r.Group("/api/admin/moderation")
	adminModeration.Use(middleware.AuthMiddleware())
	adminModeration.Use(middleware.RequirePermission(access.PermissionUsersModerate))
	{
		adminModeration.GET("/reports", moderationHandler.GetAdminReports)
		adminModeration.PUT("/reports/:id", moderationHandler.UpdateAdminReport)
		adminModeration.GET("/tickets", moderationHandler.GetAdminTickets)
		adminModeration.PUT("/tickets/:id", moderationHandler.UpdateAdminTicket)
	}

	// Админские маршруты для управления пользователями
	adminUsers := r.Group("/api/admin/users")
	adminUsers.Use(middleware.AuthMiddleware())
	adminUsers.Use(middleware.AdminMiddleware())
	{
		adminUsers.GET("/", adminUsersHandler.GetAdminUsers)
		adminUsers.POST("/:id/make-admin", adminUsersHandler.MakeAdmin)
		adminUsers.POST("/:id/remove-admin", adminUsersHandler.RemoveAdmin)
		adminUsers.POST("/:id/make-moderator", adminUsersHandler.MakeModerator)
		adminUsers.POST("/:id/remove-moderator", adminUsersHandler.RemoveModerator)
	}

	adminAnalytics := r.Group("/api/admin/analytics")
	adminAnalytics.Use(middleware.AuthMiddleware())
	adminAnalytics.Use(middleware.AdminMiddleware())
	{
		adminAnalytics.GET("/overview", adminAnalyticsHandler.GetOverview)
	}

	adminData := r.Group("/api/admin")
	adminData.Use(middleware.AuthMiddleware())
	adminData.Use(middleware.AdminMiddleware())
	{
		adminData.GET("/behavior/export", behaviorHandler.ExportCompactDataset)
	}

	if strings.EqualFold(getEnv("ENABLE_DEV_ADMIN_ROUTE", "false"), "true") {
		log.Println("⚠️ Включён bootstrap-маршрут /api/make-me-admin")
		bootstrap := r.Group("/api")
		bootstrap.Use(middleware.AuthMiddleware())
		bootstrap.POST("/make-me-admin", func(c *gin.Context) {
			bootstrapToken := strings.TrimSpace(os.Getenv("ADMIN_BOOTSTRAP_TOKEN"))
			providedToken := strings.TrimSpace(c.GetHeader("X-Admin-Bootstrap-Token"))
			if bootstrapToken == "" || subtle.ConstantTimeCompare([]byte(providedToken), []byte(bootstrapToken)) != 1 {
				c.JSON(http.StatusForbidden, gin.H{"error": "Недостаточно прав для bootstrap-доступа"})
				return
			}

			userID, ok := c.Get("user_id")
			if !ok {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
				return
			}

			var user models.User
			if err := database.DB.First(&user, userID).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь не найден"})
				return
			}
			if user.IsAdmin {
				c.JSON(http.StatusOK, gin.H{"message": "Пользователь уже является администратором", "username": user.Username})
				return
			}

			if err := database.DB.Model(&user).Updates(map[string]any{"is_admin": true, "role": access.RoleAdmin}).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось назначить администратора"})
				return
			}

			log.Printf("🔐 Bootstrap: пользователь %s (id=%d) назначен администратором", user.Username, user.ID)
			c.JSON(http.StatusOK, gin.H{"message": "Права администратора выданы текущему пользователю", "username": user.Username})
		})
	}

	if publicAppURL != "" {
		log.Printf("🌐 Public app URL: %s", publicAppURL)
	}
	log.Printf("🌿 Environment: %s", appEnv)
	log.Printf("🚀 Сервер Friendscape запущен на :%s", serverPort)

	srv := &http.Server{
		Addr:              ":" + serverPort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("❌ Ошибка запуска сервера:", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("🛑 Получен сигнал остановки, завершаем сервер...")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("❌ Ошибка graceful shutdown:", err)
	}
	log.Println("✅ Сервер остановлен корректно")
}

func startMessageMediaMaintenance() {
	if strings.EqualFold(getEnv("MESSAGE_MEDIA_CLEANUP_ENABLED", "true"), "false") {
		return
	}
	interval := parseDurationEnv("MESSAGE_MEDIA_CLEANUP_INTERVAL", time.Hour)
	ageThreshold := parseDurationEnv("MESSAGE_MEDIA_ORPHAN_AGE", 24*time.Hour)
	storage := media.NewStorage()
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		runMessageMediaCleanup(storage, ageThreshold)
		for range ticker.C {
			runMessageMediaCleanup(storage, ageThreshold)
		}
	}()
}

func runMessageMediaCleanup(storage media.Storage, ageThreshold time.Duration) {
	var rows []struct{ URL string }
	if err := database.DB.Model(&models.Message{}).Select("media_url AS url").Where("media_url <> ''").Scan(&rows).Error; err != nil {
		log.Printf("⚠️ cleanup scan media_url failed: %v", err)
		return
	}
	var thumbRows []struct{ URL string }
	if err := database.DB.Model(&models.Message{}).Select("media_thumb_url AS url").Where("media_thumb_url <> ''").Scan(&thumbRows).Error; err != nil {
		log.Printf("⚠️ cleanup scan media_thumb_url failed: %v", err)
		return
	}
	keys := make([]string, 0, len(rows)+len(thumbRows))
	for _, row := range rows {
		if key := storage.ObjectKeyFromPublicURL(row.URL); key != "" {
			keys = append(keys, key)
		}
	}
	for _, row := range thumbRows {
		if key := storage.ObjectKeyFromPublicURL(row.URL); key != "" {
			keys = append(keys, key)
		}
	}
	deleted, err := media.CleanupOrphanMessageFiles(storage, keys, ageThreshold)
	if err != nil {
		log.Printf("⚠️ message media cleanup failed: %v", err)
		return
	}
	if deleted > 0 {
		log.Printf("🧹 message media cleanup removed %d orphan files", deleted)
	}
}

func parseDurationEnv(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func readinessHandler(c *gin.Context) {
	appVersion := getEnv("APP_VERSION", "dev")
	if err := database.HealthCheck(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "error",
			"service": "friendscape-backend",
			"version": appVersion,
			"error":   err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status":  "ready",
		"service": "friendscape-backend",
		"version": appVersion,
	})
}

func validateEnvironment() {
	appEnv := getAppEnv()
	if appEnv != "production" {
		return
	}

	jwtSecret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if jwtSecret == "" || jwtSecret == "change-me" || len(jwtSecret) < 32 {
		log.Fatal("❌ В production нужно задать безопасный JWT_SECRET длиной не меньше 32 символов")
	}

	appPublicURL := strings.TrimSpace(os.Getenv("APP_PUBLIC_URL"))
	if appPublicURL == "" {
		log.Fatal("❌ В production нужно задать APP_PUBLIC_URL")
	}
	if !strings.HasPrefix(strings.ToLower(appPublicURL), "https://") {
		log.Fatal("❌ В production APP_PUBLIC_URL должен использовать https://")
	}
	if strings.Contains(strings.ToLower(appPublicURL), "localhost") || strings.Contains(strings.ToLower(appPublicURL), "127.0.0.1") {
		log.Fatal("❌ В production APP_PUBLIC_URL не должен указывать на localhost")
	}

	allowedOrigins := parseAllowedOrigins()
	if len(allowedOrigins) == 1 && allowedOrigins[0] == "*" {
		log.Fatal("❌ В production нельзя использовать ALLOWED_ORIGINS=*")
	}
	for _, origin := range allowedOrigins {
		lowerOrigin := strings.ToLower(strings.TrimSpace(origin))
		if lowerOrigin == "" {
			continue
		}
		if strings.HasPrefix(lowerOrigin, "http://localhost") || strings.HasPrefix(lowerOrigin, "http://127.0.0.1") || strings.HasPrefix(lowerOrigin, "https://localhost") || strings.HasPrefix(lowerOrigin, "https://127.0.0.1") {
			log.Fatal("❌ В production ALLOWED_ORIGINS не должен содержать localhost")
		}
		if !strings.HasPrefix(lowerOrigin, "https://") {
			log.Fatal("❌ В production ALLOWED_ORIGINS должен содержать только https origin'ы")
		}
	}

	sslMode := strings.ToLower(strings.TrimSpace(getEnv("DB_SSLMODE", "disable")))
	if sslMode == "" || sslMode == "disable" {
		log.Fatal("❌ В production DB_SSLMODE не должен быть disable")
	}

	dbPassword := strings.TrimSpace(os.Getenv("DB_PASSWORD"))
	if dbPassword == "" || strings.EqualFold(dbPassword, "postgres") || strings.EqualFold(dbPassword, "password") {
		log.Fatal("❌ В production нужно задать отдельный безопасный DB_PASSWORD")
	}

	if strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS")) == "" {
		log.Fatal("❌ В production ALLOWED_ORIGINS должен быть задан явно")
	}

	trustedProxies := parseTrustedProxies()
	for _, proxy := range trustedProxies {
		if strings.TrimSpace(proxy) == "*" {
			log.Fatal("❌ В production TRUSTED_PROXIES не должен содержать *")
		}
	}

	if strings.EqualFold(getEnv("ENABLE_DEV_ADMIN_ROUTE", "false"), "true") {
		bootstrapToken := strings.TrimSpace(os.Getenv("ADMIN_BOOTSTRAP_TOKEN"))
		if len(bootstrapToken) < 32 {
			log.Fatal("❌ В production при ENABLE_DEV_ADMIN_ROUTE=true нужен ADMIN_BOOTSTRAP_TOKEN длиной не меньше 32 символов")
		}
	}
}

func getAppEnv() string {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if value == "" {
		return "development"
	}
	return value
}

func getEnv(key, defaultValue string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return defaultValue
}

func parseTrustedProxies() []string {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	if raw == "" {
		return []string{"127.0.0.1", "::1"}
	}
	parts := strings.Split(raw, ",")
	proxies := make([]string, 0, len(parts))
	for _, part := range parts {
		proxy := strings.TrimSpace(part)
		if proxy != "" {
			proxies = append(proxies, proxy)
		}
	}
	if len(proxies) == 0 {
		return []string{"127.0.0.1", "::1"}
	}
	return proxies
}

func parseAllowedOrigins() []string {
	raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
	if raw == "" {
		return []string{"http://localhost:5173", "http://127.0.0.1:5173"}
	}
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		origin := strings.TrimSpace(part)
		if origin != "" {
			origins = append(origins, origin)
		}
	}
	if len(origins) == 0 {
		return []string{"http://localhost:5173", "http://127.0.0.1:5173"}
	}
	return origins
}

func mustGetEnv(key string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		log.Fatal(fmt.Sprintf("❌ Переменная окружения %s обязательна", key))
	}
	return value
}

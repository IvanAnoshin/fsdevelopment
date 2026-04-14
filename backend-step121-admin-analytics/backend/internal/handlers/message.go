package handlers

import (
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/media"
	"friendscape/internal/models"
	"friendscape/internal/realtime"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type MessageHandler struct{}

type directMessageMedia struct {
	Kind        string `json:"kind"`
	URL         string `json:"url"`
	ThumbURL    string `json:"thumb_url"`
	Mime        string `json:"mime"`
	DurationSec int    `json:"duration_sec"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Bytes       int64  `json:"bytes"`
}

type directMessageEncryptedEnvelope struct {
	Scheme            string `json:"scheme"`
	SenderDeviceID    string `json:"sender_device_id"`
	RecipientDeviceID string `json:"recipient_device_id"`
	Ciphertext        string `json:"ciphertext"`
	Header            string `json:"header"`
	AAD               string `json:"aad"`
	ContentHint       string `json:"content_hint"`
	ClientMessageID   string `json:"client_message_id"`
	KeyEnvelope       string `json:"key_envelope"`
}

type directMessageRequest struct {
	Content   string                          `json:"content"`
	Type      string                          `json:"type"`
	Media     *directMessageMedia             `json:"media"`
	Encrypted *directMessageEncryptedEnvelope `json:"encrypted"`
}

type updateDirectMessageRequest = directMessageRequest

type latestConversationRow struct {
	ConversationWith  uint      `gorm:"column:conversation_with"`
	ID                uint      `gorm:"column:id"`
	FromUserID        uint      `gorm:"column:from_user_id"`
	ToUserID          uint      `gorm:"column:to_user_id"`
	Type              string    `gorm:"column:type"`
	Content           string    `gorm:"column:content"`
	IsEncrypted       bool      `gorm:"column:is_encrypted"`
	EncryptionScheme  string    `gorm:"column:encryption_scheme"`
	SenderDeviceID    string    `gorm:"column:sender_device_id"`
	RecipientDeviceID string    `gorm:"column:recipient_device_id"`
	Ciphertext        string    `gorm:"column:ciphertext"`
	CipherHeader      string    `gorm:"column:cipher_header"`
	CipherAAD         string    `gorm:"column:cipher_aad"`
	ContentHint       string    `gorm:"column:content_hint"`
	ClientMessageID   string    `gorm:"column:client_message_id"`
	KeyEnvelope       string    `gorm:"column:key_envelope"`
	MediaKind         string    `gorm:"column:media_kind"`
	MediaURL          string    `gorm:"column:media_url"`
	MediaThumbURL     string    `gorm:"column:media_thumb_url"`
	MediaMime         string    `gorm:"column:media_mime"`
	MediaDurationSec  int       `gorm:"column:media_duration_sec"`
	MediaWidth        int       `gorm:"column:media_width"`
	MediaHeight       int       `gorm:"column:media_height"`
	MediaBytes        int64     `gorm:"column:media_bytes"`
	IsRead            bool      `gorm:"column:is_read"`
	CreatedAt         time.Time `gorm:"column:created_at"`
}

type unreadConversationRow struct {
	ConversationWith uint  `gorm:"column:conversation_with"`
	UnreadCount      int64 `gorm:"column:unread_count"`
}

func NewMessageHandler() *MessageHandler {
	return &MessageHandler{}
}

func positiveIntParam(c *gin.Context, name, label string) (int, bool) {
	value, err := strconv.Atoi(c.Param(name))
	if err != nil || value <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный " + label})
		return 0, false
	}
	return value, true
}

func normalizeMessageType(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "voice", "voice_note", "audio":
		return "voice"
	case "video", "video_note", "video-circle", "videocircle":
		return "video_note"
	default:
		return "text"
	}
}

func buildMessagePreview(messageType string, content string, mediaKind string, encrypted bool, contentHint string) string {
	trimmed := strings.TrimSpace(content)
	hint := strings.TrimSpace(contentHint)
	if encrypted {
		if hint != "" {
			return "🔒 " + hint
		}
		switch normalizeMessageType(messageType) {
		case "voice":
			return "🔒 Голосовое сообщение"
		case "video_note":
			return "🔒 Видеосообщение"
		default:
			if strings.TrimSpace(mediaKind) != "" {
				return "🔒 Зашифрованное медиа"
			}
			return "🔒 Зашифрованное сообщение"
		}
	}
	switch normalizeMessageType(messageType) {
	case "voice":
		if trimmed != "" {
			return "🎤 " + trimmed
		}
		return "🎤 Голосовое сообщение"
	case "video_note":
		if trimmed != "" {
			return "🎬 " + trimmed
		}
		return "🎬 Видеокружок"
	default:
		if trimmed != "" {
			return trimmed
		}
		if strings.TrimSpace(mediaKind) != "" {
			return "📎 Медиа"
		}
		return "Сообщение"
	}
}

func notificationMessageLabel(messageType string, encrypted bool) string {
	if encrypted {
		switch normalizeMessageType(messageType) {
		case "voice":
			return "зашифрованное голосовое сообщение"
		case "video_note":
			return "зашифрованное видеосообщение"
		default:
			return "зашифрованное сообщение"
		}
	}
	switch normalizeMessageType(messageType) {
	case "voice":
		return "голосовое сообщение"
	case "video_note":
		return "видеокружок"
	default:
		return "сообщение"
	}
}

func validateMessageRequest(req directMessageRequest) (directMessageRequest, error) {
	req.Content = strings.TrimSpace(req.Content)
	req.Type = normalizeMessageType(req.Type)
	if req.Encrypted != nil {
		req.Encrypted.Scheme = strings.TrimSpace(req.Encrypted.Scheme)
		req.Encrypted.SenderDeviceID = strings.TrimSpace(req.Encrypted.SenderDeviceID)
		req.Encrypted.RecipientDeviceID = strings.TrimSpace(req.Encrypted.RecipientDeviceID)
		req.Encrypted.Ciphertext = strings.TrimSpace(req.Encrypted.Ciphertext)
		req.Encrypted.Header = strings.TrimSpace(req.Encrypted.Header)
		req.Encrypted.AAD = strings.TrimSpace(req.Encrypted.AAD)
		req.Encrypted.ContentHint = strings.TrimSpace(req.Encrypted.ContentHint)
		req.Encrypted.ClientMessageID = strings.TrimSpace(req.Encrypted.ClientMessageID)
		req.Encrypted.KeyEnvelope = strings.TrimSpace(req.Encrypted.KeyEnvelope)
		if req.Encrypted.Scheme == "" || req.Encrypted.Ciphertext == "" || req.Encrypted.SenderDeviceID == "" || req.Encrypted.RecipientDeviceID == "" {
			return req, errors.New("Неполный E2EE envelope")
		}
		if req.Type == "text" && req.Content == "" {
			req.Content = ""
		}
		if req.Media != nil {
			req.Media.Kind = strings.TrimSpace(strings.ToLower(req.Media.Kind))
			req.Media.URL = strings.TrimSpace(req.Media.URL)
			req.Media.ThumbURL = strings.TrimSpace(req.Media.ThumbURL)
			req.Media.Mime = strings.TrimSpace(strings.ToLower(req.Media.Mime))
			storage := media.NewStorage()
			if req.Media.URL != "" {
				if key := storage.ObjectKeyFromPublicURL(req.Media.URL); key == "" || !strings.HasPrefix(key, "message-media/") {
					return req, errors.New("Недопустимый источник message-media")
				}
			}
			if req.Media.ThumbURL != "" {
				if key := storage.ObjectKeyFromPublicURL(req.Media.ThumbURL); key == "" || !strings.HasPrefix(key, "message-media-thumb/") {
					return req, errors.New("Недопустимый thumbnail message-media")
				}
			}
		}
		return req, nil
	}
	if req.Type == "text" {
		if req.Content == "" {
			return req, errors.New("Сообщение не может быть пустым")
		}
		return req, nil
	}
	if req.Media == nil {
		return req, errors.New("Нужно прикрепить медиа")
	}
	req.Media.Kind = strings.TrimSpace(strings.ToLower(req.Media.Kind))
	req.Media.URL = strings.TrimSpace(req.Media.URL)
	req.Media.ThumbURL = strings.TrimSpace(req.Media.ThumbURL)
	req.Media.Mime = strings.TrimSpace(strings.ToLower(req.Media.Mime))
	if req.Media.URL == "" {
		return req, errors.New("Не найден URL медиа")
	}
	if req.Type == "voice" && req.Media.Kind == "" {
		req.Media.Kind = "voice"
	}
	if req.Type == "video_note" && req.Media.Kind == "" {
		req.Media.Kind = "video_note"
	}
	storage := media.NewStorage()
	if key := storage.ObjectKeyFromPublicURL(req.Media.URL); key == "" || !strings.HasPrefix(key, "message-media/") {
		return req, errors.New("Недопустимый источник message-media")
	}
	if req.Media.ThumbURL != "" {
		if key := storage.ObjectKeyFromPublicURL(req.Media.ThumbURL); key == "" || !strings.HasPrefix(key, "message-media-thumb/") {
			return req, errors.New("Недопустимый thumbnail message-media")
		}
	}
	if req.Type == "voice" && req.Media.DurationSec > media.MaxVoiceDurationSec() {
		return req, errors.New("Голосовое сообщение превышает допустимую длительность")
	}
	if req.Type == "video_note" && req.Media.DurationSec > media.MaxVideoNoteDurationSec() {
		return req, errors.New("Видеокружок превышает допустимую длительность")
	}
	return req, nil
}

func senderDisplayName(userID uint) string {
	var sender models.User
	database.DB.Select("id, first_name, last_name, username").First(&sender, userID)
	senderName := strings.TrimSpace(strings.TrimSpace(sender.FirstName + " " + sender.LastName))
	if senderName == "" {
		senderName = sender.Username
	}
	if senderName == "" {
		senderName = "Пользователь"
	}
	return senderName
}

func validateEncryptedSenderDevice(userID uint, senderDeviceID string) error {
	trimmed := strings.TrimSpace(senderDeviceID)
	if trimmed == "" {
		return errors.New("Не найден sender E2EE device")
	}
	var device models.E2EEDevice
	if err := database.DB.Where("user_id = ? AND device_id = ? AND revoked_at IS NULL", userID, trimmed).First(&device).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("E2EE устройство отправителя не зарегистрировано")
		}
		return errors.New("Не удалось проверить E2EE устройство отправителя")
	}
	return nil
}

func sendDirectMessage(fromUserID uint, toUserID uint, req directMessageRequest) (*models.Message, *models.Notification, error) {
	if fromUserID == toUserID {
		return nil, nil, errors.New("Нельзя отправить сообщение самому себе")
	}

	normalizedReq, err := validateMessageRequest(req)
	if err != nil {
		return nil, nil, err
	}

	var recipient models.User
	if err := database.DB.Select("id").First(&recipient, toUserID).Error; err != nil {
		return nil, nil, gorm.ErrRecordNotFound
	}

	message := &models.Message{
		FromUserID: fromUserID,
		ToUserID:   toUserID,
		Type:       normalizedReq.Type,
		Content:    normalizedReq.Content,
	}
	if normalizedReq.Encrypted != nil {
		if err := validateEncryptedSenderDevice(fromUserID, normalizedReq.Encrypted.SenderDeviceID); err != nil {
			return nil, nil, err
		}
		if len(normalizedReq.Encrypted.Ciphertext) > 262144 || len(normalizedReq.Encrypted.KeyEnvelope) > 131072 || len(normalizedReq.Encrypted.Header) > 32768 || len(normalizedReq.Encrypted.AAD) > 8192 {
			return nil, nil, errors.New("Слишком большой E2EE envelope")
		}
		if len(normalizedReq.Encrypted.ContentHint) > 255 {
			normalizedReq.Encrypted.ContentHint = normalizedReq.Encrypted.ContentHint[:255]
		}
		message.IsEncrypted = true
		message.EncryptionScheme = normalizedReq.Encrypted.Scheme
		message.SenderDeviceID = normalizedReq.Encrypted.SenderDeviceID
		message.RecipientDeviceID = normalizedReq.Encrypted.RecipientDeviceID
		message.Ciphertext = normalizedReq.Encrypted.Ciphertext
		message.CipherHeader = normalizedReq.Encrypted.Header
		message.CipherAAD = normalizedReq.Encrypted.AAD
		message.ContentHint = normalizedReq.Encrypted.ContentHint
		message.ClientMessageID = normalizedReq.Encrypted.ClientMessageID
		message.KeyEnvelope = normalizedReq.Encrypted.KeyEnvelope
		message.Content = ""
	}
	if normalizedReq.Media != nil {
		message.MediaKind = normalizedReq.Media.Kind
		message.MediaURL = normalizedReq.Media.URL
		message.MediaThumbURL = normalizedReq.Media.ThumbURL
		message.MediaMime = normalizedReq.Media.Mime
		message.MediaDurationSec = normalizedReq.Media.DurationSec
		message.MediaWidth = normalizedReq.Media.Width
		message.MediaHeight = normalizedReq.Media.Height
		message.MediaBytes = normalizedReq.Media.Bytes
	}
	if err := database.DB.Create(message).Error; err != nil {
		return nil, nil, err
	}

	notification := &models.Notification{
		UserID:  toUserID,
		Type:    "message_new",
		Content: senderDisplayName(fromUserID) + " отправил(а) вам " + notificationMessageLabel(normalizedReq.Type, message.IsEncrypted),
		Link:    "/messages/" + strconv.Itoa(int(fromUserID)),
	}
	if err := database.DB.Create(notification).Error; err != nil {
		return message, nil, err
	}

	return message, notification, nil
}

func updateDirectMessage(message *models.Message, editorUserID uint, req updateDirectMessageRequest) error {
	if message == nil {
		return errors.New("Сообщение не найдено")
	}
	if message.FromUserID != editorUserID {
		return errors.New("Нельзя редактировать это сообщение")
	}
	if normalizeMessageType(message.Type) != "text" || strings.TrimSpace(message.MediaURL) != "" || strings.TrimSpace(message.MediaKind) != "" {
		return errors.New("Сейчас можно редактировать только текстовые сообщения")
	}
	normalizedReq, err := validateMessageRequest(directMessageRequest(req))
	if err != nil {
		return err
	}
	if normalizedReq.Type != "text" {
		return errors.New("Сейчас можно редактировать только текстовые сообщения")
	}
	if message.IsEncrypted {
		if normalizedReq.Encrypted == nil {
			return errors.New("Для зашифрованного сообщения нужен новый E2EE envelope")
		}
		if err := validateEncryptedSenderDevice(editorUserID, normalizedReq.Encrypted.SenderDeviceID); err != nil {
			return err
		}
		message.Content = ""
		message.EncryptionScheme = normalizedReq.Encrypted.Scheme
		message.SenderDeviceID = normalizedReq.Encrypted.SenderDeviceID
		message.RecipientDeviceID = normalizedReq.Encrypted.RecipientDeviceID
		message.Ciphertext = normalizedReq.Encrypted.Ciphertext
		message.CipherHeader = normalizedReq.Encrypted.Header
		message.CipherAAD = normalizedReq.Encrypted.AAD
		message.ContentHint = normalizedReq.Encrypted.ContentHint
		message.ClientMessageID = normalizedReq.Encrypted.ClientMessageID
		message.KeyEnvelope = normalizedReq.Encrypted.KeyEnvelope
	} else {
		if normalizedReq.Encrypted != nil {
			return errors.New("Для обычного сообщения не нужен E2EE envelope")
		}
		message.Content = strings.TrimSpace(normalizedReq.Content)
	}
	now := time.Now()
	message.EditedAt = &now
	return database.DB.Save(message).Error
}

func publishMessageUpdatedEvent(message *models.Message) {
	if message == nil {
		return
	}
	realtime.DefaultBroker.PublishToUser(message.ToUserID, realtime.Event{Type: "message:updated", Channel: "messages", Data: map[string]any{"conversation_with": message.FromUserID, "message": message, "message_id": message.ID}})
	realtime.DefaultBroker.PublishToUser(message.FromUserID, realtime.Event{Type: "message:updated", Channel: "messages", Data: map[string]any{"conversation_with": message.ToUserID, "message": message, "message_id": message.ID, "outgoing": true}})
}

func markConversationAsRead(viewerID uint, otherID uint) (int64, error) {
	result := database.DB.Model(&models.Message{}).
		Where("from_user_id = ? AND to_user_id = ? AND is_read = ?", otherID, viewerID, false).
		Update("is_read", true)
	return result.RowsAffected, result.Error
}

func buildRelationshipDecorations(viewerID uint, userIDs []uint) (map[uint]string, map[uint]bool) {
	statusByUser := make(map[uint]string, len(userIDs))
	selfByUser := make(map[uint]bool, len(userIDs))
	if len(userIDs) == 0 {
		return statusByUser, selfByUser
	}

	filtered := make([]uint, 0, len(userIDs))
	unique := map[uint]struct{}{}
	for _, id := range userIDs {
		if id == 0 {
			continue
		}
		if id == viewerID {
			statusByUser[id] = "self"
			selfByUser[id] = true
			continue
		}
		if _, exists := unique[id]; exists {
			continue
		}
		unique[id] = struct{}{}
		filtered = append(filtered, id)
		statusByUser[id] = "none"
	}
	if len(filtered) == 0 {
		return statusByUser, selfByUser
	}

	var friendships []models.Friendship
	database.DB.Where(
		"(user_id = ? AND friend_id IN ?) OR (friend_id = ? AND user_id IN ?)",
		viewerID, filtered, viewerID, filtered,
	).Find(&friendships)

	for _, friendship := range friendships {
		otherID := friendship.UserID
		if otherID == viewerID {
			otherID = friendship.FriendID
		}
		if friendship.Status == "pending" {
			if friendship.UserID == viewerID {
				statusByUser[otherID] = "request_sent"
			} else {
				statusByUser[otherID] = "request_received"
			}
			continue
		}
		statusByUser[otherID] = "friends"
	}

	var subscriptions []models.Subscription
	database.DB.Where("subscriber_id = ? AND user_id IN ?", viewerID, filtered).Find(&subscriptions)
	for _, subscription := range subscriptions {
		if statusByUser[subscription.UserID] == "none" {
			statusByUser[subscription.UserID] = "subscribed"
		}
	}

	return statusByUser, selfByUser
}

func cleanupMessageMediaIfUnused(message *models.Message) {
	if message == nil {
		return
	}
	storage := media.NewStorage()
	cleanupURL := func(rawURL string) {
		key := storage.ObjectKeyFromPublicURL(rawURL)
		if key == "" {
			return
		}
		var count int64
		database.DB.Model(&models.Message{}).Where("id <> ? AND (media_url = ? OR media_thumb_url = ?)", message.ID, rawURL, rawURL).Count(&count)
		if count == 0 {
			_ = storage.DeleteObject(key)
		}
	}
	cleanupURL(strings.TrimSpace(message.MediaURL))
	if strings.TrimSpace(message.MediaThumbURL) != strings.TrimSpace(message.MediaURL) {
		cleanupURL(strings.TrimSpace(message.MediaThumbURL))
	}
}

func publishMessageEvents(message *models.Message, notification *models.Notification) {
	if message == nil {
		return
	}
	recipientPayload := map[string]any{
		"conversation_with": message.FromUserID,
		"message_id":        message.ID,
		"message":           message,
	}
	senderPayload := map[string]any{
		"conversation_with": message.ToUserID,
		"message_id":        message.ID,
		"message":           message,
		"outgoing":          true,
	}
	realtime.DefaultBroker.PublishToUser(message.ToUserID, realtime.Event{Type: "message:new", Channel: "messages", Data: recipientPayload})
	realtime.DefaultBroker.PublishToUser(message.FromUserID, realtime.Event{Type: "message:new", Channel: "messages", Data: senderPayload})
	if notification != nil {
		realtime.DefaultBroker.PublishToUser(message.ToUserID, realtime.Event{Type: "notification:new", Channel: "notifications", Data: map[string]any{"notification_type": notification.Type, "notification": notification}})
	}
}

func (h *MessageHandler) SendMessage(c *gin.Context) {
	fromUserID, _ := c.Get("user_id")
	toUserID, ok := positiveIntParam(c, "id", "получатель")
	if !ok {
		return
	}

	var req directMessageRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат сообщения"})
		return
	}
	if req.Encrypted == nil && len(strings.TrimSpace(req.Content)) > 5000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Сообщение слишком длинное"})
		return
	}
	if req.Encrypted != nil && len(strings.TrimSpace(req.Encrypted.Ciphertext)) > 262144 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Зашифрованное сообщение слишком большое"})
		return
	}

	message, notification, err := sendDirectMessage(fromUserID.(uint), uint(toUserID), req)
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Получатель не найден"})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}

	publishMessageEvents(message, notification)

	c.JSON(http.StatusOK, gin.H{
		"message": "Отправлено",
		"data":    message,
	})
}

func (h *MessageHandler) GetMessages(c *gin.Context) {
	userID, _ := c.Get("user_id")
	otherID, ok := positiveIntParam(c, "id", "id пользователя")
	if !ok {
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	offset := (page - 1) * limit

	baseQuery := database.DB.Where("(from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)",
		userID, otherID, otherID, userID)

	var total int64
	if err := baseQuery.Model(&models.Message{}).Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки"})
		return
	}

	var messages []models.Message
	err := baseQuery.
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&messages).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки"})
		return
	}

	_, _ = markConversationAsRead(userID.(uint), uint(otherID))

	nextPage := 0
	hasMore := int64(offset+len(messages)) < total
	if hasMore {
		nextPage = page + 1
	}

	c.JSON(http.StatusOK, gin.H{
		"messages":  messages,
		"page":      page,
		"limit":     limit,
		"total":     total,
		"has_more":  hasMore,
		"next_page": nextPage,
	})
}

func (h *MessageHandler) GetChats(c *gin.Context) {
	userIDAny, _ := c.Get("user_id")
	userID := userIDAny.(uint)

	var rows []latestConversationRow
	err := database.DB.Raw(`
        SELECT DISTINCT ON (conversation_with)
            conversation_with,
            id,
            from_user_id,
            to_user_id,
            type,
            content,
            is_encrypted,
            encryption_scheme,
            sender_device_id,
            recipient_device_id,
            ciphertext,
            cipher_header,
            cipher_aad,
            content_hint,
            client_message_id,
            key_envelope,
            media_kind,
            media_url,
            media_thumb_url,
            media_mime,
            media_duration_sec,
            media_width,
            media_height,
            media_bytes,
            is_read,
            created_at
        FROM (
            SELECT
                CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END AS conversation_with,
                id,
                from_user_id,
                to_user_id,
                type,
                content,
                is_encrypted,
                encryption_scheme,
                sender_device_id,
                recipient_device_id,
                ciphertext,
                cipher_header,
                cipher_aad,
                content_hint,
                client_message_id,
                key_envelope,
                media_kind,
                media_url,
                media_thumb_url,
                media_mime,
                media_duration_sec,
                media_width,
                media_height,
                media_bytes,
                is_read,
                created_at
            FROM messages
            WHERE from_user_id = ? OR to_user_id = ?
        ) conversation_messages
        ORDER BY conversation_with, created_at DESC, id DESC
    `, userID, userID, userID).Scan(&rows).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки"})
		return
	}

	if len(rows) == 0 {
		c.JSON(http.StatusOK, gin.H{"chats": []map[string]interface{}{}})
		return
	}

	userIDs := make([]uint, 0, len(rows))
	for _, row := range rows {
		userIDs = append(userIDs, row.ConversationWith)
	}

	var users []models.User
	if err := database.DB.Select("id, username, first_name, last_name, avatar, last_seen").Where("id IN ?", userIDs).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки пользователей чатов"})
		return
	}
	userMap := make(map[uint]models.User, len(users))
	for _, user := range users {
		userMap[user.ID] = user
	}

	var unreadRows []unreadConversationRow
	_ = database.DB.Raw(`
        SELECT from_user_id AS conversation_with, COUNT(*) AS unread_count
        FROM messages
        WHERE to_user_id = ? AND is_read = FALSE AND from_user_id IN ?
        GROUP BY from_user_id
    `, userID, userIDs).Scan(&unreadRows).Error
	unreadMap := make(map[uint]int64, len(unreadRows))
	for _, row := range unreadRows {
		unreadMap[row.ConversationWith] = row.UnreadCount
	}

	statusByUser, selfByUser := buildRelationshipDecorations(userID, userIDs)

	chats := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		user, exists := userMap[row.ConversationWith]
		if !exists {
			continue
		}
		user.FriendshipStatus = statusByUser[user.ID]
		user.IsSelf = selfByUser[user.ID]
		chats = append(chats, map[string]interface{}{
			"user": user,
			"last_message": models.Message{
				ID:                row.ID,
				FromUserID:        row.FromUserID,
				ToUserID:          row.ToUserID,
				Type:              row.Type,
				Content:           buildMessagePreview(row.Type, row.Content, row.MediaKind, row.IsEncrypted, row.ContentHint),
				IsEncrypted:       row.IsEncrypted,
				EncryptionScheme:  row.EncryptionScheme,
				SenderDeviceID:    row.SenderDeviceID,
				RecipientDeviceID: row.RecipientDeviceID,
				Ciphertext:        row.Ciphertext,
				CipherHeader:      row.CipherHeader,
				CipherAAD:         row.CipherAAD,
				ContentHint:       row.ContentHint,
				ClientMessageID:   row.ClientMessageID,
				KeyEnvelope:       row.KeyEnvelope,
				MediaKind:         row.MediaKind,
				MediaURL:          row.MediaURL,
				MediaThumbURL:     row.MediaThumbURL,
				MediaMime:         row.MediaMime,
				MediaDurationSec:  row.MediaDurationSec,
				MediaWidth:        row.MediaWidth,
				MediaHeight:       row.MediaHeight,
				MediaBytes:        row.MediaBytes,
				IsRead:            row.IsRead,
				CreatedAt:         row.CreatedAt,
			},
			"unread":       unreadMap[row.ConversationWith],
			"unread_count": unreadMap[row.ConversationWith],
		})
	}

	sort.Slice(chats, func(i, j int) bool {
		left, _ := chats[i]["last_message"].(models.Message)
		right, _ := chats[j]["last_message"].(models.Message)
		return left.CreatedAt.After(right.CreatedAt)
	})

	c.JSON(http.StatusOK, gin.H{"chats": chats})
}

func (h *MessageHandler) MarkConversationRead(c *gin.Context) {
	userID, _ := c.Get("user_id")
	otherID, ok := positiveIntParam(c, "id", "id пользователя")
	if !ok {
		return
	}

	updated, err := markConversationAsRead(userID.(uint), uint(otherID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось пометить сообщения как прочитанные"})
		return
	}

	realtime.DefaultBroker.PublishToUser(uint(otherID), realtime.Event{Type: "message:read", Channel: "messages", Data: map[string]any{"conversation_with": userID, "updated": updated}})
	c.JSON(http.StatusOK, gin.H{
		"message": "Диалог отмечен как прочитанный",
		"updated": updated,
	})
}

func (h *MessageHandler) GetUnreadCount(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var count int64
	database.DB.Model(&models.Message{}).
		Where("to_user_id = ? AND is_read = ?", userID, false).
		Count(&count)

	c.JSON(http.StatusOK, gin.H{"unread": count})
}

func (h *MessageHandler) UpdateMessage(c *gin.Context) {
	userID, _ := c.Get("user_id")
	messageID, ok := positiveIntParam(c, "id", "id сообщения")
	if !ok {
		return
	}
	var req updateDirectMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат сообщения"})
		return
	}
	var message models.Message
	if err := database.DB.Where("id = ? AND from_user_id = ?", messageID, userID).First(&message).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Нельзя редактировать это сообщение"})
		return
	}
	if err := updateDirectMessage(&message, userID.(uint), req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	publishMessageUpdatedEvent(&message)
	c.JSON(http.StatusOK, gin.H{"message": "Сообщение обновлено", "data": message})
}

func (h *MessageHandler) DeleteMessage(c *gin.Context) {
	userID, _ := c.Get("user_id")
	messageID, ok := positiveIntParam(c, "id", "id сообщения")
	if !ok {
		return
	}

	var message models.Message
	if err := database.DB.Where("id = ? AND from_user_id = ?", messageID, userID).First(&message).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Нельзя удалить это сообщение"})
		return
	}

	if err := database.DB.Delete(&message).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить сообщение"})
		return
	}
	cleanupMessageMediaIfUnused(&message)

	realtime.DefaultBroker.PublishToUser(message.ToUserID, realtime.Event{Type: "message:deleted", Channel: "messages", Data: map[string]any{"conversation_with": message.FromUserID, "message_id": message.ID}})
	realtime.DefaultBroker.PublishToUser(message.FromUserID, realtime.Event{Type: "message:deleted", Channel: "messages", Data: map[string]any{"conversation_with": message.ToUserID, "message_id": message.ID, "outgoing": true}})

	c.JSON(http.StatusOK, gin.H{"message": "Удалено"})
}

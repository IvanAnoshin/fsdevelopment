package handlers

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"friendscape/utils"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type RecoveryHandler struct{}

func NewRecoveryHandler() *RecoveryHandler {
	return &RecoveryHandler{}
}

func trackingBaseURL(c *gin.Context) string {
	publicURL := strings.TrimSpace(os.Getenv("APP_PUBLIC_URL"))
	if publicURL != "" {
		return strings.TrimRight(publicURL, "/")
	}
	origin := strings.TrimSpace(c.GetHeader("Origin"))
	if origin != "" {
		return strings.TrimRight(origin, "/")
	}
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + c.Request.Host
}

func generateDeviceID(c *gin.Context) string {
	return EnsureClientDeviceID(c)
}

func (h *RecoveryHandler) CreateRecoveryRequest(c *gin.Context) {
	var req struct {
		FirstName string `json:"first_name" binding:"required"`
		LastName  string `json:"last_name" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	var user models.User
	err := database.DB.Where("LOWER(first_name) = ? AND LOWER(last_name) = ?",
		strings.ToLower(req.FirstName),
		strings.ToLower(req.LastName)).First(&user).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь не найден"})
		return
	}

	// Проверяем, нет ли уже активной заявки
	var existing models.RecoveryRequest
	err = database.DB.Where("user_id = ? AND status = ?", user.ID, "pending").First(&existing).Error
	if err == nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":         "У вас уже есть активная заявка",
			"tracking_link": existing.TrackingLink,
			"code":          existing.Code,
		})
		return
	}

	// Получаем данные об устройстве
	deviceID := generateDeviceID(c)
	var device models.TrustedDevice
	database.DB.Where("user_id = ? AND device_id = ?", user.ID, deviceID).First(&device)

	code := utils.GenerateRecoveryCode()
	trackingLink := trackingBaseURL(c) + "/recovery/status/" + code

	request := &models.RecoveryRequest{
		UserID:        user.ID,
		Status:        "pending",
		Code:          code,
		TrackingLink:  trackingLink,
		DeviceID:      deviceID,
		DeviceTrusted: device.TrustedByDFSN,
		DFSNAverage:   device.DFSNAverage,
		DFSNSessions:  device.DFSNSessions,
		IP:            c.ClientIP(),
		UserAgent:     c.Request.UserAgent(),
		ExpiresAt:     time.Now().Add(7 * 24 * time.Hour),
	}

	if err := database.DB.Create(request).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка создания заявки"})
		return
	}

	// Временно отключаем авто-оценку для тестирования
	// h.evaluateRequest(request)

	// Принудительно устанавливаем статус pending
	request.Status = "pending"
	database.DB.Save(request)

	c.JSON(http.StatusOK, gin.H{
		"message":       "Заявка отправлена в поддержку",
		"request_id":    request.ID,
		"code":          code,
		"tracking_link": trackingLink,
		"expires_at":    request.ExpiresAt,
		"status":        request.Status,
	})
}

// evaluateRequest - автоматическая оценка заявки (пока отключена)
func (h *RecoveryHandler) evaluateRequest(request *models.RecoveryRequest) {
	if request.DeviceTrusted && request.DFSNAverage > 0.85 {
		request.AutoDecision = "auto_approve"
		request.Status = "approved"
		database.DB.Save(request)
		return
	}

	if request.DFSNAverage > 0.7 {
		request.AutoDecision = "manual"
		database.DB.Save(request)
		return
	}

	if request.DFSNAverage < 0.5 {
		request.AutoDecision = "auto_reject"
		request.Status = "rejected"
		database.DB.Save(request)
		return
	}

	request.AutoDecision = "manual"
	database.DB.Save(request)
}

func (h *RecoveryHandler) GetRecoveryStatus(c *gin.Context) {
	code := c.Param("code")

	var request models.RecoveryRequest
	err := database.DB.Preload("User").Where("code = ?", code).First(&request).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Заявка не найдена"})
		return
	}

	if time.Now().After(request.ExpiresAt) && request.Status == "pending" {
		request.Status = "expired"
		database.DB.Save(&request)
	}

	c.JSON(http.StatusOK, gin.H{
		"id":            request.ID,
		"status":        request.Status,
		"auto_decision": request.AutoDecision,
		"created_at":    request.CreatedAt,
		"expires_at":    request.ExpiresAt,
		"user": gin.H{
			"id":         request.User.ID,
			"first_name": request.User.FirstName,
			"last_name":  request.User.LastName,
		},
	})
}

func (h *RecoveryHandler) SubmitAnswers(c *gin.Context) {
	var req struct {
		Code          string   `json:"code" binding:"required"`
		FriendAnswers []string `json:"friend_answers"`
		PostAnswers   []string `json:"post_answers"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	var request models.RecoveryRequest
	err := database.DB.Preload("User").Where("code = ?", req.Code).First(&request).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Заявка не найдена"})
		return
	}

	if request.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Заявка уже обработана"})
		return
	}

	if len(req.FriendAnswers) > 0 {
		request.FriendAnswers = strings.Join(req.FriendAnswers, ",")
	}
	if len(req.PostAnswers) > 0 {
		request.PostAnswers = strings.Join(req.PostAnswers, ",")
	}
	database.DB.Save(&request)

	c.JSON(http.StatusOK, gin.H{
		"status": request.Status,
	})
}

func (h *RecoveryHandler) CompleteRecoverySetup(c *gin.Context) {
	var req struct {
		Code     string `json:"code" binding:"required"`
		Question string `json:"question"`
		Answer   string `json:"answer" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	var request models.RecoveryRequest
	err := database.DB.Preload("User").Where("code = ?", req.Code).First(&request).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Заявка не найдена"})
		return
	}

	if time.Now().After(request.ExpiresAt) {
		if request.Status == "pending" || request.Status == "approved" {
			request.Status = "expired"
			database.DB.Save(&request)
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Срок действия заявки истёк"})
		return
	}

	if request.Status != "approved" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Заявка ещё не одобрена"})
		return
	}

	question := normalizeSecurityQuestion(req.Question)
	answer := normalizeSecurityAnswer(req.Answer)
	hashedAnswer, err := bcrypt.GenerateFromPassword([]byte(answer), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обработки ответа"})
		return
	}

	if err := database.DB.Model(&models.User{}).Where("id = ?", request.UserID).Updates(map[string]any{
		"security_answer_hash": string(hashedAnswer),
		"security_question":    question,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить секретный ответ"})
		return
	}

	database.DB.Where("user_id = ?", request.UserID).Delete(&models.BackupCode{})
	codes := utils.GenerateBackupCodes()
	for _, code := range codes {
		hashedCode, _ := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
		backupCode := &models.BackupCode{
			UserID:   request.UserID,
			CodeHash: string(hashedCode),
			Used:     false,
		}
		database.DB.Create(backupCode)
	}

	request.Status = "completed"
	database.DB.Save(&request)

	c.JSON(http.StatusOK, gin.H{
		"message": "Восстановление завершено",
		"codes":   codes,
	})
}

func (h *RecoveryHandler) SavePushSubscription(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var req struct {
		Endpoint  string `json:"endpoint" binding:"required"`
		AuthKey   string `json:"auth_key" binding:"required"`
		P256dhKey string `json:"p256dh_key" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	database.DB.Where("user_id = ? AND endpoint = ?", userID, req.Endpoint).Delete(&models.PushSubscription{})

	subscription := &models.PushSubscription{
		UserID:     userID.(uint),
		Endpoint:   req.Endpoint,
		AuthKey:    req.AuthKey,
		P256dhKey:  req.P256dhKey,
		UserAgent:  c.Request.UserAgent(),
		LastUsedAt: time.Now(),
	}

	if err := database.DB.Create(subscription).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка сохранения"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Подписка сохранена"})
}

func (h *RecoveryHandler) GetRecoveryRequestDetails(c *gin.Context) {
	requestID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID"})
		return
	}

	var request models.RecoveryRequest
	err = database.DB.Preload("User").First(&request, requestID).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Заявка не найдена"})
		return
	}

	var devices []models.TrustedDevice
	database.DB.Where("user_id = ?", request.UserID).Find(&devices)

	var friends []models.User
	database.DB.Raw(`
		SELECT u.id, u.first_name, u.last_name FROM users u
		WHERE u.id IN (
			SELECT friend_id FROM friendships WHERE user_id = ? AND status = 'accepted'
			UNION
			SELECT user_id FROM friendships WHERE friend_id = ? AND status = 'accepted'
		) LIMIT 10
	`, request.UserID, request.UserID).Scan(&friends)

	var posts []models.Post
	database.DB.Where("user_id = ?", request.UserID).Order("created_at DESC").Limit(10).Find(&posts)

	answers := make([]gin.H, 0)
	if request.FriendAnswers != "" {
		answers = append(answers, gin.H{
			"question": "Выбранные друзья",
			"answer":   request.FriendAnswers,
		})
	}
	if request.PostAnswers != "" {
		answers = append(answers, gin.H{
			"question": "Выбранные посты",
			"answer":   request.PostAnswers,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"request": request,
		"devices": devices,
		"friends": friends,
		"posts":   posts,
		"answers": answers,
	})
}

func (h *RecoveryHandler) GenerateRecoveryQuestions(c *gin.Context) {
	code := c.Param("code")

	var request models.RecoveryRequest
	err := database.DB.Preload("User").Where("code = ?", code).First(&request).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Заявка не найдена"})
		return
	}

	if request.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Заявка уже обработана"})
		return
	}

	var friends []models.User
	database.DB.Raw(`
		SELECT u.id, u.first_name, u.last_name FROM users u
		WHERE u.id IN (
			SELECT friend_id FROM friendships WHERE user_id = ? AND status = 'accepted'
			UNION
			SELECT user_id FROM friendships WHERE friend_id = ? AND status = 'accepted'
		) LIMIT 10
	`, request.UserID, request.UserID).Scan(&friends)

	var posts []models.Post
	database.DB.Where("user_id = ?", request.UserID).Order("created_at DESC").Limit(10).Find(&posts)

	friendOptions := make([]map[string]interface{}, 0)
	for _, f := range friends {
		friendOptions = append(friendOptions, map[string]interface{}{
			"id":   f.ID,
			"name": f.FirstName + " " + f.LastName,
		})
	}

	postOptions := make([]map[string]interface{}, 0)
	for _, p := range posts {
		content := p.Content
		if len(content) > 100 {
			content = content[:100] + "..."
		}
		postOptions = append(postOptions, map[string]interface{}{
			"id":      p.ID,
			"content": content,
			"date":    p.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"friends": friendOptions,
		"posts":   postOptions,
	})
}

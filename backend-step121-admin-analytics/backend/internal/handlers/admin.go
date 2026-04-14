package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"friendscape/utils"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AdminHandler struct{}

func NewAdminHandler() *AdminHandler {
	return &AdminHandler{}
}

func normalizeRecoveryStatusFilter(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "pending":
		return "pending"
	case "approved", "rejected", "all":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "pending"
	}
}

func (h *AdminHandler) GetPendingRecoveryRequests(c *gin.Context) {
	statusFilter := normalizeRecoveryStatusFilter(c.Query("status"))

	query := database.DB.Preload("User").Order("created_at DESC")
	if statusFilter != "all" {
		query = query.Where("status = ?", statusFilter)
	}

	var requests []models.RecoveryRequest
	if err := query.Find(&requests).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"requests": requests, "status": statusFilter})
}

func (h *AdminHandler) GetRecoveryRequestDetails(c *gin.Context) {
	requestID, err := strconv.Atoi(c.Param("id"))
	if err != nil || requestID <= 0 {
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

func (h *AdminHandler) ApproveRecoveryRequest(c *gin.Context) {
	adminID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	requestID, err := strconv.Atoi(c.Param("id"))
	if err != nil || requestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID"})
		return
	}

	var request models.RecoveryRequest
	if err := database.DB.Preload("User").First(&request, requestID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Заявка не найдена"})
		return
	}

	if request.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Заявка уже обработана"})
		return
	}

	err = database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.User{}).Where("id = ?", request.UserID).Updates(map[string]any{"security_answer_hash": "", "security_question": ""}).Error; err != nil {
			return err
		}

		request.Status = "approved"
		request.ResolvedAt = time.Now()
		request.ResolvedBy = adminID.(uint)
		if err := tx.Save(&request).Error; err != nil {
			return err
		}

		notification := &models.Notification{
			UserID:  request.UserID,
			Type:    "recovery_approved",
			Content: "✅ Ваша заявка на восстановление доступа одобрена. Нажмите, чтобы настроить новый секретный вопрос.",
			Link:    "/recovery/setup/" + request.Code,
			IsRead:  false,
		}
		return tx.Create(notification).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось одобрить заявку"})
		return
	}

	var subscriptions []models.PushSubscription
	database.DB.Where("user_id = ?", request.UserID).Find(&subscriptions)
	for _, sub := range subscriptions {
		go utils.SendPushNotification(&sub,
			"🔐 Восстановление доступа",
			"Ваша заявка одобрена! Нажмите, чтобы настроить новый секретный вопрос.",
			"/recovery/setup/"+request.Code,
		)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "Заявка одобрена",
		"tracking_link": request.TrackingLink,
	})
}

func (h *AdminHandler) RejectRecoveryRequest(c *gin.Context) {
	adminID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var req struct {
		Reason string `json:"reason"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нужно указать причину отклонения"})
		return
	}

	requestID, err := strconv.Atoi(c.Param("id"))
	if err != nil || requestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID"})
		return
	}

	var request models.RecoveryRequest
	if err := database.DB.First(&request, requestID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Заявка не найдена"})
		return
	}
	if request.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Заявка уже обработана"})
		return
	}

	request.Status = "rejected"
	request.AdminNote = reason
	request.ResolvedAt = time.Now()
	request.ResolvedBy = adminID.(uint)

	err = database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&request).Error; err != nil {
			return err
		}
		notification := &models.Notification{
			UserID:  request.UserID,
			Type:    "recovery_rejected",
			Content: "❌ Ваша заявка на восстановление доступа отклонена. Причина: " + reason,
			Link:    "/recovery",
			IsRead:  false,
		}
		return tx.Create(notification).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось отклонить заявку"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Заявка отклонена"})
}

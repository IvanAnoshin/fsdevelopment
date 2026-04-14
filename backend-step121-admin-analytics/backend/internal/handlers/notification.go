package handlers

import (
	"net/http"
	"strconv"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"friendscape/internal/realtime"
	"github.com/gin-gonic/gin"
)

type NotificationHandler struct{}

func NewNotificationHandler() *NotificationHandler {
	return &NotificationHandler{}
}

func (h *NotificationHandler) GetNotifications(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var notifications []models.Notification
	err := database.DB.Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(50).
		Find(&notifications).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки уведомлений"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"notifications": notifications})
}

func (h *NotificationHandler) MarkAsRead(c *gin.Context) {
	userID, _ := c.Get("user_id")
	notifID, err := strconv.Atoi(c.Param("id"))
	if err != nil || notifID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный идентификатор уведомления"})
		return
	}

	result := database.DB.Model(&models.Notification{}).
		Where("id = ? AND user_id = ?", notifID, userID).
		Update("is_read", true)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить уведомление"})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Уведомление не найдено"})
		return
	}

	realtime.DefaultBroker.PublishToUser(userID.(uint), realtime.Event{Type: "notification:read", Channel: "notifications", Data: map[string]any{"notification_id": notifID}})
	c.JSON(http.StatusOK, gin.H{"message": "Уведомление отмечено как прочитанное"})
}

func (h *NotificationHandler) MarkAllAsRead(c *gin.Context) {
	userID, _ := c.Get("user_id")

	result := database.DB.Model(&models.Notification{}).
		Where("user_id = ? AND is_read = ?", userID, false).
		Update("is_read", true)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить уведомления"})
		return
	}

	realtime.DefaultBroker.PublishToUser(userID.(uint), realtime.Event{Type: "notification:read_all", Channel: "notifications", Data: map[string]any{"updated": result.RowsAffected}})
	c.JSON(http.StatusOK, gin.H{"message": "Все уведомления отмечены как прочитанные", "updated": result.RowsAffected})
}

func (h *NotificationHandler) GetUnreadCount(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var count int64
	database.DB.Model(&models.Notification{}).
		Where("user_id = ? AND is_read = ?", userID, false).
		Count(&count)

	c.JSON(http.StatusOK, gin.H{"count": count})
}

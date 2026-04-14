package repository

import (
	"friendscape/internal/database"
	"friendscape/internal/models"
)

type NotificationRepo struct{}

func NewNotificationRepo() *NotificationRepo {
	return &NotificationRepo{}
}

func (r *NotificationRepo) Create(notif *models.Notification) error {
	return database.DB.Create(notif).Error
}

func (r *NotificationRepo) GetByUser(userID uint) ([]models.Notification, error) {
	var notifications []models.Notification
	err := database.DB.Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(50).
		Find(&notifications).Error
	return notifications, err
}

func (r *NotificationRepo) GetUnreadCount(userID uint) (int64, error) {
	var count int64
	err := database.DB.Model(&models.Notification{}).
		Where("user_id = ? AND is_read = ?", userID, false).
		Count(&count).Error
	return count, err
}

func (r *NotificationRepo) MarkAsRead(notifID, userID uint) error {
	return database.DB.Model(&models.Notification{}).
		Where("id = ? AND user_id = ?", notifID, userID).
		Update("is_read", true).Error
}

func (r *NotificationRepo) MarkAllAsRead(userID uint) error {
	return database.DB.Model(&models.Notification{}).
		Where("user_id = ? AND is_read = ?", userID, false).
		Update("is_read", true).Error
}

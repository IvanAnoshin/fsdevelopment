package database

import (
	"errors"
	"log"
	"strings"
	"time"

	"friendscape/internal/models"
	"friendscape/utils"

	"gorm.io/gorm"
)

func registerNotificationPushHook() error {
	if DB == nil {
		return nil
	}

	return DB.Callback().Create().After("gorm:create").Register("friendscape:dispatch-notification-push", func(tx *gorm.DB) {
		notification := notificationFromDest(tx.Statement.Dest)
		if notification == nil || notification.UserID == 0 || notification.IsRead {
			return
		}

		copied := *notification
		go dispatchNotificationPush(copied)
	})
}

func notificationFromDest(dest any) *models.Notification {
	switch value := dest.(type) {
	case *models.Notification:
		return value
	case models.Notification:
		copied := value
		return &copied
	default:
		return nil
	}
}

func dispatchNotificationPush(notification models.Notification) {
	if DB == nil || notification.UserID == 0 {
		return
	}

	var subscriptions []models.PushSubscription
	if err := DB.Where("user_id = ?", notification.UserID).Find(&subscriptions).Error; err != nil {
		log.Printf("push dispatch: не удалось загрузить подписки пользователя %d: %v", notification.UserID, err)
		return
	}

	if len(subscriptions) == 0 {
		return
	}

	title, body, link := buildPushEnvelope(notification)
	now := time.Now()

	for _, subscription := range subscriptions {
		if strings.TrimSpace(subscription.Endpoint) == "" {
			continue
		}

		if err := utils.SendPushNotification(&subscription, title, body, link); err != nil {
			if errors.Is(err, utils.ErrPushSubscriptionGone) {
				if dbErr := DB.Where("id = ?", subscription.ID).Delete(&models.PushSubscription{}).Error; dbErr != nil {
					log.Printf("push dispatch: не удалось удалить невалидную подписку %d: %v", subscription.ID, dbErr)
				}
				continue
			}

			log.Printf("push dispatch: не удалось отправить push пользователю %d по подписке %d: %v", notification.UserID, subscription.ID, err)
			continue
		}

		_ = DB.Model(&models.PushSubscription{}).
			Where("id = ?", subscription.ID).
			Update("last_used_at", now).Error
	}
}

func buildPushEnvelope(notification models.Notification) (title string, body string, link string) {
	link = strings.TrimSpace(notification.Link)
	if link == "" {
		link = "/notifications"
	}

	body = strings.TrimSpace(notification.Content)
	if body == "" {
		body = "У вас новое уведомление"
	}

	switch notification.Type {
	case "message_new":
		title = "Новое сообщение"
	case "friend_request":
		title = "Новая заявка в друзья"
	case "friend_accept":
		title = "Заявка в друзья принята"
	case "subscription":
		title = "Новый подписчик"
	case "comment":
		title = "Новый комментарий"
	case "mention":
		title = "Вас упомянули"
	case "like":
		title = "Новая реакция"
	case "community_invite":
		title = "Приглашение в сообщество"
	default:
		title = "Friendscape"
	}

	return title, body, link
}
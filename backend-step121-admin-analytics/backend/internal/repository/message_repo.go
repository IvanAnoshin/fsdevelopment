package repository

import (
	"sort"

	"friendscape/internal/database"
	"friendscape/internal/models"
)

type MessageRepo struct{}

func NewMessageRepo() *MessageRepo {
	return &MessageRepo{}
}

func (r *MessageRepo) Send(fromUserID, toUserID uint, content string) (*models.Message, error) {
	message := &models.Message{
		FromUserID: fromUserID,
		ToUserID:   toUserID,
		Content:    content,
	}

	err := database.DB.Create(message).Error
	return message, err
}

func (r *MessageRepo) GetConversation(userID, otherID uint, limit, offset int) ([]models.Message, error) {
	var messages []models.Message
	err := database.DB.
		Where("(from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)",
			userID, otherID, otherID, userID).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&messages).Error
	return messages, err
}

func (r *MessageRepo) MarkAsRead(userID, otherID uint) error {
	return database.DB.Model(&models.Message{}).
		Where("from_user_id = ? AND to_user_id = ? AND is_read = ?", otherID, userID, false).
		Update("is_read", true).Error
}

func (r *MessageRepo) GetChats(userID uint) ([]map[string]interface{}, error) {
	var messages []models.Message
	err := database.DB.
		Where("from_user_id = ? OR to_user_id = ?", userID, userID).
		Order("created_at DESC").
		Find(&messages).Error
	if err != nil {
		return nil, err
	}

	chatsMap := make(map[uint]map[string]interface{})

	for _, msg := range messages {
		var otherID uint
		if msg.FromUserID == userID {
			otherID = msg.ToUserID
		} else {
			otherID = msg.FromUserID
		}

		if _, exists := chatsMap[otherID]; !exists {
			var user models.User
			database.DB.Select("id, username, first_name, last_name, avatar, last_seen").First(&user, otherID)

			var unreadCount int64
			database.DB.Model(&models.Message{}).
				Where("from_user_id = ? AND to_user_id = ? AND is_read = ?", otherID, userID, false).
				Count(&unreadCount)

			chatsMap[otherID] = map[string]interface{}{
				"user":         user,
				"last_message": msg,
				"unread":       unreadCount,
			}
		}
	}

	chats := make([]map[string]interface{}, 0, len(chatsMap))
	for _, chat := range chatsMap {
		chats = append(chats, chat)
	}

	sort.Slice(chats, func(i, j int) bool {
		left, _ := chats[i]["last_message"].(models.Message)
		right, _ := chats[j]["last_message"].(models.Message)
		return left.CreatedAt.After(right.CreatedAt)
	})

	return chats, nil
}

func (r *MessageRepo) GetUnreadCount(userID uint) (int64, error) {
	var count int64
	err := database.DB.Model(&models.Message{}).
		Where("to_user_id = ? AND is_read = ?", userID, false).
		Count(&count).Error
	return count, err
}

func (r *MessageRepo) Delete(userID, messageID uint) error {
	return database.DB.
		Where("id = ? AND from_user_id = ?", messageID, userID).
		Delete(&models.Message{}).Error
}

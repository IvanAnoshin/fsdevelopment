package repository

import (
	"errors"

	"friendscape/internal/database"
	"friendscape/internal/models"
)

type FriendRepo struct{}

func NewFriendRepo() *FriendRepo {
	return &FriendRepo{}
}

func (r *FriendRepo) SendRequest(userID, friendID uint) error {
	var count int64
	database.DB.Model(&models.Friendship{}).
		Where("(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", userID, friendID, friendID, userID).
		Count(&count)

	if count > 0 {
		return errors.New("заявка уже существует")
	}

	friendship := &models.Friendship{
		UserID:   userID,
		FriendID: friendID,
		Status:   "pending",
	}
	return database.DB.Create(friendship).Error
}

func (r *FriendRepo) AcceptRequest(userID, friendID uint) error {
	result := database.DB.Model(&models.Friendship{}).
		Where("(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", friendID, userID, userID, friendID).
		Update("status", "accepted")

	if result.RowsAffected == 0 {
		return errors.New("заявка не найдена")
	}
	return nil
}

func (r *FriendRepo) RejectRequest(userID, friendID uint) error {
	return database.DB.Where(
		"(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
		friendID, userID, userID, friendID,
	).Delete(&models.Friendship{}).Error
}

func (r *FriendRepo) Unfriend(userID, friendID uint) error {
	return database.DB.Where(
		"(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
		userID, friendID, friendID, userID,
	).Delete(&models.Friendship{}).Error
}

func (r *FriendRepo) GetFriends(userID uint) ([]models.User, error) {
	var users []models.User

	err := database.DB.Raw(`
		SELECT u.* FROM users u
		WHERE u.id IN (
			SELECT friend_id FROM friendships WHERE user_id = ? AND status = 'accepted'
			UNION
			SELECT user_id FROM friendships WHERE friend_id = ? AND status = 'accepted'
		)
	`, userID, userID).Scan(&users).Error

	return users, err
}

func (r *FriendRepo) GetFriendsCount(userID uint) (int64, error) {
	var count int64
	err := database.DB.Model(&models.Friendship{}).
		Where("(user_id = ? OR friend_id = ?) AND status = ?", userID, userID, "accepted").
		Count(&count).Error
	return count, err
}

func (r *FriendRepo) GetIncomingRequests(userID uint) ([]models.User, error) {
	var users []models.User
	err := database.DB.Raw(`
		SELECT u.* FROM users u
		JOIN friendships f ON f.user_id = u.id
		WHERE f.friend_id = ? AND f.status = 'pending'
	`, userID).Scan(&users).Error
	return users, err
}

func (r *FriendRepo) Subscribe(subscriberID, userID uint) error {
	var count int64
	database.DB.Model(&models.Subscription{}).
		Where("subscriber_id = ? AND user_id = ?", subscriberID, userID).
		Count(&count)

	if count > 0 {
		return errors.New("уже подписан")
	}

	sub := &models.Subscription{
		SubscriberID: subscriberID,
		UserID:       userID,
	}
	return database.DB.Create(sub).Error
}

func (r *FriendRepo) Unsubscribe(subscriberID, userID uint) error {
	return database.DB.Where("subscriber_id = ? AND user_id = ?", subscriberID, userID).
		Delete(&models.Subscription{}).Error
}

func (r *FriendRepo) GetSubscribers(userID uint) ([]models.User, error) {
	var users []models.User
	err := database.DB.Raw(`
		SELECT u.* FROM users u
		JOIN subscriptions s ON s.subscriber_id = u.id
		WHERE s.user_id = ?
	`, userID).Scan(&users).Error
	return users, err
}

func (r *FriendRepo) GetSubscribersCount(userID uint) (int64, error) {
	var count int64
	err := database.DB.Model(&models.Subscription{}).Where("user_id = ?", userID).Count(&count).Error
	return count, err
}

func (r *FriendRepo) GetSubscriptions(userID uint) ([]models.User, error) {
	var users []models.User
	err := database.DB.Raw(`
		SELECT u.* FROM users u
		JOIN subscriptions s ON s.user_id = u.id
		WHERE s.subscriber_id = ?
	`, userID).Scan(&users).Error
	return users, err
}

func (r *FriendRepo) GetSubscriptionsCount(userID uint) (int64, error) {
	var count int64
	err := database.DB.Model(&models.Subscription{}).Where("subscriber_id = ?", userID).Count(&count).Error
	return count, err
}

func (r *FriendRepo) GetFriendshipStatus(userID, targetID uint) string {
	var friendship models.Friendship
	err := database.DB.
		Where("(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", userID, targetID, targetID, userID).
		First(&friendship).Error

	if err != nil {
		var subCount int64
		database.DB.Model(&models.Subscription{}).
			Where("subscriber_id = ? AND user_id = ?", userID, targetID).
			Count(&subCount)

		if subCount > 0 {
			return "subscribed"
		}
		return "none"
	}

	if friendship.Status == "pending" {
		if friendship.UserID == userID {
			return "request_sent"
		}
		return "request_received"
	}

	return "friends"
}

package handlers

import (
	"friendscape/internal/database"
	"friendscape/internal/models"
)

func decorateUserRelationship(viewerID uint, user *models.User) {
	if user == nil || user.ID == 0 {
		return
	}
	if user.ID == viewerID {
		user.FriendshipStatus = "self"
		user.IsSelf = true
		return
	}

	var friendship models.Friendship
	if err := database.DB.Where(
		"(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
		viewerID, user.ID, user.ID, viewerID,
	).First(&friendship).Error; err == nil {
		if friendship.Status == "pending" {
			if friendship.UserID == viewerID {
				user.FriendshipStatus = "request_sent"
			} else {
				user.FriendshipStatus = "request_received"
			}
			return
		}
		user.FriendshipStatus = "friends"
		return
	}

	var subCount int64
	database.DB.Model(&models.Subscription{}).Where("subscriber_id = ? AND user_id = ?", viewerID, user.ID).Count(&subCount)
	if subCount > 0 {
		user.FriendshipStatus = "subscribed"
		return
	}

	user.FriendshipStatus = "none"
}

package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"github.com/gin-gonic/gin"
)

type FriendHandler struct{}

func NewFriendHandler() *FriendHandler {
	return &FriendHandler{}
}

func displayName(user models.User) string {
	name := strings.TrimSpace(strings.TrimSpace(user.FirstName + " " + user.LastName))
	if name != "" {
		return name
	}
	if user.Username != "" {
		return user.Username
	}
	return "Пользователь"
}

func (h *FriendHandler) SendFriendRequest(c *gin.Context) {
	userID, _ := c.Get("user_id")
	friendID, err := strconv.Atoi(c.Param("id"))
	if err != nil || friendID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный пользователь"})
		return
	}

	if userID.(uint) == uint(friendID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нельзя дружить с собой"})
		return
	}

	var target models.User
	if err := database.DB.Select("id").First(&target, friendID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь не найден"})
		return
	}

	var existing models.Friendship
	err := database.DB.Where(
		"(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
		userID, friendID, friendID, userID,
	).First(&existing).Error

	if err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Заявка уже существует"})
		return
	}

	friendship := &models.Friendship{
		UserID:   userID.(uint),
		FriendID: uint(friendID),
		Status:   "pending",
	}

	if err := database.DB.Create(friendship).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка отправки заявки"})
		return
	}

	var sender models.User
	database.DB.Select("id, username, first_name, last_name").First(&sender, userID)
	notification := &models.Notification{
		UserID:  uint(friendID),
		Type:    "friend_request",
		Content: displayName(sender) + " отправил(а) вам заявку в друзья",
		Link:    "/friends?tab=requests",
	}
	database.DB.Create(notification)

	c.JSON(http.StatusOK, gin.H{"message": "Заявка отправлена"})
}

func (h *FriendHandler) AcceptFriendRequest(c *gin.Context) {
	userID, _ := c.Get("user_id")
	friendID, err := strconv.Atoi(c.Param("id"))
	if err != nil || friendID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный пользователь"})
		return
	}

	result := database.DB.Model(&models.Friendship{}).
		Where("user_id = ? AND friend_id = ? AND status = ?", friendID, userID, "pending").
		Update("status", "accepted")

	if result.RowsAffected == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Входящая заявка не найдена"})
		return
	}

	var accepter models.User
	database.DB.Select("id, username, first_name, last_name").First(&accepter, userID)
	notification := &models.Notification{
		UserID:  uint(friendID),
		Type:    "friend_accept",
		Content: displayName(accepter) + " принял(а) вашу заявку в друзья",
		Link:    "/profile/" + strconv.Itoa(int(userID.(uint))),
	}
	database.DB.Create(notification)

	c.JSON(http.StatusOK, gin.H{"message": "Дружба подтверждена"})
}

func (h *FriendHandler) RejectFriendRequest(c *gin.Context) {
	userID, _ := c.Get("user_id")
	friendID, err := strconv.Atoi(c.Param("id"))
	if err != nil || friendID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный пользователь"})
		return
	}

	result := database.DB.Where(
		"user_id = ? AND friend_id = ? AND status = ?",
		friendID, userID, "pending",
	).Delete(&models.Friendship{})

	if result.RowsAffected == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Входящая заявка не найдена"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Заявка отклонена"})
}

func (h *FriendHandler) Unfriend(c *gin.Context) {
	userID, _ := c.Get("user_id")
	friendID, err := strconv.Atoi(c.Param("id"))
	if err != nil || friendID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный пользователь"})
		return
	}

	result := database.DB.Where(
		"((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = ?",
		userID, friendID, friendID, userID, "accepted",
	).Delete(&models.Friendship{})

	if result.RowsAffected == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Пользователь не найден в друзьях"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Друг удален"})
}

func (h *FriendHandler) GetFriends(c *gin.Context) {
	viewerID, _ := c.Get("user_id")
	userID, _ := strconv.Atoi(c.Param("id"))

	var users []models.User
	err := database.DB.Raw(`
		SELECT u.* FROM users u
		WHERE u.id IN (
			SELECT friend_id FROM friendships WHERE user_id = ? AND status = 'accepted'
			UNION
			SELECT user_id FROM friendships WHERE friend_id = ? AND status = 'accepted'
		)
		ORDER BY COALESCE(u.last_seen, TIMESTAMP '1970-01-01') DESC, u.first_name ASC, u.last_name ASC
	`, userID, userID).Scan(&users).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка"})
		return
	}

	for i := range users {
		decorateUserRelationship(viewerID.(uint), &users[i])
	}

	c.JSON(http.StatusOK, gin.H{"friends": users})
}

func (h *FriendHandler) GetFriendsCount(c *gin.Context) {
	userID, _ := strconv.Atoi(c.Param("id"))

	var count int64
	database.DB.Model(&models.Friendship{}).
		Where("(user_id = ? OR friend_id = ?) AND status = ?", userID, userID, "accepted").
		Count(&count)

	c.JSON(http.StatusOK, gin.H{"count": count})
}

func (h *FriendHandler) GetFriendRequests(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var users []models.User
	err := database.DB.Raw(`
		SELECT u.* FROM users u
		JOIN friendships f ON f.user_id = u.id
		WHERE f.friend_id = ? AND f.status = 'pending'
		ORDER BY COALESCE(f.updated_at, f.created_at) DESC, u.first_name ASC, u.last_name ASC
	`, userID).Scan(&users).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка"})
		return
	}

	for i := range users {
		decorateUserRelationship(userID.(uint), &users[i])
	}

	c.JSON(http.StatusOK, gin.H{"requests": users})
}

func (h *FriendHandler) Subscribe(c *gin.Context) {
	userID, _ := c.Get("user_id")
	targetID, err := strconv.Atoi(c.Param("id"))
	if err != nil || targetID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный пользователь"})
		return
	}

	if userID.(uint) == uint(targetID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нельзя подписаться на себя"})
		return
	}

	var target models.User
	if err := database.DB.Select("id, username, first_name, last_name").First(&target, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь не найден"})
		return
	}

	var existing models.Subscription
	err := database.DB.Where("subscriber_id = ? AND user_id = ?", userID, targetID).First(&existing).Error
	if err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Уже подписан"})
		return
	}

	sub := &models.Subscription{
		SubscriberID: userID.(uint),
		UserID:       uint(targetID),
	}

	if err := database.DB.Create(sub).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка подписки"})
		return
	}

	var subscriber models.User
	database.DB.Select("id, username, first_name, last_name").First(&subscriber, userID)
	notification := &models.Notification{
		UserID:  uint(targetID),
		Type:    "subscription",
		Content: displayName(subscriber) + " подписался(-ась) на вас",
		Link:    "/profile/" + strconv.Itoa(int(userID.(uint))),
	}
	database.DB.Create(notification)

	c.JSON(http.StatusOK, gin.H{"message": "Подписка оформлена"})
}

func (h *FriendHandler) Unsubscribe(c *gin.Context) {
	userID, _ := c.Get("user_id")
	targetID, err := strconv.Atoi(c.Param("id"))
	if err != nil || targetID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный пользователь"})
		return
	}

	result := database.DB.Where("subscriber_id = ? AND user_id = ?", userID, targetID).Delete(&models.Subscription{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Подписка не найдена"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Подписка отменена"})
}

func (h *FriendHandler) GetSubscribers(c *gin.Context) {
	viewerID, _ := c.Get("user_id")
	userID, _ := strconv.Atoi(c.Param("id"))

	var users []models.User
	err := database.DB.Raw(`
		SELECT u.* FROM users u
		JOIN subscriptions s ON s.subscriber_id = u.id
		WHERE s.user_id = ?
		ORDER BY COALESCE(s.created_at, u.last_seen) DESC, u.first_name ASC, u.last_name ASC
	`, userID).Scan(&users).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка"})
		return
	}

	for i := range users {
		decorateUserRelationship(viewerID.(uint), &users[i])
	}

	c.JSON(http.StatusOK, gin.H{"subscribers": users})
}

func (h *FriendHandler) GetSubscribersCount(c *gin.Context) {
	userID, _ := strconv.Atoi(c.Param("id"))

	var count int64
	database.DB.Model(&models.Subscription{}).Where("user_id = ?", userID).Count(&count)

	c.JSON(http.StatusOK, gin.H{"count": count})
}

func (h *FriendHandler) GetSubscriptions(c *gin.Context) {
	viewerID, _ := c.Get("user_id")
	userID, _ := strconv.Atoi(c.Param("id"))

	var users []models.User
	err := database.DB.Raw(`
		SELECT u.* FROM users u
		JOIN subscriptions s ON s.user_id = u.id
		WHERE s.subscriber_id = ?
		ORDER BY COALESCE(s.created_at, u.last_seen) DESC, u.first_name ASC, u.last_name ASC
	`, userID).Scan(&users).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка"})
		return
	}

	for i := range users {
		decorateUserRelationship(viewerID.(uint), &users[i])
	}

	c.JSON(http.StatusOK, gin.H{"subscriptions": users})
}

func (h *FriendHandler) GetSubscriptionsCount(c *gin.Context) {
	userID, _ := strconv.Atoi(c.Param("id"))

	var count int64
	database.DB.Model(&models.Subscription{}).Where("subscriber_id = ?", userID).Count(&count)

	c.JSON(http.StatusOK, gin.H{"count": count})
}

func (h *FriendHandler) CheckFriendship(c *gin.Context) {
	userID, _ := c.Get("user_id")
	targetID, _ := strconv.Atoi(c.Param("id"))

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
			c.JSON(http.StatusOK, gin.H{"status": "subscribed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "none"})
		return
	}

	if friendship.Status == "pending" {
		if friendship.UserID == userID {
			c.JSON(http.StatusOK, gin.H{"status": "request_sent"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "request_received"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "friends"})
}

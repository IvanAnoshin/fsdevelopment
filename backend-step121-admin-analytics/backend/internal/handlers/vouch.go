package handlers

import (
	"net/http"
	"strconv"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"friendscape/internal/realtime"
	"github.com/gin-gonic/gin"
)

type VouchHandler struct{}

func NewVouchHandler() *VouchHandler {
	return &VouchHandler{}
}

func buildVouchSummary(viewerID uint, targetID uint) (int64, bool, error) {
	var count int64
	if err := database.DB.Model(&models.Vouch{}).Where("vouchee_id = ?", targetID).Count(&count).Error; err != nil {
		return 0, false, err
	}

	vouchedByMe := false
	if viewerID != 0 && viewerID != targetID {
		var myCount int64
		if err := database.DB.Model(&models.Vouch{}).Where("voucher_id = ? AND vouchee_id = ?", viewerID, targetID).Count(&myCount).Error; err != nil {
			return 0, false, err
		}
		vouchedByMe = myCount > 0
	}

	return count, vouchedByMe, nil
}

func (h *VouchHandler) VouchForUser(c *gin.Context) {
	userIDValue, _ := c.Get("user_id")
	voucherID, _ := userIDValue.(uint)
	voucheeID, err := strconv.Atoi(c.Param("id"))
	if err != nil || voucheeID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный пользователь"})
		return
	}

	if voucherID == uint(voucheeID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нельзя поручиться за себя"})
		return
	}

	var vouchee models.User
	if err := database.DB.Select("id, username, first_name, last_name").First(&vouchee, voucheeID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь не найден"})
		return
	}

	vouch := &models.Vouch{
		VoucherID: voucherID,
		VoucheeID: uint(voucheeID),
		Weight:    1,
	}

	if err := database.DB.Create(vouch).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Вы уже поручились за этого пользователя"})
		return
	}

	var sender models.User
	database.DB.Select("id, username, first_name, last_name").First(&sender, voucherID)
	notification := &models.Notification{
		UserID:  uint(voucheeID),
		Type:    "vouch",
		Content: displayName(sender) + " поручился(-ась) за вас",
		Link:    "/profile/" + strconv.Itoa(voucheeID),
	}
	if err := database.DB.Create(notification).Error; err == nil {
		realtime.DefaultBroker.PublishToUser(uint(voucheeID), realtime.Event{
			Type:    "notification:new",
			Channel: "notifications",
			Data: map[string]any{
				"notification": notification,
			},
		})
	}

	count, vouchedByMe, summaryErr := buildVouchSummary(voucherID, uint(voucheeID))
	if summaryErr != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Поручительство оформлено"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":        "Поручительство оформлено",
		"vouches_count":  count,
		"vouched_by_me":  vouchedByMe,
		"target_user_id": voucheeID,
	})
}

func (h *VouchHandler) UnvouchForUser(c *gin.Context) {
	userIDValue, _ := c.Get("user_id")
	voucherID, _ := userIDValue.(uint)
	voucheeID, err := strconv.Atoi(c.Param("id"))
	if err != nil || voucheeID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный пользователь"})
		return
	}

	result := database.DB.Where("voucher_id = ? AND vouchee_id = ?", voucherID, voucheeID).Delete(&models.Vouch{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось отозвать поручительство"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Поручительство не найдено"})
		return
	}

	count, vouchedByMe, summaryErr := buildVouchSummary(voucherID, uint(voucheeID))
	if summaryErr != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Поручительство отозвано"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":        "Поручительство отозвано",
		"vouches_count":  count,
		"vouched_by_me":  vouchedByMe,
		"target_user_id": voucheeID,
	})
}

func (h *VouchHandler) GetUserVouches(c *gin.Context) {
	targetID, err := strconv.Atoi(c.Param("id"))
	if err != nil || targetID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный пользователь"})
		return
	}

	viewerIDValue, _ := c.Get("user_id")
	viewerID, _ := viewerIDValue.(uint)

	var users []models.User
	err = database.DB.
		Joins("JOIN vouches ON vouches.voucher_id = users.id").
		Where("vouches.vouchee_id = ?", targetID).
		Order("vouches.created_at DESC").
		Select("users.id, users.username, users.first_name, users.last_name, users.avatar, users.bio, users.city, users.relationship, users.is_private, users.is_pioneer").
		Find(&users).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки поручительств"})
		return
	}

	for index := range users {
		decorateUserAccess(&users[index])
		decorateUserTrust(&users[index], viewerID)
	}

	count, vouchedByMe, summaryErr := buildVouchSummary(viewerID, uint(targetID))
	if summaryErr != nil {
		c.JSON(http.StatusOK, gin.H{"vouches": users})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"vouches":        users,
		"vouches_count":  count,
		"vouched_by_me":  vouchedByMe,
		"target_user_id": targetID,
	})
}

package handlers

import (
	"net/http"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type DeviceHandler struct{}

func NewDeviceHandler() *DeviceHandler {
	return &DeviceHandler{}
}

type UpdateDevicePINRequest struct {
	PIN *string `json:"pin"`
}

func isFourDigitPIN(value string) bool {
	if len(value) != 4 {
		return false
	}
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}

func (h *DeviceHandler) GetDevices(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var devices []models.TrustedDevice
	if err := database.DB.Where("user_id = ?", userID).Order("last_used DESC").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки устройств"})
		return
	}

	currentDeviceID := generateDeviceID(c)
	now := time.Now()
	response := make([]gin.H, 0, len(devices))
	for _, device := range devices {
		response = append(response, gin.H{
			"id":              device.ID,
			"user_id":         device.UserID,
			"device_id":       device.DeviceID,
			"device_name":     device.DeviceName,
			"user_agent":      device.UserAgent,
			"ip":              device.IP,
			"pin_enabled":     device.PINEnabled,
			"sessions_count":  device.SessionsCount,
			"dfsn_sessions":   device.DFSNSessions,
			"dfsn_average":    device.DFSNAverage,
			"dfsn_date":       device.DFSNDate,
			"trusted_by_dfsn": device.TrustedByDFSN,
			"trusted_since":   device.TrustedSince,
			"last_used":       device.LastUsed,
			"expires_at":      device.ExpiresAt,
			"created_at":      device.CreatedAt,
			"is_current":      device.DeviceID == currentDeviceID,
			"trust_is_active": !device.ExpiresAt.IsZero() && device.ExpiresAt.After(now),
		})
	}

	c.JSON(http.StatusOK, gin.H{"devices": response})
}

func (h *DeviceHandler) GetDevice(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	deviceID := c.Param("deviceId")

	var device models.TrustedDevice
	if err := database.DB.Where("user_id = ? AND device_id = ?", userID, deviceID).First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Устройство не найдено"})
		return
	}

	currentDeviceID := generateDeviceID(c)
	now := time.Now()
	c.JSON(http.StatusOK, gin.H{
		"id":              device.ID,
		"user_id":         device.UserID,
		"device_id":       device.DeviceID,
		"device_name":     device.DeviceName,
		"user_agent":      device.UserAgent,
		"ip":              device.IP,
		"pin_enabled":     device.PINEnabled,
		"sessions_count":  device.SessionsCount,
		"dfsn_sessions":   device.DFSNSessions,
		"dfsn_average":    device.DFSNAverage,
		"dfsn_date":       device.DFSNDate,
		"trusted_by_dfsn": device.TrustedByDFSN,
		"trusted_since":   device.TrustedSince,
		"last_used":       device.LastUsed,
		"expires_at":      device.ExpiresAt,
		"created_at":      device.CreatedAt,
		"is_current":      device.DeviceID == currentDeviceID,
		"trust_is_active": !device.ExpiresAt.IsZero() && device.ExpiresAt.After(now),
	})
}

func (h *DeviceHandler) RemoveDevice(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	deviceID := c.Param("deviceId")

	result := database.DB.Where("user_id = ? AND device_id = ?", userID, deviceID).Delete(&models.TrustedDevice{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Устройство не найдено"})
		return
	}

	_ = database.DB.Where("user_id = ? AND device_id = ?", userID, deviceID).Delete(&models.AuthSession{}).Error
	_ = revokeE2EEDeviceRecords(userID.(uint), deviceID)

	c.JSON(http.StatusOK, gin.H{
		"message":         "Устройство удалено",
		"removed_current": deviceID == generateDeviceID(c),
	})
}

func (h *DeviceHandler) UpdateDevicePIN(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	deviceID := c.Param("deviceId")
	currentDeviceID := generateDeviceID(c)
	if deviceID != currentDeviceID {
		c.JSON(http.StatusForbidden, gin.H{"error": "PIN можно менять только на текущем устройстве"})
		return
	}

	var req UpdateDevicePINRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	var device models.TrustedDevice
	if err := database.DB.Where("user_id = ? AND device_id = ?", userID, deviceID).First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Устройство не найдено"})
		return
	}

	if req.PIN == nil || strings.TrimSpace(*req.PIN) == "" {
		device.PINEnabled = false
		device.PINHash = ""
	} else {
		pin := strings.TrimSpace(*req.PIN)
		if !isFourDigitPIN(pin) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "PIN должен состоять из 4 цифр"})
			return
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить PIN"})
			return
		}

		device.PINEnabled = true
		device.PINHash = string(hash)
	}

	if err := database.DB.Save(&device).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить устройство"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "PIN обновлён",
		"device_id":   device.DeviceID,
		"pin_enabled": device.PINEnabled,
	})
}

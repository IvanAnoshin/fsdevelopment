package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type E2EEHandler struct{}

func NewE2EEHandler() *E2EEHandler {
	return &E2EEHandler{}
}

type registerE2EEOneTimePreKey struct {
	KeyID     string `json:"key_id"`
	PublicKey string `json:"public_key"`
}

type registerE2EEDeviceRequest struct {
	DeviceID              string                      `json:"device_id" binding:"required"`
	Label                 string                      `json:"label"`
	Algorithm             string                      `json:"algorithm"`
	IdentitySigningKey    string                      `json:"identity_signing_key" binding:"required"`
	IdentityExchangeKey   string                      `json:"identity_exchange_key" binding:"required"`
	SignedPreKey          string                      `json:"signed_pre_key" binding:"required"`
	SignedPreKeySignature string                      `json:"signed_pre_key_signature" binding:"required"`
	SignedPreKeyID        string                      `json:"signed_pre_key_id"`
	OneTimePreKeys        []registerE2EEOneTimePreKey `json:"one_time_prekeys"`
}

type upsertE2EEBackupRequest struct {
	Version           int    `json:"version"`
	Algorithm         string `json:"algorithm"`
	KDF               string `json:"kdf"`
	KDFIterations     int    `json:"kdf_iterations"`
	Salt              string `json:"salt" binding:"required"`
	IV                string `json:"iv" binding:"required"`
	Ciphertext        string `json:"ciphertext" binding:"required"`
	SourceDeviceID    string `json:"source_device_id"`
	SourceFingerprint string `json:"source_fingerprint"`
	BackupScope       string `json:"backup_scope"`
}

func normalizeBundleField(value string, limit int) string {
	trimmed := strings.TrimSpace(value)
	if limit > 0 && len(trimmed) > limit {
		return trimmed[:limit]
	}
	return trimmed
}

func sanitizeE2EEDevicePayload(req *registerE2EEDeviceRequest) {
	req.DeviceID = normalizeBundleField(req.DeviceID, 128)
	req.Label = normalizeBundleField(req.Label, 160)
	req.Algorithm = normalizeBundleField(req.Algorithm, 64)
	if req.Algorithm == "" {
		req.Algorithm = "p256-e2ee-v1"
	}
	req.IdentitySigningKey = strings.TrimSpace(req.IdentitySigningKey)
	req.IdentityExchangeKey = strings.TrimSpace(req.IdentityExchangeKey)
	req.SignedPreKey = strings.TrimSpace(req.SignedPreKey)
	req.SignedPreKeySignature = strings.TrimSpace(req.SignedPreKeySignature)
	req.SignedPreKeyID = normalizeBundleField(req.SignedPreKeyID, 128)
	for index := range req.OneTimePreKeys {
		req.OneTimePreKeys[index].KeyID = normalizeBundleField(req.OneTimePreKeys[index].KeyID, 128)
		req.OneTimePreKeys[index].PublicKey = strings.TrimSpace(req.OneTimePreKeys[index].PublicKey)
	}
}

func sanitizeE2EEBackupPayload(req *upsertE2EEBackupRequest) {
	req.Version = maxInt(req.Version, 1)
	req.Algorithm = normalizeBundleField(req.Algorithm, 64)
	if req.Algorithm == "" {
		req.Algorithm = "pbkdf2-aesgcm-v1"
	}
	req.KDF = normalizeBundleField(req.KDF, 64)
	if req.KDF == "" {
		req.KDF = "PBKDF2-SHA256"
	}
	req.KDFIterations = clampInt(req.KDFIterations, 100000, 1000000, 250000)
	req.Salt = strings.TrimSpace(req.Salt)
	req.IV = strings.TrimSpace(req.IV)
	req.Ciphertext = strings.TrimSpace(req.Ciphertext)
	req.SourceDeviceID = normalizeBundleField(req.SourceDeviceID, 128)
	req.SourceFingerprint = normalizeBundleField(req.SourceFingerprint, 255)
	req.BackupScope = normalizeBundleField(req.BackupScope, 32)
	if req.BackupScope == "" {
		req.BackupScope = "bundle"
	}
}

func validateE2EEDevicePayload(req registerE2EEDeviceRequest) string {
	if req.DeviceID == "" {
		return "Не найден идентификатор устройства E2EE"
	}
	if req.IdentitySigningKey == "" || req.IdentityExchangeKey == "" {
		return "Нужны публичные identity keys"
	}
	if req.SignedPreKey == "" || req.SignedPreKeySignature == "" {
		return "Нужен signed prekey bundle"
	}
	if len(req.OneTimePreKeys) > 128 {
		return "Слишком много one-time prekeys за один запрос"
	}
	return ""
}

func validateE2EEBackupPayload(req upsertE2EEBackupRequest) string {
	if req.Salt == "" || req.IV == "" || req.Ciphertext == "" {
		return "Нужен полный зашифрованный backup payload"
	}
	if len(req.Salt) > 2048 || len(req.IV) > 2048 {
		return "Некорректные параметры backup envelope"
	}
	if len(req.Ciphertext) > 3_500_000 {
		return "Слишком большой E2EE backup"
	}
	return ""
}

func clampInt(value, minValue, maxValue, fallback int) int {
	if value <= 0 {
		return fallback
	}
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func maxInt(value, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

func buildE2EEDeviceResponse(device models.E2EEDevice, availablePrekeys int64) gin.H {
	return gin.H{
		"device_id":                  device.DeviceID,
		"label":                      device.Label,
		"algorithm":                  device.Algorithm,
		"identity_signing_key":       device.IdentitySigningKey,
		"identity_exchange_key":      device.IdentityExchangeKey,
		"signed_pre_key":             device.SignedPreKey,
		"signed_pre_key_signature":   device.SignedPreKeySignature,
		"signed_pre_key_id":          device.SignedPreKeyID,
		"last_prekey_at":             device.LastPrekeyAt,
		"last_seen_at":               device.LastSeenAt,
		"created_at":                 device.CreatedAt,
		"updated_at":                 device.UpdatedAt,
		"available_one_time_prekeys": availablePrekeys,
	}
}

func buildE2EEBackupResponse(backup models.E2EEKeyBackup) gin.H {
	return gin.H{
		"exists":             true,
		"version":            backup.Version,
		"algorithm":          backup.Algorithm,
		"kdf":                backup.KDF,
		"kdf_iterations":     backup.KDFIterations,
		"source_device_id":   backup.SourceDeviceID,
		"source_fingerprint": backup.SourceFingerprint,
		"backup_scope":       backup.BackupScope,
		"created_at":         backup.CreatedAt,
		"updated_at":         backup.UpdatedAt,
		"last_downloaded_at": backup.LastDownloadedAt,
		"last_restored_at":   backup.LastRestoredAt,
	}
}

func revokeE2EEDeviceRecords(userID uint, deviceID string) error {
	trimmed := strings.TrimSpace(deviceID)
	if trimmed == "" {
		return nil
	}
	now := time.Now()
	if err := database.DB.Model(&models.E2EEDevice{}).Where("user_id = ? AND device_id = ? AND revoked_at IS NULL", userID, trimmed).Updates(map[string]any{
		"revoked_at":   now,
		"last_seen_at": now,
	}).Error; err != nil {
		return err
	}
	if err := database.DB.Where("user_id = ? AND device_id = ?", userID, trimmed).Delete(&models.E2EEOneTimePreKey{}).Error; err != nil {
		return err
	}
	return nil
}

func (h *E2EEHandler) RegisterDevice(c *gin.Context) {
	userIDAny, _ := c.Get("user_id")
	userID := userIDAny.(uint)

	var req registerE2EEDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат E2EE bundle"})
		return
	}
	sanitizeE2EEDevicePayload(&req)
	if msg := validateE2EEDevicePayload(req); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	now := time.Now()
	var device models.E2EEDevice
	err := database.DB.Where("user_id = ? AND device_id = ?", userID, req.DeviceID).First(&device).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить E2EE устройство"})
		return
	}

	if err == gorm.ErrRecordNotFound {
		device = models.E2EEDevice{
			UserID:                userID,
			DeviceID:              req.DeviceID,
			Label:                 req.Label,
			Algorithm:             req.Algorithm,
			IdentitySigningKey:    req.IdentitySigningKey,
			IdentityExchangeKey:   req.IdentityExchangeKey,
			SignedPreKey:          req.SignedPreKey,
			SignedPreKeySignature: req.SignedPreKeySignature,
			SignedPreKeyID:        req.SignedPreKeyID,
			LastPrekeyAt:          now,
			LastSeenAt:            now,
		}
		if err := database.DB.Create(&device).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось зарегистрировать E2EE устройство"})
			return
		}
	} else {
		updates := map[string]any{
			"label":                    req.Label,
			"algorithm":                req.Algorithm,
			"identity_signing_key":     req.IdentitySigningKey,
			"identity_exchange_key":    req.IdentityExchangeKey,
			"signed_pre_key":           req.SignedPreKey,
			"signed_pre_key_signature": req.SignedPreKeySignature,
			"signed_pre_key_id":        req.SignedPreKeyID,
			"last_prekey_at":           now,
			"last_seen_at":             now,
			"revoked_at":               nil,
		}
		if err := database.DB.Model(&device).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить E2EE устройство"})
			return
		}
		_ = database.DB.First(&device, device.ID).Error
	}

	if len(req.OneTimePreKeys) > 0 {
		_ = database.DB.Where("user_id = ? AND device_id = ? AND claimed_at IS NULL", userID, req.DeviceID).Delete(&models.E2EEOneTimePreKey{}).Error
		prekeys := make([]models.E2EEOneTimePreKey, 0, len(req.OneTimePreKeys))
		seen := map[string]struct{}{}
		for _, item := range req.OneTimePreKeys {
			if item.KeyID == "" || item.PublicKey == "" {
				continue
			}
			if _, exists := seen[item.KeyID]; exists {
				continue
			}
			seen[item.KeyID] = struct{}{}
			prekeys = append(prekeys, models.E2EEOneTimePreKey{UserID: userID, DeviceID: req.DeviceID, KeyID: item.KeyID, PublicKey: item.PublicKey})
		}
		if len(prekeys) > 0 {
			if err := database.DB.Create(&prekeys).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить one-time prekeys"})
				return
			}
		}
	}

	var availableCount int64
	database.DB.Model(&models.E2EEOneTimePreKey{}).Where("user_id = ? AND device_id = ? AND claimed_at IS NULL", userID, req.DeviceID).Count(&availableCount)
	c.JSON(http.StatusOK, gin.H{"message": "E2EE устройство зарегистрировано", "device": buildE2EEDeviceResponse(device, availableCount)})
}

func (h *E2EEHandler) GetDevices(c *gin.Context) {
	userIDAny, _ := c.Get("user_id")
	userID := userIDAny.(uint)

	var devices []models.E2EEDevice
	if err := database.DB.Where("user_id = ? AND revoked_at IS NULL", userID).Order("updated_at DESC").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить E2EE устройства"})
		return
	}

	response := make([]gin.H, 0, len(devices))
	for _, device := range devices {
		var availableCount int64
		database.DB.Model(&models.E2EEOneTimePreKey{}).Where("user_id = ? AND device_id = ? AND claimed_at IS NULL", userID, device.DeviceID).Count(&availableCount)
		response = append(response, buildE2EEDeviceResponse(device, availableCount))
	}

	c.JSON(http.StatusOK, gin.H{"devices": response})
}

func (h *E2EEHandler) RevokeDevice(c *gin.Context) {
	userIDAny, _ := c.Get("user_id")
	userID := userIDAny.(uint)
	deviceID := normalizeBundleField(c.Param("deviceId"), 128)
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Не найден E2EE device для отзыва"})
		return
	}
	var existing models.E2EEDevice
	if err := database.DB.Where("user_id = ? AND device_id = ? AND revoked_at IS NULL", userID, deviceID).First(&existing).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "E2EE устройство не найдено"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось отозвать E2EE устройство"})
		return
	}
	if err := revokeE2EEDeviceRecords(userID, deviceID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось отозвать E2EE устройство"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "E2EE устройство отозвано", "device_id": deviceID})
}

func (h *E2EEHandler) ResetCurrentDevice(c *gin.Context) {
	userIDAny, _ := c.Get("user_id")
	userID := userIDAny.(uint)
	deviceID := normalizeBundleField(c.GetHeader("X-E2EE-Device-ID"), 128)
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Не найден текущий E2EE device"})
		return
	}
	if err := revokeE2EEDeviceRecords(userID, deviceID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сбросить E2EE устройство"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Текущий E2EE device сброшен", "device_id": deviceID})
}

func (h *E2EEHandler) GetStatus(c *gin.Context) {
	userIDAny, _ := c.Get("user_id")
	userID := userIDAny.(uint)
	currentDeviceID := strings.TrimSpace(c.GetHeader("X-E2EE-Device-ID"))

	var total int64
	database.DB.Model(&models.E2EEDevice{}).Where("user_id = ? AND revoked_at IS NULL", userID).Count(&total)

	status := gin.H{
		"enabled":            total > 0,
		"registered_devices": total,
		"current_device_id":  currentDeviceID,
	}
	if currentDeviceID != "" {
		var current models.E2EEDevice
		if err := database.DB.Where("user_id = ? AND device_id = ? AND revoked_at IS NULL", userID, currentDeviceID).First(&current).Error; err == nil {
			var availableCount int64
			database.DB.Model(&models.E2EEOneTimePreKey{}).Where("user_id = ? AND device_id = ? AND claimed_at IS NULL", userID, currentDeviceID).Count(&availableCount)
			status["current_device"] = buildE2EEDeviceResponse(current, availableCount)
			status["current_device_registered"] = true
		} else {
			status["current_device_registered"] = false
		}
	}

	var backup models.E2EEKeyBackup
	if err := database.DB.Where("user_id = ?", userID).First(&backup).Error; err == nil {
		status["backup"] = buildE2EEBackupResponse(backup)
	}

	c.JSON(http.StatusOK, status)
}

func (h *E2EEHandler) GetPreKeyBundle(c *gin.Context) {
	userIDValue, err := strconv.Atoi(c.Param("userId"))
	if err != nil || userIDValue <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный пользователь для prekey bundle"})
		return
	}

	var devices []models.E2EEDevice
	if err := database.DB.Where("user_id = ? AND revoked_at IS NULL", uint(userIDValue)).Order("updated_at DESC").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить prekey bundle"})
		return
	}
	if len(devices) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "У пользователя нет активных E2EE устройств"})
		return
	}

	bundles := make([]gin.H, 0, len(devices))
	for _, device := range devices {
		bundle := gin.H{
			"device_id":                device.DeviceID,
			"label":                    device.Label,
			"algorithm":                device.Algorithm,
			"identity_signing_key":     device.IdentitySigningKey,
			"identity_exchange_key":    device.IdentityExchangeKey,
			"signed_pre_key":           device.SignedPreKey,
			"signed_pre_key_signature": device.SignedPreKeySignature,
			"signed_pre_key_id":        device.SignedPreKeyID,
		}
		bundles = append(bundles, bundle)
	}

	c.JSON(http.StatusOK, gin.H{"user_id": uint(userIDValue), "devices": bundles})
}

func (h *E2EEHandler) GetBackupStatus(c *gin.Context) {
	userIDAny, _ := c.Get("user_id")
	userID := userIDAny.(uint)

	var backup models.E2EEKeyBackup
	if err := database.DB.Where("user_id = ?", userID).First(&backup).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusOK, gin.H{"exists": false})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить статус E2EE backup"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"backup": buildE2EEBackupResponse(backup)})
}

func (h *E2EEHandler) DownloadBackup(c *gin.Context) {
	userIDAny, _ := c.Get("user_id")
	userID := userIDAny.(uint)

	var backup models.E2EEKeyBackup
	if err := database.DB.Where("user_id = ?", userID).First(&backup).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "E2EE backup ещё не создан"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить E2EE backup"})
		return
	}

	now := time.Now()
	_ = database.DB.Model(&backup).Update("last_downloaded_at", now).Error

	c.JSON(http.StatusOK, gin.H{
		"backup": gin.H{
			"version":            backup.Version,
			"algorithm":          backup.Algorithm,
			"kdf":                backup.KDF,
			"kdf_iterations":     backup.KDFIterations,
			"salt":               backup.Salt,
			"iv":                 backup.IV,
			"ciphertext":         backup.Ciphertext,
			"source_device_id":   backup.SourceDeviceID,
			"source_fingerprint": backup.SourceFingerprint,
			"backup_scope":       backup.BackupScope,
			"updated_at":         backup.UpdatedAt,
		},
	})
}

func (h *E2EEHandler) UpsertBackup(c *gin.Context) {
	userIDAny, _ := c.Get("user_id")
	userID := userIDAny.(uint)

	var req upsertE2EEBackupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат E2EE backup"})
		return
	}
	sanitizeE2EEBackupPayload(&req)
	if msg := validateE2EEBackupPayload(req); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	var backup models.E2EEKeyBackup
	err := database.DB.Where("user_id = ?", userID).First(&backup).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить E2EE backup"})
		return
	}

	if err == gorm.ErrRecordNotFound {
		backup = models.E2EEKeyBackup{
			UserID:            userID,
			Version:           req.Version,
			Algorithm:         req.Algorithm,
			KDF:               req.KDF,
			KDFIterations:     req.KDFIterations,
			Salt:              req.Salt,
			IV:                req.IV,
			Ciphertext:        req.Ciphertext,
			SourceDeviceID:    req.SourceDeviceID,
			SourceFingerprint: req.SourceFingerprint,
			BackupScope:       req.BackupScope,
		}
		if err := database.DB.Create(&backup).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать E2EE backup"})
			return
		}
	} else {
		updates := map[string]any{
			"version":            req.Version,
			"algorithm":          req.Algorithm,
			"kdf":                req.KDF,
			"kdf_iterations":     req.KDFIterations,
			"salt":               req.Salt,
			"iv":                 req.IV,
			"ciphertext":         req.Ciphertext,
			"source_device_id":   req.SourceDeviceID,
			"source_fingerprint": req.SourceFingerprint,
			"backup_scope":       req.BackupScope,
		}
		if err := database.DB.Model(&backup).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить E2EE backup"})
			return
		}
		_ = database.DB.First(&backup, backup.ID).Error
	}

	c.JSON(http.StatusOK, gin.H{"message": "E2EE backup сохранён", "backup": buildE2EEBackupResponse(backup)})
}

func (h *E2EEHandler) MarkBackupRestored(c *gin.Context) {
	userIDAny, _ := c.Get("user_id")
	userID := userIDAny.(uint)

	var backup models.E2EEKeyBackup
	if err := database.DB.Where("user_id = ?", userID).First(&backup).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "E2EE backup ещё не создан"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить E2EE backup"})
		return
	}
	now := time.Now()
	if err := database.DB.Model(&backup).Updates(map[string]any{"last_restored_at": now}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось отметить восстановление E2EE backup"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Восстановление E2EE backup отмечено"})
}

func (h *E2EEHandler) DeleteBackup(c *gin.Context) {
	userIDAny, _ := c.Get("user_id")
	userID := userIDAny.(uint)
	if err := database.DB.Where("user_id = ?", userID).Delete(&models.E2EEKeyBackup{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить E2EE backup"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "E2EE backup удалён"})
}

package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"gorm.io/gorm"
)

func GenerateSessionID() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func HashClientIP(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(trimmed))
	return hex.EncodeToString(sum[:])
}

func FindActiveSession(sessionID string, userID uint) (*models.AuthSession, error) {
	trimmed := strings.TrimSpace(sessionID)
	if trimmed == "" {
		return nil, errors.New("empty session id")
	}
	var session models.AuthSession
	err := database.DB.Where("session_id = ? AND user_id = ? AND revoked_at IS NULL", trimmed, userID).First(&session).Error
	if err != nil {
		return nil, err
	}
	if session.ExpiresAt.Before(time.Now()) {
		return nil, gorm.ErrRecordNotFound
	}
	return &session, nil
}

func RevokeSession(sessionID string, userID uint) error {
	trimmed := strings.TrimSpace(sessionID)
	if trimmed == "" || userID == 0 {
		return nil
	}
	now := time.Now()
	return database.DB.Model(&models.AuthSession{}).Where("session_id = ? AND user_id = ? AND revoked_at IS NULL", trimmed, userID).Updates(map[string]any{
		"revoked_at": now,
		"updated_at": now,
	}).Error
}

func RevokeAllUserSessions(userID uint) error {
	if userID == 0 {
		return nil
	}
	now := time.Now()
	return database.DB.Model(&models.AuthSession{}).Where("user_id = ? AND revoked_at IS NULL", userID).Updates(map[string]any{
		"revoked_at": now,
		"updated_at": now,
	}).Error
}

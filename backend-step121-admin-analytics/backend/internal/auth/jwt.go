package auth

import (
	"errors"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var jwtKey []byte

const (
	TokenKindAccess  = "access"
	TokenKindRefresh = "refresh"
	TokenKindTemp    = "temp"
	TokenKindRTT     = "realtime_ticket"
)

func InitJWT() {
	key := os.Getenv("JWT_SECRET")
	if key == "" {
		panic("❌ JWT_SECRET не задан в переменных окружения")
	}
	jwtKey = []byte(key)
}

type Claims struct {
	UserID       uint   `json:"user_id"`
	TokenVersion uint   `json:"token_version"`
	SessionID    string `json:"sid,omitempty"`
	Kind         string `json:"kind,omitempty"`
	IsTemp       bool   `json:"is_temp,omitempty"`
	jwt.RegisteredClaims
}

func signClaims(claims *Claims) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtKey)
}

func GenerateAccessJWT(userID uint, tokenVersion uint, sessionID string) (string, error) {
	claims := &Claims{
		UserID:       userID,
		TokenVersion: tokenVersion,
		SessionID:    strings.TrimSpace(sessionID),
		Kind:         TokenKindAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(10 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return signClaims(claims)
}

func GenerateRefreshJWT(userID uint, tokenVersion uint, sessionID string) (string, error) {
	claims := &Claims{
		UserID:       userID,
		TokenVersion: tokenVersion,
		SessionID:    strings.TrimSpace(sessionID),
		Kind:         TokenKindRefresh,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return signClaims(claims)
}

func GenerateRealtimeTicket(userID uint, tokenVersion uint, sessionID string) (string, error) {
	claims := &Claims{
		UserID:       userID,
		TokenVersion: tokenVersion,
		SessionID:    strings.TrimSpace(sessionID),
		Kind:         TokenKindRTT,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(60 * time.Second)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return signClaims(claims)
}

func GenerateJWT(userID uint, tokenVersion uint) (string, error) {
	return GenerateAccessJWT(userID, tokenVersion, "")
}

func GenerateTempJWT(userID uint, tokenVersion uint) (string, error) {
	claims := &Claims{
		UserID:       userID,
		TokenVersion: tokenVersion,
		Kind:         TokenKindTemp,
		IsTemp:       true,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return signClaims(claims)
}

func ValidateJWT(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return jwtKey, nil
	})

	if err != nil || !token.Valid {
		return nil, errors.New("недействительный токен")
	}
	if claims.Kind == "" {
		claims.Kind = TokenKindAccess
	}
	return claims, nil
}

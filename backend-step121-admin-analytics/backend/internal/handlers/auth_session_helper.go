package handlers

import (
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"friendscape/internal/auth"
	"friendscape/internal/database"
	"friendscape/internal/models"
	"github.com/gin-gonic/gin"
)

const refreshCookieName = "__Host-friendscape_refresh"
const clientDeviceCookieName = "__Host-friendscape_device"
const clientDeviceContextKey = "client_device_id"

func parseAllowedWebOrigins() []string {
	origins := make([]string, 0, 4)
	seen := map[string]struct{}{}
	appendOrigin := func(raw string) {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			return
		}
		if parsed, err := url.Parse(trimmed); err == nil && parsed.Scheme != "" && parsed.Host != "" {
			trimmed = parsed.Scheme + "://" + parsed.Host
		}
		trimmed = strings.TrimRight(trimmed, "/")
		if trimmed == "" {
			return
		}
		if _, ok := seen[trimmed]; ok {
			return
		}
		seen[trimmed] = struct{}{}
		origins = append(origins, trimmed)
	}
	for _, raw := range strings.Split(strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS")), ",") {
		appendOrigin(raw)
	}
	appendOrigin(os.Getenv("APP_PUBLIC_URL"))
	if !isProductionApp() {
		appendOrigin("http://localhost:5173")
		appendOrigin("http://127.0.0.1:5173")
	}
	return origins
}

func requestOriginAllowed(c *gin.Context) bool {
	if fetchSite := strings.ToLower(strings.TrimSpace(c.GetHeader("Sec-Fetch-Site"))); fetchSite == "cross-site" {
		return false
	}
	allowed := parseAllowedWebOrigins()
	if len(allowed) == 0 {
		return true
	}
	matches := func(raw string) bool {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			return false
		}
		if parsed, err := url.Parse(trimmed); err == nil && parsed.Scheme != "" && parsed.Host != "" {
			trimmed = parsed.Scheme + "://" + parsed.Host
		}
		trimmed = strings.TrimRight(trimmed, "/")
		for _, candidate := range allowed {
			if strings.EqualFold(trimmed, candidate) {
				return true
			}
		}
		return false
	}
	if origin := c.GetHeader("Origin"); origin != "" {
		return matches(origin)
	}
	if referer := c.GetHeader("Referer"); referer != "" {
		return matches(referer)
	}
	return !isProductionApp()
}

func isProductionApp() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "production")
}

func normalizeClientDeviceID(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) < 32 || len(trimmed) > 128 {
		return ""
	}
	for _, r := range trimmed {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return ""
	}
	return trimmed
}

func readClientDeviceID(c *gin.Context) string {
	if c == nil {
		return ""
	}
	if value, ok := c.Get(clientDeviceContextKey); ok {
		if text, ok := value.(string); ok {
			if trimmed := normalizeClientDeviceID(strings.TrimSpace(text)); trimmed != "" {
				return trimmed
			}
		}
	}
	if raw, err := c.Cookie(clientDeviceCookieName); err == nil {
		if trimmed := normalizeClientDeviceID(raw); trimmed != "" {
			c.Set(clientDeviceContextKey, trimmed)
			return trimmed
		}
	}
	return ""
}

func EnsureClientDeviceID(c *gin.Context) string {
	if existing := readClientDeviceID(c); existing != "" {
		return existing
	}
	deviceID, err := auth.GenerateSessionID()
	if err != nil || deviceID == "" {
		return ""
	}
	maxAge := int((365 * 24 * time.Hour).Seconds())
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     clientDeviceCookieName,
		Value:    deviceID,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   isProductionApp(),
		SameSite: http.SameSiteLaxMode,
	})
	c.Set(clientDeviceContextKey, deviceID)
	return deviceID
}

func setRefreshCookie(c *gin.Context, token string, expiresAt time.Time) {
	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge < 0 {
		maxAge = 0
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     refreshCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   isProductionApp(),
		SameSite: http.SameSiteLaxMode,
	})
}

func clearRefreshCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isProductionApp(),
		SameSite: http.SameSiteLaxMode,
	})
}

func issueAuthSession(c *gin.Context, user *models.User, deviceID string) (string, string, *models.AuthSession, error) {
	sessionID, err := auth.GenerateSessionID()
	if err != nil {
		return "", "", nil, err
	}
	now := time.Now()
	session := &models.AuthSession{
		SessionID: sessionID,
		UserID:    user.ID,
		DeviceID:  strings.TrimSpace(deviceID),
		UserAgent: strings.TrimSpace(c.Request.UserAgent()),
		IPHash:    auth.HashClientIP(c.ClientIP()),
		LastSeen:  now,
		ExpiresAt: now.Add(30 * 24 * time.Hour),
	}
	if err := database.DB.Create(session).Error; err != nil {
		return "", "", nil, err
	}
	accessToken, err := auth.GenerateAccessJWT(user.ID, user.TokenVersion, session.SessionID)
	if err != nil {
		return "", "", nil, err
	}
	refreshToken, err := auth.GenerateRefreshJWT(user.ID, user.TokenVersion, session.SessionID)
	if err != nil {
		return "", "", nil, err
	}
	setRefreshCookie(c, refreshToken, session.ExpiresAt)
	return accessToken, refreshToken, session, nil
}

func refreshAuthSession(c *gin.Context, user *models.User, session *models.AuthSession) (string, string, error) {
	if user == nil || session == nil {
		return "", "", gormErrSessionNotFound
	}
	now := time.Now()
	session.LastSeen = now
	session.UserAgent = strings.TrimSpace(c.Request.UserAgent())
	session.IPHash = auth.HashClientIP(c.ClientIP())
	if session.ExpiresAt.Before(now.Add(7 * 24 * time.Hour)) {
		session.ExpiresAt = now.Add(30 * 24 * time.Hour)
	}
	if err := database.DB.Save(session).Error; err != nil {
		return "", "", err
	}
	accessToken, err := auth.GenerateAccessJWT(user.ID, user.TokenVersion, session.SessionID)
	if err != nil {
		return "", "", err
	}
	refreshToken, err := auth.GenerateRefreshJWT(user.ID, user.TokenVersion, session.SessionID)
	if err != nil {
		return "", "", err
	}
	setRefreshCookie(c, refreshToken, session.ExpiresAt)
	return accessToken, refreshToken, nil
}

func readRefreshClaims(c *gin.Context) (*auth.Claims, error) {
	cookie, err := c.Request.Cookie(refreshCookieName)
	if err != nil {
		return nil, err
	}
	claims, err := auth.ValidateJWT(strings.TrimSpace(cookie.Value))
	if err != nil {
		return nil, err
	}
	if claims.Kind != auth.TokenKindRefresh || claims.IsTemp {
		return nil, errInvalidRefreshToken
	}
	return claims, nil
}

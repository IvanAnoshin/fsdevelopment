package middleware

import (
	"net/http"
	"strings"

	"friendscape/internal/access"
	"friendscape/internal/auth"
	"friendscape/internal/database"
	"friendscape/internal/models"
	"github.com/gin-gonic/gin"
)

func readBearerClaims(c *gin.Context) (*auth.Claims, *models.User, bool) {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Требуется авторизация"})
		return nil, nil, false
	}

	parts := strings.Fields(authHeader)
	if len(parts) != 2 || parts[0] != "Bearer" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный формат токена"})
		return nil, nil, false
	}

	claims, err := auth.ValidateJWT(parts[1])
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Недействительный токен"})
		return nil, nil, false
	}

	var user models.User
	if err := database.DB.First(&user, claims.UserID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не найден"})
		return nil, nil, false
	}
	if err := access.EnsureBootstrapAdminForUser(&user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить права владельца"})
		return nil, nil, false
	}

	return claims, &user, true
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, user, ok := readBearerClaims(c)
		if !ok {
			c.Abort()
			return
		}

		if claims.IsTemp || claims.Kind == auth.TokenKindTemp || claims.Kind == auth.TokenKindRefresh || claims.Kind == auth.TokenKindRTT {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Текущий токен нельзя использовать для этого действия"})
			c.Abort()
			return
		}

		if user.TokenVersion != claims.TokenVersion {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Токен устарел, войдите заново"})
			c.Abort()
			return
		}

		if strings.TrimSpace(claims.SessionID) != "" {
			if _, err := auth.FindActiveSession(claims.SessionID, claims.UserID); err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Сессия завершена или устарела"})
				c.Abort()
				return
			}
		}

		role := access.NormalizeRole(user.Role, user.IsAdmin)
		c.Set("user_id", claims.UserID)
		c.Set("session_id", strings.TrimSpace(claims.SessionID))
		c.Set("is_temp_token", false)
		c.Set("is_admin", user.IsAdmin)
		c.Set("user_role", role)
		c.Set("permissions", access.PermissionsForRole(role, user.IsAdmin))
		c.Next()
	}
}

func TempAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, user, ok := readBearerClaims(c)
		if !ok {
			c.Abort()
			return
		}

		if !claims.IsTemp && claims.Kind != auth.TokenKindTemp {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Нужен временный токен восстановления"})
			c.Abort()
			return
		}

		if user.TokenVersion != claims.TokenVersion {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Токен восстановления устарел, начните процедуру заново"})
			c.Abort()
			return
		}

		if strings.TrimSpace(claims.SessionID) != "" {
			if _, err := auth.FindActiveSession(claims.SessionID, claims.UserID); err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Сессия завершена или устарела"})
				c.Abort()
				return
			}
		}

		role := access.NormalizeRole(user.Role, user.IsAdmin)
		c.Set("user_id", claims.UserID)
		c.Set("session_id", strings.TrimSpace(claims.SessionID))
		c.Set("is_temp_token", true)
		c.Set("is_admin", user.IsAdmin)
		c.Set("user_role", role)
		c.Set("permissions", access.PermissionsForRole(role, user.IsAdmin))
		c.Next()
	}
}

package middleware

import (
	"net/http"

	"friendscape/internal/access"
	"github.com/gin-gonic/gin"
)

func RequirePermission(permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("user_role")
		isAdmin, _ := c.Get("is_admin")
		roleValue, _ := role.(string)
		isAdminValue, _ := isAdmin.(bool)
		if !access.HasPermission(roleValue, isAdminValue, permission) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Недостаточно прав для этого действия"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func AdminMiddleware() gin.HandlerFunc {
	return RequirePermission(access.PermissionAdminPanel)
}

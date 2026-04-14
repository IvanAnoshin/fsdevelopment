package handlers

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"friendscape/internal/access"
	"friendscape/internal/database"
	"friendscape/internal/models"
	"github.com/gin-gonic/gin"
)

type AdminUsersHandler struct{}

func NewAdminUsersHandler() *AdminUsersHandler {
	return &AdminUsersHandler{}
}

func currentAdminUser(c *gin.Context) (*models.User, bool) {
	currentUserID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return nil, false
	}

	var currentUser models.User
	if err := database.DB.First(&currentUser, currentUserID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Пользователь не найден"})
		return nil, false
	}
	if err := access.EnsureBootstrapAdminForUser(&currentUser); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить права владельца"})
		return nil, false
	}

	if !access.CanAccessAdminPanel(currentUser.Role, currentUser.IsAdmin) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Доступ запрещён"})
		return nil, false
	}

	return &currentUser, true
}

func serializeAdminUser(user models.User) gin.H {
	_ = access.EnsureBootstrapAdminForUser(&user)
	role := access.NormalizeRole(user.Role, user.IsAdmin)
	return gin.H{
		"id":          user.ID,
		"username":    user.Username,
		"first_name":  user.FirstName,
		"last_name":   user.LastName,
		"is_admin":    user.IsAdmin,
		"role":        role,
		"permissions": access.PermissionsForRole(role, user.IsAdmin),
		"is_owner":    access.IsBootstrapOwner(user.ID),
	}
}

func loadTargetUser(c *gin.Context) (*models.User, bool) {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID"})
		return nil, false
	}

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь не найден"})
		return nil, false
	}
	if err := access.EnsureBootstrapAdminForUser(&user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить права владельца"})
		return nil, false
	}
	return &user, true
}

func countAdmins() (int64, error) {
	var adminCount int64
	if err := database.DB.Model(&models.User{}).Where("is_admin = ?", true).Count(&adminCount).Error; err != nil {
		return 0, err
	}
	return adminCount, nil
}

func ensureCanChangeRole(currentUser *models.User, targetUser *models.User, nextRole string) (string, bool) {
	if currentUser == nil || targetUser == nil {
		return "Пользователь не найден", false
	}
	nextRole = access.NormalizeRole(strings.TrimSpace(nextRole), false)
	if nextRole == access.RoleSupport {
		return "Роль support не назначается через этот модуль", false
	}
	if currentUser.ID == targetUser.ID && nextRole != access.RoleAdmin {
		return "Нельзя снять административные права с самого себя", false
	}
	if access.IsBootstrapOwner(targetUser.ID) && nextRole != access.RoleAdmin {
		return "Нельзя изменить роль владельца системы", false
	}
	if !access.CanAccessAdminPanel(currentUser.Role, currentUser.IsAdmin) {
		return "Доступ запрещён", false
	}
	return "", true
}

func applyUserRole(targetUser *models.User, nextRole string) error {
	nextRole = access.NormalizeRole(nextRole, nextRole == access.RoleAdmin)
	updates := map[string]any{"role": nextRole, "is_admin": nextRole == access.RoleAdmin}
	if err := database.DB.Model(targetUser).Updates(updates).Error; err != nil {
		return err
	}
	targetUser.Role = nextRole
	targetUser.IsAdmin = nextRole == access.RoleAdmin
	return nil
}

func (h *AdminUsersHandler) updateRole(c *gin.Context, nextRole string, successMessage string, logLabel string) {
	currentUser, ok := currentAdminUser(c)
	if !ok {
		return
	}
	targetUser, ok := loadTargetUser(c)
	if !ok {
		return
	}
	if msg, allowed := ensureCanChangeRole(currentUser, targetUser, nextRole); !allowed {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if access.NormalizeRole(targetUser.Role, targetUser.IsAdmin) == access.NormalizeRole(nextRole, nextRole == access.RoleAdmin) {
		c.JSON(http.StatusOK, gin.H{"message": "Роль уже установлена", "user": serializeAdminUser(*targetUser)})
		return
	}
	if targetUser.IsAdmin && nextRole != access.RoleAdmin {
		adminCount, err := countAdmins()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка проверки списка администраторов"})
			return
		}
		if adminCount <= 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Нельзя снять права с последнего администратора"})
			return
		}
	}
	if err := applyUserRole(targetUser, nextRole); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления роли"})
		return
	}
	log.Printf("🔐 Role change: actor=%d target=%d username=%s role=%s action=%s", currentUser.ID, targetUser.ID, targetUser.Username, targetUser.Role, logLabel)
	c.JSON(http.StatusOK, gin.H{"message": successMessage, "user": serializeAdminUser(*targetUser)})
}

func (h *AdminUsersHandler) MakeAdmin(c *gin.Context) {
	h.updateRole(c, access.RoleAdmin, "Пользователь назначен администратором", "make_admin")
}

func (h *AdminUsersHandler) RemoveAdmin(c *gin.Context) {
	h.updateRole(c, access.RoleMember, "Права администратора сняты", "remove_admin")
}

func (h *AdminUsersHandler) MakeModerator(c *gin.Context) {
	h.updateRole(c, access.RoleModerator, "Пользователь назначен модератором", "make_moderator")
}

func (h *AdminUsersHandler) RemoveModerator(c *gin.Context) {
	h.updateRole(c, access.RoleMember, "Права модератора сняты", "remove_moderator")
}

func (h *AdminUsersHandler) GetAdminUsers(c *gin.Context) {
	if _, ok := currentAdminUser(c); !ok {
		return
	}

	var privileged []models.User
	if err := database.DB.Where("is_admin = ? OR role = ?", true, access.RoleModerator).Order("is_admin DESC, id ASC").Find(&privileged).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки пользователей с правами"})
		return
	}

	admins := make([]gin.H, 0)
	moderators := make([]gin.H, 0)
	for _, user := range privileged {
		serialized := serializeAdminUser(user)
		if user.IsAdmin {
			admins = append(admins, serialized)
			continue
		}
		if access.NormalizeRole(user.Role, user.IsAdmin) == access.RoleModerator {
			moderators = append(moderators, serialized)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"admins":       admins,
		"moderators":   moderators,
		"owner_id":     access.BootstrapOwnerID,
		"total_admins": len(admins),
	})
}

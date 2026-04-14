package access

import (
	"errors"
	"log"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"gorm.io/gorm"
)

const BootstrapOwnerID uint = 1

func IsBootstrapOwner(userID uint) bool {
	return userID == BootstrapOwnerID
}

func EnsureBootstrapAdminForUser(user *models.User) error {
	if user == nil || !IsBootstrapOwner(user.ID) {
		return nil
	}
	if user.IsAdmin && NormalizeRole(user.Role, user.IsAdmin) == RoleAdmin {
		user.Role = RoleAdmin
		return nil
	}
	if database.DB == nil {
		return errors.New("database is not initialized")
	}
	if err := database.DB.Model(&models.User{}).Where("id = ?", user.ID).Updates(map[string]any{
		"is_admin": true,
		"role":     RoleAdmin,
	}).Error; err != nil {
		return err
	}
	user.IsAdmin = true
	user.Role = RoleAdmin
	log.Printf("🔐 Bootstrap admin granted to owner account id=%d", user.ID)
	return nil
}

func EnsureBootstrapOwnerAccount() error {
	if database.DB == nil {
		return errors.New("database is not initialized")
	}
	var user models.User
	if err := database.DB.First(&user, BootstrapOwnerID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	return EnsureBootstrapAdminForUser(&user)
}

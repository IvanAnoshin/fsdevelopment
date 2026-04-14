package repository

import (
	"errors"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"gorm.io/gorm"
)

type UserRepo struct{}

func NewUserRepo() *UserRepo {
	return &UserRepo{}
}

func (r *UserRepo) Create(user *models.User) error {
	return database.DB.Transaction(func(tx *gorm.DB) error {
		var count int64
		tx.Model(&models.User{}).Where("username = ?", user.Username).Count(&count)
		if count > 0 {
			return errors.New("имя пользователя уже существует")
		}
		return tx.Create(user).Error
	})
}

func (r *UserRepo) FindByUsername(username string) (*models.User, error) {
	var user models.User
	err := database.DB.Where("username = ?", username).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepo) FindByID(id uint) (*models.User, error) {
	var user models.User
	err := database.DB.First(&user, id).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepo) Update(user *models.User) error {
	return database.DB.Save(user).Error
}

func (r *UserRepo) IncrementTokenVersion(userID uint) error {
	return database.DB.Model(&models.User{}).
		Where("id = ?", userID).
		Update("token_version", gorm.Expr("token_version + 1")).Error
}

func (r *UserRepo) IsFriend(userID, friendID uint) (bool, error) {
	var count int64
	err := database.DB.Model(&models.Friendship{}).
		Where("(user_id = ? AND friend_id = ? OR user_id = ? AND friend_id = ?) AND status = ?",
			userID, friendID, friendID, userID, "accepted").
		Count(&count).Error
	return count > 0, err
}

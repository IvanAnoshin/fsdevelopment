package repository

import (
	"friendscape/internal/database"
	"friendscape/internal/models"
)

type VouchRepo struct{}

func NewVouchRepo() *VouchRepo {
	return &VouchRepo{}
}

func (r *VouchRepo) CreateVouch(voucherID, voucheeID uint) error {
	vouch := &models.Vouch{
		VoucherID: voucherID,
		VoucheeID: voucheeID,
		Weight:    1,
	}
	return database.DB.Create(vouch).Error
}

func (r *VouchRepo) DeleteVouch(voucherID, voucheeID uint) error {
	return database.DB.
		Where("voucher_id = ? AND vouchee_id = ?", voucherID, voucheeID).
		Delete(&models.Vouch{}).Error
}

func (r *VouchRepo) CheckVouch(voucherID, voucheeID uint) (bool, error) {
	var count int64
	err := database.DB.Model(&models.Vouch{}).
		Where("voucher_id = ? AND vouchee_id = ?", voucherID, voucheeID).
		Count(&count).Error
	return count > 0, err
}

func (r *VouchRepo) GetUserVouches(userID uint) ([]models.User, error) {
	var users []models.User
	err := database.DB.
		Joins("JOIN vouches ON vouches.voucher_id = users.id").
		Where("vouches.vouchee_id = ?", userID).
		Select("users.id, users.first_name, users.last_name, users.avatar").
		Find(&users).Error
	return users, err
}

func (r *VouchRepo) GetVouchesGiven(userID uint) ([]models.User, error) {
	var users []models.User
	err := database.DB.
		Joins("JOIN vouches ON vouches.vouchee_id = users.id").
		Where("vouches.voucher_id = ?", userID).
		Select("users.id, users.first_name, users.last_name, users.avatar").
		Find(&users).Error
	return users, err
}

package handlers

import (
	"errors"

	"gorm.io/gorm"
)

var (
	errInvalidRefreshToken = errors.New("invalid refresh token")
	gormErrSessionNotFound = gorm.ErrRecordNotFound
)

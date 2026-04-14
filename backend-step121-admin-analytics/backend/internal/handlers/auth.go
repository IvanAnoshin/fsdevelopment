package handlers

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"friendscape/internal/access"
	"friendscape/internal/auth"
	"friendscape/internal/database"
	"friendscape/internal/models"
	"friendscape/utils"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type AuthHandler struct{}

func NewAuthHandler() *AuthHandler {
	return &AuthHandler{}
}

type RegisterRequest struct {
	Username  string `json:"username" binding:"required,min=1,max=50"`
	FirstName string `json:"first_name" binding:"required"`
	LastName  string `json:"last_name" binding:"required"`
	Password  string `json:"password" binding:"required,min=8"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type UpdateProfileRequest struct {
	FirstName    *string `json:"first_name"`
	LastName     *string `json:"last_name"`
	Bio          *string `json:"bio"`
	City         *string `json:"city"`
	Relationship *string `json:"relationship"`
	Avatar       *string `json:"avatar"`
	IsPrivate    *bool   `json:"is_private"`
}

const defaultSecurityQuestion = "Мой секрет, который я не выдам никому"

func decorateUserAccess(user *models.User) {
	if user == nil {
		return
	}
	_ = access.EnsureBootstrapAdminForUser(user)
	user.Role = access.NormalizeRole(user.Role, user.IsAdmin)
	user.Permissions = access.PermissionsForRole(user.Role, user.IsAdmin)
}

func validateProfileField(value, field string, maxLen int, allowEmpty bool) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if !allowEmpty && trimmed == "" {
		return field + " не может быть пустым", false
	}
	if utf8.RuneCountInString(trimmed) > maxLen {
		return field + " слишком длинное", false
	}
	return trimmed, true
}

func normalizeSecurityQuestion(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return defaultSecurityQuestion
	}
	return trimmed
}

func normalizeSecurityAnswer(value string) string {
	parts := strings.Fields(strings.ToLower(strings.TrimSpace(value)))
	return strings.Join(parts, " ")
}

func deviceNameFromUserAgent(userAgent string) string {
	ua := strings.TrimSpace(userAgent)
	if ua == "" {
		return "Текущее устройство"
	}
	platform := "Устройство"
	switch {
	case strings.Contains(ua, "Windows"):
		platform = "Windows"
	case strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS X"):
		platform = "Mac"
	case strings.Contains(ua, "Android"):
		platform = "Android"
	case strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad") || strings.Contains(ua, "iOS"):
		platform = "iPhone"
	case strings.Contains(ua, "Linux"):
		platform = "Linux"
	}
	browser := "браузер"
	switch {
	case strings.Contains(ua, "Edg/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/") || strings.Contains(ua, "Opera"):
		browser = "Opera"
	case strings.Contains(ua, "Chrome/"):
		browser = "Chrome"
	case strings.Contains(ua, "Firefox/"):
		browser = "Firefox"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}
	return platform + " · " + browser
}

func syncTrustedDevice(c *gin.Context, userID uint, bumpSession bool) (*models.TrustedDevice, error) {
	deviceID := generateDeviceID(c)
	if deviceID == "" {
		return nil, nil
	}
	now := time.Now()
	userAgent := strings.TrimSpace(c.Request.UserAgent())
	clientIP := strings.TrimSpace(c.ClientIP())
	deviceName := deviceNameFromUserAgent(userAgent)

	var device models.TrustedDevice
	err := database.DB.Where("user_id = ? AND device_id = ?", userID, deviceID).First(&device).Error
	if err != nil {
		if err != gorm.ErrRecordNotFound {
			return nil, err
		}
		device = models.TrustedDevice{
			UserID:        userID,
			DeviceID:      deviceID,
			DeviceName:    deviceName,
			UserAgent:     userAgent,
			IP:            clientIP,
			SessionsCount: 1,
			LastUsed:      now,
			ExpiresAt:     now.Add(180 * 24 * time.Hour),
		}
		if !bumpSession {
			device.SessionsCount = 0
		}
		if err := database.DB.Create(&device).Error; err != nil {
			return nil, err
		}
		return &device, nil
	}

	updates := map[string]any{
		"device_name": deviceName,
		"user_agent":  userAgent,
		"ip":          clientIP,
		"last_used":   now,
	}
	if device.ExpiresAt.IsZero() || device.ExpiresAt.Before(now) {
		updates["expires_at"] = now.Add(180 * 24 * time.Hour)
		device.ExpiresAt = updates["expires_at"].(time.Time)
	}
	if bumpSession {
		updates["sessions_count"] = gorm.Expr("sessions_count + 1")
		device.SessionsCount++
	}
	if err := database.DB.Model(&device).Updates(updates).Error; err != nil {
		return nil, err
	}
	device.DeviceName = deviceName
	device.UserAgent = userAgent
	device.IP = clientIP
	device.LastUsed = now
	return &device, nil
}

func attachCurrentDevice(user *models.User, device *models.TrustedDevice) {
	if user == nil || device == nil {
		return
	}
	user.CurrentDeviceID = device.DeviceID
	user.CurrentDevicePINEnabled = device.PINEnabled
	user.CurrentDeviceName = device.DeviceName
	user.NeedsPinSetup = !device.PINEnabled
}

func respondWithAuthenticatedSession(c *gin.Context, user *models.User, device *models.TrustedDevice, message string) {
	if user == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать сессию"})
		return
	}
	deviceID := ""
	if device != nil {
		deviceID = device.DeviceID
	}
	accessToken, _, _, err := issueAuthSession(c, user, deviceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать защищённую сессию"})
		return
	}
	user.Password = ""
	decorateUserAccess(user)
	attachCurrentDevice(user, device)
	c.Header("Cache-Control", "no-store")
	payload := gin.H{
		"token": userTokenOrEmpty(accessToken),
		"user":  user,
	}
	if strings.TrimSpace(message) != "" {
		payload["message"] = strings.TrimSpace(message)
	}
	c.JSON(http.StatusOK, payload)
}

func userTokenOrEmpty(token string) string {
	return strings.TrimSpace(token)
}

func loadRefreshSessionUser(c *gin.Context) (*auth.Claims, *models.User, *models.AuthSession, error) {
	claims, err := readRefreshClaims(c)
	if err != nil {
		return nil, nil, nil, err
	}
	var user models.User
	if err := database.DB.First(&user, claims.UserID).Error; err != nil {
		return nil, nil, nil, err
	}
	if err := access.EnsureBootstrapAdminForUser(&user); err != nil {
		return nil, nil, nil, err
	}
	if user.TokenVersion != claims.TokenVersion {
		return nil, nil, nil, errInvalidRefreshToken
	}
	if strings.TrimSpace(claims.SessionID) == "" {
		return nil, nil, nil, errInvalidRefreshToken
	}
	session, err := auth.FindActiveSession(claims.SessionID, user.ID)
	if err != nil {
		return nil, nil, nil, err
	}
	return claims, &user, session, nil
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	req.FirstName = strings.TrimSpace(req.FirstName)
	req.LastName = strings.TrimSpace(req.LastName)

	var existing models.User
	if err := database.DB.Where("username = ?", req.Username).First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Имя пользователя уже занято"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка при обработке пароля"})
		return
	}

	user := &models.User{
		Username:  req.Username,
		FirstName: req.FirstName,
		LastName:  req.LastName,
		Password:  string(hashedPassword),
		Role:      access.RoleMember,
		LastSeen:  time.Now(),
	}

	if err := database.DB.Create(user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка базы данных"})
		return
	}

	_ = access.EnsureBootstrapAdminForUser(user)

	if user.ID <= 1000 {
		user.IsPioneer = true
		database.DB.Save(user)
	}

	device, _ := syncTrustedDevice(c, user.ID, true)
	respondWithAuthenticatedSession(c, user, device, "")
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	var user models.User
	if err := database.DB.Where("username = ?", req.Username).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверное имя пользователя или пароль"})
		return
	}
	_ = access.EnsureBootstrapAdminForUser(&user)

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверное имя пользователя или пароль"})
		return
	}

	if user.SecurityAnswerHash != "" {
		user.Password = ""
		decorateUserAccess(&user)
		c.JSON(http.StatusOK, gin.H{
			"requires_2fa":      true,
			"security_question": normalizeSecurityQuestion(user.SecurityQuestion),
			"user":              user,
		})
		return
	}

	user.LastSeen = time.Now()
	database.DB.Save(&user)
	device, _ := syncTrustedDevice(c, user.ID, true)
	respondWithAuthenticatedSession(c, &user, device, "")
}

func decorateUserTrust(user *models.User, viewerID uint) {
	if user == nil || user.ID == 0 {
		return
	}

	var vouchesCount int64
	database.DB.Model(&models.Vouch{}).Where("vouchee_id = ?", user.ID).Count(&vouchesCount)
	user.VouchesCount = int(vouchesCount)

	if viewerID == 0 || viewerID == user.ID {
		user.VouchedByMe = false
		return
	}

	var myVouchCount int64
	database.DB.Model(&models.Vouch{}).Where("voucher_id = ? AND vouchee_id = ?", viewerID, user.ID).Count(&myVouchCount)
	user.VouchedByMe = myVouchCount > 0
}

func (h *AuthHandler) GetMe(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	viewerID, _ := userID.(uint)

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь не найден"})
		return
	}

	user.Password = ""
	decorateUserAccess(&user)
	decorateUserTrust(&user, viewerID)
	device, _ := syncTrustedDevice(c, user.ID, false)
	attachCurrentDevice(&user, device)

	c.JSON(http.StatusOK, user)
}

func (h *AuthHandler) GetUser(c *gin.Context) {
	userID := c.Param("id")
	viewerIDValue, _ := c.Get("user_id")
	viewerID, _ := viewerIDValue.(uint)

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь не найден"})
		return
	}

	user.Password = ""
	decorateUserAccess(&user)
	decorateUserTrust(&user, viewerID)
	user.SecurityQuestion = ""

	c.JSON(http.StatusOK, user)
}

func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	if req.FirstName == nil && req.LastName == nil && req.Bio == nil && req.City == nil && req.Relationship == nil && req.Avatar == nil && req.IsPrivate == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нет данных для обновления"})
		return
	}

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь не найден"})
		return
	}

	if req.FirstName != nil {
		value, ok := validateProfileField(*req.FirstName, "Имя", 50, false)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": value})
			return
		}
		user.FirstName = value
	}

	if req.LastName != nil {
		value, ok := validateProfileField(*req.LastName, "Фамилия", 50, false)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": value})
			return
		}
		user.LastName = value
	}

	if req.Bio != nil {
		value, ok := validateProfileField(*req.Bio, "Биография", 500, true)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": value})
			return
		}
		user.Bio = value
	}

	if req.City != nil {
		value, ok := validateProfileField(*req.City, "Город", 100, true)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": value})
			return
		}
		user.City = value
	}

	if req.Relationship != nil {
		value, ok := validateProfileField(*req.Relationship, "Статус отношений", 100, true)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": value})
			return
		}
		user.Relationship = value
	}

	if req.Avatar != nil {
		value, ok := validateProfileField(*req.Avatar, "Аватар", 255, true)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": value})
			return
		}
		user.Avatar = value
	}

	if req.IsPrivate != nil {
		user.IsPrivate = *req.IsPrivate
	}

	if err := database.DB.Save(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить профиль"})
		return
	}

	user.Password = ""
	decorateUserAccess(&user)
	c.JSON(http.StatusOK, user)
}

func (h *AuthHandler) GetUserOnlineStatus(c *gin.Context) {
	userID := c.Param("id")

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь не найден"})
		return
	}

	isOnline := time.Since(user.LastSeen) < 5*time.Minute

	c.JSON(http.StatusOK, gin.H{
		"online":   isOnline,
		"lastSeen": user.LastSeen,
	})
}

func (h *AuthHandler) GetSecurityQuestion(c *gin.Context) {
	var req struct {
		FirstName string `json:"first_name" binding:"required"`
		LastName  string `json:"last_name" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	var user models.User

	err := database.DB.Where("LOWER(first_name) = ? AND LOWER(last_name) = ?",
		strings.ToLower(req.FirstName),
		strings.ToLower(req.LastName)).
		First(&user).Error

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь с таким именем и фамилией не найден"})
		return
	}

	if user.SecurityAnswerHash == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Секретный вопрос не настроен для этого аккаунта"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"has_security": true,
		"question":     normalizeSecurityQuestion(user.SecurityQuestion),
	})
}

func (h *AuthHandler) VerifySecurityAnswer(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Answer   string `json:"answer" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	var user models.User
	if err := database.DB.Where("username = ?", req.Username).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не найден"})
		return
	}

	if user.SecurityAnswerHash == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Секретный вопрос не настроен"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.SecurityAnswerHash), []byte(normalizeSecurityAnswer(req.Answer))); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный ответ"})
		return
	}

	user.LastSeen = time.Now()
	database.DB.Save(&user)
	device, _ := syncTrustedDevice(c, user.ID, true)
	respondWithAuthenticatedSession(c, &user, device, "")
}

// SetupSecurity - настройка секретного вопроса и генерация резервных кодов
func (h *AuthHandler) SetupSecurity(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var req struct {
		Question string `json:"question"`
		Answer   string `json:"answer" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	question := normalizeSecurityQuestion(req.Question)
	if utf8.RuneCountInString(question) > 255 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Секретный вопрос слишком длинный"})
		return
	}
	answer := normalizeSecurityAnswer(req.Answer)
	if len(answer) < 3 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ответ на секретный вопрос слишком короткий"})
		return
	}

	hashedAnswer, err := bcrypt.GenerateFromPassword([]byte(answer), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обработки"})
		return
	}

	if err := database.DB.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]any{
		"security_question":    question,
		"security_answer_hash": string(hashedAnswer),
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка сохранения"})
		return
	}

	// Удаляем старые резервные коды
	database.DB.Where("user_id = ?", userID).Delete(&models.BackupCode{})

	// Генерируем новые резервные коды
	codes := utils.GenerateBackupCodes()

	// Сохраняем хэши кодов
	for _, code := range codes {
		hashedCode, _ := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
		backupCode := &models.BackupCode{
			UserID:   userID.(uint),
			CodeHash: string(hashedCode),
			Used:     false,
		}
		database.DB.Create(backupCode)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "Безопасность настроена",
		"codes":    codes,
		"question": question,
	})
}

// LoginWithBackupCode - вход по резервному коду
func (h *AuthHandler) LoginWithBackupCode(c *gin.Context) {
	var req struct {
		Username   string `json:"username" binding:"required"`
		BackupCode string `json:"backup_code" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	var user models.User
	if err := database.DB.Where("username = ?", req.Username).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не найден"})
		return
	}
	_ = access.EnsureBootstrapAdminForUser(&user)

	// Ищем неиспользованный код
	var codes []models.BackupCode
	database.DB.Where("user_id = ? AND used = ?", user.ID, false).Find(&codes)

	for _, code := range codes {
		if err := bcrypt.CompareHashAndPassword([]byte(code.CodeHash), []byte(req.BackupCode)); err == nil {
			// Код верный, помечаем как использованный
			code.Used = true
			code.UsedAt = time.Now()
			database.DB.Save(&code)

			// Сбрасываем 2FA (секретный вопрос)
			database.DB.Model(&user).Updates(map[string]any{"security_answer_hash": "", "security_question": ""})

			user.LastSeen = time.Now()
			database.DB.Save(&user)
			device, _ := syncTrustedDevice(c, user.ID, true)
			respondWithAuthenticatedSession(c, &user, device, "Вход выполнен по резервному коду. Настройте новый секретный вопрос.")
			return
		}
	}

	c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный резервный код"})
}

// SetupDFSN - настройка поведенческого профиля
func (h *AuthHandler) SetupDFSN(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var req struct {
		TypingSpeed float64 `json:"typing_speed"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	behavioralData := &models.BehavioralData{
		UserID:      userID.(uint),
		TypingSpeed: req.TypingSpeed,
	}

	if err := database.DB.Create(behavioralData).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка сохранения"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "DFSN настроен"})
}

// Recovery - восстановление доступа
func (h *AuthHandler) Recovery(c *gin.Context) {
	var req struct {
		Username  string `json:"username"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
		Type      string `json:"type"`
		Answer    string `json:"answer"`
		Code      string `json:"code"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	var user models.User
	var err error

	// Ищем пользователя по username или по имени/фамилии
	if req.Username != "" {
		err = database.DB.Where("username = ?", req.Username).First(&user).Error
	} else if req.FirstName != "" && req.LastName != "" {
		err = database.DB.Where("LOWER(first_name) = ? AND LOWER(last_name) = ?",
			strings.ToLower(req.FirstName),
			strings.ToLower(req.LastName)).
			First(&user).Error
	}

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пользователь не найден"})
		return
	}

	// Проверяем способ восстановления
	if req.Type == "security" {
		if user.SecurityAnswerHash == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Секретный вопрос не настроен"})
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(user.SecurityAnswerHash), []byte(normalizeSecurityAnswer(req.Answer))); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный ответ на секретный вопрос"})
			return
		}
	} else if req.Type == "code" {
		// Проверяем резервный код
		var codes []models.BackupCode
		database.DB.Where("user_id = ? AND used = ?", user.ID, false).Find(&codes)

		found := false
		for _, code := range codes {
			if err := bcrypt.CompareHashAndPassword([]byte(code.CodeHash), []byte(req.Code)); err == nil {
				found = true
				code.Used = true
				code.UsedAt = time.Now()
				database.DB.Save(&code)
				break
			}
		}
		if !found {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный резервный код"})
			return
		}
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный тип восстановления"})
		return
	}

	// Сбрасываем 2FA
	database.DB.Model(&user).Updates(map[string]any{"security_answer_hash": "", "security_question": ""})

	// Генерируем временный токен для смены пароля
	tempToken, _ := auth.GenerateTempJWT(user.ID, user.TokenVersion)

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"temp_token": tempToken,
		"message":    "Восстановление подтверждено. Перенаправление на смену пароля.",
	})
}

// ResetPassword - сброс пароля
func (h *AuthHandler) ResetPassword(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	isTempToken, ok := c.Get("is_temp_token")
	if !ok || !isTempToken.(bool) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Нужен временный токен восстановления"})
		return
	}

	var req struct {
		Password string `json:"password" binding:"required,min=8"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обработки пароля"})
		return
	}

	updates := map[string]interface{}{
		"password":      string(hashedPassword),
		"token_version": gorm.Expr("token_version + 1"),
	}

	if err := database.DB.Model(&models.User{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка сохранения"})
		return
	}
	_ = auth.RevokeAllUserSessions(userID.(uint))
	clearRefreshCookie(c)

	c.JSON(http.StatusOK, gin.H{"message": "Пароль успешно изменён. Войдите с новым паролем."})
}

func (h *AuthHandler) RefreshSession(c *gin.Context) {
	if !requestOriginAllowed(c) {
		clearRefreshCookie(c)
		c.JSON(http.StatusForbidden, gin.H{"error": "Обновление сессии разрешено только из доверенного интерфейса"})
		return
	}
	_, user, session, err := loadRefreshSessionUser(c)
	if err != nil {
		clearRefreshCookie(c)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Сессию нужно обновить через новый вход"})
		return
	}
	accessToken, _, err := refreshAuthSession(c, user, session)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не удалось обновить сессию"})
		return
	}
	device, _ := syncTrustedDevice(c, user.ID, false)
	user.Password = ""
	decorateUserAccess(user)
	decorateUserTrust(user, user.ID)
	attachCurrentDevice(user, device)
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"token": accessToken, "user": user})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		clearRefreshCookie(c)
		c.JSON(http.StatusOK, gin.H{"message": "Сессия очищена"})
		return
	}
	userID, _ := userIDValue.(uint)
	if claims, _, _, err := loadRefreshSessionUser(c); err == nil {
		_ = auth.RevokeSession(claims.SessionID, userID)
	}
	clearRefreshCookie(c)
	c.Header("Clear-Site-Data", "\"storage\"")
	c.JSON(http.StatusOK, gin.H{"message": "Вы вышли из текущей сессии"})
}

func (h *AuthHandler) LogoutAll(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		clearRefreshCookie(c)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}
	userID, _ := userIDValue.(uint)
	if err := auth.RevokeAllUserSessions(userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось завершить все сессии"})
		return
	}
	clearRefreshCookie(c)
	c.Header("Clear-Site-Data", "\"storage\"")
	c.JSON(http.StatusOK, gin.H{"message": "Все сессии завершены"})
}

func (h *AuthHandler) CreateRealtimeTicket(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}
	userID, _ := userIDValue.(uint)
	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не найден"})
		return
	}
	sessionID, _ := c.Get("session_id")
	ticket, err := auth.GenerateRealtimeTicket(user.ID, user.TokenVersion, strings.TrimSpace(asString(sessionID)))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось выпустить realtime ticket"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": ticket, "expires_in": 60})
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

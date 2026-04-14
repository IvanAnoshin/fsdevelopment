package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"github.com/gin-gonic/gin"
)

type ModerationHandler struct{}

func NewModerationHandler() *ModerationHandler { return &ModerationHandler{} }

func (h *ModerationHandler) CreatePostReport(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}
	postID, err := strconv.Atoi(c.Param("id"))
	if err != nil || postID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный id поста"})
		return
	}
	var req struct {
		Reason  string `json:"reason" binding:"required,max=128"`
		Details string `json:"details" binding:"max=4000"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Укажите причину жалобы"})
		return
	}
	var post models.Post
	if err := database.DB.Select("id, user_id").First(&post, postID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пост не найден"})
		return
	}
	report := models.ModerationReport{ReporterID: userID.(uint), TargetType: "post", TargetID: uint(postID), Reason: strings.TrimSpace(req.Reason), Details: strings.TrimSpace(req.Details), Status: "pending"}
	var existing models.ModerationReport
	if err := database.DB.Where("reporter_id = ? AND target_type = ? AND target_id = ?", userID.(uint), "post", postID).First(&existing).Error; err == nil {
		existing.Reason = report.Reason
		existing.Details = report.Details
		existing.Status = "pending"
		existing.AdminNote = ""
		existing.ResolvedAt = nil
		existing.ResolvedBy = nil
		if err := database.DB.Save(&existing).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить жалобу"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"report": existing})
		return
	}
	if err := database.DB.Create(&report).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось отправить жалобу"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"report": report})
}

func (h *ModerationHandler) CreateSupportTicket(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}
	var req struct {
		Subject  string `json:"subject" binding:"required,max=160"`
		Message  string `json:"message" binding:"required,max=8000"`
		Category string `json:"category" binding:"max=64"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Заполните тему и текст обращения"})
		return
	}
	ticket := models.SupportTicket{UserID: userID.(uint), Subject: strings.TrimSpace(req.Subject), Message: strings.TrimSpace(req.Message), Category: strings.TrimSpace(req.Category), Status: "open", Priority: "normal"}
	if ticket.Category == "" {
		ticket.Category = "general"
	}
	if err := database.DB.Create(&ticket).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать обращение"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": ticket})
}

func (h *ModerationHandler) GetMySupportTickets(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}
	var tickets []models.SupportTicket
	if err := database.DB.Where("user_id = ?", userID.(uint)).Order("created_at DESC").Limit(50).Find(&tickets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить обращения"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tickets": tickets})
}

func (h *ModerationHandler) GetAdminReports(c *gin.Context) {
	status := strings.TrimSpace(c.Query("status"))
	query := database.DB.Preload("Reporter").Order("created_at DESC")
	if status != "" && status != "all" {
		query = query.Where("status = ?", status)
	}
	var reports []models.ModerationReport
	if err := query.Limit(100).Find(&reports).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить жалобы"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reports": reports})
}

func (h *ModerationHandler) UpdateAdminReport(c *gin.Context) {
	adminID, _ := c.Get("user_id")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный id жалобы"})
		return
	}
	var req struct {
		Status    string `json:"status" binding:"required"`
		AdminNote string `json:"admin_note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Передайте статус"})
		return
	}
	status := strings.TrimSpace(req.Status)
	if status != "pending" && status != "reviewing" && status != "resolved" && status != "rejected" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый статус"})
		return
	}
	updates := map[string]any{"status": status, "admin_note": strings.TrimSpace(req.AdminNote)}
	if status == "resolved" || status == "rejected" {
		now := time.Now()
		updates["resolved_at"] = &now
		updates["resolved_by"] = adminID.(uint)
	} else {
		updates["resolved_at"] = nil
		updates["resolved_by"] = nil
	}
	if err := database.DB.Model(&models.ModerationReport{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить жалобу"})
		return
	}
	var report models.ModerationReport
	database.DB.Preload("Reporter").First(&report, id)
	c.JSON(http.StatusOK, gin.H{"report": report})
}

func (h *ModerationHandler) GetAdminTickets(c *gin.Context) {
	status := strings.TrimSpace(c.Query("status"))
	query := database.DB.Preload("User").Order("created_at DESC")
	if status != "" && status != "all" {
		query = query.Where("status = ?", status)
	}
	var tickets []models.SupportTicket
	if err := query.Limit(100).Find(&tickets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить обращения"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tickets": tickets})
}

func (h *ModerationHandler) UpdateAdminTicket(c *gin.Context) {
	adminID, _ := c.Get("user_id")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный id обращения"})
		return
	}
	var req struct {
		Status    string `json:"status" binding:"required"`
		AdminNote string `json:"admin_note"`
		Priority  string `json:"priority"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Передайте статус"})
		return
	}
	status := strings.TrimSpace(req.Status)
	if status != "open" && status != "reviewing" && status != "resolved" && status != "closed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый статус"})
		return
	}
	updates := map[string]any{"status": status, "admin_note": strings.TrimSpace(req.AdminNote)}
	if pr := strings.TrimSpace(req.Priority); pr != "" {
		updates["priority"] = pr
	}
	if status == "resolved" || status == "closed" {
		now := time.Now()
		updates["resolved_at"] = &now
		updates["resolved_by"] = adminID.(uint)
	} else {
		updates["resolved_at"] = nil
		updates["resolved_by"] = nil
	}
	if err := database.DB.Model(&models.SupportTicket{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить обращение"})
		return
	}
	var ticket models.SupportTicket
	database.DB.Preload("User").First(&ticket, id)
	c.JSON(http.StatusOK, gin.H{"ticket": ticket})
}

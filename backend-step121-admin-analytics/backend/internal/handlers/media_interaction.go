package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"friendscape/internal/database"
	"friendscape/internal/models"

	"github.com/gin-gonic/gin"
)

type MediaInteractionHandler struct{}

func NewMediaInteractionHandler() *MediaInteractionHandler {
	return &MediaInteractionHandler{}
}

type mediaInteractionRequest struct {
	MediaKey     string `json:"media_key"`
	AssetID      *uint  `json:"asset_id"`
	SourcePostID *uint  `json:"source_post_id"`
	Value        int    `json:"value"`
	Content      string `json:"content"`
	Reason       string `json:"reason"`
}

func normalizeMediaKey(raw string, assetID *uint) string {
	if assetID != nil && *assetID > 0 {
		return fmt.Sprintf("asset:%d", *assetID)
	}
	value := strings.TrimSpace(raw)
	if len(value) > 512 {
		value = value[:512]
	}
	return value
}

func mediaTargetFromQuery(c *gin.Context) (string, *uint, bool) {
	var assetID *uint
	if raw := strings.TrimSpace(c.Query("asset_id")); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || parsed == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный asset_id"})
			return "", nil, false
		}
		value := uint(parsed)
		assetID = &value
	}
	mediaKey := normalizeMediaKey(c.Query("media_key"), assetID)
	if mediaKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Не указан media_key"})
		return "", nil, false
	}
	return mediaKey, assetID, true
}

func buildMediaInteractionContext(mediaKey string, assetID *uint, viewerID uint) (gin.H, error) {
	var pluses int64
	var minuses int64
	var commentsCount int64
	var myVote models.MediaVote
	var comments []models.MediaComment

	if err := database.DB.Model(&models.MediaVote{}).Where("media_key = ? AND value = 1", mediaKey).Count(&pluses).Error; err != nil {
		return nil, err
	}
	if err := database.DB.Model(&models.MediaVote{}).Where("media_key = ? AND value = -1", mediaKey).Count(&minuses).Error; err != nil {
		return nil, err
	}
	if err := database.DB.Model(&models.MediaComment{}).Where("media_key = ?", mediaKey).Count(&commentsCount).Error; err != nil {
		return nil, err
	}
	_ = database.DB.Where("media_key = ? AND user_id = ?", mediaKey, viewerID).First(&myVote).Error
	if err := database.DB.Preload("User").Where("media_key = ?", mediaKey).Order("created_at ASC").Limit(50).Find(&comments).Error; err != nil {
		return nil, err
	}

	items := make([]gin.H, 0, len(comments))
	for _, comment := range comments {
		items = append(items, gin.H{
			"id":         comment.ID,
			"media_key":  comment.MediaKey,
			"asset_id":   comment.AssetID,
			"content":    comment.Content,
			"created_at": comment.CreatedAt,
			"user":       comment.User,
		})
	}

	return gin.H{
		"media_key":      mediaKey,
		"asset_id":       assetID,
		"pluses_count":   pluses,
		"minuses_count":  minuses,
		"comments_count": commentsCount,
		"my_vote":        myVote.Value,
		"comments":       items,
	}, nil
}

func (h *MediaInteractionHandler) GetContext(c *gin.Context) {
	userID, _ := c.Get("user_id")
	viewerID, ok := userID.(uint)
	if !ok || viewerID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	mediaKey, assetID, ok := mediaTargetFromQuery(c)
	if !ok {
		return
	}

	payload, err := buildMediaInteractionContext(mediaKey, assetID, viewerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить действия для фото"})
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (h *MediaInteractionHandler) Vote(c *gin.Context) {
	userID, _ := c.Get("user_id")
	viewerID, ok := userID.(uint)
	if !ok || viewerID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var req mediaInteractionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректные данные"})
		return
	}
	if req.Value != 1 && req.Value != -1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Голос должен быть +1 или -1"})
		return
	}

	mediaKey := normalizeMediaKey(req.MediaKey, req.AssetID)
	if mediaKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Не указан media_key"})
		return
	}

	var existing models.MediaVote
	err := database.DB.Where("media_key = ? AND user_id = ?", mediaKey, viewerID).First(&existing).Error
	if err == nil {
		if existing.Value == req.Value {
			if err := database.DB.Delete(&existing).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось убрать голос"})
				return
			}
		} else {
			existing.Value = req.Value
			existing.AssetID = req.AssetID
			if err := database.DB.Save(&existing).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить голос"})
				return
			}
		}
	} else {
		vote := models.MediaVote{
			MediaKey: mediaKey,
			AssetID:  req.AssetID,
			UserID:   viewerID,
			Value:    req.Value,
		}
		if err := database.DB.Create(&vote).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить голос"})
			return
		}
	}

	payload, err := buildMediaInteractionContext(mediaKey, req.AssetID, viewerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить состояние фото"})
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (h *MediaInteractionHandler) Comment(c *gin.Context) {
	userID, _ := c.Get("user_id")
	viewerID, ok := userID.(uint)
	if !ok || viewerID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var req mediaInteractionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректные данные"})
		return
	}
	mediaKey := normalizeMediaKey(req.MediaKey, req.AssetID)
	if mediaKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Не указан media_key"})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Комментарий не может быть пустым"})
		return
	}
	if len([]rune(content)) > 1200 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Комментарий слишком длинный"})
		return
	}

	comment := models.MediaComment{
		MediaKey: mediaKey,
		AssetID:  req.AssetID,
		UserID:   viewerID,
		Content:  content,
	}
	if err := database.DB.Create(&comment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить комментарий"})
		return
	}
	_ = database.DB.Preload("User").First(&comment, comment.ID).Error

	if req.SourcePostID != nil && *req.SourcePostID > 0 {
		var post models.Post
		if err := database.DB.First(&post, *req.SourcePostID).Error; err == nil && post.UserID != viewerID {
			var actor models.User
			_ = database.DB.Select("id", "username", "first_name", "last_name").First(&actor, viewerID).Error
			notification := models.Notification{
				UserID:  post.UserID,
				Type:    "media_comment",
				Content: fmt.Sprintf("%s прокомментировал(а) фото", postActorName(actor)),
				Link:    fmt.Sprintf("/feed?post=%d", post.ID),
			}
			_ = database.DB.Create(&notification).Error
		}
	}

	payload, err := buildMediaInteractionContext(mediaKey, req.AssetID, viewerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Комментарий сохранён, но состояние не обновилось"})
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (h *MediaInteractionHandler) Report(c *gin.Context) {
	userID, _ := c.Get("user_id")
	viewerID, ok := userID.(uint)
	if !ok || viewerID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var req mediaInteractionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректные данные"})
		return
	}
	mediaKey := normalizeMediaKey(req.MediaKey, req.AssetID)
	if mediaKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Не указан media_key"})
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Укажите причину жалобы"})
		return
	}
	if len([]rune(reason)) > 1500 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Причина жалобы слишком длинная"})
		return
	}

	var report models.MediaReport
	if err := database.DB.Where("media_key = ? AND reporter_id = ?", mediaKey, viewerID).First(&report).Error; err == nil {
		report.Reason = reason
		report.Status = "pending"
		report.AssetID = req.AssetID
		report.SourcePostID = req.SourcePostID
		if err := database.DB.Save(&report).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить жалобу"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Жалоба обновлена"})
		return
	}

	report = models.MediaReport{
		MediaKey:     mediaKey,
		AssetID:      req.AssetID,
		ReporterID:   viewerID,
		SourcePostID: req.SourcePostID,
		Reason:       reason,
		Status:       "pending",
	}
	if err := database.DB.Create(&report).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось отправить жалобу"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Жалоба отправлена"})
}

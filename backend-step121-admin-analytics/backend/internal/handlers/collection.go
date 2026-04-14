package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type CollectionHandler struct{}

func NewCollectionHandler() *CollectionHandler {
	return &CollectionHandler{}
}

func normalizeCollectionColor(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "#6d5efc"
	}
	if len(trimmed) > 24 {
		return trimmed[:24]
	}
	return trimmed
}

func (h *CollectionHandler) ensureDefaultCollection(userID uint) (*models.Collection, error) {
	var collection models.Collection
	err := database.DB.Where("user_id = ? AND is_default = ?", userID, true).First(&collection).Error
	if err == nil {
		return &collection, nil
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}
	collection = models.Collection{
		UserID:      userID,
		Name:        "Сохранённое",
		Description: "Быстрые сохранения из ленты, профилей и фото",
		Color:       "#6d5efc",
		IsDefault:   true,
	}
	if err := database.DB.Create(&collection).Error; err != nil {
		return nil, err
	}
	return &collection, nil
}

func (h *CollectionHandler) loadOwnedCollection(c *gin.Context, userID uint) (*models.Collection, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный id подборки"})
		return nil, false
	}
	var collection models.Collection
	if err := database.DB.Where("id = ? AND user_id = ?", id, userID).First(&collection).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Подборка не найдена"})
			return nil, false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить подборку"})
		return nil, false
	}
	return &collection, true
}

func (h *CollectionHandler) GetCollections(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uid := userID.(uint)
	if _, err := h.ensureDefaultCollection(uid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось подготовить подборки"})
		return
	}

	var collections []models.Collection
	if err := database.DB.Where("user_id = ?", uid).Order("is_default DESC, updated_at DESC, created_at DESC").Find(&collections).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить подборки"})
		return
	}

	for i := range collections {
		var count int64
		database.DB.Model(&models.CollectionItem{}).Where("collection_id = ?", collections[i].ID).Count(&count)
		collections[i].ItemsCount = int(count)
	}

	c.JSON(http.StatusOK, gin.H{"collections": collections})
}

func (h *CollectionHandler) CreateCollection(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Color       string `json:"color"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректные данные подборки"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Введите название подборки"})
		return
	}
	if len([]rune(name)) > 80 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Название слишком длинное"})
		return
	}
	description := strings.TrimSpace(req.Description)
	if len([]rune(description)) > 240 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Описание слишком длинное"})
		return
	}
	collection := models.Collection{
		UserID:      uid,
		Name:        name,
		Description: description,
		Color:       normalizeCollectionColor(req.Color),
	}
	if err := database.DB.Create(&collection).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать подборку"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"collection": collection})
}

func (h *CollectionHandler) UpdateCollection(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uid := userID.(uint)
	collection, ok := h.loadOwnedCollection(c, uid)
	if !ok {
		return
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Color       string `json:"color"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректные данные подборки"})
		return
	}
	if name := strings.TrimSpace(req.Name); name != "" {
		if len([]rune(name)) > 80 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Название слишком длинное"})
			return
		}
		collection.Name = name
	}
	if description := strings.TrimSpace(req.Description); len([]rune(description)) <= 240 {
		collection.Description = description
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Описание слишком длинное"})
		return
	}
	collection.Color = normalizeCollectionColor(req.Color)
	if err := database.DB.Save(collection).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить подборку"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"collection": collection})
}

func (h *CollectionHandler) DeleteCollection(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uid := userID.(uint)
	collection, ok := h.loadOwnedCollection(c, uid)
	if !ok {
		return
	}
	if collection.IsDefault {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Системную подборку удалить нельзя"})
		return
	}
	if err := database.DB.Delete(&models.Collection{}, collection.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить подборку"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Подборка удалена"})
}

func (h *CollectionHandler) GetCollectionItems(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uid := userID.(uint)
	collection, ok := h.loadOwnedCollection(c, uid)
	if !ok {
		return
	}
	var items []models.CollectionItem
	if err := database.DB.Where("collection_id = ? AND user_id = ?", collection.ID, uid).Order("created_at DESC").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить элементы подборки"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"collection": collection, "items": items})
}

func (h *CollectionHandler) AddCollectionItem(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	var req struct {
		EntityType   string          `json:"entity_type"`
		EntityKey    string          `json:"entity_key"`
		Title        string          `json:"title"`
		Subtitle     string          `json:"subtitle"`
		PreviewText  string          `json:"preview_text"`
		PreviewImage string          `json:"preview_image"`
		Link         string          `json:"link"`
		Payload      json.RawMessage `json:"payload"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректные данные элемента"})
		return
	}

	entityType := strings.TrimSpace(req.EntityType)
	entityKey := strings.TrimSpace(req.EntityKey)
	title := strings.TrimSpace(req.Title)
	if entityType == "" || entityKey == "" || title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Не хватает данных для сохранения"})
		return
	}

	collection, ok := h.loadOwnedCollection(c, uid)
	if !ok {
		return
	}

	payload := string(req.Payload)
	item := models.CollectionItem{}
	err := database.DB.Where("collection_id = ? AND entity_key = ?", collection.ID, entityKey).First(&item).Error
	if err == nil {
		item.Title = title
		item.Subtitle = strings.TrimSpace(req.Subtitle)
		item.PreviewText = strings.TrimSpace(req.PreviewText)
		item.PreviewImage = strings.TrimSpace(req.PreviewImage)
		item.Link = strings.TrimSpace(req.Link)
		item.PayloadJSON = payload
		item.EntityType = entityType
		if saveErr := database.DB.Save(&item).Error; saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить сохранённый элемент"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"item": item, "collection": collection, "duplicate": true})
		return
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить элемент"})
		return
	}

	item = models.CollectionItem{
		CollectionID: collection.ID,
		UserID:       uid,
		EntityType:   entityType,
		EntityKey:    entityKey,
		Title:        title,
		Subtitle:     strings.TrimSpace(req.Subtitle),
		PreviewText:  strings.TrimSpace(req.PreviewText),
		PreviewImage: strings.TrimSpace(req.PreviewImage),
		Link:         strings.TrimSpace(req.Link),
		PayloadJSON:  payload,
	}
	if err := database.DB.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить элемент"})
		return
	}
	database.DB.Model(collection).UpdateColumn("updated_at", gorm.Expr("NOW()"))
	c.JSON(http.StatusOK, gin.H{"item": item, "collection": collection})
}

func (h *CollectionHandler) DeleteCollectionItem(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uid := userID.(uint)
	collection, ok := h.loadOwnedCollection(c, uid)
	if !ok {
		return
	}

	itemID, err := strconv.Atoi(c.Param("itemId"))
	if err != nil || itemID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный id элемента"})
		return
	}

	var item models.CollectionItem
	if err := database.DB.Where("id = ? AND collection_id = ? AND user_id = ?", itemID, collection.ID, uid).First(&item).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Элемент не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить элемент"})
		return
	}
	if err := database.DB.Delete(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить элемент"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Элемент удалён"})
}

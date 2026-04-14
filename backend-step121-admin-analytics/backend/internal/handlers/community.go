package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type CommunityHandler struct{}

func NewCommunityHandler() *CommunityHandler { return &CommunityHandler{} }

func normalizeCommunitySlug(value string) string {
	value = normalizeSearchText(value)
	value = strings.ReplaceAll(value, " ", "-")
	value = strings.Trim(value, "-")
	if value == "" {
		return fmt.Sprintf("community-%d", time.Now().Unix())
	}
	if len(value) > 180 {
		value = value[:180]
	}
	return value
}

func ensureUniqueCommunitySlug(base string) string {
	slug := base
	idx := 1
	for {
		var count int64
		database.DB.Model(&models.Community{}).Where("slug = ?", slug).Count(&count)
		if count == 0 {
			return slug
		}
		idx++
		slug = fmt.Sprintf("%s-%d", base, idx)
	}
}

func trimCommunitySearchQuery(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	runes := []rune(trimmed)
	if len(runes) > 120 {
		return strings.TrimSpace(string(runes[:120]))
	}
	return trimmed
}

func communityMembershipSubquery(userID uint) *gorm.DB {
	return database.DB.Model(&models.CommunityMember{}).Select("community_id").Where("user_id = ?", userID)
}

func canAccessCommunity(viewerID uint, community models.Community) bool {
	if !community.IsPrivate {
		return true
	}
	if viewerID == 0 {
		return false
	}
	if community.CreatorID == viewerID {
		return true
	}
	var count int64
	database.DB.Model(&models.CommunityMember{}).Where("community_id = ? AND user_id = ?", community.ID, viewerID).Count(&count)
	return count > 0
}

func communityIDParam(c *gin.Context) (uint, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный id сообщества"})
		return 0, false
	}
	return uint(id), true
}

func attachCommunityMembership(viewerID uint, communities []models.Community) {
	if viewerID == 0 || len(communities) == 0 {
		return
	}
	ids := make([]uint, 0, len(communities))
	for _, item := range communities {
		ids = append(ids, item.ID)
	}
	var members []models.CommunityMember
	database.DB.Where("user_id = ? AND community_id IN ?", viewerID, ids).Find(&members)
	roles := map[uint]string{}
	for _, item := range members {
		roles[item.CommunityID] = item.Role
	}
	for i := range communities {
		if role, ok := roles[communities[i].ID]; ok {
			communities[i].IsMember = true
			communities[i].MyRole = role
		}
	}
}

func attachCommunityRecentMembers(communities []models.Community) {
	for i := range communities {
		var memberships []models.CommunityMember
		if err := database.DB.Where("community_id = ?", communities[i].ID).Order("joined_at DESC").Limit(5).Find(&memberships).Error; err != nil || len(memberships) == 0 {
			continue
		}
		userIDs := make([]uint, 0, len(memberships))
		for _, item := range memberships {
			userIDs = append(userIDs, item.UserID)
		}
		var users []models.User
		database.DB.Select("id, first_name, last_name, username, avatar").Where("id IN ?", userIDs).Find(&users)
		userMap := map[uint]models.User{}
		for _, user := range users {
			userMap[user.ID] = user
		}
		recent := make([]models.User, 0, len(userIDs))
		for _, item := range memberships {
			if user, ok := userMap[item.UserID]; ok {
				recent = append(recent, user)
			}
		}
		communities[i].RecentMembers = recent
	}
}

func (h *CommunityHandler) ListCommunities(c *gin.Context) {
	viewerID, _ := c.Get("user_id")
	uid, _ := viewerID.(uint)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	q := trimCommunitySearchQuery(c.Query("q"))
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > 40 {
		limit = 20
	}
	offset := (page - 1) * limit

	query := database.DB.Model(&models.Community{})
	if uid > 0 {
		query = query.Where("is_private = ? OR id IN (?)", false, communityMembershipSubquery(uid))
	} else {
		query = query.Where("is_private = ?", false)
	}
	if q != "" {
		needle := "%" + strings.ToLower(q) + "%"
		query = query.Where("LOWER(name) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(description) LIKE ?", needle, needle, needle)
	}
	var communities []models.Community
	if err := query.Order("members_count DESC, created_at DESC").Limit(limit + 1).Offset(offset).Find(&communities).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить сообщества"})
		return
	}
	hasMore := false
	if len(communities) > limit {
		hasMore = true
		communities = communities[:limit]
	}
	attachCommunityMembership(uid, communities)
	attachCommunityRecentMembers(communities)
	c.JSON(http.StatusOK, gin.H{"communities": communities, "page": page, "has_more": hasMore})
}

func (h *CommunityHandler) CreateCommunity(c *gin.Context) {
	viewerID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}
	uid := viewerID.(uint)
	var req struct {
		Name        string `json:"name" binding:"required,max=160"`
		Description string `json:"description" binding:"max=2000"`
		Avatar      string `json:"avatar"`
		Cover       string `json:"cover"`
		IsPrivate   bool   `json:"is_private"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Проверьте название сообщества"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if len([]rune(name)) < 3 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Название должно быть не короче 3 символов"})
		return
	}
	baseSlug := ensureUniqueCommunitySlug(normalizeCommunitySlug(name))
	community := models.Community{CreatorID: uid, Name: name, Slug: baseSlug, Description: strings.TrimSpace(req.Description), Avatar: strings.TrimSpace(req.Avatar), Cover: strings.TrimSpace(req.Cover), IsPrivate: req.IsPrivate, MembersCount: 1}
	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&community).Error; err != nil {
			return err
		}
		member := models.CommunityMember{CommunityID: community.ID, UserID: uid, Role: "owner", JoinedAt: time.Now()}
		return tx.Create(&member).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать сообщество"})
		return
	}
	community.IsMember = true
	community.MyRole = "owner"
	c.JSON(http.StatusOK, gin.H{"community": community})
}

func (h *CommunityHandler) GetCommunity(c *gin.Context) {
	id, ok := communityIDParam(c)
	if !ok {
		return
	}
	viewerID, _ := c.Get("user_id")
	uid, _ := viewerID.(uint)
	var community models.Community
	if err := database.DB.First(&community, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Сообщество не найдено"})
		return
	}
	if community.IsPrivate && !canAccessCommunity(uid, community) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Приватное сообщество недоступно"})
		return
	}
	items := []models.Community{community}
	attachCommunityMembership(uid, items)
	attachCommunityRecentMembers(items)
	community = items[0]
	c.JSON(http.StatusOK, gin.H{"community": community})
}

func (h *CommunityHandler) JoinCommunity(c *gin.Context) {
	id, ok := communityIDParam(c)
	if !ok {
		return
	}
	viewerID, _ := c.Get("user_id")
	uid := viewerID.(uint)
	var community models.Community
	if err := database.DB.First(&community, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Сообщество не найдено"})
		return
	}
	if community.IsPrivate {
		c.JSON(http.StatusForbidden, gin.H{"error": "В приватное сообщество нельзя вступить напрямую"})
		return
	}
	var existing models.CommunityMember
	if err := database.DB.Where("community_id = ? AND user_id = ?", id, uid).First(&existing).Error; err == nil {
		c.JSON(http.StatusOK, gin.H{"message": "Вы уже в сообществе"})
		return
	}
	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		member := models.CommunityMember{CommunityID: id, UserID: uid, Role: "member", JoinedAt: time.Now()}
		if err := tx.Create(&member).Error; err != nil {
			return err
		}
		return tx.Model(&models.Community{}).Where("id = ?", id).UpdateColumn("members_count", gorm.Expr("members_count + 1")).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось вступить в сообщество"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Вы вступили в сообщество"})
}

func (h *CommunityHandler) LeaveCommunity(c *gin.Context) {
	id, ok := communityIDParam(c)
	if !ok {
		return
	}
	viewerID, _ := c.Get("user_id")
	uid := viewerID.(uint)
	var member models.CommunityMember
	if err := database.DB.Where("community_id = ? AND user_id = ?", id, uid).First(&member).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Участие не найдено"})
		return
	}
	if member.Role == "owner" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Создатель не может выйти, пока не передаст сообщество"})
		return
	}
	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&member).Error; err != nil {
			return err
		}
		return tx.Model(&models.Community{}).Where("id = ? AND members_count > 0", id).UpdateColumn("members_count", gorm.Expr("GREATEST(members_count - 1, 0)")).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось выйти из сообщества"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Вы вышли из сообщества"})
}

func (h *CommunityHandler) GetCommunityPosts(c *gin.Context) {
	id, ok := communityIDParam(c)
	if !ok {
		return
	}
	viewerID, _ := c.Get("user_id")
	uid, _ := viewerID.(uint)
	var community models.Community
	if err := database.DB.Select("id, creator_id, is_private").First(&community, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Сообщество не найдено"})
		return
	}
	if community.IsPrivate && !canAccessCommunity(uid, community) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Посты приватного сообщества недоступны"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > 30 {
		limit = 20
	}
	var posts []models.Post
	if err := database.DB.Where("community_id = ?", id).Order("created_at DESC").Limit(limit + 1).Offset((page - 1) * limit).Preload("User").Preload("Community").Find(&posts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить посты сообщества"})
		return
	}
	hasMore := false
	if len(posts) > limit {
		hasMore = true
		posts = posts[:limit]
	}
	result := make([]postWithLike, len(posts))
	for i, post := range posts {
		result[i] = buildPostWithLike(uid, post)
	}
	c.JSON(http.StatusOK, gin.H{"posts": result, "page": page, "has_more": hasMore})
}

func (h *CommunityHandler) CreateCommunityPost(c *gin.Context) {
	id, ok := communityIDParam(c)
	if !ok {
		return
	}
	viewerID, _ := c.Get("user_id")
	uid := viewerID.(uint)
	var member models.CommunityMember
	if err := database.DB.Where("community_id = ? AND user_id = ?", id, uid).First(&member).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Публиковать могут только участники сообщества"})
		return
	}
	var req struct {
		Content string `json:"content" binding:"required,max=5000"`
		Images  string `json:"images"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нет контента"})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Пост не может быть пустым"})
		return
	}
	images := req.Images
	if strings.TrimSpace(images) == "" {
		images = "[]"
	}
	post := models.Post{UserID: uid, CommunityID: &id, Content: content, Images: images}
	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&post).Error; err != nil {
			return err
		}
		return tx.Model(&models.Community{}).Where("id = ?", id).UpdateColumn("posts_count", gorm.Expr("posts_count + 1")).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось опубликовать пост"})
		return
	}
	database.DB.Preload("User").Preload("Community").First(&post, post.ID)
	c.JSON(http.StatusOK, gin.H{"post": buildPostWithLike(uid, post)})
}

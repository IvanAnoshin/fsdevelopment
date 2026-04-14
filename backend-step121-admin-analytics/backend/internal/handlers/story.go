package handlers

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/models"

	"github.com/gin-gonic/gin"
)

type StoryHandler struct{}

func NewStoryHandler() *StoryHandler { return &StoryHandler{} }

var allowedStoryDurations = func() map[int]struct{} {
	values := map[int]struct{}{}
	for minutes := 10; minutes <= 60; minutes += 10 {
		values[minutes] = struct{}{}
	}
	for hours := 2; hours <= 48; hours += 1 {
		values[hours*60] = struct{}{}
	}
	return values
}()

func isAllowedStoryDuration(minutes int) bool {
	_, ok := allowedStoryDurations[minutes]
	return ok
}

func currentUserID(c *gin.Context) uint {
	if value, exists := c.Get("user_id"); exists {
		switch typed := value.(type) {
		case uint:
			return typed
		case int:
			if typed > 0 {
				return uint(typed)
			}
		case int64:
			if typed > 0 {
				return uint(typed)
			}
		case float64:
			if typed > 0 {
				return uint(typed)
			}
		}
	}
	return 0
}

func storyCanAccess(viewerID uint, story models.Story, acceptedFriends map[uint]struct{}, communityMemberships map[uint]struct{}) bool {
	if viewerID == 0 {
		return false
	}
	if story.UserID == viewerID {
		return true
	}
	if story.ExpiresAt.Before(time.Now()) {
		return false
	}
	switch strings.TrimSpace(strings.ToLower(story.Audience)) {
	case "all":
		return true
	case "close_friends":
		_, ok := acceptedFriends[story.UserID]
		return ok
	case "chat":
		return story.ChatUserID != nil && *story.ChatUserID == viewerID
	case "community":
		if story.CommunityID == nil {
			return false
		}
		_, ok := communityMemberships[*story.CommunityID]
		return ok
	default:
		return false
	}
}

func loadAcceptedFriendSet(userID uint) map[uint]struct{} {
	set := map[uint]struct{}{}
	if userID == 0 {
		return set
	}
	type pair struct{ UserID, FriendID uint }
	var rows []pair
	database.DB.Table("friendships").Select("user_id, friend_id").
		Where("status = 'accepted' AND (user_id = ? OR friend_id = ?)", userID, userID).
		Scan(&rows)
	for _, row := range rows {
		if row.UserID == userID && row.FriendID > 0 {
			set[row.FriendID] = struct{}{}
		}
		if row.FriendID == userID && row.UserID > 0 {
			set[row.UserID] = struct{}{}
		}
	}
	return set
}

func loadCommunityMembershipSet(userID uint) map[uint]struct{} {
	set := map[uint]struct{}{}
	if userID == 0 {
		return set
	}
	var ids []uint
	database.DB.Model(&models.CommunityMember{}).Where("user_id = ?", userID).Pluck("community_id", &ids)
	for _, id := range ids {
		set[id] = struct{}{}
	}
	return set
}

func attachStoryMeta(viewerID uint, stories []models.Story) {
	if len(stories) == 0 {
		return
	}
	ids := make([]uint, 0, len(stories))
	for _, story := range stories {
		ids = append(ids, story.ID)
	}

	var replyRows []struct {
		StoryID uint
		Count   int
	}
	database.DB.Table("story_replies").Select("story_id, count(*) AS count").Where("story_id IN ?", ids).Group("story_id").Scan(&replyRows)
	replyCounts := map[uint]int{}
	for _, row := range replyRows {
		replyCounts[row.StoryID] = row.Count
	}

	viewedSet := map[uint]struct{}{}
	if viewerID > 0 {
		var viewedIDs []uint
		database.DB.Model(&models.StoryView{}).Where("user_id = ? AND story_id IN ?", viewerID, ids).Pluck("story_id", &viewedIDs)
		for _, id := range viewedIDs {
			viewedSet[id] = struct{}{}
		}
	}

	for i := range stories {
		stories[i].RepliesCount = replyCounts[stories[i].ID]
		_, stories[i].Viewed = viewedSet[stories[i].ID]
	}
}

type createStoryRequest struct {
	Kind            string `json:"kind"`
	Audience        string `json:"audience"`
	Intent          string `json:"intent"`
	Content         string `json:"content"`
	MediaURL        string `json:"media_url"`
	DurationMinutes int    `json:"duration_minutes"`
	CommunityID     *uint  `json:"community_id"`
	ChatUserID      *uint  `json:"chat_user_id"`
}

func normalizeStoryKind(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "status", "intent", "text":
		return strings.TrimSpace(strings.ToLower(raw))
	case "":
		return "status"
	default:
		return "status"
	}
}

func normalizeStoryAudience(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "all", "close_friends", "chat", "community":
		return strings.TrimSpace(strings.ToLower(raw))
	default:
		return "all"
	}
}

func (h *StoryHandler) ListStories(c *gin.Context) {
	viewerID := currentUserID(c)
	acceptedFriends := loadAcceptedFriendSet(viewerID)
	communityMemberships := loadCommunityMembershipSet(viewerID)

	var stories []models.Story
	if err := database.DB.Preload("User").Preload("Community").Where("expires_at > ?", time.Now()).Order("created_at DESC").Limit(200).Find(&stories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить истории"})
		return
	}

	visible := make([]models.Story, 0, len(stories))
	for _, story := range stories {
		if storyCanAccess(viewerID, story, acceptedFriends, communityMemberships) {
			visible = append(visible, story)
		}
	}
	attachStoryMeta(viewerID, visible)
	sort.SliceStable(visible, func(i, j int) bool {
		if visible[i].Viewed != visible[j].Viewed {
			return !visible[i].Viewed
		}
		if visible[i].UserID == viewerID && visible[j].UserID != viewerID {
			return true
		}
		if visible[j].UserID == viewerID && visible[i].UserID != viewerID {
			return false
		}
		return visible[i].CreatedAt.After(visible[j].CreatedAt)
	})
	c.JSON(http.StatusOK, gin.H{"stories": visible})
}

func (h *StoryHandler) CreateStory(c *gin.Context) {
	userID := currentUserID(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Нужна авторизация"})
		return
	}
	var req createStoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректные данные истории"})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Добавьте текст истории"})
		return
	}
	duration := req.DurationMinutes
	if !isAllowedStoryDuration(duration) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимое время жизни истории"})
		return
	}
	audience := normalizeStoryAudience(req.Audience)
	kind := normalizeStoryKind(req.Kind)
	story := models.Story{
		UserID:          userID,
		Kind:            kind,
		Audience:        audience,
		Intent:          strings.TrimSpace(req.Intent),
		Content:         content,
		MediaURL:        strings.TrimSpace(req.MediaURL),
		DurationMinutes: duration,
		ExpiresAt:       time.Now().Add(time.Duration(duration) * time.Minute),
	}
	if audience == "community" {
		if req.CommunityID == nil || *req.CommunityID == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Выберите сообщество"})
			return
		}
		var membership models.CommunityMember
		if err := database.DB.Where("community_id = ? AND user_id = ?", *req.CommunityID, userID).First(&membership).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "Вы не состоите в этом сообществе"})
			return
		}
		story.CommunityID = req.CommunityID
	}
	if audience == "chat" {
		if req.ChatUserID == nil || *req.ChatUserID == 0 || *req.ChatUserID == userID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Выберите чат для истории"})
			return
		}
		story.ChatUserID = req.ChatUserID
	}
	if err := database.DB.Create(&story).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать историю"})
		return
	}
	database.DB.Preload("User").Preload("Community").First(&story, story.ID)
	stories := []models.Story{story}
	attachStoryMeta(userID, stories)
	story = stories[0]
	c.JSON(http.StatusCreated, gin.H{"story": story})
}

func (h *StoryHandler) ViewStory(c *gin.Context) {
	userID := currentUserID(c)
	storyID, _ := strconv.Atoi(c.Param("id"))
	if storyID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректная история"})
		return
	}
	var story models.Story
	if err := database.DB.First(&story, storyID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "История не найдена"})
		return
	}
	if story.UserID == userID {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}
	acceptedFriends := loadAcceptedFriendSet(userID)
	communityMemberships := loadCommunityMembershipSet(userID)
	if !storyCanAccess(userID, story, acceptedFriends, communityMemberships) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Нет доступа к истории"})
		return
	}
	view := models.StoryView{StoryID: uint(storyID), UserID: userID, ViewedAt: time.Now()}
	database.DB.Where(models.StoryView{StoryID: uint(storyID), UserID: userID}).Assign(models.StoryView{ViewedAt: time.Now()}).FirstOrCreate(&view)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *StoryHandler) ListReplies(c *gin.Context) {
	userID := currentUserID(c)
	storyID, _ := strconv.Atoi(c.Param("id"))
	if storyID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректная история"})
		return
	}
	var story models.Story
	if err := database.DB.Preload("User").First(&story, storyID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "История не найдена"})
		return
	}
	acceptedFriends := loadAcceptedFriendSet(userID)
	communityMemberships := loadCommunityMembershipSet(userID)
	if !storyCanAccess(userID, story, acceptedFriends, communityMemberships) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Нет доступа к истории"})
		return
	}
	var replies []models.StoryReply
	if err := database.DB.Preload("User").Where("story_id = ?", storyID).Order("created_at ASC").Find(&replies).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить ответы"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"replies": replies})
}

func (h *StoryHandler) AddReply(c *gin.Context) {
	userID := currentUserID(c)
	storyID, _ := strconv.Atoi(c.Param("id"))
	if storyID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректная история"})
		return
	}
	var story models.Story
	if err := database.DB.First(&story, storyID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "История не найдена"})
		return
	}
	acceptedFriends := loadAcceptedFriendSet(userID)
	communityMemberships := loadCommunityMembershipSet(userID)
	if !storyCanAccess(userID, story, acceptedFriends, communityMemberships) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Нет доступа к истории"})
		return
	}
	if story.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "История уже завершилась"})
		return
	}
	var req struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Content) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Введите ответ"})
		return
	}
	reply := models.StoryReply{StoryID: uint(storyID), UserID: userID, Content: strings.TrimSpace(req.Content)}
	if err := database.DB.Create(&reply).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось отправить ответ"})
		return
	}
	database.DB.Preload("User").First(&reply, reply.ID)
	c.JSON(http.StatusCreated, gin.H{"reply": reply})
}

func (h *StoryHandler) ExtendStory(c *gin.Context) {
	userID := currentUserID(c)
	storyID, _ := strconv.Atoi(c.Param("id"))
	if storyID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректная история"})
		return
	}
	var story models.Story
	if err := database.DB.First(&story, storyID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "История не найдена"})
		return
	}
	if story.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Продлевать историю может только автор"})
		return
	}
	if story.ExtendCount >= 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Историю можно продлить не больше двух раз"})
		return
	}
	var req struct {
		DurationMinutes int `json:"duration_minutes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || !isAllowedStoryDuration(req.DurationMinutes) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимое время продления"})
		return
	}
	base := story.ExpiresAt
	if base.Before(time.Now()) {
		base = time.Now()
	}
	story.ExpiresAt = base.Add(time.Duration(req.DurationMinutes) * time.Minute)
	story.ExtendCount += 1
	story.DurationMinutes = req.DurationMinutes
	if err := database.DB.Save(&story).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось продлить историю"})
		return
	}
	database.DB.Preload("User").Preload("Community").First(&story, story.ID)
	stories := []models.Story{story}
	attachStoryMeta(userID, stories)
	story = stories[0]
	c.JSON(http.StatusOK, gin.H{"story": story})
}

func (h *StoryHandler) DeleteStory(c *gin.Context) {
	userID := currentUserID(c)
	storyID, _ := strconv.Atoi(c.Param("id"))
	if storyID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректная история"})
		return
	}
	result := database.DB.Where("id = ? AND user_id = ?", storyID, userID).Delete(&models.Story{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить историю"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "История не найдена"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

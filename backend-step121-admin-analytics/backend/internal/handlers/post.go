package handlers

import (
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"friendscape/internal/realtime"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type PostHandler struct{}

var commentMentionPattern = regexp.MustCompile(`(?i)(?:^|[^\w])@([a-z0-9_.]{2,64})`)
var feedTopicPattern = regexp.MustCompile(`(?i)#([a-zа-я0-9_]{2,48})`)

const maxCommentDepth = 2

const (
	feedScopeFriends     = "friends"
	feedScopeFollowing   = "following"
	feedScopeRecommended = "recommended"

	feedPreferenceNotInterested = "not_interested"
	feedPreferenceHideAuthor    = "hide_author"
	feedPreferenceHideTopic     = "hide_topic"
	feedPreferenceLessLikeThis  = "less_like_this"
)

type feedPreferenceState struct {
	hiddenPosts   map[uint]struct{}
	hiddenAuthors map[uint]struct{}
	hiddenTopics  map[string]struct{}
	lessPosts     map[uint]int
	lessAuthors   map[uint]int
	lessTopics    map[string]int
}

func emptyFeedPreferenceState() feedPreferenceState {
	return feedPreferenceState{
		hiddenPosts:   map[uint]struct{}{},
		hiddenAuthors: map[uint]struct{}{},
		hiddenTopics:  map[string]struct{}{},
		lessPosts:     map[uint]int{},
		lessAuthors:   map[uint]int{},
		lessTopics:    map[string]int{},
	}
}

func normalizeFeedTopic(raw string) string {
	value := strings.TrimSpace(strings.ToLower(raw))
	value = strings.TrimPrefix(value, "#")
	if len(value) < 2 {
		return ""
	}
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'а' && r <= 'я') || (r >= '0' && r <= '9') || r == '_' || r == 'ё' {
			b.WriteRune(r)
		}
	}
	result := b.String()
	if len(result) < 2 {
		return ""
	}
	return result
}

func extractFeedTopics(content string) []string {
	matches := feedTopicPattern.FindAllStringSubmatch(strings.ToLower(content), -1)
	if len(matches) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		topic := normalizeFeedTopic(match[1])
		if topic == "" {
			continue
		}
		if _, exists := seen[topic]; exists {
			continue
		}
		seen[topic] = struct{}{}
		result = append(result, topic)
	}
	return result
}

func loadFeedPreferenceState(viewerID uint) (feedPreferenceState, error) {
	state := emptyFeedPreferenceState()
	var prefs []models.FeedPreference
	if err := database.DB.Where("user_id = ? AND type IN ?", viewerID, []string{feedPreferenceNotInterested, feedPreferenceHideAuthor, feedPreferenceHideTopic, feedPreferenceLessLikeThis}).Find(&prefs).Error; err != nil {
		return state, err
	}
	for _, pref := range prefs {
		switch pref.Type {
		case feedPreferenceNotInterested:
			if pref.PostID != nil && *pref.PostID > 0 {
				state.hiddenPosts[*pref.PostID] = struct{}{}
			}
		case feedPreferenceHideAuthor:
			if pref.AuthorID != nil && *pref.AuthorID > 0 {
				state.hiddenAuthors[*pref.AuthorID] = struct{}{}
			}
		case feedPreferenceHideTopic:
			topic := normalizeFeedTopic(pref.Topic)
			if topic != "" {
				state.hiddenTopics[topic] = struct{}{}
			}
		case feedPreferenceLessLikeThis:
			if pref.PostID != nil && *pref.PostID > 0 {
				state.lessPosts[*pref.PostID]++
			}
			if pref.AuthorID != nil && *pref.AuthorID > 0 {
				state.lessAuthors[*pref.AuthorID]++
			}
			topic := normalizeFeedTopic(pref.Topic)
			if topic != "" {
				state.lessTopics[topic]++
			}
		}
	}
	return state, nil
}

func isRecommendedPostHidden(post models.Post, prefs feedPreferenceState) bool {
	if _, exists := prefs.hiddenPosts[post.ID]; exists {
		return true
	}
	if _, exists := prefs.hiddenAuthors[post.UserID]; exists {
		return true
	}
	if len(prefs.hiddenTopics) > 0 {
		for _, topic := range extractFeedTopics(post.Content) {
			if _, exists := prefs.hiddenTopics[topic]; exists {
				return true
			}
		}
	}
	return false
}

func filterRecommendedPosts(posts []models.Post, prefs feedPreferenceState) []models.Post {
	if len(posts) == 0 {
		return posts
	}
	filtered := make([]models.Post, 0, len(posts))
	for _, post := range posts {
		if isRecommendedPostHidden(post, prefs) {
			continue
		}
		filtered = append(filtered, post)
	}
	return filtered
}

func normalizeFeedScope(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", feedScopeFriends:
		return feedScopeFriends
	case feedScopeFollowing:
		return feedScopeFollowing
	case feedScopeRecommended, "global":
		return feedScopeRecommended
	default:
		return feedScopeFriends
	}
}

func feedPostsBaseQuery(viewerID uint) *gorm.DB {
	return database.DB.Model(&models.Post{}).
		Distinct("posts.id", "posts.user_id", "posts.content", "posts.images", "posts.likes", "posts.comments", "posts.created_at", "posts.updated_at").
		Joins("LEFT JOIN users author_users ON author_users.id = posts.user_id").
		Joins("LEFT JOIN friendships ON ((friendships.user_id = ? AND friendships.friend_id = posts.user_id) OR (friendships.friend_id = ? AND friendships.user_id = posts.user_id)) AND friendships.status = 'accepted'", viewerID, viewerID).
		Joins("LEFT JOIN subscriptions ON subscriptions.subscriber_id = ? AND subscriptions.user_id = posts.user_id", viewerID)
}

func feedPostsCountBaseQuery(viewerID uint) *gorm.DB {
	return database.DB.Model(&models.Post{}).
		Distinct("posts.id").
		Joins("LEFT JOIN users author_users ON author_users.id = posts.user_id").
		Joins("LEFT JOIN friendships ON ((friendships.user_id = ? AND friendships.friend_id = posts.user_id) OR (friendships.friend_id = ? AND friendships.user_id = posts.user_id)) AND friendships.status = 'accepted'", viewerID, viewerID).
		Joins("LEFT JOIN subscriptions ON subscriptions.subscriber_id = ? AND subscriptions.user_id = posts.user_id", viewerID)
}

func applyFeedScope(query *gorm.DB, viewerID uint, scope string) *gorm.DB {
	switch normalizeFeedScope(scope) {
	case feedScopeFollowing:
		return query.Where("subscriptions.id IS NOT NULL AND posts.user_id <> ? AND friendships.id IS NULL", viewerID)
	case feedScopeRecommended:
		return query.Where("posts.user_id <> ? AND friendships.id IS NULL AND subscriptions.id IS NULL AND COALESCE(author_users.is_private, false) = false", viewerID)
	default:
		return query.Where("posts.user_id = ? OR friendships.id IS NOT NULL", viewerID)
	}
}

func countRecommendedFeedScope(viewerID uint) int64 {
	prefs, err := loadFeedPreferenceState(viewerID)
	if err != nil {
		return 0
	}
	var candidates []models.Post
	err = applyFeedScope(feedPostsBaseQuery(viewerID), viewerID, feedScopeRecommended).
		Order("posts.created_at DESC").
		Limit(1000).
		Find(&candidates).Error
	if err != nil {
		return 0
	}
	return int64(len(filterRecommendedPosts(candidates, prefs)))
}

func countFeedScope(viewerID uint, scope string) int64 {
	if normalizeFeedScope(scope) == feedScopeRecommended {
		return countRecommendedFeedScope(viewerID)
	}
	var count int64
	applyFeedScope(feedPostsCountBaseQuery(viewerID), viewerID, scope).Count(&count)
	return count
}

func hasPostMedia(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	return trimmed != "" && trimmed != "[]" && trimmed != "null"
}

func adjustRecommendedScore(post models.Post, prefs feedPreferenceState, baseScore float64) float64 {
	score := baseScore
	if penalty, exists := prefs.lessPosts[post.ID]; exists && penalty > 0 {
		score -= float64(penalty) * 40
	}
	if penalty, exists := prefs.lessAuthors[post.UserID]; exists && penalty > 0 {
		score -= float64(penalty) * 12
	}
	if len(prefs.lessTopics) > 0 {
		for _, topic := range extractFeedTopics(post.Content) {
			if penalty, exists := prefs.lessTopics[topic]; exists && penalty > 0 {
				score -= float64(penalty) * 10
			}
		}
	}
	return score
}

func recommendedScoreForPost(post models.Post) (float64, string) {
	score := 0.0
	reason := "Рекомендация ленты"

	commentWeight := float64(post.Comments) * 3.4
	likeWeight := float64(post.Likes) * 1.9
	mediaBoost := 0.0
	if hasPostMedia(post.Images) {
		mediaBoost = 2.5
	}

	age := time.Since(post.CreatedAt)
	if age < 0 {
		age = 0
	}

	freshness := 0.0
	switch {
	case age <= 6*time.Hour:
		freshness = 16
	case age <= 24*time.Hour:
		freshness = 11
	case age <= 72*time.Hour:
		freshness = 6
	case age <= 7*24*time.Hour:
		freshness = 2
	default:
		freshness = -2
	}

	score = commentWeight + likeWeight + mediaBoost + freshness

	switch {
	case post.Comments >= 8:
		reason = "Много обсуждений"
	case post.Likes >= 12:
		reason = "Много реакций"
	case age <= 24*time.Hour:
		reason = "Свежее обсуждение"
	case hasPostMedia(post.Images):
		reason = "Интересное медиа"
	}

	return score, reason
}

func recommendedCandidateLimit(limit, offset int) int {
	window := offset + limit + 120
	if window < 120 {
		window = 120
	}
	if window > 400 {
		window = 400
	}
	return window
}

func loadViewerTopicAffinity(viewerID uint) (map[string]float64, error) {
	affinity := map[string]float64{}
	addWeightedTopics := func(contents []string, weight float64) {
		for _, content := range contents {
			for _, topic := range extractFeedTopics(content) {
				affinity[topic] += weight
			}
		}
	}

	var likedContents []string
	if err := database.DB.Table("likes").
		Select("posts.content").
		Joins("JOIN posts ON posts.id = likes.post_id").
		Where("likes.user_id = ?", viewerID).
		Order("likes.created_at DESC").
		Limit(120).
		Scan(&likedContents).Error; err != nil {
		return affinity, err
	}
	addWeightedTopics(likedContents, 3.0)

	var commentedContents []string
	if err := database.DB.Table("comments").
		Select("posts.content").
		Joins("JOIN posts ON posts.id = comments.post_id").
		Where("comments.user_id = ?", viewerID).
		Order("comments.created_at DESC").
		Limit(120).
		Scan(&commentedContents).Error; err != nil {
		return affinity, err
	}
	addWeightedTopics(commentedContents, 4.0)

	var ownContents []string
	if err := database.DB.Model(&models.Post{}).
		Where("user_id = ?", viewerID).
		Order("created_at DESC").
		Limit(80).
		Pluck("content", &ownContents).Error; err != nil {
		return affinity, err
	}
	addWeightedTopics(ownContents, 2.0)

	return affinity, nil
}

func loadViewerAuthorAffinity(viewerID uint) (map[uint]float64, error) {
	affinity := map[uint]float64{}
	addWeights := func(authorIDs []uint, weight float64) {
		for _, id := range authorIDs {
			if id == 0 || id == viewerID {
				continue
			}
			affinity[id] += weight
		}
	}

	var likedAuthorIDs []uint
	if err := database.DB.Table("likes").
		Select("posts.user_id").
		Joins("JOIN posts ON posts.id = likes.post_id").
		Where("likes.user_id = ?", viewerID).
		Order("likes.created_at DESC").
		Limit(120).
		Scan(&likedAuthorIDs).Error; err != nil {
		return affinity, err
	}
	addWeights(likedAuthorIDs, 2.8)

	var commentedAuthorIDs []uint
	if err := database.DB.Table("comments").
		Select("posts.user_id").
		Joins("JOIN posts ON posts.id = comments.post_id").
		Where("comments.user_id = ?", viewerID).
		Order("comments.created_at DESC").
		Limit(120).
		Scan(&commentedAuthorIDs).Error; err != nil {
		return affinity, err
	}
	addWeights(commentedAuthorIDs, 3.3)

	var subscriptions []uint
	if err := database.DB.Model(&models.Subscription{}).Where("subscriber_id = ?", viewerID).Pluck("user_id", &subscriptions).Error; err != nil {
		return affinity, err
	}
	addWeights(subscriptions, 5.0)

	type pair struct{ UserID, FriendID uint }
	var friendships []pair
	if err := database.DB.Table("friendships").Select("user_id, friend_id").Where("status = 'accepted' AND (user_id = ? OR friend_id = ?)", viewerID, viewerID).Scan(&friendships).Error; err != nil {
		return affinity, err
	}
	for _, item := range friendships {
		if item.UserID == viewerID && item.FriendID > 0 {
			affinity[item.FriendID] += 6.0
		}
		if item.FriendID == viewerID && item.UserID > 0 {
			affinity[item.UserID] += 6.0
		}
	}

	return affinity, nil
}

func loadViewerCommunityAffinity(viewerID uint) (map[uint]float64, error) {
	affinity := map[uint]float64{}
	if viewerID == 0 {
		return affinity, nil
	}
	var memberCommunityIDs []uint
	if err := database.DB.Model(&models.CommunityMember{}).Where("user_id = ?", viewerID).Pluck("community_id", &memberCommunityIDs).Error; err != nil {
		return affinity, err
	}
	for _, id := range memberCommunityIDs {
		if id > 0 {
			affinity[id] += 7.0
		}
	}

	var likedCommunityIDs []uint
	if err := database.DB.Table("likes").Select("posts.community_id").Joins("JOIN posts ON posts.id = likes.post_id").Where("likes.user_id = ? AND posts.community_id IS NOT NULL", viewerID).Order("likes.created_at DESC").Limit(120).Scan(&likedCommunityIDs).Error; err != nil {
		return affinity, err
	}
	for _, id := range likedCommunityIDs {
		if id > 0 {
			affinity[id] += 2.2
		}
	}

	var commentedCommunityIDs []uint
	if err := database.DB.Table("comments").Select("posts.community_id").Joins("JOIN posts ON posts.id = comments.post_id").Where("comments.user_id = ? AND posts.community_id IS NOT NULL", viewerID).Order("comments.created_at DESC").Limit(120).Scan(&commentedCommunityIDs).Error; err != nil {
		return affinity, err
	}
	for _, id := range commentedCommunityIDs {
		if id > 0 {
			affinity[id] += 2.8
		}
	}
	return affinity, nil
}

func buildRecommendedSignals(post models.Post, prefs feedPreferenceState, topicAffinity map[string]float64, authorAffinity map[uint]float64, communityAffinity map[uint]float64) (float64, string, []string, string) {
	score, reason := recommendedScoreForPost(post)
	signals := make([]string, 0, 8)
	primaryTopic := ""
	bestTopicScore := 0.0

	age := time.Since(post.CreatedAt)
	if age <= 6*time.Hour {
		signals = append(signals, "Очень свежий пост")
	} else if age <= 24*time.Hour {
		signals = append(signals, "Свежий пост")
	}
	if post.Comments >= 8 {
		signals = append(signals, "Активное обсуждение")
	}
	if post.Likes >= 12 {
		signals = append(signals, "Много реакций")
	}
	if hasPostMedia(post.Images) {
		signals = append(signals, "Есть медиа")
	}
	if post.Comments >= 3 && post.Likes >= 4 {
		score += 3.5
		signals = append(signals, "Хороший отклик аудитории")
	}

	for _, topic := range extractFeedTopics(post.Content) {
		if affinity := topicAffinity[topic]; affinity > bestTopicScore {
			bestTopicScore = affinity
			primaryTopic = topic
		}
	}
	if bestTopicScore > 0 {
		bonus := bestTopicScore * 4.0
		if bonus > 18 {
			bonus = 18
		}
		score += bonus
		signals = append(signals, fmt.Sprintf("Похоже на темы #%s", primaryTopic))
		reason = fmt.Sprintf("Похоже на тему #%s", primaryTopic)
	}
	if affinity := authorAffinity[post.UserID]; affinity > 0 {
		bonus := affinity * 1.4
		if bonus > 16 {
			bonus = 16
		}
		score += bonus
		signals = append(signals, "Автор вам уже откликался")
		if strings.Contains(reason, "Рекомендация") {
			reason = "Автор, с которым вы взаимодействовали"
		}
	}
	if post.CommunityID != nil {
		if affinity := communityAffinity[*post.CommunityID]; affinity > 0 {
			bonus := affinity * 1.2
			if bonus > 14 {
				bonus = 14
			}
			score += bonus
			signals = append(signals, "Близкое вам сообщество")
			if strings.Contains(reason, "Рекомендация") {
				reason = "Пост из близкого сообщества"
			}
		}
	}

	score = adjustRecommendedScore(post, prefs, score)
	if len(signals) == 0 {
		signals = append(signals, "Подобрано по общей релевантности")
	}
	return score, reason, signals, primaryTopic
}

func diversifyRecommendedPosts(posts []models.Post) []models.Post {
	if len(posts) < 3 {
		return posts
	}
	remaining := append([]models.Post(nil), posts...)
	result := make([]models.Post, 0, len(posts))
	lastAuthorID := uint(0)
	lastTopic := ""

	for len(remaining) > 0 {
		pick := 0
		for idx, candidate := range remaining {
			candidateTopic := candidate.RecommendedTopic
			if candidateTopic == "" {
				topics := extractFeedTopics(candidate.Content)
				if len(topics) > 0 {
					candidateTopic = topics[0]
				}
			}
			if candidate.UserID != lastAuthorID && (candidateTopic == "" || candidateTopic != lastTopic) {
				pick = idx
				break
			}
		}
		chosen := remaining[pick]
		result = append(result, chosen)
		lastAuthorID = chosen.UserID
		lastTopic = chosen.RecommendedTopic
		remaining = append(remaining[:pick], remaining[pick+1:]...)
	}

	return result
}

func fetchRecommendedFeedPosts(viewerID uint, limit, offset int) ([]models.Post, bool, error) {
	prefs, err := loadFeedPreferenceState(viewerID)
	if err != nil {
		return nil, false, err
	}
	var candidates []models.Post
	err = applyFeedScope(feedPostsBaseQuery(viewerID), viewerID, feedScopeRecommended).
		Order("posts.created_at DESC").
		Limit(recommendedCandidateLimit(limit, offset)).
		Preload("User").
		Find(&candidates).Error
	if err != nil {
		return nil, false, err
	}

	topicAffinity, err := loadViewerTopicAffinity(viewerID)
	if err != nil {
		return nil, false, err
	}
	authorAffinity, err := loadViewerAuthorAffinity(viewerID)
	if err != nil {
		return nil, false, err
	}
	communityAffinity, err := loadViewerCommunityAffinity(viewerID)
	if err != nil {
		return nil, false, err
	}

	candidates = filterRecommendedPosts(candidates, prefs)
	for i := range candidates {
		score, reason, signals, topic := buildRecommendedSignals(candidates[i], prefs, topicAffinity, authorAffinity, communityAffinity)
		candidates[i].RecommendedScore = score
		candidates[i].RecommendedReason = reason
		candidates[i].RecommendedSignals = signals
		candidates[i].RecommendedTopic = topic
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].RecommendedScore == candidates[j].RecommendedScore {
			if candidates[i].CreatedAt.Equal(candidates[j].CreatedAt) {
				return candidates[i].ID > candidates[j].ID
			}
			return candidates[i].CreatedAt.After(candidates[j].CreatedAt)
		}
		return candidates[i].RecommendedScore > candidates[j].RecommendedScore
	})

	candidates = diversifyRecommendedPosts(candidates)
	if offset >= len(candidates) {
		return []models.Post{}, false, nil
	}
	end := offset + limit
	if end > len(candidates) {
		end = len(candidates)
	}
	selected := candidates[offset:end]
	hasMore := end < len(candidates)
	return selected, hasMore, nil
}

func NewPostHandler() *PostHandler {
	return &PostHandler{}
}

func postActorName(user models.User) string {
	name := strings.TrimSpace(strings.TrimSpace(user.FirstName + " " + user.LastName))
	if name != "" {
		return name
	}
	if user.Username != "" {
		return user.Username
	}
	return "Пользователь"
}

func postExcerpt(content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return "посту"
	}
	runes := []rune(content)
	if len(runes) > 42 {
		return string(runes[:42]) + "…"
	}
	return content
}

func sanitizeContent(content string) string {
	return html.EscapeString(strings.TrimSpace(content))
}

func collectCommentSubtreeIDs(rootID uint) ([]uint, error) {
	ids := []uint{rootID}
	frontier := []uint{rootID}
	for len(frontier) > 0 {
		var childIDs []uint
		if err := database.DB.Model(&models.Comment{}).Where("parent_id IN ?", frontier).Pluck("id", &childIDs).Error; err != nil {
			return nil, err
		}
		if len(childIDs) == 0 {
			break
		}
		ids = append(ids, childIDs...)
		frontier = childIDs
	}
	return ids, nil
}

func loadCommentLineage(comment models.Comment) ([]models.Comment, error) {
	lineage := []models.Comment{comment}
	current := comment
	for hops := 0; current.ParentID != nil && *current.ParentID > 0 && hops < 16; hops++ {
		var parent models.Comment
		if err := database.DB.Select("id", "post_id", "parent_id", "user_id", "content").First(&parent, *current.ParentID).Error; err != nil {
			return nil, err
		}
		lineage = append([]models.Comment{parent}, lineage...)
		current = parent
	}
	return lineage, nil
}

func createUserNotification(userID uint, notificationType, content, link string) {
	if userID == 0 {
		return
	}
	notification := &models.Notification{
		UserID:  userID,
		Type:    notificationType,
		Content: content,
		Link:    link,
	}
	if err := database.DB.Create(notification).Error; err == nil {
		realtime.DefaultBroker.PublishToUser(userID, realtime.Event{Type: "notification:new", Channel: "notifications", Data: map[string]any{"notification_type": notification.Type, "notification": notification}})
	}
}

func findMentionedUsers(content string, excludeIDs ...uint) ([]models.User, error) {
	matches := commentMentionPattern.FindAllStringSubmatch(strings.ToLower(content), -1)
	if len(matches) == 0 {
		return nil, nil
	}
	nameSet := map[string]struct{}{}
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		username := strings.TrimSpace(match[1])
		if username == "" {
			continue
		}
		nameSet[username] = struct{}{}
	}
	if len(nameSet) == 0 {
		return nil, nil
	}
	usernames := make([]string, 0, len(nameSet))
	for username := range nameSet {
		usernames = append(usernames, username)
	}
	var users []models.User
	if err := database.DB.Select("id, username, first_name, last_name").Where("LOWER(username) IN ?", usernames).Find(&users).Error; err != nil {
		return nil, err
	}
	excluded := map[uint]struct{}{}
	for _, id := range excludeIDs {
		if id > 0 {
			excluded[id] = struct{}{}
		}
	}
	filtered := make([]models.User, 0, len(users))
	for _, user := range users {
		if _, skip := excluded[user.ID]; skip {
			continue
		}
		filtered = append(filtered, user)
	}
	return filtered, nil
}

type postWithLike struct {
	models.Post
	Liked bool `json:"liked"`
}

func buildPostWithLike(viewerID uint, post models.Post) postWithLike {
	var liked bool
	database.DB.Model(&models.Like{}).Where("user_id = ? AND post_id = ?", viewerID, post.ID).Select("count(*) > 0").Find(&liked)
	decorateUserRelationship(viewerID, &post.User)
	return postWithLike{Post: post, Liked: liked}
}

func postIDParam(c *gin.Context) (int, bool) {
	postID, err := strconv.Atoi(c.Param("id"))
	if err != nil || postID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный id поста"})
		return 0, false
	}
	return postID, true
}

func loadPostByID(postID int, preloadUser bool) (*models.Post, error) {
	var post models.Post
	query := database.DB
	if preloadUser {
		query = query.Preload("User")
	}
	if err := query.First(&post, postID).Error; err != nil {
		return nil, err
	}
	return &post, nil
}

func normalizeImagesPayload(raw json.RawMessage) (string, int, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "[]", 0, nil
	}
	if len(raw) > 64*1024 {
		return "", 0, fmt.Errorf("слишком большой payload изображений")
	}
	var items []any
	if err := json.Unmarshal(raw, &items); err != nil {
		return "", 0, fmt.Errorf("некорректные данные изображений")
	}
	encoded, err := json.Marshal(items)
	if err != nil {
		return "", 0, fmt.Errorf("не удалось сохранить изображения")
	}
	return string(encoded), len(items), nil
}

func (h *PostHandler) CreatePost(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var req struct {
		Content string          `json:"content" binding:"required,max=5000"`
		Images  json.RawMessage `json:"images"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нет контента"})
		return
	}

	imagesJSON, imageCount, err := normalizeImagesPayload(req.Images)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if imageCount > 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Максимум 10 изображений"})
		return
	}

	content := sanitizeContent(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Пост не может быть пустым"})
		return
	}

	post := &models.Post{
		UserID:  userID.(uint),
		Content: content,
		Images:  imagesJSON,
	}

	if err := database.DB.Create(post).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка создания поста"})
		return
	}

	database.DB.Preload("User").First(post, post.ID)

	c.JSON(http.StatusOK, gin.H{
		"message": "Пост создан",
		"post":    post,
	})
}

func (h *PostHandler) GetFeed(c *gin.Context) {
	userID, _ := c.Get("user_id")
	viewerID, ok := userID.(uint)
	if !ok || viewerID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	scope := normalizeFeedScope(c.DefaultQuery("scope", feedScopeFriends))

	if limit > 50 {
		limit = 50
	}
	if limit <= 0 {
		limit = 20
	}
	if page < 1 {
		page = 1
	}

	offset := (page - 1) * limit

	var (
		posts   []models.Post
		err     error
		hasMore bool
	)

	if scope == feedScopeRecommended {
		posts, hasMore, err = fetchRecommendedFeedPosts(viewerID, limit, offset)
	} else {
		err = applyFeedScope(feedPostsBaseQuery(viewerID), viewerID, scope).
			Order("posts.created_at DESC").
			Limit(limit + 1).
			Offset(offset).
			Preload("User").
			Find(&posts).Error
		if err == nil && len(posts) > limit {
			hasMore = true
			posts = posts[:limit]
		}
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки"})
		return
	}

	result := make([]postWithLike, len(posts))
	for i, post := range posts {
		result[i] = buildPostWithLike(viewerID, post)
	}

	counts := gin.H{
		"friends":     countFeedScope(viewerID, feedScopeFriends),
		"following":   countFeedScope(viewerID, feedScopeFollowing),
		"recommended": countFeedScope(viewerID, feedScopeRecommended),
	}

	c.JSON(http.StatusOK, gin.H{
		"posts":    result,
		"page":     page,
		"scope":    scope,
		"has_more": hasMore,
		"counts":   counts,
	})
}

type saveFeedPreferenceRequest struct {
	Type     string `json:"type"`
	PostID   *uint  `json:"post_id"`
	AuthorID *uint  `json:"author_id"`
	Topic    string `json:"topic"`
}

func (h *PostHandler) SaveFeedPreference(c *gin.Context) {
	userID, _ := c.Get("user_id")
	viewerID, ok := userID.(uint)
	if !ok || viewerID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var req saveFeedPreferenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректные данные"})
		return
	}

	pref := models.FeedPreference{UserID: viewerID}
	switch strings.TrimSpace(req.Type) {
	case feedPreferenceNotInterested:
		if req.PostID == nil || *req.PostID == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Не указан пост"})
			return
		}
		pref.Type = feedPreferenceNotInterested
		pref.PostID = req.PostID
	case feedPreferenceHideAuthor:
		if req.AuthorID == nil || *req.AuthorID == 0 || *req.AuthorID == viewerID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный автор"})
			return
		}
		pref.Type = feedPreferenceHideAuthor
		pref.AuthorID = req.AuthorID
	case feedPreferenceHideTopic:
		topic := normalizeFeedTopic(req.Topic)
		if topic == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Не указана тема"})
			return
		}
		pref.Type = feedPreferenceHideTopic
		pref.Topic = topic
	case feedPreferenceLessLikeThis:
		if req.PostID == nil || *req.PostID == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Не указан пост"})
			return
		}
		pref.Type = feedPreferenceLessLikeThis
		pref.PostID = req.PostID
		if req.AuthorID != nil && *req.AuthorID > 0 && *req.AuthorID != viewerID {
			pref.AuthorID = req.AuthorID
		}
		topic := normalizeFeedTopic(req.Topic)
		if topic != "" {
			pref.Topic = topic
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неизвестный тип сигнала"})
		return
	}

	query := database.DB.Where("user_id = ? AND type = ?", viewerID, pref.Type)
	if pref.PostID != nil {
		query = query.Where("post_id = ?", *pref.PostID)
	}
	if pref.AuthorID != nil {
		query = query.Where("author_id = ?", *pref.AuthorID)
	}
	if pref.Topic != "" {
		query = query.Where("topic = ?", pref.Topic)
	}

	var existing models.FeedPreference
	if err := query.First(&existing).Error; err == nil {
		c.JSON(http.StatusOK, gin.H{"message": "Сигнал уже сохранён", "preference": existing})
		return
	} else if err != nil && err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить сигнал"})
		return
	}

	if err := database.DB.Create(&pref).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить сигнал"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Сигнал сохранён", "preference": pref})
}

func (h *PostHandler) DeleteFeedPreference(c *gin.Context) {
	userID, _ := c.Get("user_id")
	viewerID, ok := userID.(uint)
	if !ok || viewerID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	prefID, err := strconv.Atoi(c.Param("id"))
	if err != nil || prefID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный сигнал"})
		return
	}

	var pref models.FeedPreference
	if err := database.DB.Where("id = ? AND user_id = ?", prefID, viewerID).First(&pref).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Сигнал не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить сигнал"})
		return
	}

	if err := database.DB.Delete(&pref).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить сигнал"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Сигнал удалён"})
}

type feedPreferenceListItem struct {
	ID          uint         `json:"id"`
	Type        string       `json:"type"`
	PostID      *uint        `json:"post_id,omitempty"`
	AuthorID    *uint        `json:"author_id,omitempty"`
	Topic       string       `json:"topic,omitempty"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
	Title       string       `json:"title"`
	Description string       `json:"description"`
	Author      *models.User `json:"author,omitempty"`
	Post        *gin.H       `json:"post,omitempty"`
}

func buildFeedPreferenceListItem(pref models.FeedPreference, authors map[uint]models.User, posts map[uint]models.Post) feedPreferenceListItem {
	item := feedPreferenceListItem{
		ID: pref.ID, Type: pref.Type, PostID: pref.PostID, AuthorID: pref.AuthorID, Topic: pref.Topic,
		CreatedAt: pref.CreatedAt, UpdatedAt: pref.UpdatedAt,
		Title: "Настройка рекомендации", Description: "Сигнал влияет на персональную ленту.",
	}
	switch pref.Type {
	case feedPreferenceNotInterested:
		item.Title = "Пост скрыт"
		item.Description = "Этот пост больше не будет попадаться в рекомендациях."
	case feedPreferenceHideAuthor:
		item.Title = "Автор скрыт"
		item.Description = "Посты этого автора больше не будут попадаться в рекомендации."
	case feedPreferenceHideTopic:
		item.Title = fmt.Sprintf("Тема #%s скрыта", pref.Topic)
		item.Description = "Похожие темы исключены из рекомендательной ленты."
	case feedPreferenceLessLikeThis:
		item.Title = "Меньше похожего"
		item.Description = "Лента снижает вес похожих постов, авторов и тем."
	}
	if pref.AuthorID != nil {
		if author, ok := authors[*pref.AuthorID]; ok {
			authorCopy := author
			item.Author = &authorCopy
		}
	}
	if pref.PostID != nil {
		if post, ok := posts[*pref.PostID]; ok {
			snippet := strings.TrimSpace(post.Content)
			if len([]rune(snippet)) > 120 {
				snippet = string([]rune(snippet)[:120]) + "…"
			}
			item.Post = &gin.H{"id": post.ID, "content": snippet, "created_at": post.CreatedAt}
		}
	}
	return item
}

func (h *PostHandler) ListFeedPreferences(c *gin.Context) {
	userID, _ := c.Get("user_id")
	viewerID, ok := userID.(uint)
	if !ok || viewerID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	var prefs []models.FeedPreference
	if err := database.DB.Where("user_id = ?", viewerID).Order("created_at DESC").Find(&prefs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить настройки рекомендаций"})
		return
	}

	authorIDs := make([]uint, 0)
	postIDs := make([]uint, 0)
	authorSeen := map[uint]struct{}{}
	postSeen := map[uint]struct{}{}
	for _, pref := range prefs {
		if pref.AuthorID != nil && *pref.AuthorID > 0 {
			if _, ok := authorSeen[*pref.AuthorID]; !ok {
				authorSeen[*pref.AuthorID] = struct{}{}
				authorIDs = append(authorIDs, *pref.AuthorID)
			}
		}
		if pref.PostID != nil && *pref.PostID > 0 {
			if _, ok := postSeen[*pref.PostID]; !ok {
				postSeen[*pref.PostID] = struct{}{}
				postIDs = append(postIDs, *pref.PostID)
			}
		}
	}

	authors := map[uint]models.User{}
	if len(authorIDs) > 0 {
		var users []models.User
		if err := database.DB.Where("id IN ?", authorIDs).Find(&users).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить авторов рекомендаций"})
			return
		}
		for _, user := range users {
			authors[user.ID] = user
		}
	}

	posts := map[uint]models.Post{}
	if len(postIDs) > 0 {
		var loaded []models.Post
		if err := database.DB.Where("id IN ?", postIDs).Find(&loaded).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить скрытые посты"})
			return
		}
		for _, post := range loaded {
			posts[post.ID] = post
		}
	}

	items := make([]feedPreferenceListItem, 0, len(prefs))
	for _, pref := range prefs {
		items = append(items, buildFeedPreferenceListItem(pref, authors, posts))
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *PostHandler) GetUserPosts(c *gin.Context) {
	userID := c.Param("id")

	var posts []models.Post
	err := database.DB.Where("user_id = ?", userID).
		Order("created_at DESC").
		Preload("User").
		Find(&posts).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки"})
		return
	}

	currentUserID, exists := c.Get("user_id")
	result := make([]postWithLike, len(posts))

	for i, post := range posts {
		if exists {
			if uid, ok := currentUserID.(uint); ok {
				result[i] = buildPostWithLike(uid, post)
				continue
			}
		}
		result[i] = postWithLike{Post: post, Liked: false}
	}

	c.JSON(http.StatusOK, gin.H{"posts": result})
}

func (h *PostHandler) GetPost(c *gin.Context) {
	userID, _ := c.Get("user_id")
	postID, ok := postIDParam(c)
	if !ok {
		return
	}

	post, err := loadPostByID(postID, true)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пост не найден"})
		return
	}

	viewerID, ok := userID.(uint)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}

	result := buildPostWithLike(viewerID, *post)
	c.JSON(http.StatusOK, gin.H{"post": result})
}

func (h *PostHandler) LikePost(c *gin.Context) {
	userID, _ := c.Get("user_id")
	postID, ok := postIDParam(c)
	if !ok {
		return
	}

	post, err := loadPostByID(postID, false)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пост не найден"})
		return
	}

	var like models.Like
	if err := database.DB.Where("user_id = ? AND post_id = ?", userID, postID).First(&like).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Уже лайкнуто"})
		return
	}

	like = models.Like{
		UserID: userID.(uint),
		PostID: uint(postID),
	}

	if err := database.DB.Create(&like).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка"})
		return
	}

	database.DB.Model(&models.Post{}).Where("id = ?", postID).Update("likes", database.DB.Raw("likes + 1"))

	if post.UserID != userID.(uint) {
		var actor models.User
		database.DB.Select("id, username, first_name, last_name").First(&actor, userID)
		notification := &models.Notification{
			UserID:  post.UserID,
			Type:    "like",
			Content: postActorName(actor) + " поставил(а) лайк вашему посту: «" + postExcerpt(post.Content) + "»",
			Link:    "/feed?post=" + strconv.Itoa(postID),
		}
		database.DB.Create(notification)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Лайк поставлен"})
}

func (h *PostHandler) UnlikePost(c *gin.Context) {
	userID, _ := c.Get("user_id")
	postID, ok := postIDParam(c)
	if !ok {
		return
	}

	if _, err := loadPostByID(postID, false); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пост не найден"})
		return
	}

	result := database.DB.Where("user_id = ? AND post_id = ?", userID, postID).Delete(&models.Like{})
	if result.RowsAffected > 0 {
		database.DB.Model(&models.Post{}).Where("id = ?", postID).Update("likes", database.DB.Raw("CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END"))
	}

	c.JSON(http.StatusOK, gin.H{"message": "Лайк убран"})
}

func (h *PostHandler) AddComment(c *gin.Context) {
	userID, _ := c.Get("user_id")
	postID, ok := postIDParam(c)
	if !ok {
		return
	}

	post, err := loadPostByID(postID, false)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пост не найден"})
		return
	}

	var req struct {
		Content  string `json:"content" binding:"required,max=2000"`
		ParentID *uint  `json:"parent_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нет текста"})
		return
	}

	content := sanitizeContent(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Комментарий не может быть пустым"})
		return
	}

	var parentComment *models.Comment
	storedParentID := req.ParentID
	depthLimited := false
	if req.ParentID != nil && *req.ParentID > 0 {
		var parent models.Comment
		if err := database.DB.Where("id = ? AND post_id = ?", *req.ParentID, postID).First(&parent).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Комментарий для ответа не найден"})
			return
		}
		parentComment = &parent
		lineage, err := loadCommentLineage(parent)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось подготовить ветку комментариев"})
			return
		}
		targetDepth := len(lineage) - 1
		if targetDepth >= maxCommentDepth {
			allowedParentDepth := maxCommentDepth - 1
			if allowedParentDepth < 0 {
				allowedParentDepth = 0
			}
			actualParent := lineage[allowedParentDepth]
			actualParentID := actualParent.ID
			storedParentID = &actualParentID
			depthLimited = true
		}
	}

	comment := &models.Comment{
		PostID:   uint(postID),
		ParentID: storedParentID,
		UserID:   userID.(uint),
		Content:  content,
	}

	if err := database.DB.Create(comment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка"})
		return
	}

	database.DB.Model(&models.Post{}).Where("id = ?", postID).Update("comments", database.DB.Raw("comments + 1"))
	database.DB.Preload("User").First(comment, comment.ID)

	var actor models.User
	database.DB.Select("id, username, first_name, last_name").First(&actor, userID)
	link := "/feed?post=" + strconv.Itoa(postID) + "&comments=1"
	notified := map[uint]struct{}{userID.(uint): {}}

	if post.UserID != userID.(uint) {
		createUserNotification(post.UserID, "comment", postActorName(actor)+" прокомментировал(а) ваш пост: «"+postExcerpt(post.Content)+"»", link)
		notified[post.UserID] = struct{}{}
	}

	if parentComment != nil && parentComment.UserID != userID.(uint) {
		if _, exists := notified[parentComment.UserID]; !exists {
			createUserNotification(parentComment.UserID, "comment_reply", postActorName(actor)+" ответил(а) на ваш комментарий: «"+postExcerpt(content)+"»", link)
			notified[parentComment.UserID] = struct{}{}
		}
	}

	if mentionedUsers, err := findMentionedUsers(content, userID.(uint)); err == nil {
		for _, mentionedUser := range mentionedUsers {
			if _, exists := notified[mentionedUser.ID]; exists {
				continue
			}
			createUserNotification(mentionedUser.ID, "mention_comment", postActorName(actor)+" упомянул(а) вас в комментарии: «"+postExcerpt(content)+"»", link)
			notified[mentionedUser.ID] = struct{}{}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "Комментарий добавлен",
		"comment":       comment,
		"depth_limited": depthLimited,
	})
}

func parseCommentListParams(c *gin.Context) (*uint, int, int) {
	var parentID *uint
	if raw := strings.TrimSpace(c.Query("parent_id")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			value := uint(parsed)
			parentID = &value
		}
	}
	limit := 20
	if parentID != nil {
		limit = 10
	}
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > 100 {
				parsed = 100
			}
			limit = parsed
		}
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 0 {
			offset = parsed
		}
	}
	return parentID, limit, offset
}

func attachCommentMetadata(comments []models.Comment, viewerID uint) error {
	if len(comments) == 0 {
		return nil
	}
	ids := make([]uint, 0, len(comments))
	for i := range comments {
		ids = append(ids, comments[i].ID)
	}

	var replyCounts []struct {
		ParentID   uint
		ReplyCount int
		LatestAt   time.Time
	}
	if err := database.DB.Model(&models.Comment{}).
		Select("parent_id AS parent_id, COUNT(*) AS reply_count, MAX(created_at) AS latest_at").
		Where("parent_id IN ?", ids).
		Group("parent_id").
		Scan(&replyCounts).Error; err != nil {
		return err
	}
	repliesByParent := map[uint]int{}
	latestByParent := map[uint]time.Time{}
	for _, item := range replyCounts {
		repliesByParent[item.ParentID] = item.ReplyCount
		latestByParent[item.ParentID] = item.LatestAt
	}

	votesByComment := map[uint]int{}
	if viewerID > 0 {
		var votes []models.CommentVote
		if err := database.DB.Where("user_id = ? AND comment_id IN ?", viewerID, ids).Find(&votes).Error; err != nil {
			return err
		}
		for _, vote := range votes {
			votesByComment[vote.CommentID] = vote.Value
		}
	}

	for i := range comments {
		comments[i].ReplyCount = repliesByParent[comments[i].ID]
		comments[i].CurrentUserVote = votesByComment[comments[i].ID]
		if latestAt, exists := latestByParent[comments[i].ID]; exists && !latestAt.IsZero() {
			parsed := latestAt
			comments[i].LatestActivityAt = &parsed
		}
		if comments[i].LatestActivityAt == nil {
			fallback := comments[i].UpdatedAt
			comments[i].LatestActivityAt = &fallback
		}
	}
	return nil
}

func (h *PostHandler) GetComments(c *gin.Context) {
	postID, ok := postIDParam(c)
	if !ok {
		return
	}

	if _, err := loadPostByID(postID, false); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пост не найден"})
		return
	}

	viewerIDValue, _ := c.Get("user_id")
	viewerID, _ := viewerIDValue.(uint)
	parentID, limit, offset := parseCommentListParams(c)

	query := database.DB.Model(&models.Comment{}).Where("post_id = ?", postID)
	if parentID != nil {
		query = query.Where("parent_id = ?", *parentID)
	} else {
		query = query.Where("parent_id IS NULL")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка"})
		return
	}

	var comments []models.Comment
	err := query.
		Order("created_at ASC").
		Offset(offset).
		Limit(limit).
		Preload("User").
		Find(&comments).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка"})
		return
	}
	if err := attachCommentMetadata(comments, viewerID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка"})
		return
	}

	hasMore := int64(offset+len(comments)) < total
	response := gin.H{
		"comments":    comments,
		"total":       total,
		"offset":      offset,
		"limit":       limit,
		"has_more":    hasMore,
		"next_offset": offset + len(comments),
	}
	if parentID != nil {
		response["parent_id"] = *parentID
	}
	c.JSON(http.StatusOK, response)
}

func (h *PostHandler) UpdateComment(c *gin.Context) {
	userIDValue, _ := c.Get("user_id")
	userID, ok := userIDValue.(uint)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Требуется авторизация"})
		return
	}

	commentID, err := strconv.Atoi(c.Param("id"))
	if err != nil || commentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный комментарий"})
		return
	}

	var comment models.Comment
	if err := database.DB.First(&comment, commentID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Комментарий не найден"})
		return
	}
	if comment.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Редактировать можно только свой комментарий"})
		return
	}

	var req struct {
		Content string `json:"content" binding:"required,max=2000"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нет текста"})
		return
	}

	content := sanitizeContent(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Комментарий не может быть пустым"})
		return
	}

	if err := database.DB.Model(&comment).Updates(map[string]any{"content": content}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить комментарий"})
		return
	}
	if err := database.DB.Preload("User").First(&comment, comment.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить обновлённый комментарий"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Комментарий обновлён", "comment": comment})
}

func (h *PostHandler) DeleteComment(c *gin.Context) {
	userIDValue, _ := c.Get("user_id")
	userID, ok := userIDValue.(uint)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Требуется авторизация"})
		return
	}

	commentID, err := strconv.Atoi(c.Param("id"))
	if err != nil || commentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный комментарий"})
		return
	}

	var comment models.Comment
	if err := database.DB.First(&comment, commentID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Комментарий не найден"})
		return
	}

	var post models.Post
	if err := database.DB.Select("id", "user_id").First(&post, comment.PostID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пост не найден"})
		return
	}

	var actor models.User
	_ = database.DB.Select("id", "is_admin").First(&actor, userID).Error
	canDelete := comment.UserID == userID || post.UserID == userID || actor.IsAdmin
	if !canDelete {
		c.JSON(http.StatusForbidden, gin.H{"error": "Недостаточно прав для удаления комментария"})
		return
	}

	ids, err := collectCommentSubtreeIDs(comment.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось подготовить удаление комментария"})
		return
	}
	deletedCount := len(ids)
	if deletedCount == 0 {
		deletedCount = 1
		ids = []uint{comment.ID}
	}

	tx := database.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось начать удаление"})
		return
	}
	if err := tx.Where("comment_id IN ?", ids).Delete(&models.CommentVote{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить голоса комментариев"})
		return
	}
	if err := tx.Where("id IN ?", ids).Delete(&models.Comment{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить комментарий"})
		return
	}
	if err := tx.Model(&models.Post{}).Where("id = ?", comment.PostID).Update("comments", gorm.Expr("CASE WHEN comments >= ? THEN comments - ? ELSE 0 END", deletedCount, deletedCount)).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить счётчик комментариев"})
		return
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось завершить удаление"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Комментарий удалён", "deleted_count": deletedCount})
}

func (h *PostHandler) VoteComment(c *gin.Context) {
	userIDValue, _ := c.Get("user_id")
	userID, ok := userIDValue.(uint)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Требуется авторизация"})
		return
	}

	commentID, err := strconv.Atoi(c.Param("id"))
	if err != nil || commentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный комментарий"})
		return
	}

	var req struct {
		Value int `json:"value"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный голос"})
		return
	}
	if req.Value != -1 && req.Value != 0 && req.Value != 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Значение голоса должно быть -1, 0 или 1"})
		return
	}

	var comment models.Comment
	if err := database.DB.First(&comment, commentID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Комментарий не найден"})
		return
	}

	tx := database.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось начать обновление голоса"})
		return
	}

	var existing models.CommentVote
	err = tx.Where("user_id = ? AND comment_id = ?", userID, comment.ID).First(&existing).Error
	oldValue := 0
	if err == nil {
		oldValue = existing.Value
	} else if err != nil && err != gorm.ErrRecordNotFound {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить голос"})
		return
	}

	likeDelta := 0
	dislikeDelta := 0
	if oldValue == 1 {
		likeDelta--
	} else if oldValue == -1 {
		dislikeDelta--
	}
	if req.Value == 1 {
		likeDelta++
	} else if req.Value == -1 {
		dislikeDelta++
	}

	if oldValue == 0 && req.Value != 0 {
		if err := tx.Create(&models.CommentVote{UserID: userID, CommentID: comment.ID, Value: req.Value}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить голос"})
			return
		}
	} else if oldValue != 0 && req.Value == 0 {
		if err := tx.Where("id = ?", existing.ID).Delete(&models.CommentVote{}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить голос"})
			return
		}
	} else if oldValue != 0 && req.Value != 0 && oldValue != req.Value {
		if err := tx.Model(&existing).Update("value", req.Value).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить голос"})
			return
		}
	}

	if likeDelta != 0 || dislikeDelta != 0 {
		if err := tx.Model(&models.Comment{}).Where("id = ?", comment.ID).Updates(map[string]any{
			"likes":    gorm.Expr("GREATEST(likes + ?, 0)", likeDelta),
			"dislikes": gorm.Expr("GREATEST(dislikes + ?, 0)", dislikeDelta),
		}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить счётчики"})
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось завершить голосование"})
		return
	}

	if err := database.DB.Preload("User").First(&comment, comment.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить комментарий"})
		return
	}
	comments := []models.Comment{comment}
	if err := attachCommentMetadata(comments, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить обновлённые счётчики"})
		return
	}
	comment = comments[0]
	comment.CurrentUserVote = req.Value

	if req.Value != 0 && oldValue != req.Value && comment.UserID != userID {
		var actor models.User
		_ = database.DB.Select("id, username, first_name, last_name").First(&actor, userID).Error
		link := "/feed?post=" + strconv.Itoa(int(comment.PostID)) + "&comments=1"
		notificationType := "comment_like"
		notificationText := postActorName(actor) + " оценил(а) ваш комментарий: «" + postExcerpt(comment.Content) + "»"
		if req.Value < 0 {
			notificationType = "comment_dislike"
			notificationText = postActorName(actor) + " поставил(а) минус вашему комментарию: «" + postExcerpt(comment.Content) + "»"
		}
		createUserNotification(comment.UserID, notificationType, notificationText, link)
	}
	c.JSON(http.StatusOK, gin.H{"message": "Голос обновлён", "comment": comment})
}

func (h *PostHandler) DeletePost(c *gin.Context) {
	userID, _ := c.Get("user_id")
	postID, ok := postIDParam(c)
	if !ok {
		return
	}

	post, err := loadPostByID(postID, false)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Пост не найден"})
		return
	}

	if post.UserID != userID.(uint) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Не ваш пост"})
		return
	}

	database.DB.Where("post_id = ?", postID).Delete(&models.Like{})
	var commentIDs []uint
	database.DB.Model(&models.Comment{}).Where("post_id = ?", postID).Pluck("id", &commentIDs)
	if len(commentIDs) > 0 {
		database.DB.Where("comment_id IN ?", commentIDs).Delete(&models.CommentVote{})
	}
	database.DB.Where("post_id = ?", postID).Delete(&models.Comment{})
	database.DB.Delete(post)

	c.JSON(http.StatusOK, gin.H{"message": "Пост удален"})
}

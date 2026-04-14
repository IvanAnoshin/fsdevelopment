package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"unicode"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SearchHandler struct{}

func NewSearchHandler() *SearchHandler { return &SearchHandler{} }

type scoredUser struct {
	user  models.User
	score int
}

type scoredPost struct {
	post  models.Post
	score int
}

type scoredCommunity struct {
	community models.Community
	score     int
}

const maxSearchQueryRunes = 120

type searchViewerContext struct {
	viewerID           uint
	friendIDs          map[uint]struct{}
	subscriptionIDs    map[uint]struct{}
	memberCommunityIDs map[uint]struct{}
}

func trimSearchQuery(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	runes := []rune(trimmed)
	if len(runes) > maxSearchQueryRunes {
		return strings.TrimSpace(string(runes[:maxSearchQueryRunes]))
	}
	return trimmed
}

func normalizeSearchText(value string) string {
	value = strings.ToLower(trimSearchQuery(value))
	if value == "" {
		return ""
	}
	var b strings.Builder
	lastSpace := false
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' {
			b.WriteRune(r)
			lastSpace = false
			continue
		}
		if !lastSpace {
			b.WriteByte(' ')
			lastSpace = true
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func searchTokens(query string) []string {
	normalized := normalizeSearchText(query)
	if normalized == "" {
		return nil
	}
	tokens := strings.Fields(normalized)
	if len(tokens) > 5 {
		return tokens[:5]
	}
	return tokens
}

func applyILIKEAny(db *gorm.DB, columns []string, tokens []string) *gorm.DB {
	if len(tokens) == 0 || len(columns) == 0 {
		return db
	}
	for _, token := range tokens {
		like := "%" + token + "%"
		group := db.Session(&gorm.Session{NewDB: true})
		first := true
		for _, column := range columns {
			condition := fmt.Sprintf("LOWER(%s) LIKE ?", column)
			if first {
				group = group.Where(condition, like)
				first = false
			} else {
				group = group.Or(condition, like)
			}
		}
		db = db.Where(group)
	}
	return db
}

func fetchUserCandidates(query string, limit int) ([]models.User, error) {
	tokens := searchTokens(query)
	candidates := make([]models.User, 0, limit)
	base := database.DB.
		Select("id, first_name, last_name, username, avatar, bio, city, relationship, is_private, last_seen, is_admin, role").
		Model(&models.User{}).
		Order("last_seen DESC")
	filtered := applyILIKEAny(base, []string{"first_name", "last_name", "username", "bio", "city"}, tokens)
	if err := filtered.Limit(limit).Find(&candidates).Error; err != nil {
		return nil, err
	}
	if len(candidates) >= minInt(limit/2, 12) {
		return candidates, nil
	}
	fallback := make([]models.User, 0, limit*2)
	if err := base.Limit(limit * 2).Find(&fallback).Error; err != nil {
		return nil, err
	}
	return fallback, nil
}

func fetchPostCandidates(query string, limit int) ([]models.Post, error) {
	tokens := searchTokens(query)
	candidates := make([]models.Post, 0, limit)
	base := database.DB.
		Model(&models.Post{}).
		Distinct("posts.*").
		Joins("LEFT JOIN users search_users ON search_users.id = posts.user_id").
		Preload("User").
		Preload("Community").
		Order("posts.created_at DESC")
	filtered := applyILIKEAny(base, []string{"posts.content", "search_users.username", "search_users.first_name", "search_users.last_name"}, tokens)
	if err := filtered.Limit(limit).Find(&candidates).Error; err != nil {
		return nil, err
	}
	if len(candidates) >= minInt(limit/2, 12) {
		return candidates, nil
	}
	fallback := make([]models.Post, 0, limit*2)
	if err := base.Limit(limit * 2).Find(&fallback).Error; err != nil {
		return nil, err
	}
	return fallback, nil
}

func fetchCommunityCandidates(query string, limit int) ([]models.Community, error) {
	tokens := searchTokens(query)
	candidates := make([]models.Community, 0, limit)
	base := database.DB.Model(&models.Community{}).Order("members_count DESC, created_at DESC")
	filtered := applyILIKEAny(base, []string{"name", "slug", "description"}, tokens)
	if err := filtered.Limit(limit).Find(&candidates).Error; err != nil {
		return nil, err
	}
	if len(candidates) >= minInt(limit/2, 10) {
		return candidates, nil
	}
	fallback := make([]models.Community, 0, limit*2)
	if err := base.Limit(limit * 2).Find(&fallback).Error; err != nil {
		return nil, err
	}
	return fallback, nil
}

func levenshteinDistance(a, b string) int {
	ar := []rune(a)
	br := []rune(b)
	if len(ar) == 0 {
		return len(br)
	}
	if len(br) == 0 {
		return len(ar)
	}
	prev := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	for i, ra := range ar {
		curr := make([]int, len(br)+1)
		curr[0] = i + 1
		for j, rb := range br {
			cost := 0
			if ra != rb {
				cost = 1
			}
			ins := curr[j] + 1
			del := prev[j+1] + 1
			sub := prev[j] + cost
			curr[j+1] = minInt(ins, minInt(del, sub))
		}
		prev = curr
	}
	return prev[len(br)]
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func fuzzyScore(query string, fields ...string) int {
	nq := normalizeSearchText(query)
	if nq == "" {
		return 0
	}
	qTokens := strings.Fields(nq)
	best := 0
	for _, field := range fields {
		nf := normalizeSearchText(field)
		if nf == "" {
			continue
		}
		score := 0
		if nf == nq {
			score += 1500
		}
		if strings.Contains(nf, nq) {
			score += 1100 - minInt(len(nf)-len(nq), 200)
		}
		fTokens := strings.Fields(nf)
		for _, qt := range qTokens {
			for _, ft := range fTokens {
				if ft == qt {
					score += 240
					continue
				}
				if strings.Contains(ft, qt) || strings.Contains(qt, ft) {
					score += 170
					continue
				}
				dist := levenshteinDistance(qt, ft)
				allowed := 1
				if len([]rune(qt)) >= 6 {
					allowed = 2
				}
				if len([]rune(qt)) >= 10 {
					allowed = 3
				}
				if dist <= allowed {
					score += 140 - dist*20
				}
			}
		}
		distAll := levenshteinDistance(nq, nf)
		allowedAll := 1
		if len([]rune(nq)) >= 7 {
			allowedAll = 2
		}
		if len([]rune(nq)) >= 11 {
			allowedAll = 3
		}
		if distAll <= allowedAll {
			score += 180 - distAll*30
		}
		if score > best {
			best = score
		}
	}
	return best
}

func buildSearchViewerContext(viewerID uint, candidateUserIDs []uint, candidateCommunityIDs []uint) searchViewerContext {
	ctx := searchViewerContext{
		viewerID:           viewerID,
		friendIDs:          map[uint]struct{}{},
		subscriptionIDs:    map[uint]struct{}{},
		memberCommunityIDs: map[uint]struct{}{},
	}
	if viewerID == 0 {
		return ctx
	}
	userIDs := make([]uint, 0, len(candidateUserIDs))
	seenUsers := map[uint]struct{}{}
	for _, id := range candidateUserIDs {
		if id == 0 {
			continue
		}
		if _, ok := seenUsers[id]; ok {
			continue
		}
		seenUsers[id] = struct{}{}
		userIDs = append(userIDs, id)
	}
	if len(userIDs) > 0 {
		var friendships []models.Friendship
		database.DB.Where("status = 'accepted' AND user_id = ? AND friend_id IN ?", viewerID, userIDs).Or("status = 'accepted' AND friend_id = ? AND user_id IN ?", viewerID, userIDs).Find(&friendships)
		for _, item := range friendships {
			if item.UserID == viewerID {
				ctx.friendIDs[item.FriendID] = struct{}{}
			} else if item.FriendID == viewerID {
				ctx.friendIDs[item.UserID] = struct{}{}
			}
		}
		var subscriptions []models.Subscription
		database.DB.Where("subscriber_id = ? AND user_id IN ?", viewerID, userIDs).Find(&subscriptions)
		for _, item := range subscriptions {
			ctx.subscriptionIDs[item.UserID] = struct{}{}
		}
	}
	communityIDs := make([]uint, 0, len(candidateCommunityIDs))
	seenCommunities := map[uint]struct{}{}
	for _, id := range candidateCommunityIDs {
		if id == 0 {
			continue
		}
		if _, ok := seenCommunities[id]; ok {
			continue
		}
		seenCommunities[id] = struct{}{}
		communityIDs = append(communityIDs, id)
	}
	if len(communityIDs) > 0 {
		var memberships []models.CommunityMember
		database.DB.Where("user_id = ? AND community_id IN ?", viewerID, communityIDs).Find(&memberships)
		for _, item := range memberships {
			ctx.memberCommunityIDs[item.CommunityID] = struct{}{}
		}
	}
	return ctx
}

func (ctx searchViewerContext) canViewCommunity(community models.Community) bool {
	if !community.IsPrivate {
		return true
	}
	if ctx.viewerID != 0 && community.CreatorID == ctx.viewerID {
		return true
	}
	_, ok := ctx.memberCommunityIDs[community.ID]
	return ok
}

func (ctx searchViewerContext) canViewAuthor(author models.User) bool {
	if !author.IsPrivate {
		return true
	}
	if ctx.viewerID != 0 && author.ID == ctx.viewerID {
		return true
	}
	if _, ok := ctx.friendIDs[author.ID]; ok {
		return true
	}
	if _, ok := ctx.subscriptionIDs[author.ID]; ok {
		return true
	}
	return false
}

func (ctx searchViewerContext) canViewPost(post models.Post) bool {
	if !ctx.canViewAuthor(post.User) {
		return false
	}
	if post.CommunityID != nil && post.Community != nil {
		return ctx.canViewCommunity(*post.Community)
	}
	return true
}

func (h *SearchHandler) SearchUsers(c *gin.Context) {
	query := trimSearchQuery(c.Query("q"))
	if query == "" {
		c.JSON(http.StatusOK, gin.H{"users": []models.User{}})
		return
	}
	currentUserID, _ := c.Get("user_id")
	users, err := fetchUserCandidates(query, 120)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка поиска"})
		return
	}
	matches := make([]scoredUser, 0, len(users))
	for _, user := range users {
		score := fuzzyScore(query,
			strings.TrimSpace(fmt.Sprintf("%s %s", user.FirstName, user.LastName)),
			user.Username,
			user.Bio,
			user.City,
		)
		if score <= 0 {
			continue
		}
		if uid, ok := currentUserID.(uint); ok {
			decorateUserRelationship(uid, &user)
		}
		matches = append(matches, scoredUser{user: user, score: score})
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		return matches[i].user.LastSeen.After(matches[j].user.LastSeen)
	})
	result := make([]models.User, 0, minInt(len(matches), 25))
	for _, item := range matches {
		result = append(result, item.user)
		if len(result) >= 25 {
			break
		}
	}
	c.JSON(http.StatusOK, gin.H{"users": result})
}

func (h *SearchHandler) SearchPosts(c *gin.Context) {
	query := trimSearchQuery(c.Query("q"))
	if query == "" {
		c.JSON(http.StatusOK, gin.H{"posts": []models.Post{}})
		return
	}
	posts, err := fetchPostCandidates(query, 120)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка поиска"})
		return
	}
	viewerID, _ := c.Get("user_id")
	uid, _ := viewerID.(uint)
	candidateUserIDs := make([]uint, 0, len(posts))
	candidateCommunityIDs := make([]uint, 0, len(posts))
	for _, post := range posts {
		candidateUserIDs = append(candidateUserIDs, post.UserID)
		if post.CommunityID != nil {
			candidateCommunityIDs = append(candidateCommunityIDs, *post.CommunityID)
		}
	}
	viewerCtx := buildSearchViewerContext(uid, candidateUserIDs, candidateCommunityIDs)
	matches := make([]scoredPost, 0, len(posts))
	for _, post := range posts {
		if !viewerCtx.canViewPost(post) {
			continue
		}
		score := fuzzyScore(query, post.Content, post.User.Username, strings.TrimSpace(post.User.FirstName+" "+post.User.LastName))
		if score <= 0 {
			continue
		}
		matches = append(matches, scoredPost{post: post, score: score})
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		return matches[i].post.CreatedAt.After(matches[j].post.CreatedAt)
	})
	result := make([]models.Post, 0, minInt(len(matches), 25))
	for _, item := range matches {
		result = append(result, item.post)
		if len(result) >= 25 {
			break
		}
	}
	for i := range result {
		decorateUserRelationship(uid, &result[i].User)
	}
	c.JSON(http.StatusOK, gin.H{"posts": result})
}

func (h *SearchHandler) SearchCommunities(c *gin.Context) {
	query := trimSearchQuery(c.Query("q"))
	if query == "" {
		c.JSON(http.StatusOK, gin.H{"communities": []models.Community{}})
		return
	}
	viewerID, _ := c.Get("user_id")
	uid, _ := viewerID.(uint)
	communities, err := fetchCommunityCandidates(query, 80)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка поиска"})
		return
	}
	memberRoles := map[uint]string{}
	if uid > 0 {
		var memberships []models.CommunityMember
		database.DB.Where("user_id = ?", uid).Find(&memberships)
		for _, item := range memberships {
			memberRoles[item.CommunityID] = item.Role
		}
	}
	viewerCtx := buildSearchViewerContext(uid, nil, func() []uint {
		ids := make([]uint, 0, len(communities))
		for _, item := range communities {
			ids = append(ids, item.ID)
		}
		return ids
	}())
	matches := make([]scoredCommunity, 0, len(communities))
	for _, community := range communities {
		if role, ok := memberRoles[community.ID]; ok {
			community.IsMember = true
			community.MyRole = role
		}
		if !viewerCtx.canViewCommunity(community) {
			continue
		}
		score := fuzzyScore(query, community.Name, community.Slug, community.Description)
		if score <= 0 {
			continue
		}
		matches = append(matches, scoredCommunity{community: community, score: score})
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		if matches[i].community.MembersCount != matches[j].community.MembersCount {
			return matches[i].community.MembersCount > matches[j].community.MembersCount
		}
		return matches[i].community.CreatedAt.After(matches[j].community.CreatedAt)
	})
	result := make([]models.Community, 0, minInt(len(matches), 20))
	for _, item := range matches {
		result = append(result, item.community)
		if len(result) >= 20 {
			break
		}
	}
	c.JSON(http.StatusOK, gin.H{"communities": result})
}

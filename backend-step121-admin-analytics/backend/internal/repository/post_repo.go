package repository

import (
	"errors"

	"friendscape/internal/database"
	"friendscape/internal/models"
	"gorm.io/gorm"
)

type PostRepo struct{}

func NewPostRepo() *PostRepo {
	return &PostRepo{}
}

func (r *PostRepo) Create(post *models.Post) error {
	return database.DB.Create(post).Error
}

func (r *PostRepo) FindByID(id uint) (*models.Post, error) {
	var post models.Post
	err := database.DB.Preload("User").First(&post, id).Error
	return &post, err
}

func (r *PostRepo) Delete(id uint) error {
	database.DB.Where("post_id = ?", id).Delete(&models.Like{})
	database.DB.Where("post_id = ?", id).Delete(&models.Comment{})
	return database.DB.Delete(&models.Post{}, id).Error
}

func (r *PostRepo) GetFeed(userID uint, limit, offset int) ([]models.Post, error) {
	var posts []models.Post

	err := database.DB.
		Distinct("posts.id", "posts.user_id", "posts.content", "posts.images", "posts.likes", "posts.comments", "posts.created_at", "posts.updated_at").
		Joins("LEFT JOIN friendships ON ((friendships.user_id = ? AND friendships.friend_id = posts.user_id) OR (friendships.friend_id = ? AND friendships.user_id = posts.user_id)) AND friendships.status = 'accepted'", userID, userID).
		Joins("LEFT JOIN subscriptions ON subscriptions.subscriber_id = ? AND subscriptions.user_id = posts.user_id", userID).
		Where("posts.user_id = ? OR friendships.id IS NOT NULL OR subscriptions.id IS NOT NULL", userID).
		Order("posts.created_at DESC").
		Limit(limit).
		Offset(offset).
		Preload("User").
		Find(&posts).Error

	return posts, err
}

func (r *PostRepo) GetUserPosts(userID uint) ([]models.Post, error) {
	var posts []models.Post
	err := database.DB.Where("user_id = ?", userID).
		Order("created_at DESC").
		Preload("User").
		Find(&posts).Error
	return posts, err
}

func (r *PostRepo) Like(userID, postID uint) error {
	var count int64
	database.DB.Model(&models.Like{}).Where("user_id = ? AND post_id = ?", userID, postID).Count(&count)
	if count > 0 {
		return errors.New("already liked")
	}

	like := &models.Like{UserID: userID, PostID: postID}
	if err := database.DB.Create(like).Error; err != nil {
		return err
	}

	database.DB.Model(&models.Post{}).Where("id = ?", postID).Update("likes", gorm.Expr("likes + 1"))
	return nil
}

func (r *PostRepo) Unlike(userID, postID uint) error {
	result := database.DB.Where("user_id = ? AND post_id = ?", userID, postID).Delete(&models.Like{})
	if result.RowsAffected > 0 {
		database.DB.Model(&models.Post{}).Where("id = ?", postID).Update("likes", gorm.Expr("CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END"))
	}
	return nil
}

func (r *PostRepo) AddComment(comment *models.Comment) error {
	if err := database.DB.Create(comment).Error; err != nil {
		return err
	}
	database.DB.Model(&models.Post{}).Where("id = ?", comment.PostID).Update("comments", gorm.Expr("comments + 1"))
	return nil
}

func (r *PostRepo) GetComments(postID uint) ([]models.Comment, error) {
	var comments []models.Comment
	err := database.DB.Where("post_id = ?", postID).
		Order("created_at ASC").
		Preload("User").
		Find(&comments).Error
	return comments, err
}

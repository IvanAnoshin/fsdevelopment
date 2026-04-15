package models

import "time"

type Media struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	PostID    uint      `json:"post_id" gorm:"index"`
	UserID    uint      `json:"user_id" gorm:"index"`
	Type      string    `json:"type"`
	URL       string    `json:"url"`
	Thumbnail string    `json:"thumbnail"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}

type PostFeed struct {
	Post      Post `json:"post"`
	User      User `json:"user"`
	Liked     bool `json:"liked"`
	Saved     bool `json:"saved"`
	CanEdit   bool `json:"can_edit"`
	CanDelete bool `json:"can_delete"`
}

type SavePost struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"uniqueIndex:idx_user_post;not null"`
	PostID    uint      `json:"post_id" gorm:"uniqueIndex:idx_user_post;not null"`
	CreatedAt time.Time `json:"created_at"`
}

type Collection struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	UserID      uint      `json:"user_id" gorm:"index;not null"`
	Name        string    `json:"name" gorm:"size:80;not null"`
	Description string    `json:"description" gorm:"size:240"`
	Color       string    `json:"color" gorm:"size:24;default:'#6d5efc'"`
	IsDefault   bool      `json:"is_default" gorm:"default:false"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	ItemsCount  int       `json:"items_count" gorm:"-"`
}

type CollectionItem struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	CollectionID uint      `json:"collection_id" gorm:"index;not null"`
	UserID       uint      `json:"user_id" gorm:"index;not null"`
	EntityType   string    `json:"entity_type" gorm:"size:32;index;not null"`
	EntityKey    string    `json:"entity_key" gorm:"size:191;not null;index"`
	Title        string    `json:"title" gorm:"size:180;not null"`
	Subtitle     string    `json:"subtitle" gorm:"size:220"`
	PreviewText  string    `json:"preview_text" gorm:"type:text"`
	PreviewImage string    `json:"preview_image" gorm:"size:512"`
	Link         string    `json:"link" gorm:"size:512"`
	PayloadJSON  string    `json:"payload" gorm:"type:text"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}
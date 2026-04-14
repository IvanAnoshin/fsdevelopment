package models

import "time"

type MediaAsset struct {
	ID               uint      `json:"id" gorm:"primaryKey"`
	OwnerID          uint      `json:"owner_id" gorm:"index;not null"`
	Kind             string    `json:"kind" gorm:"type:varchar(32);index;not null"`
	ContentHash      string    `json:"content_hash" gorm:"type:varchar(128);uniqueIndex;not null"`
	OriginalFilename string    `json:"original_filename"`
	OriginalMime     string    `json:"original_mime"`
	StoredFormat     string    `json:"stored_format"`
	Width            int       `json:"width"`
	Height           int       `json:"height"`
	OriginalBytes    int64     `json:"original_bytes"`
	StoredBytes      int64     `json:"stored_bytes"`
	VariantsJSON     string    `json:"-" gorm:"type:text"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type MediaVote struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	MediaKey  string    `json:"media_key" gorm:"type:varchar(512);uniqueIndex:idx_media_vote_user_media;index;not null"`
	AssetID   *uint     `json:"asset_id" gorm:"index"`
	UserID    uint      `json:"user_id" gorm:"uniqueIndex:idx_media_vote_user_media;index;not null"`
	Value     int       `json:"value" gorm:"not null"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type MediaComment struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	MediaKey  string    `json:"media_key" gorm:"type:varchar(512);index;not null"`
	AssetID   *uint     `json:"asset_id" gorm:"index"`
	UserID    uint      `json:"user_id" gorm:"index;not null"`
	User      User      `json:"user" gorm:"foreignKey:UserID"`
	Content   string    `json:"content" gorm:"type:text;not null"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type MediaReport struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	MediaKey     string    `json:"media_key" gorm:"type:varchar(512);uniqueIndex:idx_media_report_user_media;index;not null"`
	AssetID      *uint     `json:"asset_id" gorm:"index"`
	ReporterID   uint      `json:"reporter_id" gorm:"uniqueIndex:idx_media_report_user_media;index;not null"`
	SourcePostID *uint     `json:"source_post_id" gorm:"index"`
	Reason       string    `json:"reason" gorm:"type:text"`
	Status       string    `json:"status" gorm:"type:varchar(32);default:'pending'"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

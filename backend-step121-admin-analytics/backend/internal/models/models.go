package models

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID       uint `json:"user_id"`
	TokenVersion uint `json:"token_version"`
	jwt.RegisteredClaims
}

type User struct {
	ID                 uint      `json:"id" gorm:"primaryKey"`
	Username           string    `json:"username" gorm:"unique;not null"`
	FirstName          string    `json:"first_name"`
	LastName           string    `json:"last_name"`
	Password           string    `json:"-"`
	Avatar             string    `json:"avatar" gorm:"default:'/default-avatar.png'"`
	Bio                string    `json:"bio" gorm:"size:500"`
	City               string    `json:"city"`
	Relationship       string    `json:"relationship"`
	SecurityQuestion   string    `json:"-" gorm:"size:255"`
	SecurityAnswerHash string    `json:"-"`
	TokenVersion       uint      `json:"-"`
	IsPioneer          bool      `json:"is_pioneer" gorm:"default:false"`
	IsPrivate          bool      `json:"is_private" gorm:"default:false"`
	IsAdmin            bool      `json:"is_admin" gorm:"default:false"`
	Role               string    `json:"role" gorm:"type:varchar(32);default:'member';index"`
	Permissions        []string  `json:"permissions" gorm:"-"`
	LastSeen           time.Time `json:"last_seen"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`

	FriendsCount     int    `json:"friends_count" gorm:"-"`
	SubscribersCount int    `json:"subscribers_count" gorm:"-"`
	PostsCount       int    `json:"posts_count" gorm:"-"`
	VouchesCount     int    `json:"vouches_count" gorm:"-"`
	VouchedByMe      bool   `json:"vouched_by_me" gorm:"-"`
	FriendshipStatus string `json:"friendship_status" gorm:"-"`
	IsSelf           bool   `json:"is_self" gorm:"-"`

	CurrentDeviceID         string `json:"current_device_id,omitempty" gorm:"-"`
	CurrentDevicePINEnabled bool   `json:"current_device_pin_enabled" gorm:"-"`
	CurrentDeviceName       string `json:"current_device_name,omitempty" gorm:"-"`
	NeedsPinSetup           bool   `json:"needs_pin_setup" gorm:"-"`
}

type Post struct {
	ID                 uint       `json:"id" gorm:"primaryKey"`
	UserID             uint       `json:"user_id" gorm:"index;not null"`
	User               User       `json:"user" gorm:"foreignKey:UserID"`
	Content            string     `json:"content" gorm:"type:text;not null"`
	Images             string     `json:"images" gorm:"type:text"`
	CommunityID        *uint      `json:"community_id,omitempty" gorm:"index"`
	Community          *Community `json:"community,omitempty" gorm:"foreignKey:CommunityID"`
	Likes              int        `json:"likes" gorm:"default:0"`
	Comments           int        `json:"comments" gorm:"default:0"`
	RecommendedScore   float64    `json:"recommended_score,omitempty" gorm:"->;-:migration"`
	RecommendedReason  string     `json:"recommended_reason,omitempty" gorm:"->;-:migration"`
	RecommendedSignals []string   `json:"recommended_signals,omitempty" gorm:"-"`
	RecommendedTopic   string     `json:"recommended_topic,omitempty" gorm:"-"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type Comment struct {
	ID               uint       `json:"id" gorm:"primaryKey"`
	PostID           uint       `json:"post_id" gorm:"index;not null"`
	ParentID         *uint      `json:"parent_id,omitempty" gorm:"index"`
	UserID           uint       `json:"user_id" gorm:"index;not null"`
	User             User       `json:"user" gorm:"foreignKey:UserID"`
	Content          string     `json:"content" gorm:"type:text;not null"`
	Likes            int        `json:"likes" gorm:"default:0"`
	Dislikes         int        `json:"dislikes" gorm:"default:0"`
	ReplyCount       int        `json:"reply_count,omitempty" gorm:"-"`
	LoadedReplyCount int        `json:"loaded_reply_count,omitempty" gorm:"-"`
	CurrentUserVote  int        `json:"current_user_vote,omitempty" gorm:"-"`
	LatestActivityAt *time.Time `json:"latest_activity_at,omitempty" gorm:"-"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type CommentVote struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"uniqueIndex:idx_user_comment_vote;not null"`
	CommentID uint      `json:"comment_id" gorm:"uniqueIndex:idx_user_comment_vote;index;not null"`
	Value     int       `json:"value" gorm:"not null"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type FeedPreference struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"index;not null"`
	Type      string    `json:"type" gorm:"type:varchar(32);index;not null"`
	PostID    *uint     `json:"post_id,omitempty" gorm:"index"`
	AuthorID  *uint     `json:"author_id,omitempty" gorm:"index"`
	Topic     string    `json:"topic,omitempty" gorm:"type:varchar(96);index"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Like struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"uniqueIndex:idx_user_post;not null"`
	PostID    uint      `json:"post_id" gorm:"uniqueIndex:idx_user_post;not null"`
	CreatedAt time.Time `json:"created_at"`
}

type Friendship struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"index;not null"`
	FriendID  uint      `json:"friend_id" gorm:"index;not null"`
	Status    string    `json:"status" gorm:"default:'pending'"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Subscription struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	SubscriberID uint      `json:"subscriber_id" gorm:"index;not null"`
	UserID       uint      `json:"user_id" gorm:"index;not null"`
	CreatedAt    time.Time `json:"created_at"`
}

type Message struct {
	ID                uint       `json:"id" gorm:"primaryKey"`
	FromUserID        uint       `json:"from_user_id" gorm:"index;not null"`
	ToUserID          uint       `json:"to_user_id" gorm:"index;not null"`
	Type              string     `json:"type" gorm:"type:varchar(24);default:'text';index"`
	Content           string     `json:"content" gorm:"type:text"`
	IsEncrypted       bool       `json:"is_encrypted" gorm:"default:false;index"`
	EncryptionScheme  string     `json:"encryption_scheme,omitempty" gorm:"type:varchar(64);index"`
	SenderDeviceID    string     `json:"sender_device_id,omitempty" gorm:"size:128;index"`
	RecipientDeviceID string     `json:"recipient_device_id,omitempty" gorm:"size:128;index"`
	Ciphertext        string     `json:"ciphertext,omitempty" gorm:"type:text"`
	CipherHeader      string     `json:"cipher_header,omitempty" gorm:"type:text"`
	CipherAAD         string     `json:"cipher_aad,omitempty" gorm:"type:text"`
	ContentHint       string     `json:"content_hint,omitempty" gorm:"type:varchar(255)"`
	ClientMessageID   string     `json:"client_message_id,omitempty" gorm:"size:128;index"`
	KeyEnvelope       string     `json:"key_envelope,omitempty" gorm:"type:text"`
	MediaKind         string     `json:"media_kind,omitempty" gorm:"type:varchar(24);index"`
	MediaURL          string     `json:"media_url,omitempty" gorm:"type:text"`
	MediaThumbURL     string     `json:"media_thumb_url,omitempty" gorm:"type:text"`
	MediaMime         string     `json:"media_mime,omitempty" gorm:"type:varchar(128)"`
	MediaDurationSec  int        `json:"media_duration_sec,omitempty"`
	MediaWidth        int        `json:"media_width,omitempty"`
	MediaHeight       int        `json:"media_height,omitempty"`
	MediaBytes        int64      `json:"media_bytes,omitempty"`
	IsRead            bool       `json:"is_read" gorm:"default:false"`
	EditedAt          *time.Time `json:"edited_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

type Chat struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name"`
	IsGroup   bool      `json:"is_group" gorm:"default:false"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ChatParticipant struct {
	ID       uint      `json:"id" gorm:"primaryKey"`
	ChatID   uint      `json:"chat_id" gorm:"index;not null"`
	UserID   uint      `json:"user_id" gorm:"index;not null"`
	LastRead time.Time `json:"last_read"`
	JoinedAt time.Time `json:"joined_at"`
}

type Story struct {
	ID              uint       `json:"id" gorm:"primaryKey"`
	UserID          uint       `json:"user_id" gorm:"index;not null"`
	User            User       `json:"user" gorm:"foreignKey:UserID"`
	CommunityID     *uint      `json:"community_id,omitempty" gorm:"index"`
	Community       *Community `json:"community,omitempty" gorm:"foreignKey:CommunityID"`
	ChatUserID      *uint      `json:"chat_user_id,omitempty" gorm:"index"`
	Kind            string     `json:"kind" gorm:"type:varchar(32);default:'status';index"`
	Audience        string     `json:"audience" gorm:"type:varchar(32);default:'all';index"`
	Intent          string     `json:"intent,omitempty" gorm:"type:varchar(96)"`
	Content         string     `json:"content" gorm:"type:text;not null"`
	MediaURL        string     `json:"media_url,omitempty" gorm:"type:text"`
	DurationMinutes int        `json:"duration_minutes" gorm:"not null;default:60"`
	ExtendCount     int        `json:"extend_count" gorm:"not null;default:0"`
	ExpiresAt       time.Time  `json:"expires_at" gorm:"index;not null"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`

	RepliesCount int  `json:"replies_count,omitempty" gorm:"-"`
	Viewed       bool `json:"viewed,omitempty" gorm:"-"`
}

type StoryReply struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	StoryID   uint      `json:"story_id" gorm:"index;not null"`
	Story     Story     `json:"-" gorm:"foreignKey:StoryID"`
	UserID    uint      `json:"user_id" gorm:"index;not null"`
	User      User      `json:"user" gorm:"foreignKey:UserID"`
	Content   string    `json:"content" gorm:"type:text;not null"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type StoryView struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	StoryID   uint      `json:"story_id" gorm:"uniqueIndex:idx_story_view;index;not null"`
	UserID    uint      `json:"user_id" gorm:"uniqueIndex:idx_story_view;index;not null"`
	ViewedAt  time.Time `json:"viewed_at"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Notification struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"index;not null"`
	Type      string    `json:"type"`
	Content   string    `json:"content"`
	Link      string    `json:"link"`
	IsRead    bool      `json:"is_read" gorm:"default:false"`
	CreatedAt time.Time `json:"created_at"`
}

type AuthSession struct {
	ID        uint       `json:"id" gorm:"primaryKey"`
	SessionID string     `json:"session_id" gorm:"uniqueIndex;size:64;not null"`
	UserID    uint       `json:"user_id" gorm:"index;not null"`
	DeviceID  string     `json:"device_id" gorm:"index"`
	UserAgent string     `json:"user_agent"`
	IPHash    string     `json:"ip_hash" gorm:"size:128"`
	LastSeen  time.Time  `json:"last_seen"`
	ExpiresAt time.Time  `json:"expires_at" gorm:"index"`
	RevokedAt *time.Time `json:"revoked_at,omitempty" gorm:"index"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type E2EEDevice struct {
	ID                    uint       `json:"id" gorm:"primaryKey"`
	UserID                uint       `json:"user_id" gorm:"index;not null"`
	DeviceID              string     `json:"device_id" gorm:"uniqueIndex:idx_e2ee_user_device;size:128;not null"`
	Label                 string     `json:"label" gorm:"size:160"`
	Algorithm             string     `json:"algorithm" gorm:"type:varchar(64);default:'p256-e2ee-v1';index"`
	IdentitySigningKey    string     `json:"identity_signing_key" gorm:"type:text;not null"`
	IdentityExchangeKey   string     `json:"identity_exchange_key" gorm:"type:text;not null"`
	SignedPreKey          string     `json:"signed_pre_key" gorm:"type:text;not null"`
	SignedPreKeySignature string     `json:"signed_pre_key_signature" gorm:"type:text;not null"`
	SignedPreKeyID        string     `json:"signed_pre_key_id" gorm:"size:128;index"`
	LastPrekeyAt          time.Time  `json:"last_prekey_at"`
	LastSeenAt            time.Time  `json:"last_seen_at"`
	RevokedAt             *time.Time `json:"revoked_at,omitempty" gorm:"index"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

type E2EEOneTimePreKey struct {
	ID        uint       `json:"id" gorm:"primaryKey"`
	UserID    uint       `json:"user_id" gorm:"index;not null"`
	DeviceID  string     `json:"device_id" gorm:"index;size:128;not null"`
	KeyID     string     `json:"key_id" gorm:"size:128;index;not null"`
	PublicKey string     `json:"public_key" gorm:"type:text;not null"`
	ClaimedAt *time.Time `json:"claimed_at,omitempty" gorm:"index"`
	ExpiresAt *time.Time `json:"expires_at,omitempty" gorm:"index"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type E2EEKeyBackup struct {
	ID                uint       `json:"id" gorm:"primaryKey"`
	UserID            uint       `json:"user_id" gorm:"uniqueIndex;not null"`
	Version           int        `json:"version" gorm:"default:1"`
	Algorithm         string     `json:"algorithm" gorm:"type:varchar(64);default:'pbkdf2-aesgcm-v1'"`
	KDF               string     `json:"kdf" gorm:"type:varchar(64);default:'PBKDF2-SHA256'"`
	KDFIterations     int        `json:"kdf_iterations" gorm:"default:250000"`
	Salt              string     `json:"salt" gorm:"type:text;not null"`
	IV                string     `json:"iv" gorm:"type:text;not null"`
	Ciphertext        string     `json:"ciphertext" gorm:"type:text;not null"`
	SourceDeviceID    string     `json:"source_device_id" gorm:"size:128;index"`
	SourceFingerprint string     `json:"source_fingerprint" gorm:"size:255"`
	BackupScope       string     `json:"backup_scope" gorm:"type:varchar(32);default:'bundle'"`
	LastDownloadedAt  *time.Time `json:"last_downloaded_at,omitempty"`
	LastRestoredAt    *time.Time `json:"last_restored_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type TrustedDevice struct {
	ID         uint   `json:"id" gorm:"primaryKey"`
	UserID     uint   `json:"user_id" gorm:"index;not null"`
	DeviceID   string `json:"device_id" gorm:"uniqueIndex:idx_user_device;not null"`
	DeviceName string `json:"device_name"`
	UserAgent  string `json:"user_agent"`
	IP         string `json:"ip"`

	PINEnabled bool   `json:"pin_enabled" gorm:"default:false"`
	PINHash    string `json:"-"`

	SessionsCount int       `json:"sessions_count" gorm:"default:0"`
	DFSNSessions  int       `json:"dfsn_sessions" gorm:"default:0"`
	DFSNAverage   float64   `json:"dfsn_average" gorm:"default:0"`
	DFSNDate      time.Time `json:"dfsn_date"`
	TrustedByDFSN bool      `json:"trusted_by_dfsn" gorm:"default:false"`
	TrustedSince  time.Time `json:"trusted_since"`

	LastUsed  time.Time `json:"last_used"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type Vouch struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	VoucherID uint      `json:"voucher_id" gorm:"uniqueIndex:idx_vouch_pair;index;not null"`
	VoucheeID uint      `json:"vouchee_id" gorm:"uniqueIndex:idx_vouch_pair;index;not null"`
	Weight    int       `json:"-" gorm:"default:1"`
	CreatedAt time.Time `json:"created_at"`
}

type Community struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	CreatorID    uint      `json:"creator_id" gorm:"index;not null"`
	Creator      User      `json:"creator" gorm:"foreignKey:CreatorID"`
	Name         string    `json:"name" gorm:"size:160;not null"`
	Slug         string    `json:"slug" gorm:"size:180;uniqueIndex;not null"`
	Description  string    `json:"description" gorm:"type:text"`
	Avatar       string    `json:"avatar,omitempty" gorm:"type:text"`
	Cover        string    `json:"cover,omitempty" gorm:"type:text"`
	IsPrivate    bool      `json:"is_private" gorm:"default:false"`
	MembersCount int       `json:"members_count" gorm:"default:1"`
	PostsCount   int       `json:"posts_count" gorm:"default:0"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`

	IsMember      bool   `json:"is_member" gorm:"-"`
	MyRole        string `json:"my_role,omitempty" gorm:"-"`
	RecentMembers []User `json:"recent_members,omitempty" gorm:"-"`
}

type CommunityMember struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	CommunityID uint      `json:"community_id" gorm:"uniqueIndex:idx_community_member;index;not null"`
	UserID      uint      `json:"user_id" gorm:"uniqueIndex:idx_community_member;index;not null"`
	Role        string    `json:"role" gorm:"type:varchar(32);default:'member'"`
	JoinedAt    time.Time `json:"joined_at"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type ModerationReport struct {
	ID         uint       `json:"id" gorm:"primaryKey"`
	ReporterID uint       `json:"reporter_id" gorm:"index;not null"`
	Reporter   User       `json:"reporter" gorm:"foreignKey:ReporterID"`
	TargetType string     `json:"target_type" gorm:"type:varchar(32);index;not null"`
	TargetID   uint       `json:"target_id" gorm:"index;not null"`
	Reason     string     `json:"reason" gorm:"type:varchar(128);not null"`
	Details    string     `json:"details,omitempty" gorm:"type:text"`
	Status     string     `json:"status" gorm:"type:varchar(32);default:'pending';index"`
	AdminNote  string     `json:"admin_note,omitempty" gorm:"type:text"`
	ResolvedBy *uint      `json:"resolved_by,omitempty" gorm:"index"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type SupportTicket struct {
	ID         uint       `json:"id" gorm:"primaryKey"`
	UserID     uint       `json:"user_id" gorm:"index;not null"`
	User       User       `json:"user" gorm:"foreignKey:UserID"`
	Subject    string     `json:"subject" gorm:"size:160;not null"`
	Message    string     `json:"message" gorm:"type:text;not null"`
	Category   string     `json:"category" gorm:"type:varchar(64);default:'general';index"`
	Status     string     `json:"status" gorm:"type:varchar(32);default:'open';index"`
	Priority   string     `json:"priority" gorm:"type:varchar(32);default:'normal'"`
	AdminNote  string     `json:"admin_note,omitempty" gorm:"type:text"`
	ResolvedBy *uint      `json:"resolved_by,omitempty" gorm:"index"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}
type Report struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	ReporterID uint      `json:"reporter_id" gorm:"index;not null"`
	ReportedID uint      `json:"reported_id" gorm:"index;not null"`
	Reason     string    `json:"reason"`
	Status     string    `json:"status" gorm:"default:'pending'"`
	CreatedAt  time.Time `json:"created_at"`
}

type BehavioralData struct {
	ID                 uint      `json:"id" gorm:"primaryKey"`
	UserID             uint      `json:"user_id" gorm:"index;not null"`
	SessionID          string    `json:"session_id" gorm:"index"`
	ClientDeviceID     string    `json:"client_device_id" gorm:"index"`
	RouteName          string    `json:"route_name"`
	ScreenName         string    `json:"screen_name"`
	TypingSpeed        float64   `json:"typing_speed"`
	TypingVariance     float64   `json:"typing_variance"`
	TypingDwellMean    float64   `json:"typing_dwell_mean"`
	TypingFlightMean   float64   `json:"typing_flight_mean"`
	BackspaceRate      float64   `json:"backspace_rate"`
	CorrectionRate     float64   `json:"correction_rate"`
	MouseSpeed         float64   `json:"mouse_speed"`
	MouseAccuracy      float64   `json:"mouse_accuracy"`
	HoverClickLatency  float64   `json:"hover_click_latency"`
	ScrollDepth        float64   `json:"scroll_depth"`
	ScrollBurstLength  float64   `json:"scroll_burst_length"`
	ScrollBurstSpeed   float64   `json:"scroll_burst_speed"`
	SessionTime        float64   `json:"session_time"`
	WindowTime         float64   `json:"window_time"`
	ResponseLatency    float64   `json:"response_latency"`
	SessionHour        int       `json:"session_hour"`
	SessionWeekday     int       `json:"session_weekday"`
	Timezone           string    `json:"timezone"`
	Locale             string    `json:"locale"`
	NewDevice          bool      `json:"new_device"`
	NewNetwork         bool      `json:"new_network"`
	NewGeo             bool      `json:"new_geo"`
	BackgroundRatio    float64   `json:"background_ratio"`
	AuthOutcomeLabel   string    `json:"auth_outcome_label"`
	SessionTrustLabel  string    `json:"session_trust_label"`
	DataQualityFlags   string    `json:"data_quality_flags" gorm:"type:text"`
	ScreenDwell        string    `json:"screen_dwell" gorm:"type:text"`
	CardDwell          string    `json:"card_dwell" gorm:"type:text"`
	NavigationPath     string    `json:"navigation_path" gorm:"type:text"`
	EventCounts        string    `json:"event_counts" gorm:"type:text"`
	NetworkFingerprint string    `json:"network_fingerprint" gorm:"index"`
	GeoFingerprint     string    `json:"geo_fingerprint" gorm:"index"`
	Pattern            string    `json:"pattern" gorm:"type:text"`
	CreatedAt          time.Time `json:"created_at"`
}

type BackupCode struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"index;not null"`
	CodeHash  string    `json:"-" gorm:"not null"`
	Used      bool      `json:"used" gorm:"default:false"`
	CreatedAt time.Time `json:"created_at"`
	UsedAt    time.Time `json:"used_at"`
}

type RecoveryRequest struct {
	ID           uint   `json:"id" gorm:"primaryKey"`
	UserID       uint   `json:"user_id" gorm:"index;not null"`
	User         User   `json:"user" gorm:"foreignKey:UserID"`
	Status       string `json:"status" gorm:"default:'pending'"`
	Code         string `json:"code" gorm:"uniqueIndex"`
	TrackingLink string `json:"tracking_link"`

	DeviceID      string  `json:"device_id"`
	DeviceTrusted bool    `json:"device_trusted"`
	DFSNAverage   float64 `json:"dfsn_average"`
	DFSNSessions  int     `json:"dfsn_sessions"`
	IP            string  `json:"ip"`
	UserAgent     string  `json:"user_agent"`

	FriendAnswers string `json:"friend_answers" gorm:"type:text"`
	PostAnswers   string `json:"post_answers" gorm:"type:text"`
	AutoDecision  string `json:"auto_decision"`

	AdminNote  string    `json:"admin_note" gorm:"type:text"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	ResolvedAt time.Time `json:"resolved_at"`
	ResolvedBy uint      `json:"resolved_by"`
}

type PushSubscription struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	UserID     uint      `json:"user_id" gorm:"index;not null"`
	User       User      `json:"user" gorm:"foreignKey:UserID"`
	Endpoint   string    `json:"endpoint" gorm:"unique;not null"`
	AuthKey    string    `json:"auth_key"`
	P256dhKey  string    `json:"p256dh_key"`
	UserAgent  string    `json:"user_agent"`
	CreatedAt  time.Time `json:"created_at"`
	LastUsedAt time.Time `json:"last_used_at"`
}

package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"friendscape/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Connect() {
	dsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=%s TimeZone=%s",
		getEnv("DB_HOST", "localhost"),
		getEnv("DB_USER", "postgres"),
		getEnv("DB_PASSWORD", "postgres"),
		getEnv("DB_NAME", "friendscape"),
		getEnv("DB_PORT", "5432"),
		getEnv("DB_SSLMODE", "disable"),
		getEnv("DB_TIMEZONE", "Europe/Moscow"),
	)

	var err error
	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("❌ Ошибка подключения к БД:", err)
	}

	sqlDB, err := DB.DB()
	if err != nil {
		log.Fatal("❌ Ошибка доступа к SQL БД:", err)
	}
	configureConnectionPool(sqlDB)

	if err := RunEmbeddedMigrations(sqlDB); err != nil {
		log.Fatal("❌ Ошибка SQL-миграций:", err)
	}

	err = DB.AutoMigrate(
		&models.User{},
		&models.Community{},
		&models.CommunityMember{},
		&models.Post{},
		&models.Comment{},
		&models.CommentVote{},
		&models.FeedPreference{},
		&models.Like{},
		&models.Friendship{},
		&models.Subscription{},
		&models.Message{},
		&models.Chat{},
		&models.ChatParticipant{},
		&models.Notification{},
		&models.TrustedDevice{},
		&models.AuthSession{},
		&models.E2EEDevice{},
		&models.E2EEOneTimePreKey{},
		&models.Vouch{},
		&models.Report{},
		&models.ModerationReport{},
		&models.SupportTicket{},
		&models.BehavioralData{},
		&models.BackupCode{},
		&models.RecoveryRequest{},
		&models.PushSubscription{},
		&models.MediaAsset{},
		&models.MediaVote{},
		&models.MediaComment{},
		&models.MediaReport{},
		&models.Collection{},
		&models.CollectionItem{},
	)
	if err != nil {
		log.Fatal("❌ Ошибка миграции БД:", err)
	}

	log.Println("✅ База данных подключена и синхронизирована")
}

func configureConnectionPool(db *sql.DB) {
	if db == nil {
		return
	}
	maxOpen := intEnv("DB_MAX_OPEN_CONNS", 40)
	maxIdle := intEnv("DB_MAX_IDLE_CONNS", 20)
	maxLifetimeMinutes := intEnv("DB_CONN_MAX_LIFETIME_MIN", 30)
	maxIdleMinutes := intEnv("DB_CONN_MAX_IDLE_MIN", 10)

	if maxOpen > 0 {
		db.SetMaxOpenConns(maxOpen)
	}
	if maxIdle >= 0 {
		db.SetMaxIdleConns(maxIdle)
	}
	if maxLifetimeMinutes > 0 {
		db.SetConnMaxLifetime(time.Duration(maxLifetimeMinutes) * time.Minute)
	}
	if maxIdleMinutes > 0 {
		db.SetConnMaxIdleTime(time.Duration(maxIdleMinutes) * time.Minute)
	}
}

func HealthCheck() error {
	if DB == nil {
		return fmt.Errorf("database is not initialized")
	}
	return pingDB()
}

func pingDB() error {
	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}
	return sqlDB.Ping()
}

func RawDB() (*sql.DB, error) {
	if DB == nil {
		return nil, fmt.Errorf("database is not initialized")
	}
	return DB.DB()
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func intEnv(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

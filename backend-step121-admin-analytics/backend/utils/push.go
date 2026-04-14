package utils

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	"friendscape/internal/models"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type VAPIDKeys struct {
	PublicKey  string
	PrivateKey string
}

var (
	vapidKeys               *VAPIDKeys
	ErrPushSubscriptionGone = errors.New("push subscription is gone")
)

func InitVAPID() {
	publicKey := strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY"))
	privateKey := strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY"))

	if publicKey == "" || privateKey == "" {
		if isProduction() {
			log.Fatal("❌ В production нужно задать VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY")
		}

		generatedPrivate, generatedPublic, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			log.Printf("❌ Ошибка генерации VAPID ключей: %v", err)
			return
		}

		vapidKeys = &VAPIDKeys{
			PublicKey:  generatedPublic,
			PrivateKey: generatedPrivate,
		}

		log.Printf("⚠️ VAPID ключи не заданы в окружении. Сгенерированы временные значения для локальной среды.")
		log.Printf("VAPID_PUBLIC_KEY=%s", vapidKeys.PublicKey)
		return
	}

	vapidKeys = &VAPIDKeys{
		PublicKey:  publicKey,
		PrivateKey: privateKey,
	}
}

func GetVAPIDPublicKey() string {
	if vapidKeys == nil {
		InitVAPID()
	}
	if vapidKeys == nil {
		return ""
	}
	return vapidKeys.PublicKey
}

func GetVAPIDSubject() string {
	if subject := strings.TrimSpace(os.Getenv("VAPID_SUBJECT")); subject != "" {
		return subject
	}
	if publicURL := strings.TrimSpace(os.Getenv("APP_PUBLIC_URL")); publicURL != "" {
		return publicURL
	}
	return "mailto:noreply@friendscape.local"
}

func SendPushNotification(subscription *models.PushSubscription, title, body, url string) error {
	if subscription == nil {
		return errors.New("subscription is nil")
	}
	if strings.TrimSpace(subscription.Endpoint) == "" {
		return errors.New("subscription endpoint is empty")
	}

	if vapidKeys == nil {
		InitVAPID()
	}
	if vapidKeys == nil {
		return errors.New("vapid keys are not initialized")
	}

	payload := map[string]any{
		"title": strings.TrimSpace(title),
		"body":  strings.TrimSpace(body),
		"url":   normalizePushURL(url),
		"icon":  "/favicon.svg",
		"badge": "/favicon.svg",
	}

	if payload["title"] == "" {
		payload["title"] = "Friendscape"
	}
	if payload["body"] == "" {
		payload["body"] = "У вас новое уведомление"
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	sub := &webpush.Subscription{
		Endpoint: subscription.Endpoint,
		Keys: webpush.Keys{
			Auth:   subscription.AuthKey,
			P256dh: subscription.P256dhKey,
		},
	}

	resp, err := webpush.SendNotification(payloadBytes, sub, &webpush.Options{
		Subscriber:      GetVAPIDSubject(),
		VAPIDPublicKey:  vapidKeys.PublicKey,
		VAPIDPrivateKey: vapidKeys.PrivateKey,
		TTL:             86400,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("%w: %d", ErrPushSubscriptionGone, resp.StatusCode)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("push failed: %d %s", resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
	}

	return nil
}

func normalizePushURL(url string) string {
	trimmed := strings.TrimSpace(url)
	if trimmed == "" {
		return "/notifications"
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return trimmed
	}
	if !strings.HasPrefix(trimmed, "/") {
		return "/" + trimmed
	}
	return trimmed
}

func GenerateHash(input string) string {
	hash := sha256.Sum256([]byte(input))
	return base64.URLEncoding.EncodeToString(hash[:])
}

func GenerateRecoveryCode() string {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	return fmt.Sprintf("%04d-%04d-%04d",
		rng.Intn(9000)+1000,
		rng.Intn(9000)+1000,
		rng.Intn(9000)+1000,
	)
}

func isProduction() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "production")
}
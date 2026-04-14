package utils

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	crypto_rand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	"friendscape/internal/models"
)

type VAPIDKeys struct {
	PublicKey  string
	PrivateKey string
}

var vapidKeys *VAPIDKeys

func InitVAPID() {
	publicKey := strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY"))
	privateKey := strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY"))

	if publicKey == "" || privateKey == "" {
		if isProduction() {
			log.Fatal("❌ В production нужно задать VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY")
		}

		private, err := ecdsa.GenerateKey(elliptic.P256(), crypto_rand.Reader)
		if err != nil {
			log.Printf("❌ Ошибка генерации VAPID ключей: %v", err)
			return
		}

		pubBytes := elliptic.Marshal(elliptic.P256(), private.PublicKey.X, private.PublicKey.Y)
		privBytes := private.D.Bytes()

		vapidKeys = &VAPIDKeys{
			PublicKey:  base64.RawURLEncoding.EncodeToString(pubBytes),
			PrivateKey: base64.RawURLEncoding.EncodeToString(privBytes),
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

func SendPushNotification(subscription *models.PushSubscription, title, body, url string) error {
	payload := map[string]interface{}{
		"title": title,
		"body":  body,
		"url":   url,
		"icon":  "/favicon.svg",
		"badge": "/favicon.svg",
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", subscription.Endpoint, strings.NewReader(string(payloadBytes)))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("TTL", "86400")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("push failed: %d", resp.StatusCode)
	}

	return nil
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

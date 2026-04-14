package handlers

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type CallsConfigHandler struct{}

func NewCallsConfigHandler() *CallsConfigHandler { return &CallsConfigHandler{} }

type rtcIceServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

func splitCSVEnv(raw string) []string {
	parts := strings.Split(strings.TrimSpace(raw), ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" {
			continue
		}
		out = append(out, value)
	}
	return out
}

func parsePositiveIntEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func normalizePolicy(value string, fallback string, allowed map[string]struct{}) string {
	next := strings.ToLower(strings.TrimSpace(value))
	if _, ok := allowed[next]; ok {
		return next
	}
	return fallback
}

func buildStaticTurnCredential(secret string, username string) string {
	mac := hmac.New(sha1.New, []byte(secret))
	_, _ = mac.Write([]byte(username))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func buildTurnRESTUsername(userID uint, ttlSeconds int) string {
	expiresAt := time.Now().UTC().Add(time.Duration(ttlSeconds) * time.Second).Unix()
	return strconv.FormatInt(expiresAt, 10) + ":" + strconv.FormatUint(uint64(userID), 10)
}

func buildCallIceServers(userID uint) ([]rtcIceServer, string, int) {
	stunURLs := splitCSVEnv(os.Getenv("WEBRTC_STUN_URLS"))
	turnURLs := splitCSVEnv(os.Getenv("WEBRTC_TURN_URLS"))
	turnSecret := strings.TrimSpace(os.Getenv("WEBRTC_TURN_SECRET"))
	turnUsername := strings.TrimSpace(os.Getenv("WEBRTC_TURN_USERNAME"))
	turnCredential := strings.TrimSpace(os.Getenv("WEBRTC_TURN_CREDENTIAL"))
	turnTTL := parsePositiveIntEnv("WEBRTC_TURN_TTL_SECONDS", 3600)

	servers := make([]rtcIceServer, 0, 3)
	if len(stunURLs) > 0 {
		servers = append(servers, rtcIceServer{URLs: stunURLs})
	}

	mode := "none"
	if len(turnURLs) > 0 {
		switch {
		case turnSecret != "":
			username := buildTurnRESTUsername(userID, turnTTL)
			servers = append(servers, rtcIceServer{
				URLs:       turnURLs,
				Username:   username,
				Credential: buildStaticTurnCredential(turnSecret, username),
			})
			mode = "rest"
		case turnUsername != "" && turnCredential != "":
			servers = append(servers, rtcIceServer{
				URLs:       turnURLs,
				Username:   turnUsername,
				Credential: turnCredential,
			})
			mode = "static"
		}
	}

	return servers, mode, turnTTL
}

func (h *CallsConfigHandler) GetConfig(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не авторизован"})
		return
	}
	userID, ok := userIDValue.(uint)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не авторизован"})
		return
	}

	iceServers, turnMode, turnTTL := buildCallIceServers(userID)
	transportPolicy := normalizePolicy(os.Getenv("WEBRTC_ICE_TRANSPORT_POLICY"), "all", map[string]struct{}{"all": {}, "relay": {}})
	bundlePolicy := normalizePolicy(os.Getenv("WEBRTC_BUNDLE_POLICY"), "max-bundle", map[string]struct{}{"balanced": {}, "max-compat": {}, "max-bundle": {}})
	rtcpMuxPolicy := normalizePolicy(os.Getenv("WEBRTC_RTCP_MUX_POLICY"), "require", map[string]struct{}{"require": {}})
	iceCandidatePoolSize := parsePositiveIntEnv("WEBRTC_ICE_CANDIDATE_POOL_SIZE", 6)

	configWarning := ""
	if len(iceServers) == 0 {
		configWarning = "WebRTC ICE servers are not configured"
	}

	c.JSON(http.StatusOK, gin.H{
		"ice_servers":               iceServers,
		"ice_transport_policy":      transportPolicy,
		"bundle_policy":             bundlePolicy,
		"rtcp_mux_policy":           rtcpMuxPolicy,
		"ice_candidate_pool_size":   iceCandidatePoolSize,
		"turn_mode":                 turnMode,
		"turn_ttl_seconds":          turnTTL,
		"turn_enabled":              turnMode != "none",
		"recommended_transport_set": []string{"udp", "tcp", "tls"},
		"config_warning":            configWarning,
	})
}

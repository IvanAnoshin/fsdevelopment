package handlers

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"friendscape/internal/auth"
	"friendscape/internal/database"
	"friendscape/internal/models"
	"friendscape/internal/realtime"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type ChatWSHandler struct{}

const callRingTimeout = 35 * time.Second

func NewChatWSHandler() *ChatWSHandler { return &ChatWSHandler{} }

var chatUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			return true
		}
		appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
		if appEnv != "production" {
			return true
		}
		allowedOrigins := strings.Split(strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS")), ",")
		for _, allowed := range allowedOrigins {
			allowed = strings.TrimSpace(allowed)
			if allowed == "" {
				continue
			}
			if subtle.ConstantTimeCompare([]byte(origin), []byte(allowed)) == 1 {
				return true
			}
		}
		return false
	},
}

type chatWSRequest struct {
	Type     string                 `json:"type"`
	ClientID string                 `json:"client_id,omitempty"`
	Data     map[string]interface{} `json:"data,omitempty"`
}

type chatWSResponse struct {
	Type      string         `json:"type"`
	ClientID  string         `json:"client_id,omitempty"`
	Data      map[string]any `json:"data,omitempty"`
	Error     string         `json:"error,omitempty"`
	Timestamp time.Time      `json:"timestamp"`
}

func parseRealtimeToken(c *gin.Context) string {
	return strings.TrimSpace(c.Query("ticket"))
}

func authenticateRealtimeUser(tokenString string) (*models.User, error) {
	claims, err := auth.ValidateJWT(tokenString)
	if err != nil || claims.IsTemp || claims.Kind != auth.TokenKindRTT {
		return nil, err
	}
	var user models.User
	if err := database.DB.First(&user, claims.UserID).Error; err != nil {
		return nil, err
	}
	if user.TokenVersion != claims.TokenVersion {
		return nil, websocket.ErrBadHandshake
	}
	if strings.TrimSpace(claims.SessionID) != "" {
		if _, err := auth.FindActiveSession(claims.SessionID, claims.UserID); err != nil {
			return nil, websocket.ErrBadHandshake
		}
	}
	return &user, nil
}

func writeWSJSON(conn *websocket.Conn, payload chatWSResponse) error {
	payload.Timestamp = time.Now().UTC()
	return conn.WriteJSON(payload)
}

func writeWSError(conn *websocket.Conn, clientID string, message string) error {
	return writeWSJSON(conn, chatWSResponse{Type: "error", ClientID: clientID, Error: message})
}

func parseUint(data map[string]interface{}, key string) uint {
	raw, ok := data[key]
	if !ok {
		return 0
	}
	switch value := raw.(type) {
	case float64:
		if value > 0 {
			return uint(value)
		}
	case string:
		parsed, _ := strconv.Atoi(strings.TrimSpace(value))
		if parsed > 0 {
			return uint(parsed)
		}
	}
	return 0
}

func parseString(data map[string]interface{}, key string) string {
	raw, ok := data[key]
	if !ok {
		return ""
	}
	switch value := raw.(type) {
	case string:
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func parseMediaPayload(data map[string]interface{}) *directMessageMedia {
	raw, ok := data["media"]
	if !ok || raw == nil {
		return nil
	}
	payload, ok := raw.(map[string]interface{})
	if !ok {
		return nil
	}
	media := &directMessageMedia{
		Kind:        parseString(payload, "kind"),
		URL:         parseString(payload, "url"),
		ThumbURL:    parseString(payload, "thumb_url"),
		Mime:        parseString(payload, "mime"),
		DurationSec: int(parseUint(payload, "duration_sec")),
		Width:       int(parseUint(payload, "width")),
		Height:      int(parseUint(payload, "height")),
		Bytes:       int64(parseUint(payload, "bytes")),
	}
	if media.URL == "" {
		return nil
	}
	return media
}

func realtimeUserPayload(userID uint) map[string]any {
	var user models.User
	if err := database.DB.Select("id, first_name, last_name, username, avatar").First(&user, userID).Error; err != nil {
		return map[string]any{"id": userID}
	}
	name := strings.TrimSpace(strings.TrimSpace(user.FirstName + " " + user.LastName))
	if name == "" {
		name = strings.TrimSpace(user.Username)
	}
	return map[string]any{
		"id":       user.ID,
		"name":     name,
		"username": user.Username,
		"avatar":   user.Avatar,
	}
}

func buildCallPayload(session *realtime.CallSession, peerID uint) map[string]any {
	if session == nil {
		return map[string]any{}
	}
	payload := map[string]any{
		"session_id": session.ID,
		"kind":       session.Kind,
		"state":      session.State,
		"peer":       realtimeUserPayload(peerID),
	}
	if session.AcceptedAt != nil {
		payload["accepted_at"] = session.AcceptedAt.UTC()
	}
	return payload
}

func relayCallSignalToPeer(session *realtime.CallSession, fromUserID uint, eventType string, extra map[string]any) {
	if session == nil {
		return
	}
	peerID := session.OtherUserID(fromUserID)
	if peerID == 0 {
		return
	}
	payload := buildCallPayload(session, fromUserID)
	payload["from_user_id"] = fromUserID
	payload["to_user_id"] = peerID
	for key, value := range extra {
		payload[key] = value
	}
	realtime.DefaultBroker.PublishToUser(peerID, realtime.Event{Type: eventType, Channel: "calls", Data: payload})
}

func (h *ChatWSHandler) Stream(c *gin.Context) {
	tokenString := parseRealtimeToken(c)
	if tokenString == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Нужен short-lived ticket для chat websocket"})
		return
	}

	user, err := authenticateRealtimeUser(tokenString)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Недействительный токен chat websocket"})
		return
	}

	conn, err := chatUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	defer func() {
		if session, ended := realtime.DefaultCallRegistry.EndForUser(user.ID); ended && session != nil {
			relayCallSignalToPeer(session, user.ID, "call:end", map[string]any{"reason": "disconnect"})
		}
	}()

	ch := realtime.DefaultBroker.Subscribe(user.ID)
	defer realtime.DefaultBroker.Unsubscribe(user.ID, ch)

	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	_ = conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})

	_ = writeWSJSON(conn, chatWSResponse{Type: "ready", Data: map[string]any{"user_id": user.ID}})

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			var req chatWSRequest
			if err := conn.ReadJSON(&req); err != nil {
				return
			}
			switch req.Type {
			case "ping":
				_ = writeWSJSON(conn, chatWSResponse{Type: "pong", ClientID: req.ClientID})
			case "message:send":
				toUserID := parseUint(req.Data, "to_user_id")
				content, _ := req.Data["content"].(string)
				if toUserID == 0 {
					_ = writeWSError(conn, req.ClientID, "Некорректный получатель")
					continue
				}
				message, notification, err := sendDirectMessage(user.ID, toUserID, directMessageRequest{Type: parseString(req.Data, "type"), Content: content, Media: parseMediaPayload(req.Data)})
				if err != nil {
					_ = writeWSError(conn, req.ClientID, err.Error())
					continue
				}
				publishMessageEvents(message, notification)
				_ = writeWSJSON(conn, chatWSResponse{Type: "message:sent", ClientID: req.ClientID, Data: map[string]any{"message": message}})
			case "message:read":
				otherID := parseUint(req.Data, "conversation_with")
				if otherID == 0 {
					_ = writeWSError(conn, req.ClientID, "Некорректный диалог")
					continue
				}
				updated, err := markConversationAsRead(user.ID, otherID)
				if err != nil {
					_ = writeWSError(conn, req.ClientID, "Не удалось отметить сообщения как прочитанные")
					continue
				}
				realtime.DefaultBroker.PublishToUser(otherID, realtime.Event{Type: "message:read", Channel: "messages", Data: map[string]any{"conversation_with": user.ID, "updated": updated}})
				_ = writeWSJSON(conn, chatWSResponse{Type: "message:read:ack", ClientID: req.ClientID, Data: map[string]any{"conversation_with": otherID, "updated": updated}})
			case "call:invite":
				toUserID := parseUint(req.Data, "to_user_id")
				kind := parseString(req.Data, "kind")
				if toUserID == 0 {
					_ = writeWSError(conn, req.ClientID, "Некорректный получатель звонка")
					continue
				}
				if !realtime.DefaultBroker.HasSubscribers(toUserID) {
					_ = writeWSJSON(conn, chatWSResponse{Type: "call:unavailable", ClientID: req.ClientID, Data: map[string]any{"to_user_id": toUserID}})
					continue
				}
				session, err := realtime.DefaultCallRegistry.Create(user.ID, toUserID, kind)
				if err != nil {
					message := err.Error()
					switch {
					case errors.Is(err, realtime.ErrCallBusy):
						message = "Пользователь уже занят другим звонком"
						_ = writeWSJSON(conn, chatWSResponse{Type: "call:busy", ClientID: req.ClientID, Data: map[string]any{"to_user_id": toUserID}})
					case errors.Is(err, realtime.ErrInvalidCallKind):
						message = "Поддерживаются только аудио и видеозвонки"
					case errors.Is(err, realtime.ErrCallForbidden):
						message = "Нельзя позвонить самому себе"
					}
					_ = writeWSError(conn, req.ClientID, message)
					continue
				}
				_ = writeWSJSON(conn, chatWSResponse{Type: "call:outgoing", ClientID: req.ClientID, Data: buildCallPayload(session, toUserID)})
				relayCallSignalToPeer(session, user.ID, "call:incoming", nil)
				go func(sessionID string, callerID uint, calleeID uint) {
					time.Sleep(callRingTimeout)
					session, expired := realtime.DefaultCallRegistry.ExpireRinging(sessionID)
					if !expired || session == nil {
						return
					}
					payloadToCaller := buildCallPayload(session, calleeID)
					payloadToCaller["reason"] = "timeout"
					realtime.DefaultBroker.PublishToUser(callerID, realtime.Event{Type: "call:timeout", Channel: "calls", Data: payloadToCaller})
					payloadToCallee := buildCallPayload(session, callerID)
					payloadToCallee["reason"] = "timeout"
					realtime.DefaultBroker.PublishToUser(calleeID, realtime.Event{Type: "call:timeout", Channel: "calls", Data: payloadToCallee})
				}(session.ID, user.ID, toUserID)
			case "call:accept":
				sessionID := parseString(req.Data, "session_id")
				session, err := realtime.DefaultCallRegistry.Accept(sessionID, user.ID)
				if err != nil {
					message := "Не удалось принять звонок"
					switch {
					case errors.Is(err, realtime.ErrCallNotFound):
						message = "Звонок больше недоступен"
					case errors.Is(err, realtime.ErrCallForbidden):
						message = "Нельзя принять этот звонок"
					}
					_ = writeWSError(conn, req.ClientID, message)
					continue
				}
				_ = writeWSJSON(conn, chatWSResponse{Type: "call:accepted", ClientID: req.ClientID, Data: buildCallPayload(session, session.OtherUserID(user.ID))})
				relayCallSignalToPeer(session, user.ID, "call:accepted", nil)
			case "call:reject", "call:cancel", "call:end":
				sessionID := parseString(req.Data, "session_id")
				reason := parseString(req.Data, "reason")
				session, err := realtime.DefaultCallRegistry.End(sessionID, user.ID)
				if err != nil {
					message := "Не удалось завершить звонок"
					if errors.Is(err, realtime.ErrCallNotFound) {
						message = "Звонок уже завершён"
					}
					_ = writeWSError(conn, req.ClientID, message)
					continue
				}
				eventType := req.Type
				extra := map[string]any{}
				if reason != "" {
					extra["reason"] = reason
				}
				_ = writeWSJSON(conn, chatWSResponse{Type: eventType, ClientID: req.ClientID, Data: buildCallPayload(session, session.OtherUserID(user.ID))})
				relayCallSignalToPeer(session, user.ID, eventType, extra)
			case "call:offer", "call:answer", "call:ice", "call:toggle":
				sessionID := parseString(req.Data, "session_id")
				session, ok := realtime.DefaultCallRegistry.Get(sessionID)
				if !ok || session == nil || !session.HasParticipant(user.ID) {
					_ = writeWSError(conn, req.ClientID, "Звонок недоступен")
					continue
				}
				extra := map[string]any{}
				switch req.Type {
				case "call:offer":
					extra["offer"] = req.Data["offer"]
				case "call:answer":
					extra["answer"] = req.Data["answer"]
				case "call:ice":
					extra["candidate"] = req.Data["candidate"]
				case "call:toggle":
					if audioEnabled, ok := req.Data["audio_enabled"]; ok {
						extra["audio_enabled"] = audioEnabled
					}
					if videoEnabled, ok := req.Data["video_enabled"]; ok {
						extra["video_enabled"] = videoEnabled
					}
				}
				relayCallSignalToPeer(session, user.ID, req.Type, extra)
				_ = writeWSJSON(conn, chatWSResponse{Type: req.Type + ":ack", ClientID: req.ClientID, Data: buildCallPayload(session, session.OtherUserID(user.ID))})
			}
		}
	}()

	pingTicker := time.NewTicker(20 * time.Second)
	defer pingTicker.Stop()

	for {
		select {
		case <-done:
			return
		case <-pingTicker.C:
			if err := conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second)); err != nil {
				return
			}
		case event := <-ch:
			payload, _ := json.Marshal(event.Data)
			var data map[string]any
			_ = json.Unmarshal(payload, &data)
			if err := writeWSJSON(conn, chatWSResponse{Type: event.Type, Data: data}); err != nil {
				return
			}
		}
	}
}

func BuildChatWebSocketURL(baseURL string, ticket string) string {
	cleanBase := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(cleanBase, "/api") {
		cleanBase = strings.TrimSuffix(cleanBase, "/api")
	}
	parsed, _ := url.Parse(cleanBase)
	if parsed != nil {
		if parsed.Scheme == "https" {
			parsed.Scheme = "wss"
		} else {
			parsed.Scheme = "ws"
		}
		parsed.Path = "/api/ws/chat"
		q := parsed.Query()
		if ticket != "" {
			q.Set("ticket", ticket)
		}
		parsed.RawQuery = q.Encode()
		return parsed.String()
	}
	return ""
}

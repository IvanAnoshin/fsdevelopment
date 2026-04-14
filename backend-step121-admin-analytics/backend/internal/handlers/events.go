package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"friendscape/internal/auth"
	"friendscape/internal/database"
	"friendscape/internal/models"
	"friendscape/internal/realtime"
	"github.com/gin-gonic/gin"
)

type EventsHandler struct{}

func NewEventsHandler() *EventsHandler { return &EventsHandler{} }

func (h *EventsHandler) Stream(c *gin.Context) {
	tokenString := strings.TrimSpace(c.Query("ticket"))
	if tokenString == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Нужен short-lived ticket для realtime-потока"})
		return
	}
	claims, err := auth.ValidateJWT(tokenString)
	if err != nil || claims.IsTemp || claims.Kind != auth.TokenKindRTT {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Недействительный ticket realtime-потока"})
		return
	}
	var user models.User
	if err := database.DB.First(&user, claims.UserID).Error; err != nil || user.TokenVersion != claims.TokenVersion {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь realtime-потока не найден или токен устарел"})
		return
	}
	if strings.TrimSpace(claims.SessionID) != "" {
		if _, err := auth.FindActiveSession(claims.SessionID, claims.UserID); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Realtime-сессия завершена или устарела"})
			return
		}
	}
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Realtime stream не поддерживается"})
		return
	}
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	ch := realtime.DefaultBroker.Subscribe(user.ID)
	defer realtime.DefaultBroker.Unsubscribe(user.ID, ch)
	fmt.Fprint(c.Writer, "event: ready\ndata: {\"type\":\"ready\"}\n\n")
	flusher.Flush()
	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-heartbeat.C:
			fmt.Fprint(c.Writer, ": ping\n\n")
			flusher.Flush()
		case event := <-ch:
			payload, _ := json.Marshal(event)
			fmt.Fprintf(c.Writer, "event: %s\n", event.Type)
			fmt.Fprintf(c.Writer, "data: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

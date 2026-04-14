package observability

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type Fields map[string]any

func logEvent(level string, message string, fields Fields) {
	payload := Fields{
		"level":     level,
		"message":   message,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	}
	for key, value := range fields {
		payload[key] = value
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		log.Printf(`{"level":"error","message":"logger marshal failed","original_message":%q}`+"\n", message)
		return
	}
	log.Println(string(encoded))
}

func CaptureError(component string, err error, fields Fields) {
	if fields == nil {
		fields = Fields{}
	}
	fields["component"] = component
	if err != nil {
		fields["error"] = err.Error()
	}
	logEvent("error", component+" failed", fields)
	webhookURL := strings.TrimSpace(os.Getenv("ERROR_WEBHOOK_URL"))
	if webhookURL == "" || err == nil {
		return
	}
	go func(body Fields) {
		encoded, marshalErr := json.Marshal(body)
		if marshalErr != nil {
			return
		}
		req, reqErr := http.NewRequest(http.MethodPost, webhookURL, bytes.NewReader(encoded))
		if reqErr != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		client := &http.Client{Timeout: 3 * time.Second}
		resp, doErr := client.Do(req)
		if doErr != nil {
			return
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}(fields)
}

func RequestContextMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := strings.TrimSpace(c.GetHeader("X-Request-ID"))
		if requestID == "" {
			requestID = strings.ReplaceAll(time.Now().UTC().Format("20060102T150405.000000000"), ".", "-")
		}
		c.Set("request_id", requestID)
		c.Header("X-Request-ID", requestID)
		c.Next()
	}
}

func RequestLoggerMiddleware(skipPaths map[string]struct{}) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		path := c.Request.URL.Path
		if _, skip := skipPaths[path]; skip {
			c.Next()
			return
		}
		c.Next()
		fields := Fields{
			"request_id": c.GetString("request_id"),
			"method":     c.Request.Method,
			"path":       path,
			"status":     c.Writer.Status(),
			"latency_ms": time.Since(started).Milliseconds(),
			"client_ip":  c.ClientIP(),
		}
		if userID, ok := c.Get("user_id"); ok {
			fields["user_id"] = userID
		}
		logEvent("info", "request completed", fields)
	}
}

func RecoveryMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				CaptureError("panic", nil, Fields{
					"request_id": c.GetString("request_id"),
					"path":       c.Request.URL.Path,
					"method":     c.Request.Method,
					"panic":      recovered,
					"stack":      string(debug.Stack()),
				})
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Внутренняя ошибка сервера"})
			}
		}()
		c.Next()
	}
}

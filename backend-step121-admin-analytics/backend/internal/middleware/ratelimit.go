package middleware

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type RateLimiter struct {
	requests map[string][]time.Time
	mu       sync.Mutex
	limit    int
	window   time.Duration
}

type rateLimitPolicy struct {
	limit  int
	window time.Duration
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}
}

func (rl *RateLimiter) policyFor(path, method string) rateLimitPolicy {
	policy := rateLimitPolicy{limit: rl.limit, window: rl.window}
	path = strings.ToLower(path)
	method = strings.ToUpper(method)

	switch {
	case method == http.MethodPost && (path == "/api/auth/login" || path == "/api/auth/register" || path == "/api/auth/login-with-backup-code"):
		return rateLimitPolicy{limit: 10, window: 10 * time.Minute}
	case method == http.MethodPost && (path == "/api/auth/recovery" || path == "/api/auth/recovery-request" || path == "/api/auth/recovery-submit-answers" || path == "/api/auth/recovery-complete" || path == "/api/auth/reset-password"):
		return rateLimitPolicy{limit: 6, window: 15 * time.Minute}
	case strings.HasPrefix(path, "/api/messages"):
		if method == http.MethodPost || method == http.MethodDelete {
			return rateLimitPolicy{limit: 120, window: time.Minute}
		}
		return rateLimitPolicy{limit: 240, window: time.Minute}
	case strings.HasPrefix(path, "/api/posts"):
		if method == http.MethodPost || method == http.MethodDelete || method == http.MethodPut {
			return rateLimitPolicy{limit: 90, window: time.Minute}
		}
		return rateLimitPolicy{limit: 180, window: time.Minute}
	case method == http.MethodPost && strings.HasPrefix(path, "/api/reports/posts"):
		return rateLimitPolicy{limit: 12, window: time.Hour}
	case method == http.MethodPost && path == "/api/support/tickets":
		return rateLimitPolicy{limit: 6, window: 6 * time.Hour}
	case method == http.MethodGet && path == "/api/support/tickets":
		return rateLimitPolicy{limit: 60, window: time.Hour}
	case strings.HasPrefix(path, "/api/admin"):
		return rateLimitPolicy{limit: 60, window: time.Minute}
	case method == http.MethodPost && path == "/api/make-me-admin":
		return rateLimitPolicy{limit: 5, window: 15 * time.Minute}
	default:
		return policy
	}
}

func pruneRequests(requests []time.Time, cutoff time.Time) []time.Time {
	idx := 0
	for idx < len(requests) && requests[idx].Before(cutoff) {
		idx++
	}
	if idx == 0 {
		return requests
	}
	if idx >= len(requests) {
		return nil
	}
	pruned := make([]time.Time, len(requests)-idx)
	copy(pruned, requests[idx:])
	return pruned
}

func (rl *RateLimiter) RateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}
		if path == "/healthz" || path == "/readyz" || path == "/api/health" || path == "/api/ready" {
			c.Next()
			return
		}
		policy := rl.policyFor(path, c.Request.Method)
		key := fmt.Sprintf("%s|%s|%s", c.ClientIP(), strings.ToUpper(c.Request.Method), path)

		now := time.Now()
		cutoff := now.Add(-policy.window)

		rl.mu.Lock()
		requests := pruneRequests(rl.requests[key], cutoff)
		if len(requests) == 0 {
			delete(rl.requests, key)
		}
		if len(requests) >= policy.limit {
			retryAfter := int(requests[0].Add(policy.window).Sub(now).Seconds())
			if retryAfter < 1 {
				retryAfter = int(policy.window.Seconds())
			}
			rl.requests[key] = requests
			rl.mu.Unlock()

			c.Header("Retry-After", fmt.Sprintf("%d", retryAfter))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":       "Слишком много запросов. Попробуйте позже.",
				"retry_after": retryAfter,
			})
			return
		}

		requests = append(requests, now)
		rl.requests[key] = requests
		rl.mu.Unlock()

		c.Next()
	}
}

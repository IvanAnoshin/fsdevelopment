package handlers

import (
	"compress/gzip"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/models"

	"github.com/gin-gonic/gin"
)

type behaviorExportFilters struct {
	startDate   time.Time
	endDate     time.Time
	userID      uint
	trustLabel  string
	authOutcome string
	routeName   string
	limit       int
	gzip        bool
}

func parseDateFilter(value string, endOfDay bool) (time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}, nil
	}
	layouts := []string{time.RFC3339, "2006-01-02"}
	var parsed time.Time
	var err error
	for _, layout := range layouts {
		parsed, err = time.Parse(layout, trimmed)
		if err == nil {
			if layout == "2006-01-02" && endOfDay {
				parsed = parsed.Add(23*time.Hour + 59*time.Minute + 59*time.Second)
			}
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid date: %s", trimmed)
}

func getenvInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func parseBehaviorExportFilters(c *gin.Context) (behaviorExportFilters, error) {
	maxRows := getenvInt("DFSN_EXPORT_MAX_ROWS", 250000)
	limit := 50000
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			return behaviorExportFilters{}, fmt.Errorf("invalid limit")
		}
		if parsed > maxRows {
			parsed = maxRows
		}
		limit = parsed
	}

	var userID uint
	if raw := strings.TrimSpace(c.Query("user_id")); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return behaviorExportFilters{}, fmt.Errorf("invalid user_id")
		}
		userID = uint(parsed)
	}

	startDate, err := parseDateFilter(c.Query("from"), false)
	if err != nil {
		return behaviorExportFilters{}, err
	}
	endDate, err := parseDateFilter(c.Query("to"), true)
	if err != nil {
		return behaviorExportFilters{}, err
	}
	if !startDate.IsZero() && !endDate.IsZero() && endDate.Before(startDate) {
		return behaviorExportFilters{}, fmt.Errorf("invalid date range")
	}

	gzipEnabled := true
	if raw := strings.TrimSpace(strings.ToLower(c.Query("gzip"))); raw != "" {
		gzipEnabled = raw != "0" && raw != "false" && raw != "no"
	}

	return behaviorExportFilters{
		startDate:   startDate,
		endDate:     endDate,
		userID:      userID,
		trustLabel:  normalizeLabel(c.Query("trust_label"), ""),
		authOutcome: normalizeLabel(c.Query("auth_outcome"), ""),
		routeName:   strings.TrimSpace(c.Query("route")),
		limit:       limit,
		gzip:        gzipEnabled,
	}, nil
}

func decodeStringSlice(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(trimmed), &out); err != nil {
		return nil
	}
	return out
}

func decodeStringFloatMap(raw string) map[string]float64 {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	var out map[string]float64
	if err := json.Unmarshal([]byte(trimmed), &out); err == nil {
		return out
	}

	var generic map[string]any
	if err := json.Unmarshal([]byte(trimmed), &generic); err != nil {
		return nil
	}
	out = make(map[string]float64, len(generic))
	for key, value := range generic {
		switch typed := value.(type) {
		case float64:
			out[key] = typed
		case int:
			out[key] = float64(typed)
		case int64:
			out[key] = float64(typed)
		case string:
			if parsed, err := strconv.ParseFloat(typed, 64); err == nil {
				out[key] = parsed
			}
		}
	}
	return out
}

func topMapEntry(values map[string]float64) (string, float64) {
	topKey := ""
	topValue := 0.0
	for key, value := range values {
		if value > topValue || topKey == "" {
			topKey = key
			topValue = value
		}
	}
	return topKey, topValue
}

func sumMapValues(values map[string]float64) float64 {
	total := 0.0
	for _, value := range values {
		total += value
	}
	return total
}

func navSignature(path []string) string {
	if len(path) == 0 {
		return ""
	}
	if len(path) > 5 {
		path = path[:5]
	}
	return strings.Join(path, ">")
}

func csvFloat(value float64) string { return strconv.FormatFloat(value, 'f', 4, 64) }
func csvInt(value int) string       { return strconv.Itoa(value) }
func csvUint(value uint) string     { return strconv.FormatUint(uint64(value), 10) }
func csvBool(value bool) string {
	if value {
		return "1"
	}
	return "0"
}

func compactBehaviorCSVHeader() []string {
	return []string{
		"schema_version",
		"created_at_unix",
		"user_id",
		"session_id",
		"client_device_id",
		"route_name",
		"screen_name",
		"typing_speed",
		"typing_variance",
		"typing_dwell_mean",
		"typing_flight_mean",
		"backspace_rate",
		"correction_rate",
		"mouse_speed",
		"mouse_accuracy",
		"hover_click_latency",
		"scroll_depth",
		"scroll_burst_length",
		"scroll_burst_speed",
		"session_time",
		"window_time",
		"response_latency",
		"session_hour",
		"session_weekday",
		"timezone",
		"locale",
		"new_device",
		"new_network",
		"new_geo",
		"background_ratio",
		"auth_outcome_label",
		"session_trust_label",
		"quality_flags",
		"screen_dwell_total",
		"screen_dwell_unique",
		"screen_dwell_top_key",
		"screen_dwell_top_value",
		"card_dwell_total",
		"card_dwell_unique",
		"card_dwell_top_key",
		"card_dwell_top_value",
		"navigation_length",
		"navigation_from",
		"navigation_to",
		"navigation_signature",
		"event_total",
		"event_key_down",
		"event_backspace",
		"event_pointer_move",
		"event_scroll_event",
		"event_hover_click_samples",
		"network_fingerprint",
		"geo_fingerprint",
	}
}

func buildCompactBehaviorCSVRow(row *models.BehavioralData) []string {
	qualityFlags := decodeStringSlice(row.DataQualityFlags)
	sort.Strings(qualityFlags)
	screenDwell := decodeStringFloatMap(row.ScreenDwell)
	cardDwell := decodeStringFloatMap(row.CardDwell)
	eventCounts := decodeStringFloatMap(row.EventCounts)
	navigationPath := decodeStringSlice(row.NavigationPath)

	topScreenKey, topScreenValue := topMapEntry(screenDwell)
	topCardKey, topCardValue := topMapEntry(cardDwell)

	navFrom := ""
	navTo := ""
	if len(navigationPath) > 0 {
		navFrom = navigationPath[0]
		navTo = navigationPath[len(navigationPath)-1]
	}

	return []string{
		"dfsn-compact-v1",
		strconv.FormatInt(row.CreatedAt.UTC().Unix(), 10),
		csvUint(row.UserID),
		row.SessionID,
		row.ClientDeviceID,
		row.RouteName,
		row.ScreenName,
		csvFloat(row.TypingSpeed),
		csvFloat(row.TypingVariance),
		csvFloat(row.TypingDwellMean),
		csvFloat(row.TypingFlightMean),
		csvFloat(row.BackspaceRate),
		csvFloat(row.CorrectionRate),
		csvFloat(row.MouseSpeed),
		csvFloat(row.MouseAccuracy),
		csvFloat(row.HoverClickLatency),
		csvFloat(row.ScrollDepth),
		csvFloat(row.ScrollBurstLength),
		csvFloat(row.ScrollBurstSpeed),
		csvFloat(row.SessionTime),
		csvFloat(row.WindowTime),
		csvFloat(row.ResponseLatency),
		csvInt(row.SessionHour),
		csvInt(row.SessionWeekday),
		row.Timezone,
		row.Locale,
		csvBool(row.NewDevice),
		csvBool(row.NewNetwork),
		csvBool(row.NewGeo),
		csvFloat(row.BackgroundRatio),
		row.AuthOutcomeLabel,
		row.SessionTrustLabel,
		strings.Join(qualityFlags, "|"),
		csvFloat(sumMapValues(screenDwell)),
		csvInt(len(screenDwell)),
		topScreenKey,
		csvFloat(topScreenValue),
		csvFloat(sumMapValues(cardDwell)),
		csvInt(len(cardDwell)),
		topCardKey,
		csvFloat(topCardValue),
		csvInt(len(navigationPath)),
		navFrom,
		navTo,
		navSignature(navigationPath),
		csvFloat(sumMapValues(eventCounts)),
		csvFloat(eventCounts["key_down"]),
		csvFloat(eventCounts["backspace"]),
		csvFloat(eventCounts["pointer_move"]),
		csvFloat(eventCounts["scroll_event"]),
		csvFloat(eventCounts["hover_click_samples"]),
		row.NetworkFingerprint,
		row.GeoFingerprint,
	}
}

func (h *BehaviorHandler) ExportCompactDataset(c *gin.Context) {
	filters, err := parseBehaviorExportFilters(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := database.DB.Model(&models.BehavioralData{}).Order("id asc").Limit(filters.limit)
	if !filters.startDate.IsZero() {
		query = query.Where("created_at >= ?", filters.startDate)
	}
	if !filters.endDate.IsZero() {
		query = query.Where("created_at <= ?", filters.endDate)
	}
	if filters.userID != 0 {
		query = query.Where("user_id = ?", filters.userID)
	}
	if filters.trustLabel != "" {
		query = query.Where("session_trust_label = ?", filters.trustLabel)
	}
	if filters.authOutcome != "" {
		query = query.Where("auth_outcome_label = ?", filters.authOutcome)
	}
	if filters.routeName != "" {
		query = query.Where("route_name = ?", filters.routeName)
	}

	rows, err := query.Rows()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось подготовить экспорт"})
		return
	}
	defer rows.Close()

	filename := fmt.Sprintf("dfsn-compact-export-%s.csv", time.Now().UTC().Format("20060102-150405"))
	c.Header("X-DFSN-Export-Schema", "dfsn-compact-v1")
	c.Header("X-DFSN-Export-Limit", strconv.Itoa(filters.limit))

	writerTarget := c.Writer
	if filters.gzip {
		filename += ".gz"
		c.Header("Content-Type", "application/gzip")
		c.Header("Content-Encoding", "gzip")
	} else {
		c.Header("Content-Type", "text/csv; charset=utf-8")
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Status(http.StatusOK)

	var gzipWriter *gzip.Writer
	if filters.gzip {
		gzipWriter = gzip.NewWriter(c.Writer)
		defer gzipWriter.Close()
		writerTarget = gzipWriter
	}

	csvWriter := csv.NewWriter(writerTarget)
	defer csvWriter.Flush()

	if err := csvWriter.Write(compactBehaviorCSVHeader()); err != nil {
		return
	}

	for rows.Next() {
		var row models.BehavioralData
		if err := database.DB.ScanRows(rows, &row); err != nil {
			continue
		}
		if err := csvWriter.Write(buildCompactBehaviorCSVRow(&row)); err != nil {
			return
		}
	}
}

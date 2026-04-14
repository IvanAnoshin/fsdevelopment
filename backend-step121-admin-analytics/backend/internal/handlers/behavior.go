package handlers

import (
	"encoding/json"
	"math"
	"net"
	"net/http"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/dfsn"
	"friendscape/internal/models"
	"friendscape/utils"
	"github.com/gin-gonic/gin"
)

type BehaviorHandler struct{}

type behaviorUpdateRequest struct {
	SessionID         string             `json:"session_id"`
	ClientDeviceID    string             `json:"client_device_id"`
	RouteName         string             `json:"route_name"`
	ScreenName        string             `json:"screen_name"`
	TypingSpeed       float64            `json:"typing_speed"`
	TypingVariance    float64            `json:"typing_variance"`
	TypingDwellMean   float64            `json:"typing_dwell_mean"`
	TypingFlightMean  float64            `json:"typing_flight_mean"`
	BackspaceRate     float64            `json:"backspace_rate"`
	CorrectionRate    float64            `json:"correction_rate"`
	MouseSpeed        float64            `json:"mouse_speed"`
	MouseAccuracy     float64            `json:"mouse_accuracy"`
	HoverClickLatency float64            `json:"hover_click_latency"`
	ScrollDepth       float64            `json:"scroll_depth"`
	ScrollBurstLength float64            `json:"scroll_burst_length"`
	ScrollBurstSpeed  float64            `json:"scroll_burst_speed"`
	SessionTime       float64            `json:"session_time"`
	WindowTime        float64            `json:"window_time"`
	ResponseLatency   float64            `json:"response_latency"`
	SessionHour       int                `json:"session_hour"`
	SessionWeekday    int                `json:"session_weekday"`
	Timezone          string             `json:"timezone"`
	Locale            string             `json:"locale"`
	BackgroundRatio   float64            `json:"background_ratio"`
	AuthOutcomeLabel  string             `json:"auth_outcome_label"`
	DataQualityFlags  []string           `json:"data_quality_flags"`
	ScreenDwell       map[string]float64 `json:"screen_dwell"`
	CardDwell         map[string]float64 `json:"dwell_per_card"`
	NavigationPath    []string           `json:"navigation_path"`
	EventCounts       map[string]float64 `json:"event_counts"`
	Pattern           map[string]any     `json:"pattern"`
}

type behaviorBatchRequest struct {
	Reason  string                  `json:"reason"`
	Samples []behaviorUpdateRequest `json:"samples"`
}

type behaviorBatchContext struct {
	clientIP          string
	acceptLanguage    string
	knownDevices      map[string]bool
	knownNetworks     map[string]bool
	knownGeos         map[string]bool
	persistedDevices  map[string]bool
	persistedNetworks map[string]bool
	persistedGeos     map[string]bool
}

func NewBehaviorHandler() *BehaviorHandler {
	return &BehaviorHandler{}
}

func marshalJSON(v any) string {
	if v == nil {
		return ""
	}
	encoded, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func normalizeLabel(value, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	if len(trimmed) > 64 {
		return fallback
	}
	return trimmed
}

func clampFloat(value, min, max float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return min
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(strings.ToLower(value))
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	return out
}

func networkFingerprint(ip string) string {
	parsed := net.ParseIP(strings.TrimSpace(ip))
	if parsed == nil {
		return ""
	}
	if v4 := parsed.To4(); v4 != nil {
		return utils.GenerateHash(net.IPv4(v4[0], v4[1], v4[2], 0).String() + "/24")
	}
	masked := parsed.Mask(net.CIDRMask(64, 128))
	if masked == nil {
		return ""
	}
	return utils.GenerateHash(masked.String() + "/64")
}

func geoFingerprint(timezone, locale, acceptLanguage string) string {
	parts := []string{
		strings.TrimSpace(strings.ToLower(timezone)),
		strings.TrimSpace(strings.ToLower(locale)),
		strings.TrimSpace(strings.ToLower(acceptLanguage)),
	}
	joined := strings.Join(parts, "|")
	if strings.Trim(joined, "|") == "" {
		return ""
	}
	return utils.GenerateHash(joined)
}

func loadKnownBehaviorKeys(userID uint) (map[string]bool, map[string]bool, map[string]bool) {
	devices := map[string]bool{}
	networks := map[string]bool{}
	geos := map[string]bool{}
	if userID == 0 {
		return devices, networks, geos
	}

	var rows []struct {
		ClientDeviceID     string
		NetworkFingerprint string
		GeoFingerprint     string
	}
	database.DB.Model(&models.BehavioralData{}).
		Select("client_device_id, network_fingerprint, geo_fingerprint").
		Where("user_id = ?", userID).
		Order("created_at desc").
		Limit(500).
		Find(&rows)
	for _, row := range rows {
		if row.ClientDeviceID != "" {
			devices[row.ClientDeviceID] = true
		}
		if row.NetworkFingerprint != "" {
			networks[row.NetworkFingerprint] = true
		}
		if row.GeoFingerprint != "" {
			geos[row.GeoFingerprint] = true
		}
	}
	return devices, networks, geos
}

func deriveQualityFlags(req behaviorUpdateRequest) []string {
	flags := append([]string{}, req.DataQualityFlags...)
	keydownCount := req.EventCounts["key_down"]
	pointerMoves := req.EventCounts["pointer_move"]
	scrollEvents := req.EventCounts["scroll_event"]
	hoverSamples := req.EventCounts["hover_click_samples"]

	if req.WindowTime < 8 {
		flags = append(flags, "short_window")
	}
	if keydownCount < 3 {
		flags = append(flags, "low_keyboard_signal")
	}
	if pointerMoves < 5 {
		flags = append(flags, "low_pointer_signal")
	}
	if scrollEvents < 2 {
		flags = append(flags, "low_scroll_signal")
	}
	if hoverSamples < 1 {
		flags = append(flags, "missing_hover_signal")
	}
	if len(req.ScreenDwell) == 0 {
		flags = append(flags, "missing_screen_dwell")
	}
	if len(req.CardDwell) == 0 {
		flags = append(flags, "missing_card_dwell")
	}
	if req.BackgroundRatio > 0.45 {
		flags = append(flags, "background_heavy")
	}
	if req.ResponseLatency <= 0 && strings.HasPrefix(req.RouteName, "/messages") {
		flags = append(flags, "missing_chat_latency")
	}
	return uniqueStrings(flags)
}

func deriveSessionTrustLabel(req behaviorUpdateRequest, qualityFlags []string, newDevice, newNetwork, newGeo bool) string {
	flagSet := map[string]bool{}
	for _, flag := range qualityFlags {
		flagSet[flag] = true
	}

	authLabel := normalizeLabel(req.AuthOutcomeLabel, "authenticated_session")
	if newNetwork && newGeo {
		return "suspicious"
	}
	if authLabel == "login_success_backup_code" && (newDevice || newNetwork || newGeo) {
		return "suspicious"
	}
	if flagSet["background_heavy"] && (flagSet["low_keyboard_signal"] || flagSet["low_pointer_signal"]) {
		return "suspicious"
	}
	if newDevice || newNetwork || newGeo {
		return "uncertain"
	}
	if flagSet["short_window"] || flagSet["low_keyboard_signal"] || flagSet["low_pointer_signal"] {
		return "uncertain"
	}
	return "trusted"
}

func buildDFSNSession(userID uint, req behaviorUpdateRequest) *dfsn.BehavioralSession {
	delay := req.TypingFlightMean
	if delay <= 0 && req.TypingSpeed > 0 {
		delay = 60000.0 / req.TypingSpeed
	}
	if delay <= 0 {
		delay = 180
	}
	varianceDelay := delay + math.Sqrt(math.Max(req.TypingVariance, 0))
	now := time.Now()

	session := &dfsn.BehavioralSession{
		UserID:       userID,
		StartTime:    now.Add(-time.Duration(clampFloat(req.WindowTime, 1, 900)) * time.Second),
		EndTime:      now,
		TypingEvents: []dfsn.TypingEvent{{Timestamp: now.Add(-2 * time.Second).UnixMilli(), Key: "a", Delay: delay}, {Timestamp: now.Add(-1 * time.Second).UnixMilli(), Key: "b", Delay: varianceDelay}},
		MouseEvents:  []dfsn.MouseEvent{{Timestamp: now.Add(-1500 * time.Millisecond).UnixMilli(), X: 0, Y: 0, Speed: req.MouseSpeed}, {Timestamp: now.Add(-1 * time.Second).UnixMilli(), X: 12, Y: 8, Speed: req.MouseSpeed}, {Timestamp: now.Add(-500 * time.Millisecond).UnixMilli(), X: 18, Y: 12, Speed: req.MouseSpeed}},
		ScrollEvents: []dfsn.ScrollEvent{{Timestamp: now.Add(-700 * time.Millisecond).UnixMilli(), Delta: int(req.ScrollDepth * 100), Speed: req.ScrollBurstSpeed}},
	}
	return session
}

func normalizeBehaviorRequest(req *behaviorUpdateRequest, c *gin.Context) {
	if req.SessionHour < 0 || req.SessionHour > 23 {
		req.SessionHour = time.Now().Hour()
	}
	if req.SessionWeekday < 0 || req.SessionWeekday > 6 {
		req.SessionWeekday = int(time.Now().Weekday())
	}
	if strings.TrimSpace(req.RouteName) == "" {
		req.RouteName = c.GetHeader("X-Client-Route")
	}
	if strings.TrimSpace(req.ScreenName) == "" {
		req.ScreenName = req.RouteName
	}
	if strings.TrimSpace(req.ClientDeviceID) == "" {
		req.ClientDeviceID = generateDeviceID(c)
	}
	if strings.TrimSpace(req.SessionID) == "" {
		req.SessionID = utils.GenerateHash(req.ClientDeviceID + time.Now().UTC().Format("2006-01-02"))
	}
}

func newBehaviorBatchContext(userID uint, c *gin.Context) *behaviorBatchContext {
	knownDevices, knownNetworks, knownGeos := loadKnownBehaviorKeys(userID)
	return &behaviorBatchContext{
		clientIP:          c.ClientIP(),
		acceptLanguage:    c.GetHeader("Accept-Language"),
		knownDevices:      knownDevices,
		knownNetworks:     knownNetworks,
		knownGeos:         knownGeos,
		persistedDevices:  map[string]bool{},
		persistedNetworks: map[string]bool{},
		persistedGeos:     map[string]bool{},
	}
}

func buildBehavioralData(userID uint, req behaviorUpdateRequest, ctx *behaviorBatchContext) (*models.BehavioralData, string, string) {
	if req.SessionHour < 0 || req.SessionHour > 23 {
		req.SessionHour = time.Now().Hour()
	}
	if req.SessionWeekday < 0 || req.SessionWeekday > 6 {
		req.SessionWeekday = int(time.Now().Weekday())
	}

	networkFP := networkFingerprint(ctx.clientIP)
	geoFP := geoFingerprint(req.Timezone, req.Locale, ctx.acceptLanguage)
	newDevice := strings.TrimSpace(req.ClientDeviceID) != "" && !ctx.knownDevices[req.ClientDeviceID]
	newNetwork := networkFP != "" && !ctx.knownNetworks[networkFP]
	newGeo := geoFP != "" && !ctx.knownGeos[geoFP]

	qualityFlags := deriveQualityFlags(req)
	authOutcome := normalizeLabel(req.AuthOutcomeLabel, "authenticated_session")
	sessionTrust := deriveSessionTrustLabel(req, qualityFlags, newDevice, newNetwork, newGeo)

	if req.Pattern == nil {
		req.Pattern = map[string]any{}
	}
	req.Pattern["window_time"] = clampFloat(req.WindowTime, 0, 7200)
	req.Pattern["quality_flags_count"] = len(qualityFlags)
	req.Pattern["new_device"] = newDevice
	req.Pattern["new_network"] = newNetwork
	req.Pattern["new_geo"] = newGeo

	row := &models.BehavioralData{
		UserID:             userID,
		SessionID:          req.SessionID,
		ClientDeviceID:     strings.TrimSpace(req.ClientDeviceID),
		RouteName:          strings.TrimSpace(req.RouteName),
		ScreenName:         strings.TrimSpace(req.ScreenName),
		TypingSpeed:        clampFloat(req.TypingSpeed, 0, 3000),
		TypingVariance:     clampFloat(req.TypingVariance, 0, 1000000),
		TypingDwellMean:    clampFloat(req.TypingDwellMean, 0, 5000),
		TypingFlightMean:   clampFloat(req.TypingFlightMean, 0, 5000),
		BackspaceRate:      clampFloat(req.BackspaceRate, 0, 1),
		CorrectionRate:     clampFloat(req.CorrectionRate, 0, 1),
		MouseSpeed:         clampFloat(req.MouseSpeed, 0, 100000),
		MouseAccuracy:      clampFloat(req.MouseAccuracy, 0, 1),
		HoverClickLatency:  clampFloat(req.HoverClickLatency, 0, 60000),
		ScrollDepth:        clampFloat(req.ScrollDepth, 0, 1),
		ScrollBurstLength:  clampFloat(req.ScrollBurstLength, 0, 10000),
		ScrollBurstSpeed:   clampFloat(req.ScrollBurstSpeed, 0, 100000),
		SessionTime:        clampFloat(req.SessionTime, 0, 86400),
		WindowTime:         clampFloat(req.WindowTime, 0, 7200),
		ResponseLatency:    clampFloat(req.ResponseLatency, 0, 86400000),
		SessionHour:        req.SessionHour,
		SessionWeekday:     req.SessionWeekday,
		Timezone:           strings.TrimSpace(req.Timezone),
		Locale:             strings.TrimSpace(req.Locale),
		NewDevice:          newDevice,
		NewNetwork:         newNetwork,
		NewGeo:             newGeo,
		BackgroundRatio:    clampFloat(req.BackgroundRatio, 0, 1),
		AuthOutcomeLabel:   authOutcome,
		SessionTrustLabel:  sessionTrust,
		DataQualityFlags:   marshalJSON(qualityFlags),
		ScreenDwell:        marshalJSON(req.ScreenDwell),
		CardDwell:          marshalJSON(req.CardDwell),
		NavigationPath:     marshalJSON(req.NavigationPath),
		EventCounts:        marshalJSON(req.EventCounts),
		NetworkFingerprint: networkFP,
		GeoFingerprint:     geoFP,
		Pattern:            marshalJSON(req.Pattern),
	}

	ctx.persistedDevices[row.ClientDeviceID] = true
	if networkFP != "" {
		ctx.persistedNetworks[networkFP] = true
	}
	if geoFP != "" {
		ctx.persistedGeos[geoFP] = true
	}

	return row, authOutcome, sessionTrust
}

func (h *BehaviorHandler) UpdateBehavior(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}
	userID := userIDValue.(uint)

	var req behaviorUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}
	normalizeBehaviorRequest(&req, c)

	ctx := newBehaviorBatchContext(userID, c)
	row, authOutcome, sessionTrust := buildBehavioralData(userID, req, ctx)
	if err := database.DB.Create(row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка сохранения"})
		return
	}

	network := dfsn.GetNetwork()
	network.UpdateProfile(userID, buildDFSNSession(userID, req))
	ctx.knownDevices[row.ClientDeviceID] = true
	if row.NetworkFingerprint != "" {
		ctx.knownNetworks[row.NetworkFingerprint] = true
	}
	if row.GeoFingerprint != "" {
		ctx.knownGeos[row.GeoFingerprint] = true
	}

	c.JSON(http.StatusOK, gin.H{
		"message":             "Поведенческие данные сохранены",
		"session_id":          row.SessionID,
		"client_device_id":    row.ClientDeviceID,
		"auth_outcome_label":  authOutcome,
		"session_trust_label": sessionTrust,
		"new_device":          row.NewDevice,
		"new_network":         row.NewNetwork,
		"new_geo":             row.NewGeo,
		"network_fingerprint": row.NetworkFingerprint,
		"geo_fingerprint":     row.GeoFingerprint,
	})
}

func (h *BehaviorHandler) UpdateBehaviorBatch(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}
	userID := userIDValue.(uint)

	var req behaviorBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}
	if len(req.Samples) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нет данных для сохранения"})
		return
	}
	if len(req.Samples) > 12 {
		req.Samples = req.Samples[:12]
	}

	ctx := newBehaviorBatchContext(userID, c)
	rows := make([]models.BehavioralData, 0, len(req.Samples))
	lastAuthOutcome := "authenticated_session"
	lastSessionTrust := "uncertain"
	var profileSample *behaviorUpdateRequest

	for i := range req.Samples {
		normalizeBehaviorRequest(&req.Samples[i], c)
		row, authOutcome, sessionTrust := buildBehavioralData(userID, req.Samples[i], ctx)
		rows = append(rows, *row)
		ctx.knownDevices[row.ClientDeviceID] = true
		if row.NetworkFingerprint != "" {
			ctx.knownNetworks[row.NetworkFingerprint] = true
		}
		if row.GeoFingerprint != "" {
			ctx.knownGeos[row.GeoFingerprint] = true
		}
		lastAuthOutcome = authOutcome
		lastSessionTrust = sessionTrust
		if profileSample == nil || (row.WindowTime >= profileSample.WindowTime && row.EventCounts != "") {
			copyReq := req.Samples[i]
			profileSample = &copyReq
		}
	}

	if err := database.DB.CreateInBatches(&rows, 12).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка сохранения"})
		return
	}

	if profileSample != nil {
		network := dfsn.GetNetwork()
		network.UpdateProfile(userID, buildDFSNSession(userID, *profileSample))
	}

	c.JSON(http.StatusOK, gin.H{
		"message":             "Пакет поведенческих данных сохранён",
		"saved":               len(rows),
		"reason":              normalizeLabel(req.Reason, "batch"),
		"auth_outcome_label":  lastAuthOutcome,
		"session_trust_label": lastSessionTrust,
	})
}

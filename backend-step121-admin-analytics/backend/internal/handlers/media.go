package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/media"
	"friendscape/internal/models"
	"github.com/gin-gonic/gin"
)

const maxImageBytes = 10 << 20
const maxVideoAssetBytes = 96 << 20
const maxVoiceBytes = 8 << 20
const maxVideoNoteBytes = 24 << 20
const maxVideoThumbBytes = 1 << 20

type MediaHandler struct{ storage media.Storage }

func NewMediaHandler() *MediaHandler { return &MediaHandler{storage: media.NewStorage()} }

func (h *MediaHandler) GetConfig(c *gin.Context) {
	heicEnabled, heicNote := media.HEICSupport()
	c.JSON(http.StatusOK, gin.H{
		"driver":          h.storage.Driver(),
		"max_image_bytes": maxImageBytes,
		"max_video_bytes": maxVideoAssetBytes,
		"image_types":     []string{"image/jpeg", "image/png", "image/heic", "image/heif"},
		"video_types":     []string{"video/mp4", "video/webm", "video/quicktime", "video/ogg"},
		"supports_direct": h.storage.Driver() != "",
		"heic_enabled":    heicEnabled,
		"heic_note":       heicNote,
		"profiles": []gin.H{
			{"name": "thumb", "max_width": 320},
			{"name": "display", "max_width": 960},
			{"name": "full", "max_width": 1920},
		},
		"notes": []string{
			"Сервер автоматически убирает метаданные и пересобирает изображения в экономичные варианты.",
			"HEIC/HEIF автоматически конвертируются на сервере в оптимизированные web-варианты.",
			"Для постов и ленты лучше сохранять объект media payload, а не исходный большой URL.",
		},
	})
}

func (h *MediaHandler) CreateUploadDraft(c *gin.Context) {
	userID, _ := c.Get("user_id")
	var req struct {
		Filename string `json:"filename"`
		Kind     string `json:"kind"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные загрузки"})
		return
	}
	kind := strings.TrimSpace(strings.ToLower(req.Kind))
	if kind == "" {
		kind = "images"
	}
	filename := strings.TrimSpace(req.Filename)
	if filename == "" {
		filename = "upload" + filepath.Ext(req.Filename)
	}
	objectKey := h.storage.NewObjectKey(userID.(uint), kind, filename)
	c.JSON(http.StatusOK, gin.H{
		"driver":       h.storage.Driver(),
		"object_key":   objectKey,
		"public_url":   h.storage.PublicURL(objectKey),
		"upload_url":   "/api/media/upload",
		"expires_in_s": 900,
	})
}

func (h *MediaHandler) UploadImage(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}
	userID := userIDValue.(uint)

	kind := strings.TrimSpace(strings.ToLower(c.PostForm("kind")))
	if kind == "" {
		kind = "images"
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Файл не найден"})
		return
	}

	if strings.HasPrefix(kind, "video") || strings.Contains(kind, "clip") {
		h.uploadVideoAsset(c, userID, fileHeader)
		return
	}

	raw, mimeType, err := readUploadedImage(fileHeader)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hash := media.HashBytes(raw)
	if payload, ok := h.existingAssetPayload(hash); ok {
		c.JSON(http.StatusOK, gin.H{
			"message":          "Файл уже есть, используем сохранённую оптимизированную версию",
			"deduplicated":     true,
			"storage_strategy": mediaStorageStrategy(),
			"asset":            payload,
		})
		return
	}

	optimized, err := media.OptimizeImage(h.storage, kind, raw, fileHeader.Filename, mimeType)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Не удалось оптимизировать изображение: %v", err)})
		return
	}

	variantsJSON, _ := json.Marshal(optimized.Variants)
	storedFormat := "jpeg"
	if len(optimized.Variants) > 0 {
		storedFormat = optimized.Variants[0].Format
	}
	asset := models.MediaAsset{
		OwnerID:          userID,
		Kind:             kind,
		ContentHash:      optimized.Hash,
		OriginalFilename: strings.TrimSpace(fileHeader.Filename),
		OriginalMime:     mimeType,
		StoredFormat:     storedFormat,
		Width:            optimized.Width,
		Height:           optimized.Height,
		OriginalBytes:    optimized.OriginalBytes,
		StoredBytes:      optimized.OriginalBytes - optimized.SavedBytes,
		VariantsJSON:     string(variantsJSON),
	}
	if err := database.DB.Create(&asset).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить медиа-метаданные"})
		return
	}

	payload := buildAssetPayload(asset, optimized.Variants)
	c.JSON(http.StatusOK, gin.H{
		"message":          "Изображение оптимизировано и сохранено",
		"deduplicated":     false,
		"storage_strategy": mediaStorageStrategy(),
		"asset":            payload,
	})
}

func (h *MediaHandler) uploadVideoAsset(c *gin.Context, userID uint, fileHeader *multipart.FileHeader) {
	raw, mimeType, err := readUploadedBinary(fileHeader, maxVideoAssetBytes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !isSupportedUploadVideo(fileHeader.Filename, mimeType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Поддерживаются mp4, webm, mov и ogv"})
		return
	}

	hash := media.HashBytes(raw)
	if payload, ok := h.existingAssetPayload(hash); ok {
		c.JSON(http.StatusOK, gin.H{
			"message":          "Видео уже есть, используем сохранённую версию",
			"deduplicated":     true,
			"storage_strategy": mediaStorageStrategy(),
			"asset":            payload,
		})
		return
	}

	ext := videoExtensionForMime(mimeType, fileHeader.Filename)
	objectKey := media.ContentAddressKey("videos", hash, "full", ext)
	if err := h.storage.WriteObject(objectKey, raw); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить видео"})
		return
	}

	meta := media.EffectiveMessageMediaMetadata(raw, mimeType, "video_note", 0, 0, 0)
	variants := []media.Variant{{
		Name:   "full",
		Width:  meta.Width,
		Height: meta.Height,
		Bytes:  int64(len(raw)),
		Format: strings.TrimPrefix(ext, "."),
		Path:   objectKey,
		URL:    h.storage.PublicURL(objectKey),
	}}
	if len(meta.PosterJPEG) > 0 {
		posterHash := media.HashBytes(meta.PosterJPEG)
		posterKey := media.ContentAddressKey("videos-thumb", posterHash, "thumb", ".jpg")
		if err := h.storage.WriteObject(posterKey, meta.PosterJPEG); err == nil {
			variants = append([]media.Variant{{
				Name:   "thumb",
				Width:  320,
				Height: 0,
				Bytes:  int64(len(meta.PosterJPEG)),
				Format: "jpeg",
				Path:   posterKey,
				URL:    h.storage.PublicURL(posterKey),
			}}, variants...)
		}
	}

	variantsJSON, _ := json.Marshal(variants)
	asset := models.MediaAsset{
		OwnerID:          userID,
		Kind:             "video",
		ContentHash:      hash,
		OriginalFilename: strings.TrimSpace(fileHeader.Filename),
		OriginalMime:     mimeType,
		StoredFormat:     strings.TrimPrefix(ext, "."),
		Width:            meta.Width,
		Height:           meta.Height,
		OriginalBytes:    int64(len(raw)),
		StoredBytes:      int64(len(raw)),
		VariantsJSON:     string(variantsJSON),
	}
	if err := database.DB.Create(&asset).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить видео-метаданные"})
		return
	}

	payload := buildAssetPayload(asset, variants)
	c.JSON(http.StatusOK, gin.H{
		"message":          "Видео сохранено",
		"deduplicated":     false,
		"storage_strategy": mediaStorageStrategy(),
		"asset":            payload,
	})
}

func (h *MediaHandler) UploadMessageMedia(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}
	userID := userIDValue.(uint)

	kind := strings.TrimSpace(strings.ToLower(c.PostForm("kind")))
	if kind == "audio" || kind == "voice_note" {
		kind = "voice"
	}
	if kind == "video" || kind == "video-circle" || kind == "videocircle" {
		kind = "video_note"
	}
	if kind != "voice" && kind != "video_note" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Поддерживаются только voice и video_note"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Файл не найден"})
		return
	}
	raw, mimeType, err := readUploadedBinary(fileHeader, messageMediaMaxBytes(kind))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !isAllowedMessageMime(kind, mimeType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неподдерживаемый формат медиа"})
		return
	}

	hash := media.HashBytes(raw)
	ext := messageMediaExtension(fileHeader.Filename, mimeType)
	objectKey := media.ContentAddressKey("message-media", hash, kind, ext)
	if err := h.storage.WriteObject(objectKey, raw); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить файл"})
		return
	}

	durationSec, _ := strconv.Atoi(strings.TrimSpace(c.PostForm("duration_sec")))
	width, _ := strconv.Atoi(strings.TrimSpace(c.PostForm("width")))
	height, _ := strconv.Atoi(strings.TrimSpace(c.PostForm("height")))
	if durationSec < 0 {
		durationSec = 0
	}
	if width < 0 {
		width = 0
	}
	if height < 0 {
		height = 0
	}
	meta := media.EffectiveMessageMediaMetadata(raw, mimeType, kind, durationSec, width, height)
	durationSec = meta.DurationSec
	width = meta.Width
	height = meta.Height
	if kind == "voice" && durationSec > media.MaxVoiceDurationSec() {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Голосовое сообщение слишком длинное: максимум %d сек.", media.MaxVoiceDurationSec())})
		return
	}
	if kind == "video_note" && durationSec > media.MaxVideoNoteDurationSec() {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Видеокружок слишком длинный: максимум %d сек.", media.MaxVideoNoteDurationSec())})
		return
	}

	thumbURL := ""
	if kind == "video_note" {
		thumbBytes := []byte(nil)
		thumbExt := ".jpg"
		if thumbHeader, err := c.FormFile("thumb"); err == nil && thumbHeader != nil {
			thumbRaw, thumbMime, thumbErr := readUploadedBinary(thumbHeader, maxVideoThumbBytes)
			if thumbErr == nil && strings.HasPrefix(thumbMime, "image/") {
				thumbBytes = thumbRaw
				thumbExt = messageMediaExtension(thumbHeader.Filename, thumbMime)
			}
		}
		if len(thumbBytes) == 0 && len(meta.PosterJPEG) > 0 {
			thumbBytes = meta.PosterJPEG
			thumbExt = ".jpg"
		}
		if len(thumbBytes) > 0 {
			thumbHash := media.HashBytes(thumbBytes)
			thumbKey := media.ContentAddressKey("message-media-thumb", thumbHash, "poster", thumbExt)
			if err := h.storage.WriteObject(thumbKey, thumbBytes); err == nil {
				thumbURL = h.storage.PublicURL(thumbKey)
			}
		}
	}

	payload := gin.H{
		"kind":               kind,
		"url":                h.storage.PublicURL(objectKey),
		"thumb_url":          thumbURL,
		"mime":               mimeType,
		"duration_sec":       durationSec,
		"width":              width,
		"height":             height,
		"bytes":              len(raw),
		"owner_id":           userID,
		"hash":               hash,
		"metadata_source":    meta.Source,
		"server_poster_used": thumbURL != "" && len(meta.PosterJPEG) > 0,
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "Медиа для сообщения сохранено",
		"asset":   payload,
	})
}

func (h *MediaHandler) UploadEncryptedMessageMedia(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не авторизован"})
		return
	}
	userID := userIDValue.(uint)

	kind := strings.TrimSpace(strings.ToLower(c.PostForm("kind")))
	if kind == "audio" || kind == "voice_note" {
		kind = "voice"
	}
	if kind == "video" || kind == "video-circle" || kind == "videocircle" {
		kind = "video_note"
	}
	if kind != "voice" && kind != "video_note" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Поддерживаются только voice и video_note"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Файл не найден"})
		return
	}
	raw, _, err := readUploadedBinary(fileHeader, messageMediaMaxBytes(kind))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hash := media.HashBytes(raw)
	objectKey := media.ContentAddressKey("message-media-encrypted", hash, kind, ".bin")
	if err := h.storage.WriteObject(objectKey, raw); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить encrypted media"})
		return
	}

	durationSec, _ := strconv.Atoi(strings.TrimSpace(c.PostForm("duration_sec")))
	width, _ := strconv.Atoi(strings.TrimSpace(c.PostForm("width")))
	height, _ := strconv.Atoi(strings.TrimSpace(c.PostForm("height")))
	if durationSec < 0 {
		durationSec = 0
	}
	if width < 0 {
		width = 0
	}
	if height < 0 {
		height = 0
	}

	thumbURL := ""
	if thumbHeader, err := c.FormFile("thumb"); err == nil && thumbHeader != nil {
		thumbRaw, _, thumbErr := readUploadedBinary(thumbHeader, maxVideoThumbBytes)
		if thumbErr == nil && len(thumbRaw) > 0 {
			thumbHash := media.HashBytes(thumbRaw)
			thumbKey := media.ContentAddressKey("message-media-encrypted-thumb", thumbHash, "poster", ".bin")
			if err := h.storage.WriteObject(thumbKey, thumbRaw); err == nil {
				thumbURL = h.storage.PublicURL(thumbKey)
			}
		}
	}

	payload := gin.H{
		"kind":         kind,
		"url":          h.storage.PublicURL(objectKey),
		"thumb_url":    thumbURL,
		"mime":         strings.TrimSpace(c.PostForm("original_mime")),
		"duration_sec": durationSec,
		"width":        width,
		"height":       height,
		"bytes":        len(raw),
		"owner_id":     userID,
		"hash":         hash,
		"encrypted":    true,
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "Encrypted media сохранено",
		"asset":   payload,
	})
}

func messageMediaMaxBytes(kind string) int64 {
	if kind == "video_note" {
		return maxVideoNoteBytes
	}
	return maxVoiceBytes
}

func readUploadedBinary(fileHeader *multipart.FileHeader, maxBytes int64) ([]byte, string, error) {
	if fileHeader.Size <= 0 {
		return nil, "", fmt.Errorf("пустой файл")
	}
	if fileHeader.Size > maxBytes {
		return nil, "", fmt.Errorf("файл слишком большой")
	}
	fh, err := fileHeader.Open()
	if err != nil {
		return nil, "", fmt.Errorf("не удалось открыть файл")
	}
	defer fh.Close()
	raw, err := io.ReadAll(io.LimitReader(fh, maxBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("не удалось прочитать файл")
	}
	if int64(len(raw)) > maxBytes {
		return nil, "", fmt.Errorf("файл слишком большой")
	}
	mimeType := http.DetectContentType(raw)
	return raw, strings.ToLower(strings.TrimSpace(mimeType)), nil
}

func isAllowedMessageMime(kind string, mimeType string) bool {
	if kind == "voice" {
		return strings.HasPrefix(mimeType, "audio/webm") || strings.HasPrefix(mimeType, "audio/ogg") || strings.HasPrefix(mimeType, "audio/mp4") || strings.HasPrefix(mimeType, "audio/mpeg")
	}
	return strings.HasPrefix(mimeType, "video/webm") || strings.HasPrefix(mimeType, "video/mp4") || strings.HasPrefix(mimeType, "video/quicktime")
}

func messageMediaExtension(filename string, mimeType string) string {
	name := strings.ToLower(strings.TrimSpace(filename))
	if ext := filepath.Ext(name); ext != "" {
		return ext
	}
	switch {
	case strings.Contains(mimeType, "audio/ogg"):
		return ".ogg"
	case strings.Contains(mimeType, "audio/mp4"):
		return ".m4a"
	case strings.Contains(mimeType, "audio/mpeg"):
		return ".mp3"
	case strings.Contains(mimeType, "video/mp4"):
		return ".mp4"
	default:
		return ".webm"
	}
}

func (h *MediaHandler) existingAssetPayload(hash string) (gin.H, bool) {
	var asset models.MediaAsset
	if err := database.DB.Where("content_hash = ?", hash).First(&asset).Error; err != nil {
		return nil, false
	}
	variants, err := parseVariants(asset.VariantsJSON)
	if err != nil {
		return nil, false
	}
	return buildAssetPayload(asset, variants), true
}

func readUploadedImage(fileHeader *multipart.FileHeader) ([]byte, string, error) {
	if fileHeader.Size <= 0 {
		return nil, "", fmt.Errorf("пустой файл")
	}
	if fileHeader.Size > maxImageBytes {
		return nil, "", fmt.Errorf("файл слишком большой: максимум %d МБ", maxImageBytes>>20)
	}
	fh, err := fileHeader.Open()
	if err != nil {
		return nil, "", fmt.Errorf("не удалось открыть файл")
	}
	defer fh.Close()
	raw, err := io.ReadAll(io.LimitReader(fh, maxImageBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("не удалось прочитать файл")
	}
	if int64(len(raw)) > maxImageBytes {
		return nil, "", fmt.Errorf("файл слишком большой: максимум %d МБ", maxImageBytes>>20)
	}
	mimeType := media.DetectUploadMime(raw, fileHeader.Filename)
	if !media.IsSupportedUploadImage(raw, fileHeader.Filename, mimeType) {
		return nil, "", fmt.Errorf("поддерживаются JPEG, PNG и HEIC")
	}
	return raw, mimeType, nil
}

func isSupportedUploadVideo(filename string, mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	filename = strings.ToLower(strings.TrimSpace(filename))
	if strings.HasPrefix(mimeType, "video/mp4") || strings.HasPrefix(mimeType, "video/webm") || strings.HasPrefix(mimeType, "video/quicktime") || strings.HasPrefix(mimeType, "video/ogg") {
		return true
	}
	return strings.HasSuffix(filename, ".mp4") || strings.HasSuffix(filename, ".webm") || strings.HasSuffix(filename, ".mov") || strings.HasSuffix(filename, ".ogv")
}

func videoExtensionForMime(mimeType, filename string) string {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	switch {
	case strings.Contains(mimeType, "video/webm"):
		return ".webm"
	case strings.Contains(mimeType, "video/quicktime"):
		return ".mov"
	case strings.Contains(mimeType, "video/ogg"):
		return ".ogv"
	case strings.Contains(mimeType, "video/mp4"):
		return ".mp4"
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == ".mp4" || ext == ".webm" || ext == ".mov" || ext == ".ogv" {
		return ext
	}
	return ".mp4"
}

func parseVariants(raw string) ([]media.Variant, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var variants []media.Variant
	if err := json.Unmarshal([]byte(raw), &variants); err != nil {
		return nil, err
	}
	return variants, nil
}

func buildAssetPayload(asset models.MediaAsset, variants []media.Variant) gin.H {
	isVideo := strings.EqualFold(strings.TrimSpace(asset.Kind), "video")
	thumb := variantByPriority(variants, "thumb", "display", "full")
	displayPriority := []string{"display", "full", "thumb"}
	if isVideo {
		displayPriority = []string{"full", "display", "thumb"}
	}
	display := variantByPriority(variants, displayPriority...)
	full := variantByPriority(variants, "full", "display", "thumb")
	saved := asset.OriginalBytes - asset.StoredBytes
	if saved < 0 {
		saved = 0
	}
	kind := "image"
	if isVideo {
		kind = "video"
	}
	return gin.H{
		"id":                asset.ID,
		"kind":              kind,
		"hash":              asset.ContentHash,
		"width":             asset.Width,
		"height":            asset.Height,
		"original_mime":     asset.OriginalMime,
		"original_bytes":    asset.OriginalBytes,
		"stored_bytes":      asset.StoredBytes,
		"saved_bytes":       saved,
		"compression_ratio": compressionRatio(asset.OriginalBytes, asset.StoredBytes),
		"display_url":       display.URL,
		"full_url":          full.URL,
		"thumb_url":         thumb.URL,
		"variants":          variants,
		"post_payload": gin.H{
			"kind":      kind,
			"asset_id":  asset.ID,
			"hash":      asset.ContentHash,
			"mime":      asset.OriginalMime,
			"width":     asset.Width,
			"height":    asset.Height,
			"display":   display,
			"full":      full,
			"thumb":     thumb,
			"poster":    thumb,
			"variants":  variants,
			"src":       display.URL,
			"full_src":  full.URL,
			"thumb_src": thumb.URL,
		},
	}
}

func mediaStorageStrategy() gin.H {
	return gin.H{
		"deduplication":           "sha256 content hash",
		"metadata_stripped":       true,
		"responsive_variants":     []string{"thumb", "display", "full"},
		"serve_smallest_possible": true,
		"keep_original_binary":    false,
	}
}

func variantByPriority(variants []media.Variant, names ...string) media.Variant {
	for _, name := range names {
		for _, variant := range variants {
			if variant.Name == name {
				return variant
			}
		}
	}
	if len(variants) > 0 {
		return variants[len(variants)-1]
	}
	return media.Variant{}
}

func compressionRatio(original, stored int64) float64 {
	if original <= 0 || stored <= 0 {
		return 1
	}
	return float64(original) / float64(stored)
}

type userMediaListItem struct {
	SourcePostID          uint           `json:"source_post_id"`
	SourcePostDate        string         `json:"source_post_date"`
	SourcePostText        string         `json:"source_post_text"`
	SourcePostLikes       int            `json:"source_post_likes"`
	SourcePostComments    int            `json:"source_post_comments"`
	SourcePostScore       int            `json:"source_post_score"`
	SourcePostHasComments bool           `json:"source_post_has_comments"`
	OwnerID               uint           `json:"owner_id"`
	OwnerUsername         string         `json:"owner_username"`
	Kind                  string         `json:"kind"`
	SearchText            string         `json:"-"`
	Payload               map[string]any `json:"-"`
}

func inferProfileMediaKind(item map[string]any) string {
	for _, key := range []string{"kind", "type", "media_kind"} {
		if value := strings.ToLower(strings.TrimSpace(fmt.Sprint(item[key]))); value != "" {
			if strings.Contains(value, "video") {
				return "video"
			}
			if value == "image" || value == "photo" || value == "images" {
				return "image"
			}
		}
	}
	for _, key := range []string{"mime", "original_mime", "media_mime"} {
		if value := strings.ToLower(strings.TrimSpace(fmt.Sprint(item[key]))); strings.HasPrefix(value, "video/") {
			return "video"
		}
	}
	for _, key := range []string{"src", "url", "full_url", "display_url", "thumb_url", "poster_url"} {
		value := strings.ToLower(strings.TrimSpace(fmt.Sprint(item[key])))
		if strings.HasSuffix(value, ".mp4") || strings.HasSuffix(value, ".webm") || strings.HasSuffix(value, ".mov") || strings.HasSuffix(value, ".m4v") || strings.HasSuffix(value, ".ogv") {
			return "video"
		}
	}
	return "image"
}

func toProfileMediaMap(raw any) map[string]any {
	switch value := raw.(type) {
	case map[string]any:
		copied := make(map[string]any, len(value))
		for k, v := range value {
			copied[k] = v
		}
		return copied
	case string:
		return map[string]any{"src": value, "display": map[string]any{"url": value}, "full": map[string]any{"url": value}, "thumb": map[string]any{"url": value}}
	default:
		return map[string]any{}
	}
}

func profileMediaSearchText(item map[string]any, post models.Post) string {
	chunks := []string{post.Content}
	for _, key := range []string{"alt", "caption", "title", "description", "kind", "type"} {
		if value := strings.TrimSpace(fmt.Sprint(item[key])); value != "" && value != "<nil>" {
			chunks = append(chunks, value)
		}
	}
	return strings.ToLower(strings.Join(chunks, " "))
}

func flattenProfileMediaItems(posts []models.Post) []userMediaListItem {
	items := make([]userMediaListItem, 0)
	for _, post := range posts {
		if strings.TrimSpace(post.Images) == "" || strings.TrimSpace(post.Images) == "[]" {
			continue
		}
		var parsed []any
		if err := json.Unmarshal([]byte(post.Images), &parsed); err != nil {
			continue
		}
		for index, raw := range parsed {
			payload := toProfileMediaMap(raw)
			kind := inferProfileMediaKind(payload)
			payload["kind"] = kind
			payload["owner_id"] = post.UserID
			payload["owner_username"] = post.User.Username
			payload["source_post_id"] = post.ID
			payload["source_post_date"] = post.CreatedAt.Format(time.RFC3339)
			payload["source_post_text"] = post.Content
			payload["source_post_likes"] = post.Likes
			payload["source_post_comments"] = post.Comments
			payload["source_post_score"] = post.Likes*3 + post.Comments*2 + len(parsed)
			payload["source_post_has_comments"] = post.Comments > 0
			if _, ok := payload["_key"]; !ok {
				if asset := strings.TrimSpace(fmt.Sprint(payload["asset_id"])); asset != "" && asset != "<nil>" {
					payload["_key"] = fmt.Sprintf("asset:%s", asset)
				} else if hash := strings.TrimSpace(fmt.Sprint(payload["hash"])); hash != "" && hash != "<nil>" {
					payload["_key"] = fmt.Sprintf("hash:%s", hash)
				} else {
					payload["_key"] = fmt.Sprintf("%d-%d", post.ID, index)
				}
			}
			items = append(items, userMediaListItem{
				SourcePostID:          post.ID,
				SourcePostDate:        post.CreatedAt.Format(time.RFC3339),
				SourcePostText:        post.Content,
				SourcePostLikes:       post.Likes,
				SourcePostComments:    post.Comments,
				SourcePostScore:       post.Likes*3 + post.Comments*2 + len(parsed),
				SourcePostHasComments: post.Comments > 0,
				OwnerID:               post.UserID,
				OwnerUsername:         post.User.Username,
				Kind:                  kind,
				SearchText:            profileMediaSearchText(payload, post),
				Payload:               payload,
			})
		}
	}
	return items
}

func (h *MediaHandler) GetUserMedia(c *gin.Context) {
	userIDValue, err := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || userIDValue == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный id пользователя"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "24"))
	if page < 1 {
		page = 1
	}
	if limit <= 0 {
		limit = 24
	}
	if limit > 60 {
		limit = 60
	}
	sortMode := strings.ToLower(strings.TrimSpace(c.DefaultQuery("sort", "recent")))
	kindFilter := strings.ToLower(strings.TrimSpace(c.DefaultQuery("kind", "all")))
	query := strings.ToLower(strings.TrimSpace(c.DefaultQuery("q", "")))

	var posts []models.Post
	if err := database.DB.Where("user_id = ?", uint(userIDValue)).Order("created_at DESC").Preload("User").Find(&posts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось загрузить альбом"})
		return
	}

	allItems := flattenProfileMediaItems(posts)
	stats := gin.H{
		"total":     0,
		"photos":    0,
		"videos":    0,
		"posts":     len(posts),
		"captioned": 0,
		"discussed": 0,
	}
	seenPosts := map[uint]struct{}{}
	for _, item := range allItems {
		stats["total"] = stats["total"].(int) + 1
		if item.Kind == "video" {
			stats["videos"] = stats["videos"].(int) + 1
		} else {
			stats["photos"] = stats["photos"].(int) + 1
		}
		if strings.TrimSpace(item.SourcePostText) != "" {
			stats["captioned"] = stats["captioned"].(int) + 1
		}
		if item.SourcePostHasComments {
			stats["discussed"] = stats["discussed"].(int) + 1
		}
		seenPosts[item.SourcePostID] = struct{}{}
	}
	stats["posts"] = len(seenPosts)

	filtered := make([]userMediaListItem, 0, len(allItems))
	for _, item := range allItems {
		if kindFilter == "photos" || kindFilter == "photo" || kindFilter == "image" {
			if item.Kind != "image" {
				continue
			}
		}
		if kindFilter == "videos" || kindFilter == "video" {
			if item.Kind != "video" {
				continue
			}
		}
		if query != "" && !strings.Contains(item.SearchText, query) {
			continue
		}
		filtered = append(filtered, item)
	}

	sort.SliceStable(filtered, func(i, j int) bool {
		a := filtered[i]
		b := filtered[j]
		switch sortMode {
		case "popular":
			if a.SourcePostScore != b.SourcePostScore {
				return a.SourcePostScore > b.SourcePostScore
			}
		case "commented":
			if a.SourcePostComments != b.SourcePostComments {
				return a.SourcePostComments > b.SourcePostComments
			}
		case "captions":
			if len(strings.TrimSpace(a.SourcePostText)) != len(strings.TrimSpace(b.SourcePostText)) {
				return len(strings.TrimSpace(a.SourcePostText)) > len(strings.TrimSpace(b.SourcePostText))
			}
		default:
			if a.SourcePostDate != b.SourcePostDate {
				return a.SourcePostDate > b.SourcePostDate
			}
		}
		return fmt.Sprint(a.Payload["_key"]) < fmt.Sprint(b.Payload["_key"])
	})

	highlightsRaw := make([]gin.H, 0, 6)
	for idx, item := range filtered {
		if idx >= 6 {
			break
		}
		highlightsRaw = append(highlightsRaw, gin.H(item.Payload))
	}

	total := len(filtered)
	start := (page - 1) * limit
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}
	pageItems := make([]gin.H, 0, end-start)
	for _, item := range filtered[start:end] {
		pageItems = append(pageItems, gin.H(item.Payload))
	}

	hasMore := end < total
	nextPage := 0
	if hasMore {
		nextPage = page + 1
	}
	c.JSON(http.StatusOK, gin.H{
		"items":      pageItems,
		"stats":      stats,
		"highlights": highlightsRaw,
		"page":       page,
		"limit":      limit,
		"total":      total,
		"has_more":   hasMore,
		"next_page":  nextPage,
		"filters":    gin.H{"kind": kindFilter, "sort": sortMode, "q": query},
	})
}

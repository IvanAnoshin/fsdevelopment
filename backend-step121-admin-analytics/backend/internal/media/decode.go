package media

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	maxDecodePixels    = 40_000_000
	maxDecodeDimension = 12_000
)

var heicBrands = map[string]struct{}{
	"heic": {}, "heix": {}, "hevc": {}, "hevx": {},
	"heim": {}, "heis": {}, "mif1": {}, "msf1": {},
}

func DecodeImage(raw []byte, filename string, mimeType string) (image.Image, string, error) {
	if isHEICUpload(raw, filename, mimeType) {
		img, err := decodeHEICViaMagick(raw)
		if err != nil {
			return nil, "", err
		}
		bounds := img.Bounds()
		if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
			return nil, "", fmt.Errorf("invalid image size")
		}
		if bounds.Dx() > maxDecodeDimension || bounds.Dy() > maxDecodeDimension || bounds.Dx()*bounds.Dy() > maxDecodePixels {
			return nil, "", fmt.Errorf("изображение слишком большое для безопасной обработки")
		}
		return img, "heic", nil
	}

	if cfg, format, err := image.DecodeConfig(bytes.NewReader(raw)); err == nil {
		if cfg.Width <= 0 || cfg.Height <= 0 {
			return nil, "", fmt.Errorf("invalid image size")
		}
		if cfg.Width > maxDecodeDimension || cfg.Height > maxDecodeDimension || cfg.Width*cfg.Height > maxDecodePixels {
			return nil, "", fmt.Errorf("изображение слишком большое для безопасной обработки")
		}
		_ = format
	}
	img, format, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, "", fmt.Errorf("decode image: %w", err)
	}
	return img, format, nil
}

func DetectUploadMime(raw []byte, filename string) string {
	mimeType := strings.ToLower(strings.TrimSpace(httpDetectContentType(raw)))
	if mimeType == "application/octet-stream" && isHEICBytes(raw) {
		return "image/heic"
	}
	if isHEICExt(filename) && (mimeType == "application/octet-stream" || mimeType == "image/heif") {
		return "image/heic"
	}
	return mimeType
}

func IsSupportedUploadImage(raw []byte, filename string, mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/png", "image/heic", "image/heif":
		return true
	}
	return isHEICUpload(raw, filename, mimeType)
}

func isHEICUpload(raw []byte, filename string, mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	if mimeType == "image/heic" || mimeType == "image/heif" {
		return true
	}
	if isHEICBytes(raw) {
		return true
	}
	return isHEICExt(filename)
}

func isHEICExt(filename string) bool {
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(filename)))
	return ext == ".heic" || ext == ".heif"
}

func isHEICBytes(raw []byte) bool {
	if len(raw) < 12 {
		return false
	}
	if string(raw[4:8]) != "ftyp" {
		return false
	}
	brand := strings.ToLower(string(raw[8:12]))
	_, ok := heicBrands[brand]
	return ok
}

func decodeHEICViaMagick(raw []byte) (image.Image, error) {
	magickPath, args, err := resolveMagickCommand()
	if err != nil {
		return nil, fmt.Errorf("HEIC пока не может быть обработан на сервере: %w", err)
	}

	cmd := exec.Command(magickPath, args...)
	cmd.Stdin = bytes.NewReader(raw)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("не удалось декодировать HEIC: %s", msg)
	}

	img, _, err := image.Decode(bytes.NewReader(stdout.Bytes()))
	if err != nil {
		return nil, fmt.Errorf("decode converted HEIC: %w", err)
	}
	return img, nil
}

func HEICSupport() (bool, string) {
	_, _, err := resolveMagickCommand()
	if err != nil {
		return false, err.Error()
	}
	return true, "enabled"
}

func resolveMagickCommand() (string, []string, error) {
	preferred := strings.TrimSpace(os.Getenv("MEDIA_MAGICK_BIN"))
	candidates := []string{}
	if preferred != "" {
		candidates = append(candidates, preferred)
	}
	candidates = append(candidates, "magick", "convert")

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		path, err := exec.LookPath(candidate)
		if err != nil {
			continue
		}
		if filepath.Base(path) == "magick" || candidate == "magick" || strings.Contains(candidate, "magick") {
			return path, []string{"heic:-", "-auto-orient", "-strip", "png:-"}, nil
		}
		return path, []string{"heic:-", "-auto-orient", "-strip", "png:-"}, nil
	}
	return "", nil, fmt.Errorf("не найден ImageMagick (magick/convert); установи ImageMagick с поддержкой HEIC или задай MEDIA_MAGICK_BIN")
}

func httpDetectContentType(raw []byte) string {
	if len(raw) > 512 {
		raw = raw[:512]
	}
	return httpDetect(raw)
}

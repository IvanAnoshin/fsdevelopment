package media

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
	"strings"
)

type Variant struct {
	Name   string `json:"name"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Bytes  int64  `json:"bytes"`
	Format string `json:"format"`
	Path   string `json:"path"`
	URL    string `json:"url"`
}

type OptimizedAsset struct {
	Hash          string    `json:"hash"`
	Width         int       `json:"width"`
	Height        int       `json:"height"`
	OriginalBytes int64     `json:"original_bytes"`
	SavedBytes    int64     `json:"saved_bytes"`
	PreferredURL  string    `json:"preferred_url"`
	Variants      []Variant `json:"variants"`
}

func OptimizeImage(storage Storage, kind string, raw []byte, filename string, mimeType string) (*OptimizedAsset, error) {
	img, format, err := DecodeImage(raw, filename, mimeType)
	if err != nil {
		return nil, err
	}

	bounds := img.Bounds()
	origW := bounds.Dx()
	origH := bounds.Dy()
	if origW <= 0 || origH <= 0 {
		return nil, fmt.Errorf("invalid image size")
	}

	hash := HashBytes(raw)
	targetWidths := normalizedTargetWidths(origW)
	hasAlpha := detectAlpha(img)
	formatOut := preferredFormat(hasAlpha, strings.ToLower(format))
	ext := extensionForFormat(formatOut)
	quality := jpegQuality()

	variants := make([]Variant, 0, len(targetWidths))
	var totalBytes int64
	preferredURL := ""

	for idx, width := range targetWidths {
		resized := resizeImage(img, width)
		encoded, outW, outH, err := encodeImage(resized, formatOut, quality)
		if err != nil {
			return nil, err
		}

		variantName := variantLabel(width, idx, len(targetWidths))
		key := ContentAddressKey(kind, hash, variantName, ext)

		if err := storage.WriteObject(key, encoded); err != nil {
			return nil, fmt.Errorf("write variant: %w", err)
		}

		variant := Variant{
			Name:   variantName,
			Width:  outW,
			Height: outH,
			Bytes:  int64(len(encoded)),
			Format: formatOut,
			Path:   key,
			URL:    storage.PublicURL(key),
		}
		variants = append(variants, variant)
		totalBytes += variant.Bytes

		if preferredURL == "" || variantName == "display" {
			preferredURL = variant.URL
		}
	}

	if preferredURL == "" && len(variants) > 0 {
		preferredURL = variants[len(variants)-1].URL
	}

	return &OptimizedAsset{
		Hash:          hash,
		Width:         origW,
		Height:        origH,
		OriginalBytes: int64(len(raw)),
		SavedBytes:    int64(len(raw)) - totalBytes,
		PreferredURL:  preferredURL,
		Variants:      variants,
	}, nil
}

func normalizedTargetWidths(origW int) []int {
	maxStoredWidth := 1600
	if origW < maxStoredWidth {
		maxStoredWidth = origW
	}

	candidates := []int{320, 640, 960, 1280, maxStoredWidth}
	result := make([]int, 0, len(candidates)+1)
	seen := map[int]struct{}{}

	for _, width := range candidates {
		if width <= 0 {
			continue
		}
		if width >= origW {
			continue
		}
		seen[width] = struct{}{}
		result = append(result, width)
	}

	if _, ok := seen[origW]; !ok {
		result = append(result, origW)
	}

	if len(result) == 1 {
		result[0] = origW
	}
	if len(result) == 0 {
		result = []int{origW}
	}

	return result
}

func variantLabel(width int, idx int, total int) string {
	switch {
	case idx == 0:
		return "thumb"
	case idx == total-1:
		return "full"
	case width <= 960:
		return "display"
	default:
		return fmt.Sprintf("w%d", width)
	}
}

func preferredFormat(hasAlpha bool, decodedFormat string) string {
	if hasAlpha {
		return "png"
	}
	if decodedFormat == "png" {
		return "jpeg"
	}
	return "jpeg"
}

func extensionForFormat(format string) string {
	switch format {
	case "png":
		return ".png"
	default:
		return ".jpg"
	}
}

func jpegQuality() int {
	quality := 80
	return quality
}

func encodeImage(img image.Image, format string, quality int) ([]byte, int, int, error) {
	var buf bytes.Buffer
	bounds := img.Bounds()

	switch format {
	case "png":
		enc := png.Encoder{CompressionLevel: png.BestCompression}
		if err := enc.Encode(&buf, img); err != nil {
			return nil, 0, 0, fmt.Errorf("encode png: %w", err)
		}
	default:
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
			return nil, 0, 0, fmt.Errorf("encode jpeg: %w", err)
		}
	}

	return buf.Bytes(), bounds.Dx(), bounds.Dy(), nil
}

func detectAlpha(img image.Image) bool {
	bounds := img.Bounds()
	stepX := max(bounds.Dx()/24, 1)
	stepY := max(bounds.Dy()/24, 1)

	for y := bounds.Min.Y; y < bounds.Max.Y; y += stepY {
		for x := bounds.Min.X; x < bounds.Max.X; x += stepX {
			_, _, _, a := img.At(x, y).RGBA()
			if a != 0xffff {
				return true
			}
		}
	}
	return false
}

func resizeImage(src image.Image, targetW int) image.Image {
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()

	if targetW <= 0 || targetW >= srcW {
		return src
	}

	ratio := float64(targetW) / float64(srcW)
	targetH := int(math.Round(float64(srcH) * ratio))
	if targetH < 1 {
		targetH = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, targetW, targetH))

	for y := 0; y < targetH; y++ {
		sy := float64(y) * float64(srcH-1) / float64(max(targetH-1, 1))
		y0 := int(math.Floor(sy))
		y1 := min(y0+1, srcH-1)
		fy := sy - float64(y0)

		for x := 0; x < targetW; x++ {
			sx := float64(x) * float64(srcW-1) / float64(max(targetW-1, 1))
			x0 := int(math.Floor(sx))
			x1 := min(x0+1, srcW-1)
			fx := sx - float64(x0)

			c00r, c00g, c00b, c00a := src.At(bounds.Min.X+x0, bounds.Min.Y+y0).RGBA()
			c10r, c10g, c10b, c10a := src.At(bounds.Min.X+x1, bounds.Min.Y+y0).RGBA()
			c01r, c01g, c01b, c01a := src.At(bounds.Min.X+x0, bounds.Min.Y+y1).RGBA()
			c11r, c11g, c11b, c11a := src.At(bounds.Min.X+x1, bounds.Min.Y+y1).RGBA()

			r := bilerp(c00r, c10r, c01r, c11r, fx, fy)
			g := bilerp(c00g, c10g, c01g, c11g, fx, fy)
			b := bilerp(c00b, c10b, c01b, c11b, fx, fy)
			a := bilerp(c00a, c10a, c01a, c11a, fx, fy)

			dst.Set(x, y, colorRGBA64To8(r, g, b, a))
		}
	}

	return dst
}

func bilerp(c00, c10, c01, c11 uint32, fx, fy float64) uint32 {
	top := float64(c00)*(1-fx) + float64(c10)*fx
	bottom := float64(c01)*(1-fx) + float64(c11)*fx
	return uint32(top*(1-fy) + bottom*fy)
}

func colorRGBA64To8(r, g, b, a uint32) color.RGBA {
	return color.RGBA{
		R: uint8(r >> 8),
		G: uint8(g >> 8),
		B: uint8(b >> 8),
		A: uint8(a >> 8),
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
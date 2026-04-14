package media

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type MessageMediaMetadata struct {
	DurationSec int
	Width       int
	Height      int
	PosterJPEG  []byte
	Source      string
}

func MaxVoiceDurationSec() int     { return positiveEnvInt("MAX_VOICE_DURATION_SEC", 180) }
func MaxVideoNoteDurationSec() int { return positiveEnvInt("MAX_VIDEO_NOTE_DURATION_SEC", 90) }

func positiveEnvInt(key string, fallback int) int {
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

func EffectiveMessageMediaMetadata(raw []byte, mimeType, kind string, clientDurationSec, clientWidth, clientHeight int) MessageMediaMetadata {
	meta := MessageMediaMetadata{DurationSec: maxInt(clientDurationSec, 0), Width: maxInt(clientWidth, 0), Height: maxInt(clientHeight, 0), Source: "client"}
	extracted, err := ExtractMessageMediaMetadata(raw, mimeType, kind)
	if err == nil {
		if extracted.DurationSec > 0 {
			meta.DurationSec = extracted.DurationSec
		}
		if extracted.Width > 0 {
			meta.Width = extracted.Width
		}
		if extracted.Height > 0 {
			meta.Height = extracted.Height
		}
		if len(extracted.PosterJPEG) > 0 {
			meta.PosterJPEG = extracted.PosterJPEG
		}
		meta.Source = extracted.Source
	}
	return meta
}

func ExtractMessageMediaMetadata(raw []byte, mimeType, kind string) (MessageMediaMetadata, error) {
	ffprobePath, probeErr := exec.LookPath("ffprobe")
	ffmpegPath, ffmpegErr := exec.LookPath("ffmpeg")
	if probeErr != nil && ffmpegErr != nil {
		return MessageMediaMetadata{}, fmt.Errorf("ffmpeg tools unavailable")
	}
	ext := ".bin"
	switch {
	case strings.Contains(mimeType, "ogg"):
		ext = ".ogg"
	case strings.Contains(mimeType, "mp4"):
		ext = ".mp4"
	case strings.Contains(mimeType, "mpeg"):
		ext = ".mp3"
	case strings.Contains(mimeType, "quicktime"):
		ext = ".mov"
	case strings.Contains(mimeType, "webm"):
		ext = ".webm"
	}
	tmpFile, err := os.CreateTemp("", "friendscape-message-media-*"+ext)
	if err != nil {
		return MessageMediaMetadata{}, err
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)
	if _, err := tmpFile.Write(raw); err != nil {
		tmpFile.Close()
		return MessageMediaMetadata{}, err
	}
	tmpFile.Close()
	meta := MessageMediaMetadata{Source: "server"}
	if probeErr == nil {
		d, w, h := ffprobeMedia(ffprobePath, tmpPath)
		meta.DurationSec = d
		meta.Width = w
		meta.Height = h
	}
	if kind == "video_note" && ffmpegErr == nil {
		if poster, err := ffmpegPoster(ffmpegPath, tmpPath); err == nil && len(poster) > 0 {
			meta.PosterJPEG = poster
		}
	}
	if meta.DurationSec == 0 && meta.Width == 0 && meta.Height == 0 && len(meta.PosterJPEG) == 0 {
		return MessageMediaMetadata{}, fmt.Errorf("metadata extraction unavailable")
	}
	return meta, nil
}

type ffprobeOutput struct {
	Streams []struct {
		CodecType string `json:"codec_type"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
		Duration  string `json:"duration"`
		Tags      struct {
			Duration string `json:"DURATION"`
		} `json:"tags"`
	} `json:"streams"`
	Format struct {
		Duration string `json:"duration"`
	} `json:"format"`
}

func ffprobeMedia(ffprobePath, filePath string) (durationSec, width, height int) {
	cmd := exec.Command(ffprobePath, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath)
	output, err := cmd.Output()
	if err != nil {
		return 0, 0, 0
	}
	var parsed ffprobeOutput
	if err := json.Unmarshal(output, &parsed); err != nil {
		return 0, 0, 0
	}
	durationSec = parseDurationSeconds(parsed.Format.Duration)
	for _, stream := range parsed.Streams {
		if durationSec == 0 {
			durationSec = parseDurationSeconds(stream.Duration)
		}
		if durationSec == 0 {
			durationSec = parseClockDurationSeconds(stream.Tags.Duration)
		}
		if stream.CodecType == "video" {
			if stream.Width > 0 {
				width = stream.Width
			}
			if stream.Height > 0 {
				height = stream.Height
			}
		}
	}
	return durationSec, width, height
}

func ffmpegPoster(ffmpegPath, filePath string) ([]byte, error) {
	cmd := exec.Command(ffmpegPath, "-y", "-ss", "0.2", "-i", filePath, "-frames:v", "1", "-vf", "scale='min(320,iw)':-2", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg poster failed: %w %s", err, stderr.String())
	}
	return stdout.Bytes(), nil
}

func parseDurationSeconds(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || value <= 0 {
		return 0
	}
	return int(math.Round(value))
}
func parseClockDurationSeconds(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	parts := strings.Split(raw, ":")
	if len(parts) != 3 {
		return 0
	}
	h, errH := strconv.Atoi(parts[0])
	m, errM := strconv.Atoi(parts[1])
	s, errS := strconv.ParseFloat(parts[2], 64)
	if errH != nil || errM != nil || errS != nil {
		return 0
	}
	return int(math.Round(float64(h*3600+m*60) + s))
}
func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func CleanupOrphanMessageFiles(storage Storage, referencedKeys []string, olderThan time.Duration) (int, error) {
	rootDir := storage.RootDir()
	if strings.TrimSpace(rootDir) == "" {
		return 0, nil
	}
	refSet := make(map[string]struct{}, len(referencedKeys))
	for _, key := range referencedKeys {
		key = strings.Trim(strings.TrimSpace(filepath.ToSlash(key)), "/")
		if key != "" {
			refSet[key] = struct{}{}
		}
	}
	prefixes := []string{"message-media", "message-media-thumb"}
	deleted := 0
	now := time.Now()
	for _, prefix := range prefixes {
		base := filepath.Join(rootDir, filepath.FromSlash(prefix))
		if _, err := os.Stat(base); err != nil {
			continue
		}
		walkErr := filepath.Walk(base, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				return nil
			}
			rel, relErr := filepath.Rel(rootDir, path)
			if relErr != nil {
				return nil
			}
			key := strings.Trim(filepath.ToSlash(rel), "/")
			if _, ok := refSet[key]; ok {
				return nil
			}
			if olderThan > 0 && now.Sub(info.ModTime()) < olderThan {
				return nil
			}
			if removeErr := os.Remove(path); removeErr == nil || os.IsNotExist(removeErr) {
				deleted++
			}
			return nil
		})
		if walkErr != nil {
			return deleted, walkErr
		}
	}
	return deleted, nil
}

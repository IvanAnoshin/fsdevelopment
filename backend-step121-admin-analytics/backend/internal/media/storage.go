package media

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
)

type Storage interface {
	Driver() string
	PublicURL(objectKey string) string
	NewObjectKey(userID uint, kind string, filename string) string
	RootDir() string
	WriteObject(objectKey string, data []byte) error
	DeleteObject(objectKey string) error
	FileSize(objectKey string) (int64, error)
	ObjectKeyFromPublicURL(rawURL string) string
}

type LocalStorage struct {
	baseURL string
	rootDir string
}

func NewStorage() Storage {
	baseURL := strings.TrimRight(strings.TrimSpace(getEnv("MEDIA_BASE_URL", "/media")), "/")
	rootDir := strings.TrimSpace(getEnv("MEDIA_ROOT", "./media"))
	if rootDir == "" {
		rootDir = "./media"
	}
	return &LocalStorage{baseURL: baseURL, rootDir: rootDir}
}

func (s *LocalStorage) Driver() string {
	return strings.ToLower(getEnv("MEDIA_DRIVER", "local"))
}

func (s *LocalStorage) PublicURL(objectKey string) string {
	return s.baseURL + "/" + strings.TrimLeft(objectKey, "/")
}

func (s *LocalStorage) RootDir() string {
	return s.rootDir
}

func (s *LocalStorage) NewObjectKey(userID uint, kind string, filename string) string {
	safeName := sanitizeFilename(filename)
	if safeName == "" {
		safeName = "upload.bin"
	}
	return path.Join(kind, fmt.Sprintf("user-%d", userID), safeName)
}

func (s *LocalStorage) WriteObject(objectKey string, data []byte) error {
	fullPath := filepath.Join(s.rootDir, filepath.FromSlash(strings.TrimLeft(objectKey, "/")))
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(fullPath, data, 0o644)
}

func (s *LocalStorage) DeleteObject(objectKey string) error {
	fullPath := filepath.Join(s.rootDir, filepath.FromSlash(strings.TrimLeft(objectKey, "/")))
	if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *LocalStorage) FileSize(objectKey string) (int64, error) {
	fullPath := filepath.Join(s.rootDir, filepath.FromSlash(strings.TrimLeft(objectKey, "/")))
	st, err := os.Stat(fullPath)
	if err != nil {
		return 0, err
	}
	return st.Size(), nil
}

func (s *LocalStorage) ObjectKeyFromPublicURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}
	base := strings.TrimRight(s.baseURL, "/") + "/"
	if strings.HasPrefix(rawURL, base) {
		return strings.TrimLeft(strings.TrimPrefix(rawURL, base), "/")
	}
	return ""
}

func sanitizeFilename(name string) string {
	name = strings.TrimSpace(strings.ToLower(name))
	name = strings.ReplaceAll(name, " ", "-")
	name = strings.ReplaceAll(name, "..", "")
	name = path.Base(name)
	return name
}

func getEnv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func HashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func ContentAddressKey(kind, hash, variant, ext string) string {
	hash = strings.ToLower(strings.TrimSpace(hash))
	if len(hash) < 4 {
		return path.Join(kind, hash+"-"+variant+ext)
	}
	return path.Join(kind, hash[:2], hash[2:4], hash+"-"+variant+ext)
}

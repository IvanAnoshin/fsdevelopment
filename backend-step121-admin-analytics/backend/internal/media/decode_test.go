package media

import "testing"

func TestIsHEICBytes(t *testing.T) {
	raw := append([]byte{0, 0, 0, 24}, []byte("ftypheic")...)
	raw = append(raw, []byte{0, 0, 0, 0}...)
	if !isHEICBytes(raw) {
		t.Fatal("expected heic signature to be detected")
	}
}

func TestDetectUploadMimeHEIC(t *testing.T) {
	raw := append([]byte{0, 0, 0, 24}, []byte("ftypheic")...)
	raw = append(raw, []byte{0, 0, 0, 0}...)
	if got := DetectUploadMime(raw, "photo.heic"); got != "image/heic" {
		t.Fatalf("expected image/heic, got %s", got)
	}
}

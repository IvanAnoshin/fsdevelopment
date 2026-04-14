package media

import "net/http"

func httpDetect(raw []byte) string {
	return http.DetectContentType(raw)
}

package utils

import (
	"fmt"
	"math/rand"
	"time"
)

func GenerateBackupCodes() []string {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	codes := make([]string, 8)
	for i := 0; i < 8; i++ {
		part1 := rng.Intn(9000) + 1000
		part2 := rng.Intn(9000) + 1000
		codes[i] = fmt.Sprintf("%04d-%04d", part1, part2)
	}
	return codes
}
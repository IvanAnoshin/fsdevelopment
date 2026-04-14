package utils

import (
	"sync"
	"time"
)

type TempUserData struct {
	Username   string
	Password   string
	FirstName  string
	LastName   string
	Code       string
	ExpiresAt  time.Time
}

var (
	tempStore = make(map[string]TempUserData)
	mu        sync.RWMutex
)

func SaveTempUser(username string, data TempUserData) {
	mu.Lock()
	defer mu.Unlock()
	tempStore[username] = data

	time.AfterFunc(15*time.Minute, func() {
		DeleteTempUser(username)
	})
}

func GetTempUser(username string) (TempUserData, bool) {
	mu.RLock()
	defer mu.RUnlock()
	data, exists := tempStore[username]
	return data, exists
}

func DeleteTempUser(username string) {
	mu.Lock()
	defer mu.Unlock()
	delete(tempStore, username)
}
package dfsn

import (
	"encoding/json"
	"math"
	"sync"
	"time"

	"friendscape/internal/database"
	"friendscape/internal/models"
)

type BehavioralProfile struct {
	UserID          uint      `json:"user_id"`
	TypingSpeed     float64   `json:"typing_speed"`
	TypingVariance  float64   `json:"typing_variance"`
	MouseSpeed      float64   `json:"mouse_speed"`
	MouseAccuracy   float64   `json:"mouse_accuracy"`
	ScrollDepth     float64   `json:"scroll_depth"`
	SessionDuration float64   `json:"session_duration"`
	ActiveHours     []int     `json:"active_hours"`
	Pattern         []float64 `json:"pattern"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type BehavioralSession struct {
	ID           uint          `json:"id"`
	UserID       uint          `json:"user_id"`
	TypingEvents []TypingEvent `json:"typing_events"`
	MouseEvents  []MouseEvent  `json:"mouse_events"`
	ScrollEvents []ScrollEvent `json:"scroll_events"`
	StartTime    time.Time     `json:"start_time"`
	EndTime      time.Time     `json:"end_time"`
}

type TypingEvent struct {
	Timestamp int64   `json:"timestamp"`
	Key       string  `json:"key"`
	Delay     float64 `json:"delay"`
}

type MouseEvent struct {
	Timestamp int64   `json:"timestamp"`
	X         int     `json:"x"`
	Y         int     `json:"y"`
	Speed     float64 `json:"speed"`
}

type ScrollEvent struct {
	Timestamp int64   `json:"timestamp"`
	Delta     int     `json:"delta"`
	Speed     float64 `json:"speed"`
}

type BehavioralNetwork struct {
	profiles map[uint]*BehavioralProfile
	mu       sync.RWMutex
}

var (
	instance *BehavioralNetwork
	once     sync.Once
)

func GetNetwork() *BehavioralNetwork {
	once.Do(func() {
		instance = &BehavioralNetwork{
			profiles: make(map[uint]*BehavioralProfile),
		}
	})
	return instance
}

func (bn *BehavioralNetwork) UpdateProfile(userID uint, session *BehavioralSession) {
	bn.mu.Lock()
	defer bn.mu.Unlock()

	profile, exists := bn.profiles[userID]
	if !exists {
		profile = &BehavioralProfile{
			UserID:    userID,
			Pattern:   make([]float64, 10),
			UpdatedAt: time.Now(),
		}
	}

	bn.analyzeSession(profile, session)

	profile.UpdatedAt = time.Now()
	bn.profiles[userID] = profile
}

func (bn *BehavioralNetwork) analyzeSession(profile *BehavioralProfile, session *BehavioralSession) {
	if session == nil || len(session.TypingEvents) == 0 {
		return
	}

	var totalDelay float64
	for _, event := range session.TypingEvents {
		totalDelay += event.Delay
	}
	avgDelay := totalDelay / float64(len(session.TypingEvents))
	typingSpeed := 60000.0 / avgDelay

	if profile.TypingSpeed == 0 {
		profile.TypingSpeed = typingSpeed
	} else {
		profile.TypingSpeed = profile.TypingSpeed*0.7 + typingSpeed*0.3
	}

	var variance float64
	for _, event := range session.TypingEvents {
		variance += math.Pow(event.Delay-avgDelay, 2)
	}
	profile.TypingVariance = profile.TypingVariance*0.7 + (variance/float64(len(session.TypingEvents)))*0.3

	if len(session.MouseEvents) > 1 {
		var totalSpeed float64
		var totalAccuracy float64

		for i := 1; i < len(session.MouseEvents); i++ {
			dx := session.MouseEvents[i].X - session.MouseEvents[i-1].X
			dy := session.MouseEvents[i].Y - session.MouseEvents[i-1].Y
			dt := float64(session.MouseEvents[i].Timestamp - session.MouseEvents[i-1].Timestamp)

			if dt > 0 {
				distance := math.Sqrt(float64(dx*dx + dy*dy))
				speed := distance / dt * 1000
				totalSpeed += speed

				if i > 1 && i < len(session.MouseEvents)-1 {
					accuracy := bn.calculateAccuracy(
						session.MouseEvents[i-1],
						session.MouseEvents[i],
						session.MouseEvents[i+1],
					)
					totalAccuracy += accuracy
				}
			}
		}

		avgSpeed := totalSpeed / float64(len(session.MouseEvents)-1)
		avgAccuracy := totalAccuracy / float64(len(session.MouseEvents)-2)

		if profile.MouseSpeed == 0 {
			profile.MouseSpeed = avgSpeed
		} else {
			profile.MouseSpeed = profile.MouseSpeed*0.7 + avgSpeed*0.3
		}

		if profile.MouseAccuracy == 0 {
			profile.MouseAccuracy = avgAccuracy
		} else {
			profile.MouseAccuracy = profile.MouseAccuracy*0.7 + avgAccuracy*0.3
		}
	}

	profile.Pattern = []float64{
		profile.TypingSpeed / 1000.0,
		profile.TypingVariance / 1000.0,
		profile.MouseSpeed / 1000.0,
		profile.MouseAccuracy,
		profile.ScrollDepth,
		profile.SessionDuration / 60.0,
	}
}

func (bn *BehavioralNetwork) calculateAccuracy(p1, p2, p3 MouseEvent) float64 {
	dx := float64(p3.X - p1.X)
	dy := float64(p3.Y - p1.Y)

	if dx == 0 && dy == 0 {
		return 0
	}

	numerator := math.Abs(float64((p3.X-p1.X)*(p1.Y-p2.Y) - (p1.X-p2.X)*(p3.Y-p1.Y)))
	denominator := math.Sqrt(dx*dx + dy*dy)

	return numerator / denominator
}

func (bn *BehavioralNetwork) VerifyBehavior(userID uint, session *BehavioralSession) (float64, bool) {
	bn.mu.RLock()
	profile, exists := bn.profiles[userID]
	bn.mu.RUnlock()

	if !exists {
		bn.UpdateProfile(userID, session)
		return 1.0, true
	}

	tempProfile := &BehavioralProfile{}
	bn.analyzeSession(tempProfile, session)

	similarity := bn.calculateSimilarity(profile.Pattern, tempProfile.Pattern)
	threshold := 0.7

	return similarity, similarity >= threshold
}

func (bn *BehavioralNetwork) calculateSimilarity(v1, v2 []float64) float64 {
	if len(v1) == 0 || len(v2) == 0 || len(v1) != len(v2) {
		return 0
	}

	var dotProduct, norm1, norm2 float64

	for i := 0; i < len(v1); i++ {
		dotProduct += v1[i] * v2[i]
		norm1 += v1[i] * v1[i]
		norm2 += v2[i] * v2[i]
	}

	if norm1 == 0 || norm2 == 0 {
		return 0
	}

	return dotProduct / (math.Sqrt(norm1) * math.Sqrt(norm2))
}

func (bn *BehavioralNetwork) SaveProfileToDB(userID uint) error {
	bn.mu.RLock()
	profile, exists := bn.profiles[userID]
	bn.mu.RUnlock()

	if !exists {
		return nil
	}

	profileJSON, err := json.Marshal(profile)
	if err != nil {
		return err
	}

	result := database.DB.Model(&models.User{}).
		Where("id = ?", userID).
		Update("behavioral_profile", string(profileJSON))

	return result.Error
}

func (bn *BehavioralNetwork) LoadProfileFromDB(userID uint, profileData string) error {
	var profile BehavioralProfile

	err := json.Unmarshal([]byte(profileData), &profile)
	if err != nil {
		return err
	}

	bn.mu.Lock()
	defer bn.mu.Unlock()

	bn.profiles[userID] = &profile
	return nil
}

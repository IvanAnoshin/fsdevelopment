package realtime

import (
	"sync"
	"time"
)

type Event struct {
	Type      string         `json:"type"`
	Channel   string         `json:"channel,omitempty"`
	Data      map[string]any `json:"data,omitempty"`
	Timestamp time.Time      `json:"timestamp"`
}

type Broker struct {
	mu          sync.RWMutex
	subscribers map[uint]map[chan Event]struct{}
}

func NewBroker() *Broker {
	return &Broker{subscribers: map[uint]map[chan Event]struct{}{}}
}

func (b *Broker) Subscribe(userID uint) chan Event {
	ch := make(chan Event, 16)
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.subscribers[userID] == nil {
		b.subscribers[userID] = map[chan Event]struct{}{}
	}
	b.subscribers[userID][ch] = struct{}{}
	return ch
}

func (b *Broker) Unsubscribe(userID uint, ch chan Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.subscribers[userID] == nil {
		return
	}
	delete(b.subscribers[userID], ch)
	close(ch)
	if len(b.subscribers[userID]) == 0 {
		delete(b.subscribers, userID)
	}
}

func (b *Broker) PublishToUser(userID uint, event Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	event.Timestamp = time.Now().UTC()
	for ch := range b.subscribers[userID] {
		select {
		case ch <- event:
		default:
		}
	}
}

func (b *Broker) HasSubscribers(userID uint) bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.subscribers[userID]) > 0
}

var DefaultBroker = NewBroker()

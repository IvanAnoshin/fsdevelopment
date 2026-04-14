package realtime

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

type CallState string

const (
	CallStateRinging CallState = "ringing"
	CallStateActive  CallState = "active"
	CallStateEnded   CallState = "ended"
)

var (
	ErrCallBusy         = errors.New("один из пользователей уже занят другим звонком")
	ErrCallNotFound     = errors.New("звонок не найден")
	ErrCallForbidden    = errors.New("нет доступа к звонку")
	ErrInvalidCallState = errors.New("некорректное состояние звонка")
	ErrInvalidCallKind  = errors.New("поддерживаются только audio и video звонки")
	ErrCallUnavailable  = errors.New("пользователь недоступен для звонка")
)

type CallSession struct {
	ID         string
	CallerID   uint
	CalleeID   uint
	Kind       string
	State      CallState
	CreatedAt  time.Time
	AcceptedAt *time.Time
}

func (s *CallSession) OtherUserID(userID uint) uint {
	if s.CallerID == userID {
		return s.CalleeID
	}
	if s.CalleeID == userID {
		return s.CallerID
	}
	return 0
}

func (s *CallSession) HasParticipant(userID uint) bool {
	return s.CallerID == userID || s.CalleeID == userID
}

type CallRegistry struct {
	mu          sync.Mutex
	sessions    map[string]*CallSession
	userSession map[uint]string
}

func NewCallRegistry() *CallRegistry {
	return &CallRegistry{
		sessions:    map[string]*CallSession{},
		userSession: map[uint]string{},
	}
}

func randomCallID() string {
	var buf [12]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format("20060102150405.000000")))
	}
	return hex.EncodeToString(buf[:])
}

func normalizeCallKind(kind string) string {
	switch kind {
	case "audio", "video":
		return kind
	default:
		return ""
	}
}

func (r *CallRegistry) Create(callerID, calleeID uint, kind string) (*CallSession, error) {
	normalizedKind := normalizeCallKind(kind)
	if normalizedKind == "" {
		return nil, ErrInvalidCallKind
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if callerID == 0 || calleeID == 0 || callerID == calleeID {
		return nil, ErrCallForbidden
	}
	if r.userSession[callerID] != "" || r.userSession[calleeID] != "" {
		return nil, ErrCallBusy
	}

	session := &CallSession{
		ID:        randomCallID(),
		CallerID:  callerID,
		CalleeID:  calleeID,
		Kind:      normalizedKind,
		State:     CallStateRinging,
		CreatedAt: time.Now().UTC(),
	}
	r.sessions[session.ID] = session
	r.userSession[callerID] = session.ID
	r.userSession[calleeID] = session.ID
	return cloneCallSession(session), nil
}

func (r *CallRegistry) Get(id string) (*CallSession, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	session, ok := r.sessions[id]
	if !ok {
		return nil, false
	}
	return cloneCallSession(session), true
}

func (r *CallRegistry) Accept(id string, userID uint) (*CallSession, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	session, ok := r.sessions[id]
	if !ok {
		return nil, ErrCallNotFound
	}
	if session.CalleeID != userID {
		return nil, ErrCallForbidden
	}
	if session.State != CallStateRinging {
		return nil, ErrInvalidCallState
	}
	now := time.Now().UTC()
	session.State = CallStateActive
	session.AcceptedAt = &now
	return cloneCallSession(session), nil
}

func (r *CallRegistry) End(id string, userID uint) (*CallSession, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	session, ok := r.sessions[id]
	if !ok {
		return nil, ErrCallNotFound
	}
	if userID != 0 && !session.HasParticipant(userID) {
		return nil, ErrCallForbidden
	}
	session.State = CallStateEnded
	cloned := cloneCallSession(session)
	delete(r.sessions, id)
	delete(r.userSession, session.CallerID)
	delete(r.userSession, session.CalleeID)
	return cloned, nil
}

func (r *CallRegistry) ExpireRinging(id string) (*CallSession, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	session, ok := r.sessions[id]
	if !ok || session.State != CallStateRinging {
		return nil, false
	}
	session.State = CallStateEnded
	cloned := cloneCallSession(session)
	delete(r.sessions, id)
	delete(r.userSession, session.CallerID)
	delete(r.userSession, session.CalleeID)
	return cloned, true
}

func (r *CallRegistry) EndForUser(userID uint) (*CallSession, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	sessionID := r.userSession[userID]
	if sessionID == "" {
		return nil, false
	}
	session, ok := r.sessions[sessionID]
	if !ok {
		delete(r.userSession, userID)
		return nil, false
	}
	session.State = CallStateEnded
	cloned := cloneCallSession(session)
	delete(r.sessions, sessionID)
	delete(r.userSession, session.CallerID)
	delete(r.userSession, session.CalleeID)
	return cloned, true
}

func cloneCallSession(session *CallSession) *CallSession {
	if session == nil {
		return nil
	}
	cloned := *session
	if session.AcceptedAt != nil {
		acceptedAt := *session.AcceptedAt
		cloned.AcceptedAt = &acceptedAt
	}
	return &cloned
}

var DefaultCallRegistry = NewCallRegistry()

package handler

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// securityHeaders are baseline response headers for every endpoint. CSP is
// left to the front ends because the media path serves arbitrary image bytes.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

// rateLimiter is a per-client token bucket. It degrades to per-IP keying when
// the remote address is unparsable (e.g. unit-test transports), which keeps
// local runs working while production traffic stays partitioned.
type rateLimiter struct {
	mu        sync.Mutex
	rate      int
	buckets   map[string]*bucket
	lastSweep time.Time
}

type bucket struct {
	tokens    float64
	lastTaken time.Time
}

func newRateLimiter(requestsPerMinute int) *rateLimiter {
	// Zero disables limiting entirely; it is the test/local default. The
	// env default for deployments is 60.
	if requestsPerMinute <= 0 {
		return nil
	}
	return &rateLimiter{rate: requestsPerMinute, buckets: map[string]*bucket{}, lastSweep: time.Now()}
}

func (l *rateLimiter) allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.lastSweep) > time.Minute {
		for key, entry := range l.buckets {
			if now.Sub(entry.lastTaken) > 10*time.Minute {
				delete(l.buckets, key)
			}
		}
		l.lastSweep = now
	}
	entry, ok := l.buckets[key]
	if !ok {
		entry = &bucket{tokens: float64(l.rate), lastTaken: now}
		l.buckets[key] = entry
	}
	elapsed := now.Sub(entry.lastTaken).Minutes()
	entry.tokens += elapsed * float64(l.rate)
	if entry.tokens > float64(l.rate) {
		entry.tokens = float64(l.rate)
	}
	entry.lastTaken = now
	if entry.tokens < 1 {
		return false
	}
	entry.tokens--
	return true
}

func (l *rateLimiter) middleware(next http.Handler) http.Handler {
	if l == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			key = r.RemoteAddr
		}
		if !l.allow(key) {
			WriteError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Slow down and try again shortly.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

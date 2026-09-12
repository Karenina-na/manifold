package handler

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
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

func trustedProxyNetworks(values []string) []*net.IPNet {
	networks := make([]*net.IPNet, 0, len(values))
	for _, value := range values {
		_, network, err := net.ParseCIDR(strings.TrimSpace(value))
		if err == nil {
			networks = append(networks, network)
		}
	}
	return networks
}

func clientAddress(r *http.Request, trustedProxies []*net.IPNet) string {
	remote := r.RemoteAddr
	if host, _, err := net.SplitHostPort(remote); err == nil {
		remote = host
	}
	remoteIP := net.ParseIP(remote)
	if remoteIP == nil {
		return remote
	}
	for _, network := range trustedProxies {
		if !network.Contains(remoteIP) {
			continue
		}
		forwardedIP := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP")))
		if forwardedIP != nil {
			return forwardedIP.String()
		}
		break
	}
	return remoteIP.String()
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

func (l *rateLimiter) middleware(trustedProxies []*net.IPNet) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if l == nil {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := clientAddress(r, trustedProxies)
			if !l.allow(key) {
				WriteError(w, http.StatusTooManyRequests, apierror.RateLimited, "Too many requests. Slow down and try again shortly.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

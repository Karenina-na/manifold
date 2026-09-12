package store

import (
	"testing"
	"time"
)

// nowRFC3339 and timeNowUTC are one clock decision in two shapes: every SQL
// timestamp column in this package is written by the first, and every
// "is this still current" comparison is computed from the second. They were
// separate time.Now().UTC() calls before; the test pins the property that made
// merging them safe — same instant, UTC, RFC3339 — so a change to one of them
// cannot silently leave the other behind.
func TestNowRFC3339IsTheUTCTimeHelperFormatted(t *testing.T) {
	before := timeNowUTC()
	formatted := nowRFC3339()
	after := timeNowUTC()

	parsed, err := time.Parse(time.RFC3339, formatted)
	if err != nil {
		t.Fatalf("nowRFC3339() = %q, which is not RFC3339: %v", formatted, err)
	}
	if parsed.Location() != time.UTC {
		t.Fatalf("nowRFC3339() = %q, want a UTC timestamp", formatted)
	}
	// Both helpers read the same clock, so the formatted value has to fall
	// inside the window the two samples bound. A local-time or drifted
	// implementation lands outside it.
	if parsed.Before(before.Add(-time.Second)) || parsed.After(after.Add(time.Second)) {
		t.Fatalf("nowRFC3339() = %q falls outside the window [%s, %s]", formatted, before.Format(time.RFC3339Nano), after.Format(time.RFC3339Nano))
	}
}

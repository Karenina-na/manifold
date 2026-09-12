package handler

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

// Profile field limits. Core is the business authority, so the constraints
// live here rather than only in the Admin form's zod schema: the form is one
// caller among several, and a direct caller could previously persist an
// unbounded bio or a javascript: URL that the public site renders straight
// into an href. The values match the Admin schema so the form's inline error
// and Core's 422 agree instead of contradicting each other.
//
// Lengths are counted in runes, not bytes, because the contract talks about
// characters: a byte cap would reject a CJK bio at roughly a third of the
// documented limit.
const (
	maxProfileDisplayName    = 160
	maxProfileHandle         = 80
	maxProfileHeadline       = 240
	maxProfileBio            = 4000
	maxProfileLocation       = 160
	maxProfileOrganization   = 160
	maxProfileURL            = 500
	maxProfileInterest       = 60
	maxProfileItemName       = 160
	maxProfilePeriod         = 80
	maxProfileSeriesDesc     = 400
	maxProfileSeriesCategory = 80
	maxProfileContactLabel   = 80
	maxProfileContactHandle  = 120
	maxProfileContactIcon    = 40
)

// validateProfileInput enforces every profile value constraint at the Core
// boundary. Field presence and JSON types are the caller's job (the handler
// rejects absent or non-string fields before this runs); this function decides
// whether the values themselves are admissible.
//
// Values are trimmed before measuring, so surrounding whitespace cannot be
// used to smuggle a value past a length or scheme check, but what gets stored
// is exactly what was submitted — this function validates, it does not rewrite.
func validateProfileInput(p model.Profile) error {
	if err := limitText("displayName", p.DisplayName, maxProfileDisplayName); err != nil {
		return err
	}
	for _, field := range []struct {
		name  string
		value string
		max   int
	}{
		{"handle", p.Handle, maxProfileHandle},
		{"headline", p.Headline, maxProfileHeadline},
		{"bio", p.Bio, maxProfileBio},
		{"location", p.Location, maxProfileLocation},
		{"organization", p.Organization, maxProfileOrganization},
	} {
		if err := limitText(field.name, field.value, field.max); err != nil {
			return err
		}
	}
	if err := limitURL("avatarUrl", p.AvatarURL, false); err != nil {
		return err
	}
	if err := limitURL("websiteUrl", p.WebsiteURL, false); err != nil {
		return err
	}
	if p.ResumeURL != nil {
		if err := limitURL("resumeUrl", *p.ResumeURL, false); err != nil {
			return err
		}
	}
	for index, interest := range p.Interests {
		if err := requireText(fmt.Sprintf("interests[%d]", index), interest, maxProfileInterest); err != nil {
			return err
		}
	}
	for index, item := range p.Education {
		if err := requireText(fmt.Sprintf("education[%d].institution", index), item.Institution, maxProfileItemName); err != nil {
			return err
		}
		if err := requireText(fmt.Sprintf("education[%d].program", index), item.Program, maxProfileItemName); err != nil {
			return err
		}
		if err := requireText(fmt.Sprintf("education[%d].period", index), item.Period, maxProfilePeriod); err != nil {
			return err
		}
	}
	for index, item := range p.Experience {
		if err := requireText(fmt.Sprintf("experience[%d].organization", index), item.Organization, maxProfileItemName); err != nil {
			return err
		}
		if err := requireText(fmt.Sprintf("experience[%d].role", index), item.Role, maxProfileItemName); err != nil {
			return err
		}
		if err := requireText(fmt.Sprintf("experience[%d].period", index), item.Period, maxProfilePeriod); err != nil {
			return err
		}
	}
	for index, item := range p.Series {
		if err := requireText(fmt.Sprintf("series[%d].name", index), item.Name, maxProfileItemName); err != nil {
			return err
		}
		if err := requireURL(fmt.Sprintf("series[%d].url", index), item.URL, true); err != nil {
			return err
		}
		if err := limitText(fmt.Sprintf("series[%d].description", index), item.Description, maxProfileSeriesDesc); err != nil {
			return err
		}
		if item.Category != nil {
			if err := limitText(fmt.Sprintf("series[%d].category", index), *item.Category, maxProfileSeriesCategory); err != nil {
				return err
			}
		}
	}
	for index, contact := range p.Contacts {
		if err := requireText(fmt.Sprintf("contacts[%d].label", index), contact.Label, maxProfileContactLabel); err != nil {
			return err
		}
		if err := requireURL(fmt.Sprintf("contacts[%d].url", index), contact.URL, true); err != nil {
			return err
		}
		if contact.Handle != nil {
			if err := limitText(fmt.Sprintf("contacts[%d].handle", index), *contact.Handle, maxProfileContactHandle); err != nil {
				return err
			}
		}
		if contact.Icon != nil {
			if err := limitText(fmt.Sprintf("contacts[%d].icon", index), *contact.Icon, maxProfileContactIcon); err != nil {
				return err
			}
		}
	}
	return nil
}

// requireText rejects a field that is blank once trimmed, or longer than max
// runes. It is for values the contract treats as meaningful — a link label or
// an institution — where an empty string is a data error rather than a choice.
func requireText(name, value string, max int) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", name)
	}
	return limitText(name, value, max)
}

// limitText caps a field at max runes and nothing else: empty and
// whitespace-only values pass, because this function does not decide whether a
// field is required. Non-empty requirements come from requireText for the
// structured fields and from the handler's presence check for displayName.
func limitText(name, value string, max int) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	if utf8.RuneCountInString(trimmed) > max {
		return fmt.Errorf("%s must be at most %d characters", name, max)
	}
	return nil
}

// limitURL accepts an empty value (the field is optional) and otherwise
// requires an absolute http(s) URL, or — when allowMailto is set, for series
// and contact links — a mailto: address. Anything else is rejected, which is
// what keeps javascript:/data: payloads out of the public site's hrefs.
func limitURL(name, value string, allowMailto bool) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	allowed := []string{"http://", "https://"}
	if allowMailto {
		allowed = append(allowed, "mailto:")
	}
	if !hasAnyScheme(trimmed, allowed) {
		if allowMailto {
			return fmt.Errorf("%s must be an http(s) or mailto URL", name)
		}
		return fmt.Errorf("%s must be an http(s) URL", name)
	}
	return limitText(name, trimmed, maxProfileURL)
}

// requireURL is limitURL for the links the contract treats as required, so the
// empty case reports a missing field rather than a bad scheme.
func requireURL(name, value string, allowMailto bool) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", name)
	}
	return limitURL(name, value, allowMailto)
}

// hasAnyScheme reports whether value starts with one of the given schemes,
// compared case-insensitively. Prefix matching is deliberate: the point is to
// pin the scheme, not to validate the rest of the URL, and browsers treat any
// other prefix — including control-character-obfuscated javascript: — as a
// scheme we did not allow.
func hasAnyScheme(value string, schemes []string) bool {
	lowered := strings.ToLower(value)
	for _, scheme := range schemes {
		if strings.HasPrefix(lowered, scheme) {
			return true
		}
	}
	return false
}

package store

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Store) GetProfile() (model.Profile, error) {
	var p model.Profile
	var resume sql.NullString
	var interests, education, experience, series, contacts string
	err := s.DB.QueryRow(`SELECT id, display_name, handle, headline, bio, avatar_url, location, organization, website_url, resume_url, interests_json, education_json, experience_json, series_json, contacts_json, updated_at FROM profile WHERE id = 'profile_1'`).Scan(&p.ID, &p.DisplayName, &p.Handle, &p.Headline, &p.Bio, &p.AvatarURL, &p.Location, &p.Organization, &p.WebsiteURL, &resume, &interests, &education, &experience, &series, &contacts, &p.UpdatedAt)
	if err != nil {
		return model.Profile{}, err
	}
	if resume.Valid {
		p.ResumeURL = &resume.String
	}
	_ = json.Unmarshal([]byte(interests), &p.Interests)
	_ = json.Unmarshal([]byte(education), &p.Education)
	_ = json.Unmarshal([]byte(experience), &p.Experience)
	_ = json.Unmarshal([]byte(series), &p.Series)
	_ = json.Unmarshal([]byte(contacts), &p.Contacts)
	if p.Interests == nil {
		p.Interests = []string{}
	}
	if p.Education == nil {
		p.Education = []model.ProfileEducationItem{}
	}
	if p.Experience == nil {
		p.Experience = []model.ProfileExperienceItem{}
	}
	if p.Series == nil {
		p.Series = []model.ProfileSeriesItem{}
	}
	if p.Contacts == nil {
		p.Contacts = []model.ProfileContact{}
	}
	return p, nil
}

func (s *Store) UpdateProfile(p model.Profile) error {
	_, err := s.DB.Exec(`UPDATE profile SET display_name = ?, handle = ?, headline = ?, bio = ?, avatar_url = ?, location = ?, organization = ?, website_url = ?, resume_url = ?, interests_json = ?, education_json = ?, experience_json = ?, series_json = ?, contacts_json = ?, updated_at = ? WHERE id = 'profile_1'`, p.DisplayName, p.Handle, p.Headline, p.Bio, p.AvatarURL, p.Location, p.Organization, p.WebsiteURL, p.ResumeURL, encodeJSON(p.Interests), encodeJSON(p.Education), encodeJSON(p.Experience), encodeJSON(p.Series), encodeJSON(p.Contacts), nowRFC3339())
	return err
}

func (s *Store) GetSiteConfig() (model.SiteConfig, error) {
	var title, description, footerText, rawSocial, rawNavigation, rawSections string
	var commentsEnabled int
	if err := s.DB.QueryRow(`SELECT title, description, footer_text, social_json, comments_enabled, navigation_json, sections_json FROM site_config WHERE id = 'site_1'`).Scan(&title, &description, &footerText, &rawSocial, &commentsEnabled, &rawNavigation, &rawSections); err != nil {
		return model.SiteConfig{}, err
	}
	var config model.SiteConfig
	config.Title = title
	config.Description = description
	config.Footer = footerText
	config.CommentsEnabled = commentsEnabled != 0
	if err := json.Unmarshal([]byte(rawSocial), &config.Social); err != nil {
		return model.SiteConfig{}, err
	}
	if err := json.Unmarshal([]byte(rawNavigation), &config.Navigation); err != nil {
		return model.SiteConfig{}, err
	}
	if err := json.Unmarshal([]byte(rawSections), &config.Sections); err != nil {
		return model.SiteConfig{}, err
	}
	return config, nil
}

func (s *Store) UpdateSiteConfig(config model.SiteConfig) error {
	_, err := s.DB.Exec(`UPDATE site_config SET title = ?, description = ?, footer_text = ?, social_json = ?, comments_enabled = ?, navigation_json = ?, sections_json = ?, updated_at = ? WHERE id = 'site_1'`, config.Title, config.Description, config.Footer, encodeJSON(config.Social), boolToInt(config.CommentsEnabled), encodeJSON(config.Navigation), encodeJSON(config.Sections), nowRFC3339())
	return err
}

func (s *Store) GetThoughtConfig() (model.ThoughtConfig, error) {
	var config model.ThoughtConfig
	var featuredThoughtID sql.NullString
	err := s.DB.QueryRow(`SELECT featured_thought_id, updated_at FROM thoughts_config WHERE id = 'thoughts_1'`).Scan(&featuredThoughtID, &config.UpdatedAt)
	if featuredThoughtID.Valid {
		config.FeaturedThoughtID = &featuredThoughtID.String
	}
	return config, err
}

func (s *Store) UpdateThoughtConfig(featuredThoughtID *string) error {
	_, err := s.DB.Exec(`UPDATE thoughts_config SET featured_thought_id = ?, updated_at = ? WHERE id = 'thoughts_1'`, featuredThoughtID, nowRFC3339())
	return err
}

func (s *Store) GetWritingConfig() (model.WritingConfig, error) {
	var config model.WritingConfig
	var featuredWritingID sql.NullString
	err := s.DB.QueryRow(`SELECT featured_writing_id, updated_at FROM writings_config WHERE id = 'writings_1'`).Scan(&featuredWritingID, &config.UpdatedAt)
	if featuredWritingID.Valid {
		config.FeaturedWritingID = &featuredWritingID.String
	}
	return config, err
}

func (s *Store) UpdateWritingConfig(featuredWritingID *string) error {
	_, err := s.DB.Exec(`UPDATE writings_config SET featured_writing_id = ?, updated_at = ? WHERE id = 'writings_1'`, featuredWritingID, nowRFC3339())
	return err
}

func (s *Store) TouchPresence(visitorID string) (int, error) {
	now := time.Now().UTC()
	cutoff := now.Add(-presenceTTL).Format(time.RFC3339)
	if _, err := s.DB.Exec(`DELETE FROM presence WHERE last_seen_at < ?`, cutoff); err != nil {
		return 0, err
	}
	if _, err := s.DB.Exec(`INSERT INTO presence (visitor_id, last_seen_at) VALUES (?, ?) ON CONFLICT(visitor_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`, visitorID, now.Format(time.RFC3339)); err != nil {
		return 0, err
	}
	var activeVisitors int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM presence WHERE last_seen_at >= ?`, cutoff).Scan(&activeVisitors); err != nil {
		return 0, err
	}
	return activeVisitors, nil
}

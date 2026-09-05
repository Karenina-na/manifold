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
	err := s.DB.QueryRow(`SELECT updated_at FROM thoughts_config WHERE id = 'thoughts_1'`).Scan(&config.UpdatedAt)
	if err != nil {
		return model.ThoughtConfig{}, err
	}
	pinned, err := s.GetPinnedIds(model.ContentKindThought)
	if err != nil {
		return model.ThoughtConfig{}, err
	}
	config.PinnedIds = pinned
	return config, nil
}

func (s *Store) GetWritingConfig() (model.WritingConfig, error) {
	var config model.WritingConfig
	err := s.DB.QueryRow(`SELECT updated_at FROM writings_config WHERE id = 'writings_1'`).Scan(&config.UpdatedAt)
	if err != nil {
		return model.WritingConfig{}, err
	}
	pinned, err := s.GetPinnedIds(model.ContentKindArticle)
	if err != nil {
		return model.WritingConfig{}, err
	}
	config.PinnedIds = pinned
	return config, nil
}

func (s *Store) GetPinnedIds(kind model.ContentKind) ([]string, error) {
	rows, err := s.DB.Query(`SELECT content_id FROM pins WHERE kind = ? ORDER BY position ASC, created_at ASC`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// SetPinnedIds replaces the whole pin set for a kind. Order in pins is the
// position index: callers pass the intended display order. The config
// singleton's updated_at advances so admin reads reflect the last mutation.
func (s *Store) SetPinnedIds(kind model.ContentKind, ids []string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM pins WHERE kind = ?`, kind); err != nil {
		return err
	}
	now := nowRFC3339()
	for index, id := range ids {
		if _, err := tx.Exec(`INSERT INTO pins (content_id, kind, position, created_at) VALUES (?, ?, ?, ?)`, id, kind, index, now); err != nil {
			return err
		}
	}
	configTable := "thoughts_config"
	configID := "thoughts_1"
	if kind == model.ContentKindArticle {
		configTable = "writings_config"
		configID = "writings_1"
	}
	if _, err := tx.Exec(`UPDATE `+configTable+` SET updated_at = ? WHERE id = ?`, now, configID); err != nil {
		return err
	}
	return tx.Commit()
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

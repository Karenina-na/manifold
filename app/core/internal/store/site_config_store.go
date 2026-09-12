package store

import (
	"context"
	"encoding/json"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Store) GetSiteConfig(ctx context.Context) (model.SiteConfig, error) {
	var title, description, footerText, rawSocial, rawNavigation, rawSections string
	var commentsEnabled int
	if err := s.DB.QueryRowContext(ctx, `SELECT title, description, footer_text, social_json, comments_enabled, navigation_json, sections_json FROM site_config WHERE id = 'site_1'`).Scan(&title, &description, &footerText, &rawSocial, &commentsEnabled, &rawNavigation, &rawSections); err != nil {
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

func (s *Store) UpdateSiteConfig(ctx context.Context, config model.SiteConfig) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE site_config SET title = ?, description = ?, footer_text = ?, social_json = ?, comments_enabled = ?, navigation_json = ?, sections_json = ?, updated_at = ? WHERE id = 'site_1'`, config.Title, config.Description, config.Footer, encodeJSON(config.Social), boolToInt(config.CommentsEnabled), encodeJSON(config.Navigation), encodeJSON(config.Sections), nowRFC3339())
	return err
}

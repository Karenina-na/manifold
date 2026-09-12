package store

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Store) GetProfile(ctx context.Context) (model.Profile, error) {
	var p model.Profile
	var resume sql.NullString
	var interests, education, experience, series, contacts string
	err := s.DB.QueryRowContext(ctx, `SELECT id, display_name, handle, headline, bio, avatar_url, location, organization, website_url, resume_url, interests_json, education_json, experience_json, series_json, contacts_json, updated_at FROM profile WHERE id = 'profile_1'`).Scan(&p.ID, &p.DisplayName, &p.Handle, &p.Headline, &p.Bio, &p.AvatarURL, &p.Location, &p.Organization, &p.WebsiteURL, &resume, &interests, &education, &experience, &series, &contacts, &p.UpdatedAt)
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

func (s *Store) UpdateProfile(ctx context.Context, p model.Profile) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE profile SET display_name = ?, handle = ?, headline = ?, bio = ?, avatar_url = ?, location = ?, organization = ?, website_url = ?, resume_url = ?, interests_json = ?, education_json = ?, experience_json = ?, series_json = ?, contacts_json = ?, updated_at = ? WHERE id = 'profile_1'`, p.DisplayName, p.Handle, p.Headline, p.Bio, p.AvatarURL, p.Location, p.Organization, p.WebsiteURL, p.ResumeURL, encodeJSON(p.Interests), encodeJSON(p.Education), encodeJSON(p.Experience), encodeJSON(p.Series), encodeJSON(p.Contacts), nowRFC3339())
	return err
}

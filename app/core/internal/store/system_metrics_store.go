package store

func (s *Store) DatabaseSizeBytes() (int64, error) {
	var pageCount, pageSize int64
	if err := s.DB.QueryRow(`PRAGMA page_count`).Scan(&pageCount); err != nil {
		return 0, err
	}
	if err := s.DB.QueryRow(`PRAGMA page_size`).Scan(&pageSize); err != nil {
		return 0, err
	}
	return pageCount * pageSize, nil
}

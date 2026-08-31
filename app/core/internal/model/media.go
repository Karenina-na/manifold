package model

// Media is an uploaded binary asset. SHA256 feeds the ETag on the serving
// path but is not part of the public contract; URL is filled by the handler
// because only it knows the request/public origin.
type Media struct {
	ID        string `json:"id"`
	URL       string `json:"url,omitempty"`
	Mime      string `json:"mime"`
	Size      int64  `json:"size"`
	Filename  string `json:"filename"`
	SHA256    string `json:"-"`
	CreatedAt string `json:"createdAt"`
}

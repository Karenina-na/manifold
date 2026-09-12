package model

// Media is an uploaded binary asset. SHA256 feeds the ETag on the serving
// path but is not part of the public contract; URL is filled by the handler
// because only it knows the request/public origin.
//
// URL has no `omitempty` on purpose: the shared contract declares `url` as a
// required string, so dropping the key whenever the handler had nothing to put
// in it would break every typed client instead of surfacing the bug.
type Media struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Mime      string `json:"mime"`
	Size      int64  `json:"size"`
	Filename  string `json:"filename"`
	SHA256    string `json:"-"`
	CreatedAt string `json:"createdAt"`
}

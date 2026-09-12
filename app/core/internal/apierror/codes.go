// Package apierror holds every error code Core can put in an error body.
//
// This file is the Go half of the error-code contract: the TypeScript half is
// API_ERROR_CODES in packages/contracts/src/index.ts, and
// packages/contracts/test/error-codes.test.ts fails if the two lists are not
// identical. Adding, renaming or removing a code here therefore requires the
// same change on the contracts side, which is what keeps client-side
// switch (error.code) branches from silently rotting.
//
// Codes are untyped string constants so they can be passed straight to
// WriteError without conversion.
package apierror

// 会话与鉴权
const (
	Unauthorized          = "UNAUTHORIZED"
	Forbidden             = "FORBIDDEN"
	InvalidCredentials    = "INVALID_CREDENTIALS"
	SessionUnavailable    = "SESSION_UNAVAILABLE"
	SessionsUnavailable   = "SESSIONS_UNAVAILABLE"
	SessionNotFound       = "SESSION_NOT_FOUND"
	SessionRevokeFailed   = "SESSION_REVOKE_FAILED"
	PasswordChangeFailed  = "PASSWORD_CHANGE_FAILED"
	InvalidVisitorSession = "INVALID_VISITOR_SESSION"
	VisitorIDInvalid      = "VISITOR_ID_INVALID"
)

// 第三方登录
const (
	GitHubAuthDisabled  = "GITHUB_AUTH_DISABLED"
	GitHubAuthFailed    = "GITHUB_AUTH_FAILED"
	GitHubProfileFailed = "GITHUB_PROFILE_FAILED"
	IdentityUnavailable = "IDENTITY_UNAVAILABLE"
)

// 请求校验与限流
const (
	ValidationError = "VALIDATION_ERROR"
	InvalidJSON     = "INVALID_JSON"
	InvalidQuery    = "INVALID_QUERY"
	PayloadTooLarge = "PAYLOAD_TOO_LARGE"
	RateLimited     = "RATE_LIMITED"
)

// 内容
const (
	ContentNotFound      = "CONTENT_NOT_FOUND"
	ContentUnavailable   = "CONTENT_UNAVAILABLE"
	ContentCreateFailed  = "CONTENT_CREATE_FAILED"
	ContentUpdateFailed  = "CONTENT_UPDATE_FAILED"
	ContentRestoreFailed = "CONTENT_RESTORE_FAILED"
	SlugTaken            = "SLUG_TAKEN"
	VersionConflict      = "VERSION_CONFLICT"
)

// 评论与反应
const (
	CommentNotFound     = "COMMENT_NOT_FOUND"
	CommentCreateFailed = "COMMENT_CREATE_FAILED"
	CommentUpdateFailed = "COMMENT_UPDATE_FAILED"
	CommentDeleted      = "COMMENT_DELETED"
	CommentDisabled     = "COMMENT_DISABLED"
	CommentsUnavailable = "COMMENTS_UNAVAILABLE"
	ReplyTargetInvalid  = "REPLY_TARGET_INVALID"
	LikesUnavailable    = "LIKES_UNAVAILABLE"
	LikeUpdateFailed    = "LIKE_UPDATE_FAILED"
)

// 媒体
const (
	MediaNotFound        = "MEDIA_NOT_FOUND"
	MediaUnavailable     = "MEDIA_UNAVAILABLE"
	MediaDeleteFailed    = "MEDIA_DELETE_FAILED"
	MediaTooLarge        = "MEDIA_TOO_LARGE"
	MediaTypeUnsupported = "MEDIA_TYPE_UNSUPPORTED"
	MediaUnreadable      = "MEDIA_UNREADABLE"
	MediaInUse           = "MEDIA_IN_USE"
)

// Profile 与站点配置
const (
	ProfileUnavailable        = "PROFILE_UNAVAILABLE"
	ProfileUpdateFailed       = "PROFILE_UPDATE_FAILED"
	SiteUnavailable           = "SITE_UNAVAILABLE"
	SiteUpdateFailed          = "SITE_UPDATE_FAILED"
	ThoughtConfigUnavailable  = "THOUGHT_CONFIG_UNAVAILABLE"
	ThoughtConfigUpdateFailed = "THOUGHT_CONFIG_UPDATE_FAILED"
	WritingConfigUnavailable  = "WRITING_CONFIG_UNAVAILABLE"
	WritingConfigUpdateFailed = "WRITING_CONFIG_UPDATE_FAILED"
)

// 管理端系统视图
const (
	OverviewUnavailable  = "OVERVIEW_UNAVAILABLE"
	AnalyticsUnavailable = "ANALYTICS_UNAVAILABLE"
	AuditUnavailable     = "AUDIT_UNAVAILABLE"
	StatsUnavailable     = "STATS_UNAVAILABLE"
	SystemUnavailable    = "SYSTEM_UNAVAILABLE"
)

// 公开端聚合视图
const (
	PresenceUnavailable = "PRESENCE_UNAVAILABLE"
	TagsUnavailable     = "TAGS_UNAVAILABLE"
)

// 锚定链
const (
	ChainUnavailable   = "CHAIN_UNAVAILABLE"
	BlockNotFound      = "BLOCK_NOT_FOUND"
	AnchorNotFound     = "ANCHOR_NOT_FOUND"
	AnchorSubmitFailed = "ANCHOR_SUBMIT_FAILED"
)

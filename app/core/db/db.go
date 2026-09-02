// Package db owns the embedded migration scripts. The migrations directory is
// the single schema source of truth; internal/store applies these files at
// startup and nothing else in the binary declares DDL.
package db

import "embed"

//go:embed migrations/*.sql
var MigrationsFS embed.FS

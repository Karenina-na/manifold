.PHONY: core-test core-run build check test
core-test:
	cd apps/core && go test ./...
core-run:
	cd apps/core && go run ./cmd/server
build:
	pnpm build
check:
	cd apps/core && go vet ./...
	pnpm check
test:
	make core-test
	pnpm test

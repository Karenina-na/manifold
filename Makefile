.PHONY: core-test core-run build check test browser-test
core-test:
	cd app/core && go test ./...
core-run:
	cd app/core && go run ./cmd/server
build:
	pnpm build
check:
	cd app/core && go vet ./...
	pnpm check
test:
	make core-test
	pnpm test
browser-test:
	pnpm browser-test

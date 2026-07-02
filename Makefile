.PHONY: all build build-backend build-frontend dev dev-backend dev-frontend test lint clean docker

BINARY_NAME=flexdeck
VERSION?=$(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS=-ldflags "-s -w -X main.version=$(VERSION)"

all: build

build: build-frontend build-backend

build-backend:
	CGO_ENABLED=0 go build $(LDFLAGS) -o bin/$(BINARY_NAME) ./cmd/server

build-frontend:
	cd web && npm ci && npm run build

dev:
	@make -j2 dev-backend dev-frontend

dev-backend:
	@which air > /dev/null || go install github.com/air-verse/air@latest
	air -c .air.toml

dev-frontend:
	cd web && npm run dev

test:
	go test -v -race ./...

test-frontend:
	cd web && npm run test

lint:
	@which golangci-lint > /dev/null || go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.8.0
	golangci-lint run ./...

lint-frontend:
	cd web && npm run lint

typecheck:
	cd web && npm run typecheck

clean:
	rm -rf bin/ web/dist/

docker:
	docker build -t flexdeck:$(VERSION) .

deps:
	go mod download
	go mod tidy
	cd web && npm ci

install: build
	cp bin/$(BINARY_NAME) $(HOME)/.local/bin/

# Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/web

COPY web/package*.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

# Build backend
FROM golang:1.24-alpine AS backend-builder
WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /flexdeck ./cmd/server

# Runtime
FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata && \
    adduser -D -u 1000 flexdeck

WORKDIR /app

COPY --from=backend-builder /flexdeck /app/flexdeck
COPY --from=frontend-builder /app/web/dist /app/web/dist

RUN chown -R flexdeck:flexdeck /app

USER flexdeck

ENV PORT=8080
ENV STATIC_DIR=/app/web/dist

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:8080/api/health || exit 1

ENTRYPOINT ["/app/flexdeck"]

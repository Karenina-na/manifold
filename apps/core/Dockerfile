FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/manifold ./cmd/server

FROM alpine:3.20
RUN adduser -D -u 10001 manifold
USER manifold
COPY --from=build /out/manifold /manifold
EXPOSE 8080
ENTRYPOINT ["/manifold"]

APP_NAME=friendscape-backend

.PHONY: bootstrap-go test build preflight tidy release

bootstrap-go:
	./scripts/bootstrap-go.sh

preflight:
	./scripts/preflight.sh

test:
	go test ./...

build:
	go build -o $(APP_NAME) .

tidy:
	go mod tidy

release: bootstrap-go preflight build

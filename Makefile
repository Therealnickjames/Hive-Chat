# Tavok — Developer Commands
# Run `make help` to see all available commands.

.PHONY: help dev up down logs logs-web logs-gateway logs-stream \
        db-migrate db-studio db-seed clean health build regression-harness \
        test-web test-gateway test-streaming test-unit test-sdk test-e2e test-load test-all demo \
        lint format lint-fix

# Default target
help: ## Show this help
	@echo "Tavok — Available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ============================================================
# LINT & FORMAT
# ============================================================

lint: ## Check formatting and lint across all services
	cd packages/web && pnpm lint
	cd gateway && mix format --check-formatted
	cd gateway && mix credo --strict || true
	cd streaming && gofmt -l . && go vet ./...

format: ## Auto-format all services
	cd packages/web && pnpm format
	cd gateway && mix format
	cd streaming && gofmt -w .

lint-fix: ## Auto-fix lint and formatting issues
	cd packages/web && pnpm lint:fix
	cd packages/web && pnpm format
	cd gateway && mix format
	cd streaming && gofmt -w .

# ============================================================
# DEVELOPMENT
# ============================================================

dev: ## Start all services in development mode (with hot reload)
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build

up: ## Start all services in production mode (detached)
	docker-compose up --build -d

down: ## Stop all services
	docker-compose down

build: ## Build all Docker images without starting
	docker-compose build

# ============================================================
# TESTS
# ============================================================

test-web: ## Run web unit tests (Vitest)
	cd packages/web && npx vitest run

test-gateway: ## Run Elixir gateway unit tests (ExUnit)
	cd gateway && mix test --trace

test-streaming: ## Run Go streaming proxy unit tests
	cd streaming && go test ./... -v -count=1

test-unit: ## Run all unit tests (web + gateway + streaming)
	@echo "=== Web (Vitest) ==="
	cd packages/web && npx vitest run
	@echo ""
	@echo "=== Gateway (ExUnit) ==="
	cd gateway && mix test
	@echo ""
	@echo "=== Streaming (Go) ==="
	cd streaming && go test ./... -v -count=1

test-e2e: ## Run Playwright E2E tests (requires Docker services running)
	cd packages/web && npx playwright test

test-sdk: ## Run Python SDK E2E test (requires Docker services running)
	python scripts/test-sdk.py

test-load: ## Run k6 load tests (requires Docker services running + k6 installed)
	k6 run tests/load/k6-messaging.js
	k6 run tests/load/k6-typing-storm.js

test-all: ## Run all tests (unit + E2E + SDK)
	$(MAKE) test-unit
	$(MAKE) test-e2e
	python scripts/test-sdk.py

# ============================================================
# DEMO
# ============================================================

demo: ## Start demo agents (requires TAVOK_SERVER_ID and TAVOK_CHANNEL_ID)
	docker-compose -f docker-compose.demo.yml up --build

# ============================================================
# REGRESSION HARNESS
# ============================================================

regression-harness: ## Run full regression harness (K-001 through K-022, 130+ assertions)
	pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/regression-harness.ps1 -StartServicesIfDown

# ============================================================
# LOGS
# ============================================================

logs: ## Follow logs from all services
	docker-compose logs -f

logs-web: ## Follow logs from Next.js web service
	docker-compose logs -f web

logs-gateway: ## Follow logs from Elixir gateway
	docker-compose logs -f gateway

logs-stream: ## Follow logs from Go streaming proxy
	docker-compose logs -f streaming

logs-db: ## Follow logs from PostgreSQL
	docker-compose logs -f db

# ============================================================
# DATABASE
# ============================================================

db-migrate: ## Run Prisma migrations
	docker-compose exec web npx prisma migrate dev --schema=./prisma/schema.prisma

db-studio: ## Open Prisma Studio (database browser)
	docker-compose exec web npx prisma studio

db-seed: ## Seed database with demo data
	docker-compose exec web npx prisma db seed

db-reset: ## Reset database (WARNING: destroys all data)
	docker-compose exec web npx prisma migrate reset --schema=./prisma/schema.prisma

# ============================================================
# HEALTH & STATUS
# ============================================================

health: ## Check health of all services
	@echo "Checking services..."
	@echo -n "Web:       " && curl -sf http://localhost:3000/api/health 2>/dev/null && echo "" || echo "UNREACHABLE"
	@echo -n "Gateway:   " && curl -sf http://localhost:4001/api/health 2>/dev/null && echo "" || echo "UNREACHABLE"
	@echo -n "Streaming: " && curl -sf http://localhost:4002/health 2>/dev/null && echo "" || echo "UNREACHABLE"

status: ## Show Docker container status
	docker-compose ps

# ============================================================
# CLEANUP
# ============================================================

clean: ## Stop services and remove all volumes (WARNING: destroys data)
	docker-compose down -v --remove-orphans

prune: ## Remove all unused Docker resources
	docker system prune -f

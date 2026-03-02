# Tavok — Developer Commands
# Run `make help` to see all available commands.

.PHONY: help dev up down logs logs-web logs-gateway logs-stream \
        db-migrate db-studio db-seed clean health build regression-harness \
        test-web test-sdk test-all demo

# Default target
help: ## Show this help
	@echo "Tavok — Available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""

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

test-web: ## Run web unit tests (vitest — 174 tests)
	cd packages/web && npx vitest run

test-sdk: ## Run Python SDK E2E test (requires Docker services running)
	python scripts/test-sdk.py

test-all: ## Run all tests (web unit + SDK E2E)
	cd packages/web && npx vitest run
	python scripts/test-sdk.py

# ============================================================
# DEMO
# ============================================================

demo: ## Start demo agents (requires TAVOK_SERVER_ID and TAVOK_CHANNEL_ID)
	docker-compose -f docker-compose.demo.yml up --build

# ============================================================
# REGRESSION HARNESS
# ============================================================

regression-harness: ## Run scripted regression checks for K-001, K-002, K-003, K-005
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/regression-harness.ps1 -StartServicesIfDown

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

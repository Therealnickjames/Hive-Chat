package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/TavokAI/Tavok/cli/internal/agents"
	"github.com/TavokAI/Tavok/cli/internal/bootstrap"
)

var version = "dev"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		return
	}

	switch os.Args[1] {
	case "init":
		runInit(os.Args[2:])
	case "version", "--version", "-v":
		fmt.Println(version)
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func runInit(args []string) {
	flags := flag.NewFlagSet("init", flag.ExitOnError)
	domain := flags.String("domain", "localhost", "Domain for the Tavok deployment")
	output := flags.String("output", ".env", "Path to the generated env file")
	force := flags.Bool("force", false, "Overwrite the output file if it already exists")
	email := flags.String("email", "admin@tavok.local", "Admin email for bootstrap")
	yes := flags.Bool("yes", false, "Skip interactive prompts, use defaults")
	flags.Parse(args)

	// Determine working directory (use cwd)
	dir, err := os.Getwd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: cannot determine working directory: %v\n", err)
		os.Exit(1)
	}

	// ── Phase 1: Pre-flight checks ──

	fmt.Print("  Checking Docker...          ")
	if !checkDockerBlocking() {
		os.Exit(1)
	}
	fmt.Println("ok")

	// Check if Tavok is already running (skip port checks if so)
	tavokRunning := isTavokRunning(dir)
	if tavokRunning {
		fmt.Println("  Tavok containers detected   (resuming setup)")
	} else {
		// Only check ports if Tavok is NOT already running
		requiredPorts := []int{5555, 4001, 4002, 55432, 6379}
		for _, port := range requiredPorts {
			if err := bootstrap.CheckPort(port); err != nil {
				fmt.Fprintf(os.Stderr, "\nERROR: %v\n", err)
				fmt.Fprintf(os.Stderr, "Free port %d and try again, or stop the conflicting service.\n", port)
				os.Exit(1)
			}
		}
	}

	// ── Phase 2: Write files ──

	fmt.Print("  Writing docker-compose.yml  ")
	if err := bootstrap.WriteDockerCompose(dir, *force); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("ok")

	envPath := filepath.Join(dir, *output)
	fmt.Print("  Writing .env                ")

	// If .env exists and no --force: reuse existing secrets for idempotent resume.
	// This lets users re-run `tavok init` after a partial failure without
	// regenerating secrets (which would break existing DB volumes — DEC-0057).
	var secrets bootstrap.Secrets
	var envExists bool

	if _, statErr := os.Stat(envPath); statErr == nil {
		envExists = true
	}

	if envExists && !*force {
		// Parse existing .env for the admin token so we can resume bootstrap
		existingSecrets, parseErr := bootstrap.ParseEnvSecrets(envPath)
		if parseErr != nil {
			fmt.Fprintf(os.Stderr, "\nERROR: could not read existing %s: %v\n", envPath, parseErr)
			fmt.Fprintln(os.Stderr, "Use --force to regenerate, or fix the file manually.")
			os.Exit(1)
		}
		secrets = existingSecrets
		fmt.Println("exists (reusing)")
	} else {
		var genErr error
		secrets, genErr = bootstrap.NewSecrets()
		if genErr != nil {
			fmt.Fprintf(os.Stderr, "ERROR: generate secrets: %v\n", genErr)
			os.Exit(1)
		}

		config := bootstrap.BuildConfig(*domain, time.Now().UTC(), secrets)
		if err := bootstrap.WriteEnvFile(envPath, config, *force); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: write env: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("ok")
	}

	config := bootstrap.BuildConfig(*domain, time.Now().UTC(), secrets)

	// ── Phase 3: Pull images (skip if already running) ──

	if !tavokRunning {
		fmt.Println("  Pulling images...           (this may take a few minutes)")
		if err := runDockerCompose(dir, "pull"); err != nil {
			fmt.Fprintf(os.Stderr, "\nERROR: docker compose pull failed: %v\n", err)
			fmt.Fprintln(os.Stderr, "Check your internet connection and try: docker compose pull")
			os.Exit(1)
		}

		// ── Phase 4: Start services ──

		fmt.Print("  Starting services...        ")
		if err := runDockerCompose(dir, "up", "-d"); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: docker compose up failed: %v\n", err)
			fmt.Fprintln(os.Stderr, "Check logs with: docker compose logs")
			os.Exit(1)
		}
		fmt.Println("ok")
	} else {
		// Containers are running — reconcile to pick up any .env changes.
		// Docker Compose is idempotent: only recreates containers whose
		// config actually changed. Uses cleaned env (DEC-0058).
		fmt.Print("  Reconciling config...       ")
		if err := runDockerCompose(dir, "up", "-d"); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: docker compose up failed: %v\n", err)
			fmt.Fprintln(os.Stderr, "Check logs with: docker compose logs")
			os.Exit(1)
		}
		fmt.Println("ok")
	}

	// ── Phase 5: Health polling ──

	fmt.Print("  Waiting for health...       ")
	baseURL := config.NextAuthURL
	if err := bootstrap.PollHealth(baseURL, 120*time.Second); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: %v\n", err)
		fmt.Fprintln(os.Stderr, "Check logs with: docker compose logs web")
		os.Exit(1)
	}
	fmt.Println("ok")

	// ── Phase 6: Bootstrap ──

	adminPassword, err := bootstrap.GeneratePassword()
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: generate admin password: %v\n", err)
		os.Exit(1)
	}

	// Derive username from email
	username := "admin"
	if atIdx := len(*email) - len(*email); atIdx >= 0 {
		parts := splitEmail(*email)
		if parts != "" {
			username = parts
		}
	}

	result, err := bootstrap.CallBootstrap(baseURL, secrets.AdminToken, bootstrap.BootstrapRequest{
		Email:       *email,
		Username:    username,
		Password:    adminPassword,
		DisplayName: "Admin",
		ServerName:  "Tavok",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "\nERROR: bootstrap: %v\n", err)
		os.Exit(1)
	}

	if result == nil {
		// Already bootstrapped (403) — try to read existing .tavok.json
		fmt.Println()
		fmt.Println("  Already bootstrapped. Services are running.")

		tavokCfgPath := filepath.Join(dir, ".tavok.json")
		if _, statErr := os.Stat(tavokCfgPath); statErr == nil {
			fmt.Printf("  Config: %s\n", tavokCfgPath)
		}
		fmt.Printf("  Open: %s\n", baseURL)
		return
	}

	// Write .tavok.json (no secrets)
	if err := bootstrap.WriteTavokConfig(dir, bootstrap.TavokConfig{
		URL:        result.URLs.Web,
		GatewayURL: result.URLs.Gateway,
		ServerID:   result.Server.ID,
		ChannelID:  result.Channel.ID,
	}); err != nil {
		fmt.Fprintf(os.Stderr, "WARNING: could not write .tavok.json: %v\n", err)
	}

	// Write credentials file (mode 0600)
	if err := bootstrap.WriteCredentials(dir, *email, adminPassword); err != nil {
		fmt.Fprintf(os.Stderr, "WARNING: could not write .tavok-credentials: %v\n", err)
	}

	// Write .gitignore to prevent accidental secret commits
	if err := bootstrap.WriteGitignore(dir); err != nil {
		fmt.Fprintf(os.Stderr, "WARNING: could not write .gitignore: %v\n", err)
	}

	// ── Phase 6.5: Agent setup ──

	var createdAgents []agents.CreatedAgent

	configPath := filepath.Join(dir, "tavok-agents.yml")
	if agents.ConfigFileExists(dir) {
		// Mode A: Config file
		fmt.Println()
		fmt.Println("  Found tavok-agents.yml")
		created, agentErr := agents.RunFromConfig(baseURL, secrets.AdminToken, result.Server.ID, configPath)
		if agentErr != nil {
			fmt.Fprintf(os.Stderr, "WARNING: agent setup from config: %v\n", agentErr)
		} else {
			createdAgents = created
		}
	} else {
		// Mode B: Interactive wizard
		created, agentErr := agents.RunInteractive(baseURL, secrets.AdminToken, result.Server.ID, *yes)
		if agentErr != nil {
			fmt.Fprintf(os.Stderr, "WARNING: agent setup: %v\n", agentErr)
		} else {
			createdAgents = created
		}
	}

	// Write agent credentials if any were created
	if len(createdAgents) > 0 {
		if err := agents.WriteAgentCredentials(dir, createdAgents); err != nil {
			fmt.Fprintf(os.Stderr, "WARNING: could not write .tavok-agents.json: %v\n", err)
		}
	}

	// ── Phase 7: Print summary ──

	fmt.Println()
	fmt.Printf("  Tavok %s is running at %s\n", version, result.URLs.Web)
	fmt.Println()
	fmt.Println("  ── Login ──")
	fmt.Printf("    Email:    %s\n", *email)
	fmt.Printf("    Password: %s\n", adminPassword)
	fmt.Printf("    Open %s and sign in with these credentials.\n", result.URLs.Web)
	fmt.Println("    (saved to .tavok-credentials — delete after first login)")
	fmt.Println()
	fmt.Printf("  Server: %q (%s)\n", result.Server.Name, result.Server.ID)
	fmt.Printf("  Channel: #%s (%s)\n", result.Channel.Name, result.Channel.ID)

	if len(createdAgents) > 0 {
		fmt.Println()
		fmt.Println("  ── Agents ──")
		for _, a := range createdAgents {
			fmt.Printf("    • %s (%s)\n", a.Name, a.ConnectionMethod)
		}
		fmt.Println("    Credentials saved to .tavok-agents.json")
	}

	fmt.Println()
	fmt.Printf("  Manage agents: open %s → Agents panel, or re-run tavok init\n", result.URLs.Web)
}

// runBootstrapFromExisting handles the case where .env already exists (idempotent re-run).
func runBootstrapFromExisting(dir, domain, email string) {
	config := bootstrap.BuildConfig(domain, time.Now().UTC(), bootstrap.Secrets{})
	baseURL := config.NextAuthURL

	// Check if services are already running
	fmt.Print("  Checking services...        ")
	if err := bootstrap.PollHealth(baseURL, 5*time.Second); err != nil {
		fmt.Println("not running")
		fmt.Println()
		fmt.Println("  .env exists. Start services with: docker compose up -d")
		return
	}
	fmt.Println("running")

	tavokCfgPath := filepath.Join(dir, ".tavok.json")
	if _, err := os.Stat(tavokCfgPath); err == nil {
		fmt.Printf("  Config: %s\n", tavokCfgPath)
	}
	fmt.Printf("  Open: %s\n", baseURL)
}

// isTavokRunning checks if Tavok containers are already running in the given directory.
// Uses cleaned environment to avoid stale shell vars affecting compose (DEC-0058).
func isTavokRunning(dir string) bool {
	cmd := exec.Command("docker", "compose", "ps", "--status=running", "-q")
	cmd.Dir = dir
	cmd.Env = cleanEnvForCompose()
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	// If any container IDs are returned, Tavok is running
	return len(strings.TrimSpace(string(output))) > 0
}

// checkDockerBlocking verifies Docker and Docker Compose are installed. Returns false if missing.
func checkDockerBlocking() bool {
	if _, err := exec.LookPath("docker"); err != nil {
		fmt.Println("MISSING")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "  Docker is required but not installed.")
		switch runtime.GOOS {
		case "linux":
			fmt.Fprintln(os.Stderr, "  Install: https://docs.docker.com/engine/install/")
		case "darwin":
			fmt.Fprintln(os.Stderr, "  Install: brew install --cask docker")
		case "windows":
			fmt.Fprintln(os.Stderr, "  Install: https://docs.docker.com/desktop/install/windows-install/")
		default:
			fmt.Fprintln(os.Stderr, "  Install: https://docs.docker.com/engine/install/")
		}
		return false
	}

	if err := exec.Command("docker", "compose", "version").Run(); err != nil {
		fmt.Println("MISSING")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "  Docker Compose v2 is required but not found.")
		fmt.Fprintln(os.Stderr, "  See: https://docs.docker.com/compose/install/")
		return false
	}

	return true
}

// runDockerCompose executes docker compose with the given args in the specified directory.
// Uses a cleaned environment to ensure .env is always authoritative (DEC-0058).
func runDockerCompose(dir string, args ...string) error {
	cmdArgs := append([]string{"compose"}, args...)
	cmd := exec.Command("docker", cmdArgs...)
	cmd.Dir = dir
	cmd.Env = cleanEnvForCompose()
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// cleanEnvForCompose returns the current process environment with all Tavok-related
// variables stripped out. This prevents stale shell env vars from overriding the .env
// file — Docker Compose gives shell env vars priority over .env (DEC-0058).
func cleanEnvForCompose() []string {
	// Every var referenced in docker-compose.yml via ${VAR} syntax.
	// If shell has these, they override .env — which breaks retry after failure.
	strip := map[string]bool{
		"POSTGRES_USER":           true,
		"POSTGRES_PASSWORD":       true,
		"POSTGRES_DB":             true,
		"POSTGRES_HOST_PORT":      true,
		"DATABASE_URL":            true,
		"REDIS_PASSWORD":          true,
		"REDIS_URL":               true,
		"NEXTAUTH_SECRET":         true,
		"NEXTAUTH_URL":            true,
		"JWT_SECRET":              true,
		"INTERNAL_API_SECRET":     true,
		"SECRET_KEY_BASE":         true,
		"ENCRYPTION_KEY":          true,
		"TAVOK_ADMIN_TOKEN":       true,
		"BIND_ADDRESS":            true,
		"NEXT_PUBLIC_GATEWAY_URL": true,
		"NODE_ENV":                true,
		"MIX_ENV":                 true,
		"GATEWAY_PORT":            true,
		"STREAMING_PORT":          true,
		"DOMAIN":                  true,
		"GATEWAY_WEB_URL":         true,
		"STREAMING_WEB_URL":       true,
	}
	var clean []string
	for _, kv := range os.Environ() {
		if idx := strings.Index(kv, "="); idx > 0 {
			if !strip[kv[:idx]] {
				clean = append(clean, kv)
			}
		}
	}
	return clean
}

// splitEmail returns the local part of an email, sanitized for use as a username.
func splitEmail(email string) string {
	for i, c := range email {
		if c == '@' {
			local := email[:i]
			// Sanitize for username: only letters, numbers, underscores
			var result []byte
			for _, ch := range []byte(local) {
				if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' {
					result = append(result, ch)
				}
			}
			if len(result) >= 3 {
				return string(result)
			}
			return "admin"
		}
	}
	return "admin"
}

func printUsage() {
	fmt.Println("Tavok CLI")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  tavok init [--domain localhost] [--email admin@tavok.local] [--yes] [--force]")
	fmt.Println("  tavok version")
	fmt.Println()
	fmt.Println("The init command sets up a complete Tavok instance:")
	fmt.Println("  1. Writes docker-compose.yml and .env with secure secrets")
	fmt.Println("  2. Pulls pre-built Docker images from ghcr.io")
	fmt.Println("  3. Starts all services")
	fmt.Println("  4. Creates admin account and default server")
	fmt.Println("  5. Interactive agent setup (or reads tavok-agents.yml)")
	fmt.Println("  6. Writes .tavok.json and .tavok-agents.json for SDK auto-discovery")
}

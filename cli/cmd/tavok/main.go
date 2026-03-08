package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

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
	flags.Parse(args)

	// Check if we're in a Tavok checkout
	if !isTavokCheckout() {
		fmt.Fprintln(os.Stderr, "ERROR: docker-compose.yml not found in the current directory.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "tavok init generates .env but must be run inside a Tavok checkout.")
		fmt.Fprintln(os.Stderr, "Clone the repo first, then use the setup script:")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "  git clone https://github.com/TavokAI/Tavok.git")
		fmt.Fprintln(os.Stderr, "  cd Tavok")
		fmt.Fprintf(os.Stderr, "  ./scripts/setup.sh --domain %s\n", *domain)
		fmt.Fprintln(os.Stderr, "  docker compose up -d")
		fmt.Fprintln(os.Stderr, "")
		os.Exit(1)
	}

	// Pre-flight: warn if Docker is missing (non-blocking)
	checkDocker()

	secrets, err := bootstrap.NewSecrets()
	if err != nil {
		fmt.Fprintf(os.Stderr, "generate secrets: %v\n", err)
		os.Exit(1)
	}

	config := bootstrap.BuildConfig(*domain, time.Now().UTC(), secrets)
	if err := bootstrap.WriteEnvFile(*output, config, *force); err != nil {
		fmt.Fprintf(os.Stderr, "write env: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Created %s for %s\n", filepath.Clean(*output), config.Domain)
	fmt.Println()
	if config.Domain == "localhost" {
		fmt.Println("Next: docker compose up -d")
		fmt.Println("      (pulls pre-built images from ghcr.io — no build needed)")
		fmt.Println("Open: http://localhost:5555")
		return
	}

	fmt.Printf("Next: point DNS for %s to your server, then:\n", config.Domain)
	fmt.Println("      docker compose --profile production up -d")
	fmt.Println("      (pulls pre-built images from ghcr.io — no build needed)")
	fmt.Printf("Open: https://%s\n", config.Domain)
}

func isTavokCheckout() bool {
	_, err := os.Stat("docker-compose.yml")
	return err == nil
}

// checkDocker prints warnings if Docker or Docker Compose are not installed.
// Non-blocking — .env is still generated so users can install Docker afterwards.
func checkDocker() {
	dockerOK := true

	if _, err := exec.LookPath("docker"); err != nil {
		dockerOK = false
		fmt.Fprintln(os.Stderr, "⚠ Docker not found.")
		switch runtime.GOOS {
		case "linux":
			fmt.Fprintln(os.Stderr, "  Install: https://docs.docker.com/engine/install/")
		case "darwin":
			fmt.Fprintln(os.Stderr, "  Install: brew install --cask docker")
			fmt.Fprintln(os.Stderr, "      or: https://docs.docker.com/desktop/install/mac-install/")
		case "windows":
			fmt.Fprintln(os.Stderr, "  Install: https://docs.docker.com/desktop/install/windows-install/")
		default:
			fmt.Fprintln(os.Stderr, "  Install: https://docs.docker.com/engine/install/")
		}
		fmt.Fprintln(os.Stderr, "")
	}

	if dockerOK {
		// Only check compose if docker exists (compose is a docker subcommand)
		if err := exec.Command("docker", "compose", "version").Run(); err != nil {
			fmt.Fprintln(os.Stderr, "⚠ docker compose (v2) not found.")
			fmt.Fprintln(os.Stderr, "  Docker Compose v2 ships with Docker Desktop and recent Docker Engine.")
			fmt.Fprintln(os.Stderr, "  See: https://docs.docker.com/compose/install/")
			fmt.Fprintln(os.Stderr, "")
		}
	}
}

func printUsage() {
	fmt.Println("Tavok CLI")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  tavok init [--domain chat.example.com] [--output .env] [--force]")
	fmt.Println("  tavok version")
}

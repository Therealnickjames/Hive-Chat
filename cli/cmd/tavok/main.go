package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
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
	if config.Domain == "localhost" {
		fmt.Println("Next: docker compose up -d")
		fmt.Println("Open: http://localhost:5555")
		return
	}

	fmt.Printf("Next: point DNS for %s to your server and run docker compose --profile production up -d\n", config.Domain)
	fmt.Printf("Open: https://%s\n", config.Domain)
}

func printUsage() {
	fmt.Println("Tavok CLI")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  tavok init [--domain chat.example.com] [--output .env] [--force]")
	fmt.Println("  tavok version")
}

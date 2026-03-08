#!/usr/bin/env bash
set -euo pipefail

REPO="TavokAI/Tavok"
LATEST_RELEASE_API="${TAVOK_LATEST_RELEASE_API:-https://api.github.com/repos/${REPO}/releases/latest}"
RELEASE_BASE="${TAVOK_RELEASE_BASE_URL:-https://github.com/${REPO}/releases/download}"

resolve_version() {
  if [ -n "${TAVOK_VERSION:-}" ]; then
    printf '%s\n' "${TAVOK_VERSION#v}"
    return
  fi

  local version
  version="$(
    curl -fsSL "$LATEST_RELEASE_API" |
      sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' |
      head -n 1
  )"

  if [ -z "$version" ]; then
    echo "Unable to determine the latest Tavok release." >&2
    exit 1
  fi

  printf '%s\n' "$version"
}

resolve_os() {
  case "$(uname -s | tr '[:upper:]' '[:lower:]')" in
    darwin) printf 'darwin\n' ;;
    linux) printf 'linux\n' ;;
    *)
      echo "Unsupported operating system. Tavok install.sh supports macOS and Linux." >&2
      exit 1
      ;;
  esac
}

resolve_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'amd64\n' ;;
    aarch64|arm64) printf 'arm64\n' ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

resolve_install_dir() {
  if [ -n "${TAVOK_INSTALL_DIR:-}" ]; then
    mkdir -p "$TAVOK_INSTALL_DIR"
    printf '%s\n' "$TAVOK_INSTALL_DIR"
    return
  fi

  if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    printf '/usr/local/bin\n'
    return
  fi

  mkdir -p "${HOME}/.local/bin"
  printf '%s\n' "${HOME}/.local/bin"
}

main() {
  local version os arch asset url install_dir tmp_file

  version="$(resolve_version)"
  os="$(resolve_os)"
  arch="$(resolve_arch)"
  asset="tavok-${os}-${arch}"
  url="${RELEASE_BASE}/v${version}/${asset}"
  install_dir="$(resolve_install_dir)"
  tmp_file="$(mktemp "${TMPDIR:-/tmp}/tavok.XXXXXX")"

  trap 'rm -f "$tmp_file"' EXIT

  echo "Downloading Tavok CLI ${version} (${os}/${arch})..."
  curl -fsSL "$url" -o "$tmp_file"
  chmod +x "$tmp_file"
  install -m 755 "$tmp_file" "${install_dir}/tavok"

  echo "Installed Tavok to ${install_dir}/tavok"
  if [ "$install_dir" = "${HOME}/.local/bin" ]; then
    echo "Add ${HOME}/.local/bin to PATH if it is not already available in your shell."
  fi

  echo "Next: run 'tavok version' or use 'tavok init' inside a Tavok checkout."
}

main "$@"

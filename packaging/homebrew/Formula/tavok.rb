class Tavok < Formula
  desc "Bootstrap CLI for self-hosting Tavok"
  homepage "https://tavok.dev"
  version "0.1.0"

  on_macos do
    on_arm do
      url "https://github.com/TavokAI/Tavok/releases/download/v0.1.0/tavok-darwin-arm64.tar.gz"
      sha256 "REPLACE_DARWIN_ARM64_SHA256"
    end

    on_intel do
      url "https://github.com/TavokAI/Tavok/releases/download/v0.1.0/tavok-darwin-amd64.tar.gz"
      sha256 "REPLACE_DARWIN_AMD64_SHA256"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/TavokAI/Tavok/releases/download/v0.1.0/tavok-linux-arm64.tar.gz"
      sha256 "REPLACE_LINUX_ARM64_SHA256"
    end

    on_intel do
      url "https://github.com/TavokAI/Tavok/releases/download/v0.1.0/tavok-linux-amd64.tar.gz"
      sha256 "REPLACE_LINUX_AMD64_SHA256"
    end
  end

  def install
    bin.install "tavok"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/tavok version")
  end
end

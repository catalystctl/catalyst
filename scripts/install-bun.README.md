# Universal Bun Installer

A distribution-independent script to install Bun package manager on any Linux system.

## Features

- **Universal compatibility**: Works on all major Linux distributions
  - Debian/Ubuntu/Linux Mint
  - RHEL/CentOS/Fedora/Rocky/AlmaLinux
  - Arch Linux/Manjaro
  - Alpine Linux
  - openSUSE
  - And any other Linux distribution

- **Automatic dependency installation**: Installs required dependencies (curl, bash, xz) automatically
- **Version selection**: Install the latest version or a specific version
- **Shell integration**: Automatically configures PATH for bash and zsh
- **Verification**: Verifies installation after completion

## Usage

### Basic Usage

```bash
# Install the latest version of Bun
./scripts/install-bun.sh

# Install a specific version
./scripts/install-bun.sh 1.3.9

# Show help
./scripts/install-bun.sh --help
```

### Options

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show help message |
| `--no-shell` | Skip shell integration (don't modify ~/.bashrc or ~/.zshrc) |
| `--deps-only` | Only install dependencies, don't install Bun |

### Examples

```bash
# Install latest Bun with full shell integration
sudo ./scripts/install-bun.sh

# Install specific version
./scripts/install-bun.sh 1.3.9

# Install Bun without modifying shell config
./scripts/install-bun.sh --no-shell

# Only install system dependencies
sudo ./scripts/install-bun.sh --deps-only
```

## What Gets Installed

The script will:
1. Detect your Linux distribution
2. Install required dependencies (curl, bash, xz-utils/xz)
3. Download the official Bun installer
4. Install Bun to `~/.bun/bin/bun`
5. Add Bun to your PATH in `~/.bashrc` or `~/.zshrc`

## After Installation

1. **Reload your shell** (or open a new terminal):
   ```bash
   source ~/.bashrc   # or source ~/.zshrc
   ```

2. **Verify installation**:
   ```bash
   bun --version
   ```

3. **Start using Bun**:
   ```bash
   bun create vite my-app
   cd my-app
   bun install
   bun run dev
   ```

## System Requirements

- **Operating System**: Any Linux distribution
- **Architecture**: x86_64 (amd64) or ARM64 (aarch64)
- **Privileges**: sudo/root access for installing dependencies
- **Network**: Internet connection for downloading Bun

## How It Works

The script:

1. **Detects your distribution** by checking `/etc/os-release` and other distribution-specific files
2. **Installs dependencies** using the appropriate package manager:
   - `apt` for Debian/Ubuntu
   - `yum/dnf` for RHEL/CentOS/Fedora
   - `pacman` for Arch Linux
   - `apk` for Alpine
   - `zypper` for openSUSE
3. **Downloads** the official Bun installer from `https://bun.sh/install`
4. **Installs Bun** to `~/.bun/bin/bun`
5. **Configures your shell** by adding PATH to your bashrc/zshrc

## Troubleshooting

### Bun command not found after installation

If `bun` is not found after installation, manually add it to your PATH:

```bash
# For bash
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# For zsh
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.zshrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Installation fails on distro X

The script attempts to work on any distribution by:
1. First trying the package manager for known distros
2. Falling back to manual installation if the package manager isn't found

If installation fails:
1. Ensure you have `curl` and `bash` installed
2. Check your internet connection
3. Try running with `--help` to see available options

### Permission denied errors

The script needs sudo/root access to install system dependencies. Run with sudo:

```bash
sudo ./scripts/install-bun.sh
```

## Uninstalling Bun

To remove Bun from your system:

```bash
# Remove the Bun installation directory
rm -rf ~/.bun

# Remove PATH configuration from your shell
# Edit ~/.bashrc or ~/.zshrc and remove the BUN_INSTALL lines
```

## See Also

- [Official Bun Documentation](https://bun.sh/docs)
- [Bun Installation Guide](https://bun.sh/docs/installation)
- [Bun GitHub Repository](https://github.com/oven-sh/bun)

## License

This script is part of the Catalyst project and is licensed under the same terms.

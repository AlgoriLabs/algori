#!/bin/sh
set -eu

# Algori - Instalador universal
# Uso: curl -fsSL https://raw.githubusercontent.com/wanfranklin/algori/main/install.sh | sh

ALGORI_VERSION="${ALGORI_VERSION:-}"
ALGORI_REPO="wanfranklin/algori"
GITHUB_API="https://api.github.com/repos/${ALGORI_REPO}/releases/latest"

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { printf "${GREEN}[info]${NC}  %s\n" "$1" >&2; }
warn() { printf "${YELLOW}[warn]${NC}  %s\n" "$1" >&2; }
error() {
  printf "${RED}[error]${NC} %s\n" "$1" >&2
  exit 1
}

# Verificar dependências
need_cmd() {
  command -v "$1" >/dev/null 2>&1 || error "Comando '$1' não encontrado. Instale-o primeiro."
}

# Buscar versão mais recente do GitHub
fetch_latest_version() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$GITHUB_API" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"tag_name": *"v?([^"]+)".*/\1/'
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$GITHUB_API" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"tag_name": *"v?([^"]+)".*/\1/'
  fi
}

# Detectar plataforma
detect_platform() {
  os=$(uname -s)
  arch=$(uname -m)

  case "$os" in
  Linux*) os_name="linux" ;;
  Darwin*) os_name="macos" ;;
  *) error "Sistema operacional não suportado: $os" ;;
  esac

  case "$arch" in
  x86_64 | amd64) arch_name="x64" ;;
  aarch64 | arm64) arch_name="arm64" ;;
  *) error "Arquitetura não suportada: $arch" ;;
  esac

  platform="${os_name}-${arch_name}"
  info "Plataforma detectada: ${platform}"
}

# Montar nome do arquivo
get_filename() {
  case "$os_name" in
  macos) echo "algori-${platform}" ;;
  linux) echo "algori-${platform}" ;;
  esac
}

# Montar URL de download
get_url() {
  filename=$(get_filename)
  echo "https://github.com/${ALGORI_REPO}/releases/download/v${ALGORI_VERSION}/${filename}"
}

# Download
download() {
  url=$(get_url)
  filename=$(get_filename)
  tmpdir=$(mktemp -d)
  tmpfile="${tmpdir}/${filename}"

  info "Baixando ${url}..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$tmpfile" "$url" || error "Falha no download. Verifique sua conexão."
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmpfile" "$url" || error "Falha no download. Verifique sua conexão."
  else
    error "curl ou wget não encontrado. Instale um deles."
  fi

  echo "$tmpfile"
}

# Instalar
install_binary() {
  tmpfile=$1
  filename=$(get_filename)

  # Determinar diretório de instalação
  if [ -w /usr/local/bin ]; then
    install_dir="/usr/local/bin"
  elif [ -d "$HOME/.local/bin" ]; then
    install_dir="$HOME/.local/bin"
  else
    mkdir -p "$HOME/.local/bin"
    install_dir="$HOME/.local/bin"
    warn "Adicione ~/.local/bin ao seu PATH:"
    warn "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi

  chmod +x "$tmpfile"
  mv "$tmpfile" "${install_dir}/algori"
  info "Instalado em: ${install_dir}/algori"
}

# Verificar instalação
verify() {
  if command -v algori >/dev/null 2>&1; then
    version=$(algori --version 2>/dev/null || echo "desconhecida")
    info "Instalação verificada: ${version}"
  else
    warn "Algori instalado, mas não encontrado no PATH."
    warn "Execute: algori --version"
  fi
}

# Limpeza
cleanup() {
  rm -rf "${tmpdir:-/tmp/algori}" 2>/dev/null || true
}

main() {
  # Buscar versão mais recente se não especificada
  if [ -z "$ALGORI_VERSION" ]; then
    info "Verificando versão mais recente..."
    ALGORI_VERSION=$(fetch_latest_version)
    if [ -z "$ALGORI_VERSION" ]; then
      error "Não foi possível buscar a versão mais recente. Defina ALGORI_VERSION manualmente."
    fi
    info "Versão mais recente: v${ALGORI_VERSION}"
  fi

  info "Instalando Algori v${ALGORI_VERSION}..."
  echo ""

  need_cmd uname
  need_cmd mktemp
  need_cmd chmod
  need_cmd mv

  detect_platform
  tmpfile=$(download)
  install_binary "$tmpfile"
  cleanup
  verify

  echo ""
  info "Instalação concluída!"
  info "Execute: algori --help"
}

main "$@"

#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/build/Latcraft.app"
MODULE_CACHE="/tmp/swift_module_cache"

mkdir -p "$MODULE_CACHE" "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

echo "Compiling Latcraft native macOS app..."
swiftc -O \
    -target arm64-apple-macosx14.0 \
    -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk \
    -module-cache-path "$MODULE_CACHE" \
    -parse-as-library \
    "$SCRIPT_DIR"/Sources/Latcraft/*.swift \
    -o "$APP_DIR/Contents/MacOS/Latcraft"

cp -f /tmp/Lattix.app/Contents/Resources/AppIcon.icns "$APP_DIR/Contents/Resources/" 2>/dev/null || true
codesign --force --deep --entitlements "$SCRIPT_DIR/Entitlements.plist" --sign - "$APP_DIR"
echo "Build complete: $APP_DIR"

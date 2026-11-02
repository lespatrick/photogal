#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/Library/Application Support/Capture One/Plug-ins"
SCRIPTS_DIR="$HOME/Library/Scripts/Capture One Scripts"

echo "=== photogal Capture One Integration Installer ==="

# Build plugin if binary does not exist
if [ ! -f "$SCRIPT_DIR/photogal.coplugin/Contents/MacOS/PhotogalCaptureOne" ]; then
    echo "Compiling photogal.coplugin..."
    (cd "$SCRIPT_DIR" && make)
fi

# 1. Install native .coplugin
echo "Installing photogal.coplugin to: $TARGET_DIR"
mkdir -p "$TARGET_DIR"
rm -rf "$TARGET_DIR/photogal.coplugin"
cp -R "$SCRIPT_DIR/photogal.coplugin" "$TARGET_DIR/"
echo "✓ Native plugin installed successfully!"

# 2. Install companion AppleScript (if Capture One Scripts folder exists or can be created)
if [ -f "$SCRIPT_DIR/scripts/Export to photogal.applescript" ]; then
    echo "Installing companion AppleScript to: $SCRIPTS_DIR"
    mkdir -p "$SCRIPTS_DIR"
    osacompile -o "$SCRIPTS_DIR/Export to photogal.scpt" "$SCRIPT_DIR/scripts/Export to photogal.applescript" 2>/dev/null || \
    cp "$SCRIPT_DIR/scripts/Export to photogal.applescript" "$SCRIPTS_DIR/Export to photogal.applescript"
    echo "✓ Companion AppleScript installed successfully!"
fi

echo ""
echo "==========================================================="
echo "🎉 Installation complete!"
echo "Please restart Capture One to see photogal under:"
echo "   - Image -> Publish -> photogal"
echo "   - Export Tool -> Publish Target -> photogal"
echo "   - Export Recipe -> Open With -> photogal"
echo "==========================================================="


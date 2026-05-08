#!/bin/bash
# Run this script to install homebridge-tempurpedic into the correct location.
# Usage: sudo bash install.sh

set -e

PLUGIN_NAME="homebridge-tempurpedic"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Finding Homebridge plugin directory..."

# Try common locations in order
CANDIDATES=(
  "/var/lib/homebridge/node_modules"
  "/usr/local/lib/node_modules/homebridge/node_modules"
  "$(npm root -g 2>/dev/null)"
)

INSTALL_DIR=""
for dir in "${CANDIDATES[@]}"; do
  if [ -d "$dir" ]; then
    # Prefer the one that already has homebridge or other plugins in it
    if [ -d "$dir/homebridge" ] || [ -d "$dir/homebridge-config-ui-x" ]; then
      INSTALL_DIR="$dir"
      break
    fi
    # Fall back to any valid node_modules
    [ -z "$INSTALL_DIR" ] && INSTALL_DIR="$dir"
  fi
done

if [ -z "$INSTALL_DIR" ]; then
  echo "ERROR: Could not find a node_modules directory. Try manually:"
  echo "  sudo cp -r $SCRIPT_DIR /var/lib/homebridge/node_modules/$PLUGIN_NAME"
  exit 1
fi

DEST="$INSTALL_DIR/$PLUGIN_NAME"
echo "Installing to: $DEST"

rm -rf "$DEST"
cp -r "$SCRIPT_DIR" "$DEST"

echo ""
echo "Done! Now:"
echo "  1. Copy AlexaTempurpedic-1.0.jar into: $DEST/bin/"
echo "  2. Add to your config.json platforms array:"
echo '     {'
echo '       "platform": "TempurPedic",'
echo '       "name": "TempurPedic",'
echo '       "bases": [{ "name": "Bed Base", "ip": "YOUR_IP", "delay": 1000 }]'
echo '     }'
echo "  3. Restart Homebridge"

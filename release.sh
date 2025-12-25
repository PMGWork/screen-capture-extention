#!/bin/bash
set -e

echo "Building CSS..."
npm run build

echo "Creating extension.zip..."
rm -f extension.zip
zip -r extension.zip \
  manifest.json \
  background.js \
  popup.js popup.html \
  options.js options.html \
  offscreen.js offscreen.html \
  dist/ \
  icons/

echo "Done! extension.zip created."

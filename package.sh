#!/bin/sh
# Upload layout (hub src/frontend.rs publish()): theme.json must sit at the
# archive ROOT next to dist/ -- NOT nested under a conan/ directory. A nested
# package is refused with "主题包里没有 theme.json".
set -eu
cd "$(dirname "$0")"
npm run build
rm -f conan-theme.tar.gz
tar -czf conan-theme.tar.gz theme.json preview.png dist
echo "conan-theme.tar.gz: $(du -h conan-theme.tar.gz | cut -f1)"
tar -tzf conan-theme.tar.gz | grep -E '^(theme.json|preview.png|dist/index.html)$'

#!/bin/sh
set -e

# Migrations run before the server accepts traffic, and `deploy` never
# generates one - CI and production apply what was committed and reviewed,
# nothing else. A failure here stops the container rather than serving an
# application whose schema does not match its code.
echo "Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "Starting server on port ${PORT:-3000}..."
exec node server.js

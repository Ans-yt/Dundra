#!/bin/sh
exec node "$(dirname "$0")/scripts/dundra.mjs" --start-only "$@"

#!/bin/sh
# Served at /install.sh. This build installs nothing from the network
# (upstream's piped the hosted installer to sh): run it from its source,
# with local/unii-local.sh (the `unii` alias).
echo "install.sh: not available in this build; run local/unii-local.sh from its source" >&2
exit 1

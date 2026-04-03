#!/usr/bin/env bun
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_BASE = process.env.MCJARS_API_BASE ?? 'https://mcjars.app/api';
const OUTPUT_DIR = process.env.MCJARS_OUTPUT_DIR ?? path.resolve(process.cwd(), 'templates');

const IMAGE_VARIANTS = [
  { name: 'temurin-25', label: 'Eclipse Temurin 25 JRE', image: 'eclipse-temurin:25-jre' },
  { name: 'temurin-21', label: 'Eclipse Temurin 21 JRE', image: 'eclipse-temurin:21-jre' },
  { name: 'temurin-17', label: 'Eclipse Temurin 17 JRE', image: 'eclipse-temurin:17-jre' },
  { name: 'temurin-11', label: 'Eclipse Temurin 11 JRE', image: 'eclipse-temurin:11-jre' },
  { name: 'temurin-8', label: 'Eclipse Temurin 8 JRE', image: 'eclipse-temurin:8-jre' },
];

const INSTALL_SCRIPT = `#!/bin/sh
set -e

echo '[Catalyst] Installing MCJARS type: {{TYPE}} (mc version: {{MC_VERSION:-latest}})'

mkdir -p {{SERVER_DIR}}
cd {{SERVER_DIR}}

TYPE="{{TYPE}}"
MC_VERSION="{{MC_VERSION}}"

API_BASE="https://mcjars.app/api"
BUILD_JSON=""
latest=""

if [ -n "$MC_VERSION" ]; then
  BUILD_JSON=$(curl -sS "$API_BASE/v1/builds/$TYPE/$MC_VERSION/latest")
else
  BUILD_JSON=$(curl -sS "$API_BASE/v2/builds/$TYPE")
fi

get_json_field() {
  printf '%s' "$1" | grep -o "\"$2\":\"[^\"]*" | head -n1 | sed "s/.*\"$2\":\"//;s/\"$//"
}

jarUrl=""
zipUrl=""
instUrl=""
instFile=""

if command -v jq >/dev/null 2>&1; then
  if [ -n "$MC_VERSION" ]; then
    jarUrl=$(printf '%s' "$BUILD_JSON" | jq -r '.build.jarUrl // empty')
    zipUrl=$(printf '%s' "$BUILD_JSON" | jq -r '.build.zipUrl // empty')
    instUrl=$(printf '%s' "$BUILD_JSON" | jq -r '.build.installation[][]? | select(.type=="download") | .url' | head -n1)
    instFile=$(printf '%s' "$BUILD_JSON" | jq -r '.build.installation[][]? | select(.type=="download") | .file' | head -n1)
  else
    latest=$(printf '%s' "$BUILD_JSON" | jq -c '.builds | to_entries | map(.value.latest) | sort_by(.created // "") | last')
    jarUrl=$(printf '%s' "$latest" | jq -r '.jarUrl // empty')
    zipUrl=$(printf '%s' "$latest" | jq -r '.zipUrl // empty')
    instUrl=$(printf '%s' "$latest" | jq -r '.installation[][]? | select(.type=="download") | .url' | head -n1)
    instFile=$(printf '%s' "$latest" | jq -r '.installation[][]? | select(.type=="download") | .file' | head -n1)
  fi
else
  jarUrl=$(get_json_field "$BUILD_JSON" jarUrl)
  zipUrl=$(get_json_field "$BUILD_JSON" zipUrl)
  instUrl=$(get_json_field "$BUILD_JSON" url)
  instFile=$(get_json_field "$BUILD_JSON" file)
fi

extract_zip() {
  if command -v unzip >/dev/null 2>&1; then
    unzip -o "$1"
  elif command -v bsdtar >/dev/null 2>&1; then
    bsdtar -xf "$1"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$1" .
  else
    echo '[Catalyst] ERROR: unzip not available to extract zip archive.'
    exit 1
  fi
}

download_and_extract() {
  url="$1"
  file="$2"
  if [ -z "$file" ] || [ "$file" = "null" ]; then
    file="server.download"
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q -O "$file" "$url"
  elif command -v curl >/dev/null 2>&1; then
    curl -sL -o "$file" "$url"
  else
    echo '[Catalyst] ERROR: Neither wget nor curl found!'
    exit 1
  fi
  if [ ! -f "$file" ]; then
    echo "[Catalyst] ERROR: Failed to download from $url"
    exit 1
  fi
  if echo "$url" | grep -Ei '\\.zip($|\\?|#)' >/dev/null || echo "$file" | grep -Ei '\\.zip$' >/dev/null; then
    echo '[Catalyst] Detected zip archive, extracting...'
    extract_zip "$file"
    rm -f "$file"
  else
    if file "$file" | grep -qi 'Zip archive data'; then
      echo '[Catalyst] Detected zip archive by content, extracting...'
      extract_zip "$file"
      rm -f "$file"
    fi
  fi
}

downloaded_any=false
if command -v jq >/dev/null 2>&1; then
  if [ -n "$MC_VERSION" ]; then
    step_list=$(printf '%s' "$BUILD_JSON" | jq -r '.build.installation[][]? | select(.type=="download") | "\\(.url)|\\(.file)"')
  else
    step_list=$(printf '%s' "$latest" | jq -r '.installation[][]? | select(.type=="download") | "\\(.url)|\\(.file)"')
  fi
  if [ -n "$step_list" ]; then
    downloaded_any=true
    echo "$step_list" | while IFS='|' read -r step_url step_file; do
      if [ -n "$step_url" ]; then
        download_and_extract "$step_url" "$step_file"
      fi
    done
  fi
fi

FNAME="server.download"
if [ "$downloaded_any" != "true" ]; then
  DOWNLOAD_URL="$jarUrl"
  if [ -z "$DOWNLOAD_URL" ]; then
    DOWNLOAD_URL="$zipUrl"
  fi
  if [ -z "$DOWNLOAD_URL" ] && [ -n "$instUrl" ]; then
    DOWNLOAD_URL="$instUrl"
  fi

  if [ -z "$DOWNLOAD_URL" ]; then
    echo "[Catalyst] ERROR: Could not find a download URL for type $TYPE"
    exit 1
  fi

  if [ -n "$instFile" ]; then
    FNAME="$instFile"
  fi

  download_and_extract "$DOWNLOAD_URL" "$FNAME"
fi

if [ -f "$FNAME" ] && echo "$FNAME" | grep -Ei '\\.jar$' >/dev/null; then
  mv -f "$FNAME" server.jar
fi

if [ ! -f server.jar ]; then
  JAR=$(find . -maxdepth 4 -type f \\( -iname '*server*.jar' -o -iname '*.jar' \\) | head -n1 || true)
  if [ -n "$JAR" ]; then
    mv -f "$JAR" server.jar
  fi
fi

if [ ! -f server.jar ]; then
  echo '[Catalyst] ERROR: Failed to obtain server.jar after extraction.'
  exit 1
fi

if [ "{{EULA}}" = "true" ] || [ "{{EULA}}" = "1" ]; then
  echo 'eula=true' > eula.txt
fi

cat > server.properties << 'PROPS'
server-port={{PORT}}
max-players=20
PROPS

echo '[Catalyst] Installation complete!'
`;

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
};

const collectTypes = (typesPayload) => {
  if (!typesPayload || typeof typesPayload !== 'object') return [];
  const categories = ['recommended', 'established', 'experimental', 'miscellaneous', 'limbos'];
  const entries = [];
  const addEntries = (obj) => {
    Object.entries(obj || {}).forEach(([key, value]) => {
      if (!entries.some(([existing]) => existing === key)) {
        entries.push([key, value]);
      }
    });
  };
  if (categories.some((category) => typesPayload[category])) {
    categories.forEach((category) => addEntries(typesPayload[category]));
  } else {
    addEntries(typesPayload);
  }
  return entries;
};

const pickLatestBuild = (buildsPayload) => {
  const builds = buildsPayload?.builds;
  if (!builds || typeof builds !== 'object') return null;
  const entries = Array.isArray(builds) ? builds : Object.values(builds);
  const normalized = entries
    .map((entry) => {
      const latest = entry?.latest ?? entry;
      const created = latest?.created ?? entry?.created ?? '';
      return { entry, latest, created };
    })
    .filter((item) => item.latest);
  if (!normalized.length) return null;
  normalized.sort((a, b) => String(a.created).localeCompare(String(b.created)));
  return normalized[normalized.length - 1];
};

const resolveDefaultImage = (javaVersion) => {
  const supported = new Set([8, 11, 17, 21, 25]);
  const selected = supported.has(javaVersion) ? javaVersion : 21;
  return `eclipse-temurin:${selected}-jre`;
};

const buildTemplate = (typeId, info, latestEntry) => {
  const displayName = info?.name ?? typeId;
  const description = info?.description ?? `MCJARS installer for ${displayName}.`;
  const latest = latestEntry.latest ?? {};
  const version = latest.name || latest.versionId || 'latest';
  const javaVersion = Number(latestEntry.entry?.java ?? latest.java ?? 21);
  const defaultImage = resolveDefaultImage(javaVersion);
  const templateId = `mcjars-${slugify(typeId)}`;

  return {
    id: templateId,
    name: `Minecraft Server (${displayName})`,
    description,
    author: 'MCJARS',
    version: String(version),
    image: defaultImage,
    images: IMAGE_VARIANTS,
    defaultImage,
    installImage: 'alpine:3.19',
    startup: 'java -Xms{{MEMORY_XMS}}M -Xmx{{MEMORY}}M -jar server.jar nogui',
    stopCommand: 'stop',
    sendSignalTo: 'SIGTERM',
    variables: [
      {
        name: 'TYPE',
        description: 'MCJARS server type',
        default: typeId,
        required: true,
        input: 'text',
      },
      {
        name: 'MC_VERSION',
        description: 'Minecraft version (leave blank for latest)',
        default: '',
        required: false,
        input: 'text',
      },
      {
        name: 'MEMORY',
        description: 'Amount of RAM in MB to allocate to the server',
        default: '1024',
        required: true,
        input: 'number',
      },
      {
        name: 'PORT',
        description: 'Server port (both container and host will use this port)',
        default: '25565',
        required: true,
        input: 'number',
        rules: ['between:1024,65535'],
      },
      {
        name: 'EULA',
        description: 'Agree to Minecraft EULA',
        default: 'true',
        required: true,
        input: 'checkbox',
      },
    ],
    installScript: INSTALL_SCRIPT,
    supportedPorts: [25565],
    allocatedMemoryMb: 1024,
    allocatedCpuCores: 2,
    features: {
      restartOnExit: true,
    },
  };
};

const validateBuild = (latest) => {
  const downloadUrl =
    latest?.jarUrl ||
    latest?.zipUrl ||
    latest?.installation?.flat?.()?.find?.((step) => step?.type === 'download')?.url;
  if (!downloadUrl) {
    throw new Error('No download URL in latest build');
  }
};

const main = async () => {
  const typesResponse = await fetchJson(`${API_BASE}/v2/types`);
  const types = collectTypes(typesResponse.types);
  if (!types.length) {
    throw new Error('No MCJARS types found');
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const results = [];
  for (const [typeId, info] of types) {
    const buildsResponse = await fetchJson(`${API_BASE}/v2/builds/${encodeURIComponent(typeId)}`);
    const latestEntry = pickLatestBuild(buildsResponse);
    if (!latestEntry?.latest) {
      throw new Error(`No builds found for ${typeId}`);
    }
    validateBuild(latestEntry.latest);
    const template = buildTemplate(typeId, info, latestEntry);
    const filename = `mcjars-${slugify(typeId)}.json`;
    const targetPath = path.join(OUTPUT_DIR, filename);
    await writeFile(targetPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
    results.push({ typeId, filename });
  }

  console.log(`Generated ${results.length} templates in ${OUTPUT_DIR}`);
};

main().catch((error) => {
  console.error('MCJARS template generation failed:', error.message);
  process.exit(1);
});

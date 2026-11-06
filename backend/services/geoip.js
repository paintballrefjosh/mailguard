const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const zlib    = require('zlib');
const { execSync } = require('child_process');
const maxmind = require('maxmind');

const DB_DIR  = path.join('/app/config/geoip');
const DB_PATH = path.join(DB_DIR, 'GeoLite2-City.mmdb');

let reader = null;

async function initGeoIp() {
  if (!process.env.MAXMIND_LICENSE_KEY || !process.env.MAXMIND_ACCOUNT_ID) {
    console.warn('[geoip] No MaxMind credentials in .env — geo lookup disabled.');
    return;
  }

  const needsDownload = !fs.existsSync(DB_PATH) ||
    (Date.now() - fs.statSync(DB_PATH).mtimeMs) > 7 * 24 * 60 * 60 * 1000;

  if (needsDownload) {
    console.log('[geoip] Downloading GeoLite2-City database...');
    await downloadDb();
  }

  reader = await maxmind.open(DB_PATH);
  console.log('[geoip] GeoLite2-City database loaded.');
}

function downloadDb() {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(DB_DIR, { recursive: true });

    const accountId  = process.env.MAXMIND_ACCOUNT_ID;
    const licenseKey = process.env.MAXMIND_LICENSE_KEY;
    const tmpFile    = path.join(DB_DIR, 'GeoLite2-City.tar.gz');

    // MaxMind download URL — follows redirects manually
    const downloadUrl = `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${licenseKey}&suffix=tar.gz`;

    const file = fs.createWriteStream(tmpFile);

    function doGet(url, redirects = 0) {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      const mod = url.startsWith('https') ? require('https') : require('http');
      mod.get(url, res => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          doGet(res.headers.location, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`MaxMind download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            try {
              // Extract just the .mmdb file directly to DB_PATH
              execSync(
                `tar -xzf ${tmpFile} -C ${DB_DIR} --strip-components=1 --wildcards "*.mmdb"`
              );
              fs.unlinkSync(tmpFile);
              // Rename dated file to standard name if needed
              const files = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.mmdb'));
              if (!files.length) throw new Error('No .mmdb file found after extraction');
              const extracted = path.join(DB_DIR, files[0]);
              if (extracted !== DB_PATH) fs.renameSync(extracted, DB_PATH);
              console.log('[geoip] Database extracted successfully.');
              resolve();
            } catch(e) { reject(e); }
          });
        });
        file.on('error', reject);
      }).on('error', reject);
    }

    doGet(downloadUrl);
  });
}

function lookup(ip) {
  if (!reader || !ip) return null;
  // Skip private/loopback IPs
  if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1)/.test(ip)) return null;
  try {
    const r = reader.get(ip);
    if (!r) return null;
    return {
      country_code: r.country?.iso_code   || null,
      country_name: r.country?.names?.en  || null,
      city:         r.city?.names?.en     || null,
      latitude:     r.location?.latitude  || null,
      longitude:    r.location?.longitude || null,
    };
  } catch { return null; }
}

module.exports = { initGeoIp, lookup };
// Extend Node's bundled CA list with the operating system's trusted roots.
// Some Node builds cannot complete newer certificate chains (e.g. Let's Encrypt "ISRG Root YE",
// used by api.open-meteo.com) that the OS already trusts. This only ADDS trust anchors —
// certificate verification is never disabled.
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const MAC_ROOTS = '/System/Library/Keychains/SystemRootCertificates.keychain';

export function extendTrustStore(): number {
  if (typeof tls.setDefaultCACertificates !== 'function') return 0;
  const extra: string[] = [];

  if (process.platform === 'darwin' && process.env.USE_SYSTEM_TRUST_STORE !== 'false' && existsSync(MAC_ROOTS)) {
    try {
      const out = execFileSync('/usr/bin/security', ['find-certificate', '-a', '-p', MAC_ROOTS], { encoding: 'utf8' });
      extra.push(...(out.match(PEM) ?? []));
    } catch (err) {
      console.warn('[tls] could not read macOS root certificates:', (err as Error).message);
    }
  }

  const file = process.env.TRUSTED_CA_FILE;
  if (file) {
    if (existsSync(file)) extra.push(...(readFileSync(file, 'utf8').match(PEM) ?? []));
    else console.warn(`[tls] TRUSTED_CA_FILE not found: ${file}`);
  }

  if (!extra.length) return 0;
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...extra]);
  return extra.length;
}

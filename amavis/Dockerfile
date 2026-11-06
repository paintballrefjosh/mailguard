FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive

RUN echo "deb http://deb.debian.org/debian bookworm main contrib non-free" > /etc/apt/sources.list && \
    echo "deb http://deb.debian.org/debian-security bookworm-security main contrib non-free" >> /etc/apt/sources.list && \
    echo "deb http://deb.debian.org/debian bookworm-updates main contrib non-free" >> /etc/apt/sources.list

RUN apt-get update && apt-get install -y \
    amavisd-new \
    spamassassin spamc \
    libnet-dns-perl \
    libmail-spf-perl \
    libarchive-zip-perl \
    libconvert-tnef-perl \
    libmime-tools-perl \
    python3 \
    pyzor razor \
    arj bzip2 cabextract cpio file gzip lhasa \
    nomarch pax unrar unzip zip \
    curl wget netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

# Patch the amavisd binary:
#   1. Remove -T (taint mode) from shebang — causes startup failures in containers
#   2. Neutralise enc_tainted substr call if present (2.11.x only, no-op on 2.13+)
# The binary path differs between Debian versions so we locate it dynamically.
RUN python3 << 'PYEOF'
import sys, os, glob

# ── Patch 1: fix the amavisd binary shebang ───────────────────────────────────
candidates = glob.glob('/usr/sbin/amavis*') + \
             glob.glob('/usr/lib/amavis*') + \
             glob.glob('/usr/bin/amavis*')
candidates = [f for f in candidates
              if os.path.isfile(f)
              and not f.endswith(('.pm', '.conf', '.cf'))
              and os.access(f, os.R_OK)]

if candidates:
    path = candidates[0]
    print(f"Patching binary: {path}")
    with open(path, 'r') as f:
        lines = f.readlines()
    if lines[0].startswith('#!') and '-T' in lines[0]:
        lines[0] = lines[0].replace(' -T', '').replace('\t-T', '')
        print(f"  Removed -T from shebang: {lines[0].rstrip()!r}")
    else:
        print(f"  Shebang already clean: {lines[0].rstrip()!r}")
    for i, line in enumerate(lines):
        if '$enc_tainted' in line and 'substr' in line:
            lines[i] = '$enc_tainted = "";  # taint disabled — patched at build\n'
            print(f"  Patched enc_tainted on line {i+1}")
            break
    with open(path, 'w') as f:
        f.writelines(lines)
else:
    print("No amavisd binary found — skipping binary patch")

# ── Patch 2: ensure Amavis.pm loads Amavis::Unpackers ────────────────────────
# 2.13.0-3+deb12u1 calls Amavis::Unpackers::decompose_mail but never loads
# the module — it's a packaging bug. We add a 'use' statement at the top.
amavis_pm = '/usr/share/perl5/Amavis.pm'
if os.path.exists(amavis_pm):
    with open(amavis_pm, 'r') as f:
        content = f.read()

    if 'use Amavis::Unpackers;' in content or \
       'use Amavis::Unpackers qw' in content:
        print("Amavis.pm already loads Amavis::Unpackers — no patch needed")
    else:
        # Insert after the block of Amavis::Unpackers sub-package imports
        # so the parent package is loaded before its children are used
        patched = content.replace(
            'use Amavis::Unpackers::MIME qw(mime_decode);',
            'use Amavis::Unpackers;  # patched at build — missing from 2.13.0 packaging\nuse Amavis::Unpackers::MIME qw(mime_decode);',
            1
        )
        if patched == content:
            print("WARNING: could not find insertion point in Amavis.pm")
        else:
            with open(amavis_pm, 'w') as f:
                f.write(patched)
            print("Patched Amavis.pm: added 'use Amavis::Unpackers'")
else:
    print(f"WARNING: {amavis_pm} not found")

print("All patches complete.")
PYEOF

# Verify the patched binary parses cleanly
RUN find /usr/sbin /usr/lib /usr/bin -name "amavis*" -type f \
    ! -name "*.pm" ! -name "*.conf" ! -name "*.cf" 2>/dev/null | \
    head -1 | xargs perl -c 2>&1 | tail -3

RUN mkdir -p /var/lib/amavis /var/run/amavis /var/log/amavis && \
    chown -R amavis:amavis /var/lib/amavis /var/run/amavis /var/log/amavis

COPY amavis.conf        /etc/amavis/conf.d/99-mailguard
COPY spamassassin.conf  /etc/spamassassin/local.cf
COPY entrypoint.sh      /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 10024 10026

HEALTHCHECK --interval=15s --timeout=5s --retries=20 --start-period=90s \
    CMD nc -z 127.0.0.1 10024 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
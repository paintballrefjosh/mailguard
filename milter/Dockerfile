# MailGuard compound-rule milter.
# python3-milter (Debian package) ships libmilter + the Python `Milter`
# module prebuilt, so no compiler/libmilter-dev is needed.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-milter && \
    rm -rf /var/lib/apt/lists/*

# NB: the module must NOT be named milter.py — the `Milter` package does
# `import milter` (the C extension), which our own file would shadow.
COPY mg_milter.py /usr/local/bin/mg_milter.py
RUN chmod +x /usr/local/bin/mg_milter.py

EXPOSE 8894
CMD ["python3", "/usr/local/bin/mg_milter.py"]

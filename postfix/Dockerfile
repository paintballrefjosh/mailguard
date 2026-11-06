FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    postfix postfix-lmdb postfix-pcre libsasl2-modules \
    postgrey \
    python3 curl procps iproute2 rsyslog && \
    rm -rf /var/lib/apt/lists/*

# Let Postfix set its own correct permissions on the spool
RUN postfix set-permissions 2>/dev/null || true

# Disable chroot in the default master.cf — not needed or wanted in Docker
RUN sed -i 's/^\([a-zA-Z].*\s\+\)y\(\s\+[-0-9]\)/\1n\2/' /etc/postfix/master.cf

# Save the patched master.cf as our reference
RUN cp /etc/postfix/master.cf /etc/postfix/master.cf.dist

# Internal cert directory
RUN mkdir -p /etc/postfix/certs && chmod 755 /etc/postfix/certs

# Log directory
RUN mkdir -p /var/log/mail && chmod 755 /var/log/mail

COPY main.cf.template /etc/postfix/main.cf.template
COPY maps/            /etc/postfix/maps/
COPY entrypoint.sh    /entrypoint.sh
COPY log-event.sh     /usr/local/bin/log-event.sh
COPY log-shipper.py   /usr/local/bin/log-shipper.py
COPY policy-check.py  /usr/local/bin/policy-check.py

RUN chown root:root   /etc/postfix/main.cf.template && \
    chmod 644         /etc/postfix/main.cf.template && \
    chown -R root:root /etc/postfix/maps && \
    chmod 755         /etc/postfix/maps && \
    chmod 644         /etc/postfix/maps/* && \
    chmod +x /entrypoint.sh \
             /usr/local/bin/log-event.sh \
             /usr/local/bin/log-shipper.py \
             /usr/local/bin/policy-check.py

EXPOSE 25 587
ENTRYPOINT ["/entrypoint.sh"]
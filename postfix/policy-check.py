#!/usr/bin/env python3
"""
MailGuard policy daemon.

Two modes:
  - stdin/stdout (Postfix spawn transport):  called with no args
  - TCP server (--server host:port):         listens for Postfix policy connections

The TCP server mode is used in production so the daemon stays resident and
handles multiple connections without the overhead of spawning a new process
per connection.
"""
import sys
import os
import json
import socket
import threading
import argparse
import urllib.request
import urllib.error

API_URL   = os.environ.get("MAILGUARD_API_URL",        "http://backend:3001")
API_TOKEN = os.environ.get("MAILGUARD_INTERNAL_TOKEN", "")


def call_api(attrs):
    """POST attributes to MailGuard policy endpoint, return Postfix action string."""
    payload = json.dumps({
        "sender":        attrs.get("sender",         ""),
        "recipient":     attrs.get("recipient",      ""),
        "sender_ip":     attrs.get("client_address", ""),
        "helo_name":     attrs.get("helo_name",      ""),
        "queue_id":      attrs.get("queue_id",       ""),
        "size":          attrs.get("size",           "0"),
        "sasl_username": attrs.get("sasl_username",  ""),
    }).encode()

    req = urllib.request.Request(
        f"{API_URL}/api/events/policy",
        data=payload,
        headers={
            "Content-Type":     "application/json",
            "X-Internal-Token": API_TOKEN,
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return data.get("action", "DUNNO")
    except urllib.error.URLError as e:
        sys.stderr.write(f"[policy] API error: {e}\n")
        sys.stderr.flush()
        return "DUNNO"  # fail open — never block mail if API is unreachable
    except Exception as e:
        sys.stderr.write(f"[policy] Unexpected error: {e}\n")
        sys.stderr.flush()
        return "DUNNO"


def handle_connection(conn):
    """Handle a single Postfix policy protocol connection."""
    try:
        f = conn.makefile('r')
        while True:
            # Read one policy request (blank-line terminated)
            attrs = {}
            for line in f:
                line = line.strip()
                if not line:
                    break
                if "=" in line:
                    k, v = line.split("=", 1)
                    attrs[k.strip()] = v.strip()

            if not attrs:
                break

            action = call_api(attrs)
            conn.sendall(f"action={action}\n\n".encode())
    except Exception as e:
        sys.stderr.write(f"[policy] Connection error: {e}\n")
        sys.stderr.flush()
    finally:
        try:
            conn.close()
        except Exception:
            pass


def run_server(host, port):
    """Run as a persistent TCP server."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((host, port))
    srv.listen(128)
    sys.stderr.write(f"[policy] Listening on {host}:{port}\n")
    sys.stderr.flush()

    while True:
        try:
            conn, addr = srv.accept()
            t = threading.Thread(target=handle_connection, args=(conn,), daemon=True)
            t.start()
        except Exception as e:
            sys.stderr.write(f"[policy] Accept error: {e}\n")
            sys.stderr.flush()


def run_stdio():
    """Run in stdin/stdout mode (Postfix spawn transport fallback)."""
    while True:
        attrs = {}
        for line in sys.stdin:
            line = line.strip()
            if not line:
                break
            if "=" in line:
                k, v = line.split("=", 1)
                attrs[k.strip()] = v.strip()

        if not attrs:
            break

        action = call_api(attrs)
        sys.stdout.write(f"action={action}\n\n")
        sys.stdout.flush()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", metavar="HOST:PORT",
                        help="Run as TCP server on HOST:PORT")
    args = parser.parse_args()

    if args.server:
        host, port = args.server.rsplit(":", 1)
        run_server(host, int(port))
    else:
        run_stdio()
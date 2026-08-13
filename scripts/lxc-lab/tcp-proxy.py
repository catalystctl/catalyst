#!/usr/bin/env python3
"""Bind 0.0.0.0:HOST_PORT and splice to DEST_IP:DEST_PORT."""
import socket
import sys
import threading

host_port = int(sys.argv[1])
dest_ip = sys.argv[2]
dest_port = int(sys.argv[3])

listen = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
listen.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listen.bind(("0.0.0.0", host_port))
listen.listen(128)


def pipe(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            src.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            dst.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        src.close()
        dst.close()


while True:
    client, _addr = listen.accept()
    try:
        upstream = socket.create_connection((dest_ip, dest_port), timeout=10)
    except OSError:
        client.close()
        continue
    threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
    threading.Thread(target=pipe, args=(upstream, client), daemon=True).start()

"""Необязательный локальный веб-сервер для BuildSense (только стандартная библиотека Python).

Приложение работает и без него: достаточно открыть index.html. Сервер нужен разработчику,
чтобы браузер не кэшировал файлы при правках.

Запуск:  python serve.py            — http://localhost:8000 и открыть браузер
         python serve.py 8080       — другой порт
         python serve.py --no-browser
         python serve.py --lan     — открыть доступ с телефона: тот же Wi-Fi, адрес вида http://192.168.x.x:8000 (печатается при запуске)

Особенности: заголовок no-store не даёт браузеру показывать устаревшие файлы после правок;
.js отдаётся с явным MIME-типом (на Windows реестр иногда сообщает text/plain).
"""
import functools
import http.server
import os
import socket
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".FCMacro": "text/x-python; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "--quiet" not in sys.argv:
            super().log_message(fmt, *args)


def lan_addresses():
    """Адреса этого компьютера в локальной сети (для открытия с телефона)."""
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    try:  # адрес «наружу» — обычно тот, что нужен
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            ip = sock.getsockname()[0]
            if ip not in ips:
                ips.insert(0, ip)
    except OSError:
        pass
    return ips


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8000
    handler = functools.partial(Handler, directory=ROOT)
    lan = "--lan" in sys.argv
    with http.server.ThreadingHTTPServer(("0.0.0.0" if lan else "127.0.0.1", port), handler) as httpd:
        url = f"http://localhost:{port}/"
        print(f"BuildSense запущен: {url}  (Ctrl+C — остановить)")
        if lan:
            for ip in lan_addresses():
                print(f"  С телефона (тот же Wi-Fi): http://{ip}:{port}/")
            print("  Если страница не открывается — разрешите Python в брандмауэре Windows для частных сетей.")
        if "--no-browser" not in sys.argv:
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен")


if __name__ == "__main__":
    main()

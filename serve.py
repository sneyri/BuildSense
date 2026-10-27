"""Необязательный локальный веб-сервер для BuildSense (только стандартная библиотека Python).

Приложение работает и без него: достаточно открыть index.html. Сервер нужен разработчику,
чтобы браузер не кэшировал файлы при правках.

Запуск:  python serve.py            — http://localhost:8000 и открыть браузер
         python serve.py 8080       — другой порт
         python serve.py --no-browser

Особенности: заголовок no-store не даёт браузеру показывать устаревшие файлы после правок;
.js отдаётся с явным MIME-типом (на Windows реестр иногда сообщает text/plain).
"""
import functools
import http.server
import os
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


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8000
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        url = f"http://localhost:{port}/"
        print(f"BuildSense запущен: {url}  (Ctrl+C — остановить)")
        if "--no-browser" not in sys.argv:
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен")


if __name__ == "__main__":
    main()

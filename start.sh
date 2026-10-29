#!/bin/sh
# BuildSense: открыть index.html в браузере по умолчанию (Linux, в том числе RedOS).
xdg-open "$(dirname "$0")/index.html" 2>/dev/null || echo "Откройте файл index.html в браузере (Firefox, Chromium, Яндекс.Браузер)."

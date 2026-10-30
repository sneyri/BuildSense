@echo off
chcp 65001 >nul
echo BuildSense: запуск для телефона (компьютер и телефон — в одной сети Wi-Fi)
python serve.py --lan
pause

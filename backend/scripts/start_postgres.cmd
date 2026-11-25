@echo off
REM Starts PostgreSQL (with pgvector) inside WSL Ubuntu and keeps the WSL VM alive.
REM WSL shuts its VM down when no Windows process is attached, which would stop Postgres.
REM Leave this window open (minimise it) while Nyay Apex is running. Close it to stop Postgres.

echo Starting PostgreSQL in WSL (Ubuntu)...
wsl.exe -d Ubuntu -u root -- service postgresql start
echo PostgreSQL is listening on 127.0.0.1:5432. Keep this window open.
wsl.exe -d Ubuntu -u root -- sleep infinity

@echo off
for /f "tokens=1,* delims==" %%A in (.env) do if "%%A"=="MONGODB_URI" set MONGODB_URI=%%B
mongosh "%MONGODB_URI%"

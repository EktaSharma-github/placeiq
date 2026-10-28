# Rebuilds the PlaceIQ database from scratch: schema, logic, mock data.
# Usage (from the Project folder):   .\run_all.ps1
# Optional: .\run_all.ps1 -Password yourpassword -Psql "C:\path\to\psql.exe"

param(
    [string]$Password = "postgres",
    [string]$Psql     = "C:\Program Files\PostgreSQL\18\bin\psql.exe",
    [string]$Database = "placeiq"
)

$ErrorActionPreference = "Stop"
$env:PGPASSWORD = $Password
Set-Location $PSScriptRoot

$exists = & $Psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname = '$Database'"
if (-not $exists) {
    & $Psql -U postgres -h localhost -c "CREATE DATABASE $Database"
}

foreach ($file in "02_ddl.sql", "03_logic.sql", "04_data.sql") {
    Write-Host "== $file"
    & $Psql -U postgres -h localhost -d $Database -q -v ON_ERROR_STOP=1 -f $file | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "$file failed (exit $LASTEXITCODE)" }
}

Write-Host "PlaceIQ rebuilt. Try:  psql -U postgres -h localhost -d $Database -f 05_queries.sql"

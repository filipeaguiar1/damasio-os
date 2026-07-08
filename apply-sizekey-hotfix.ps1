# Damasio OS V50.1 SizeKey Hotfix
# Run from the project root: C:\Projetos\damasio-os

$ErrorActionPreference = "Stop"

$quoteForm = "components/QuoteForm.tsx"
$pricing = "lib/pricing.ts"

if (!(Test-Path $quoteForm)) {
  Write-Error "Could not find $quoteForm. Run this script from the Damasio OS project root."
}
if (!(Test-Path $pricing)) {
  Write-Error "Could not find $pricing. Run this script from the Damasio OS project root."
}

Copy-Item $quoteForm "$quoteForm.bak-sizekey"
Copy-Item $pricing "$pricing.bak-sizekey"

$q = Get-Content $quoteForm -Raw

# Prefer QuoteSizeKey for QuoteForm state/casts/imports.
$q = $q -replace "\bSizeKey\b", "QuoteSizeKey"

# Avoid impossible defaults from old pricing sizes.
$q = $q -replace 'useState<QuoteSizeKey>\("medium"\)', 'useState<QuoteSizeKey>("small")'
$q = $q -replace "useState<QuoteSizeKey>\('medium'\)", "useState<QuoteSizeKey>('small')"
$q = $q -replace 'useState<QuoteSizeKey>\("large"\)', 'useState<QuoteSizeKey>("legacy")'
$q = $q -replace "useState<QuoteSizeKey>\('large'\)", "useState<QuoteSizeKey>('legacy')"

# If QuoteSizeKey was not imported, add it to the pricing import.
if ($q -match 'from\s+["'']@/lib/pricing["'']') {
  if ($q -notmatch '\bQuoteSizeKey\b.*from\s+["'']@/lib/pricing["'']' -and $q -notmatch 'import\s+type\s+\{[^}]*QuoteSizeKey') {
    $q = $q -replace 'import\s+\{([^}]*)\}\s+from\s+(["'']@/lib/pricing["''])', 'import {$1, QuoteSizeKey} from $2'
  }
}

Set-Content $quoteForm $q -NoNewline

$p = Get-Content $pricing -Raw

# Ensure pricing exports the canonical quote size type.
if ($p -notmatch 'export\s+type\s+QuoteSizeKey') {
  $p = "export type QuoteSizeKey = \"xs\" | \"small\" | \"legacy\" | \"oversize\";`r`n" + $p
}

# Make any legacy SizeKey alias safe if it exists/gets imported elsewhere.
if ($p -match 'export\s+type\s+SizeKey\s*=') {
  $p = $p -replace 'export\s+type\s+SizeKey\s*=\s*[^;]+;', 'export type SizeKey = QuoteSizeKey;'
} elseif ($p -notmatch 'export\s+type\s+SizeKey\s*=\s*QuoteSizeKey') {
  $p = $p + "`r`nexport type SizeKey = QuoteSizeKey;`r`n"
}

Set-Content $pricing $p -NoNewline

Write-Host "SizeKey hotfix applied. Backups created with .bak-sizekey suffix."
Write-Host "Now run: pnpm build"

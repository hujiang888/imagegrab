# -*- coding: utf-8 -*-
<#
.SYNOPSIS
    打包 ImageGrab 扩展为可发布的 ZIP（manifest.json 位于压缩包根目录）。
.DESCRIPTION
    产物输出到 docs/downloads/ImageGrab-v<版本>.zip，供官网下载按钮和 GitHub Release 使用。
    注意：ZIP 内路径统一使用正斜杠，兼容 Windows / macOS / Linux 解压。
#>

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root 'manifest.json'
$manifest = Get-Content -Path $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version

$downloadDir = Join-Path $root 'docs/downloads'
$zipPath = Join-Path $downloadDir "ImageGrab-v$version.zip"

if (-not (Test-Path $downloadDir)) {
    New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
}

$stage = Join-Path $env:TEMP ("imagegrab-stage-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null

try {
    $files = @(
        'manifest.json',
        'background.js',
        'content.js',
        'content.css',
        'gallery.html',
        'gallery.css',
        'gallery.js',
        'README.md',
        'INSTALL.txt',
        'LICENSE'
    )
    foreach ($file in $files) {
        $source = Join-Path $root $file
        if (-not (Test-Path $source)) { throw "缺少打包文件：$file" }
        Copy-Item $source (Join-Path $stage $file)
    }

    foreach ($dir in @('lib', 'icons')) {
        Copy-Item (Join-Path $root $dir) (Join-Path $stage $dir) -Recurse
    }

    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stageFull = (Resolve-Path $stage).Path
    $archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem -Path $stage -Recurse -File | ForEach-Object {
            $relative = $_.FullName.Substring($stageFull.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $_.FullName,
                $relative,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    }
    finally {
        $archive.Dispose()
    }

    $size = (Get-Item $zipPath).Length
    Write-Host ("打包完成：{0}" -f $zipPath)
    Write-Host ("版本：{0}  大小：{1:N1} KB" -f $version, ($size / 1KB))

    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        Write-Host '压缩包内容：'
        $archive.Entries | ForEach-Object { Write-Host ("  {0}  ({1} bytes)" -f $_.FullName, $_.Length) }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
}

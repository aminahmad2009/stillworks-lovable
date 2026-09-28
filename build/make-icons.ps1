<#
  Builds the web icon set, the maskable variant and the social card from
  build/icon.png, so every asset is the same artwork as the packaged app.

  build/icon.png paints its rounded square on an opaque white page, so the
  corners are keyed out here: favicons get a measured rounded clip, and the
  iOS / maskable variants get a slight over-scan so no corner survives.

  ASCII only in this file: Windows PowerShell reads BOM-less scripts in the
  system codepage, which turns typographic characters into mojibake.

  Windows-only (System.Drawing). From the repo root:
    powershell -ExecutionPolicy Bypass -File build\make-icons.ps1
    node build/make-favicon-ico.mjs
#>

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'web\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$master = [System.Drawing.Bitmap]::new((Join-Path $root 'build\icon.png'))
Write-Host "master: $($master.Width)x$($master.Height)"

function Test-White([System.Drawing.Color]$c) {
  return ($c.R -gt 235 -and $c.G -gt 235 -and $c.B -gt 235)
}

# The artwork's own corner radius: how far in the gradient starts on row 0.
$radius = 0
for ($x = 0; $x -lt $master.Width; $x++) {
  if (-not (Test-White $master.GetPixel($x, 0))) { $radius = $x; break }
}
if ($radius -lt 1) { $radius = [int]($master.Width * 0.22) }
Write-Host "corner radius measured at $radius px ($([math]::Round($radius / $master.Width * 100, 1))%)"

# Mid-gradient sample: the brand blue the artwork actually carries.
$brand = $master.GetPixel([int]($master.Width * 0.22), [int]($master.Height * 0.55))
$brandBrush = [System.Drawing.SolidBrush]::new($brand)

function New-Canvas([int]$w, [int]$h) {
  $bmp = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return @{ Bitmap = $bmp; Graphics = $g }
}

function Save-Png($canvas, [string]$name) {
  $path = Join-Path $outDir $name
  $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Dispose()
  Write-Host "  wrote $name"
}

# Rounded, transparent-cornered icon at a given size. The master's corners are
# opaque white, so the artwork is over-scanned by ~1% to push the blended fringe
# outside the clip instead of leaving a pale ring on dark backgrounds.
function Save-Rounded([int]$size, [string]$name) {
  $c = New-Canvas $size $size
  $r = [int]($size * ($radius / $master.Width))
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
  $path.AddArc($size - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($size - 2 * $r, $size - 2 * $r, 2 * $r, 2 * $r, 0, 90)
  $path.AddArc(0, $size - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $path.CloseFigure()
  $c.Graphics.SetClip($path, [System.Drawing.Drawing2D.CombineMode]::Replace)
  $pad = [math]::Max(1, [int]($size * 0.012))
  $c.Graphics.DrawImage($master, [System.Drawing.Rectangle]::new(-$pad, -$pad, $size + 2 * $pad, $size + 2 * $pad))
  $path.Dispose()
  Save-Png $c $name
}

# Full-bleed square: over-scanned so the white corners fall outside the canvas.
function Save-FullBleed([int]$size, [string]$name) {
  $c = New-Canvas $size $size
  $over = [int]($size * 0.07)
  $c.Graphics.DrawImage($master, [System.Drawing.Rectangle]::new(-$over, -$over, $size + 2 * $over, $size + 2 * $over))
  Save-Png $c $name
}

foreach ($size in 16, 32, 48, 192, 512) { Save-Rounded $size "icon-$size.png" }
Save-FullBleed 180 'apple-touch-icon.png'
Save-FullBleed 512 'maskable-512.png'

# --- social card (1200x630: the ratio crawlers, Slack and Discord prefer) ---
$ink = [System.Drawing.Color]::FromArgb(255, 231, 231, 234)    # --text
$muted = [System.Drawing.Color]::FromArgb(255, 139, 139, 153)  # --text-muted
$accent = [System.Drawing.Color]::FromArgb(255, 255, 77, 141)  # --accent
$bg = [System.Drawing.Color]::FromArgb(255, 11, 11, 15)        # --bg
$bgTop = [System.Drawing.Color]::FromArgb(255, 21, 21, 31)     # --bg-panel

$card = New-Canvas 1200 630
$gradRect = [System.Drawing.Rectangle]::new(0, 0, 1200, 630)
$grad = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  $gradRect, $bgTop, $bg, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
$card.Graphics.FillRectangle($grad, $gradRect)
$grad.Dispose()

$rounded = [System.Drawing.Image]::fromFile((Join-Path $outDir 'icon-512.png'))
$card.Graphics.DrawImage($rounded, [System.Drawing.Rectangle]::new(76, 158, 314, 314))
$rounded.Dispose()
$card.Graphics.FillRectangle([System.Drawing.SolidBrush]::new($accent), 76, 496, 314, 5)

$titleFont = [System.Drawing.Font]::new('Segoe UI Semibold', 58, [System.Drawing.FontStyle]::Bold)
$tagFont = [System.Drawing.Font]::new('Segoe UI', 25)
$fineFont = [System.Drawing.Font]::new('Segoe UI Semibold', 19)

$card.Graphics.DrawString('Stillworks', $titleFont, [System.Drawing.SolidBrush]::new($ink), 440, 146)

$y = 252
foreach ($line in @(
  'Describe an app in chat. The agent edits real',
  'files in a real Vite project on your disk, and',
  'the preview updates while it works.')) {
  $card.Graphics.DrawString($line, $tagFont, [System.Drawing.SolidBrush]::new($muted), 442, $y)
  $y += 36
}

$card.Graphics.DrawString('single-user  |  on-device  |  bring your own model key',
  $fineFont, [System.Drawing.SolidBrush]::new($muted), 442, 404)
$card.Graphics.DrawString('CodeWoxy', $fineFont, [System.Drawing.SolidBrush]::new($accent), 442, 466)

$titleFont.Dispose(); $tagFont.Dispose(); $fineFont.Dispose()
Save-Png $card 'og-image.png'

$brandBrush.Dispose()
$master.Dispose()
Write-Host 'now run: node build/make-favicon-ico.mjs'

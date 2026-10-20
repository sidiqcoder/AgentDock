Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 32, 32, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 20, 44, 41))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 7
$d = $r * 2
$rect = New-Object System.Drawing.Rectangle 1, 1, 30, 30
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
$path.CloseFigure()
$g.FillPath($brush, $path)

$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 154, 228, 202)), 3.0
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

$pts = @(
  New-Object System.Drawing.PointF 8, 24
  New-Object System.Drawing.PointF 16, 7
  New-Object System.Drawing.PointF 24, 24
)
$g.DrawLines($pen, $pts)
$g.DrawLine($pen, (New-Object System.Drawing.PointF 12, 18), (New-Object System.Drawing.PointF 20, 18))
$g.Dispose()

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()
$ms.Close()
$bmp.Dispose()

$icoMs = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($icoMs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]1)

$bw.Write([Byte]32)
$bw.Write([Byte]32)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Flush()

$outPath = Join-Path $PSScriptRoot "..\public\icon.ico"
[System.IO.File]::WriteAllBytes($outPath, $icoMs.ToArray())
$icoMs.Close()
Write-Output "PNG-ICO generated successfully at $outPath"

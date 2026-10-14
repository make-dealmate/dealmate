# Brand-only share card; no product, customer or performance claims.
Add-Type -AssemblyName System.Drawing
$target = Join-Path $PSScriptRoot '..\public\share-card.png'
if (Test-Path -LiteralPath $target) { throw 'Back up the existing share-card.png before regenerating it.' }
$bitmap = New-Object System.Drawing.Bitmap 1200,630
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#fbfbf8'))
$blue = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#244ef1'))
$pale = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#e8edff'))
$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#171b2d'))
$titleFont = New-Object System.Drawing.Font('Arial',94,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
$nameFont = New-Object System.Drawing.Font('Malgun Gothic',36,[System.Drawing.FontStyle]::Regular,[System.Drawing.GraphicsUnit]::Pixel)
$graphics.FillEllipse($pale,790,-170,650,650)
$graphics.FillEllipse($blue,925,360,330,330)
$graphics.FillRectangle($blue,84,135,18,18)
$graphics.DrawString('dealmate.',$titleFont,$ink,76,235)
$graphics.DrawString('딜메이트',$nameFont,$blue,84,365)
$bitmap.Save($target,[System.Drawing.Imaging.ImageFormat]::Png)
$nameFont.Dispose(); $titleFont.Dispose(); $ink.Dispose(); $pale.Dispose(); $blue.Dispose(); $graphics.Dispose(); $bitmap.Dispose()

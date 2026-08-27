param(
	[string]$OutputPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'resources\win32\forge-agent.ico'),
	[string]$PreviewPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'resources\win32\forge-agent.png')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase

# This is the exact path used by @vscode/codicons/src/icons/agent.svg and by
# Forge's animated .codicon-agent startup mark.
$agentPath = 'M5.10198 3C4.92335 3 4.75829 3.0953 4.66897 3.25L2.07089 7.75C1.98158 7.9047 1.98158 8.0953 2.07089 8.25L4.5746 12.5866C4.72231 12.8424 4.99529 13 5.29071 13C5.65144 13 5.97055 12.7662 6.0792 12.4222L8.96823 3.27622C9.20821 2.51649 9.913 2 10.7097 2C11.3622 2 11.9651 2.34809 12.2914 2.91316L14.7953 7.25C15.0632 7.7141 15.0632 8.2859 14.7953 8.75L12.1972 13.25C11.9292 13.7141 11.434 14 10.8981 14H8.50155C8.22541 14 8.00155 13.7761 8.00155 13.5C8.00155 13.2239 8.22541 13 8.50155 13H10.8981C11.0768 13 11.2418 12.9047 11.3311 12.75L13.9292 8.25C14.0185 8.0953 14.0185 7.9047 13.9292 7.75L11.4254 3.41316C11.2777 3.1575 11.005 3 10.7097 3C10.3493 3 10.0304 3.23369 9.92179 3.57743L7.03276 12.7234C6.7927 13.4834 6.08769 14 5.29071 14C4.63803 14 4.03492 13.6518 3.70858 13.0866L1.20487 8.75C0.936918 8.2859 0.936919 7.7141 1.20487 7.25L3.80295 2.75C4.07089 2.2859 4.56609 2 5.10198 2H7.50155C7.77769 2 8.00155 2.22386 8.00155 2.5C8.00155 2.77614 7.77769 3 7.50155 3H5.10198Z'
$geometry = [System.Windows.Media.Geometry]::Parse($agentPath)
$sizes = @(16, 24, 32, 48, 64, 128, 256)

function New-AgentIconImage([int]$Size) {
	$visual = [System.Windows.Media.DrawingVisual]::new()
	$context = $visual.RenderOpen()
	try {
		$background = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(24, 24, 24))
		$foreground = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(242, 242, 242))
		$bounds = [System.Windows.Rect]::new(0, 0, $Size, $Size)
		$radius = [Math]::Max(3, $Size * 0.22)
		$context.DrawRoundedRectangle($background, $null, $bounds, $radius, $radius)

		# Match the startup mark's breathing room while retaining the exact Codicon geometry.
		$padding = $Size * 0.14
		$scale = ($Size - (2 * $padding)) / 16
		# Use an explicit affine matrix so the translation remains in output pixels.
		# Appending Translate to the scaled matrix made the former padding inherit
		# the wrong coordinate space and pushed the mark toward the top-left.
		$matrix = [System.Windows.Media.Matrix]::new($scale, 0, 0, $scale, $padding, $padding)
		$context.PushTransform([System.Windows.Media.MatrixTransform]::new($matrix))
		$context.DrawGeometry($foreground, $null, $geometry)
		$context.Pop()
	}
	finally {
		$context.Close()
	}

	$bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new($Size, $Size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
	$bitmap.Render($visual)
	$encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
	$encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
	$stream = [System.IO.MemoryStream]::new()
	$encoder.Save($stream)
	$pngBytes = $stream.ToArray()
	$stream.Dispose()

	# Win32's legacy resource compiler requires DIB-backed ICO frames rather
	# than PNG-backed frames. Store bottom-up, straight-alpha BGRA pixels and
	# append the traditional 1-bit transparency mask.
	$stride = $Size * 4
	$pixels = [byte[]]::new($stride * $Size)
	$bitmap.CopyPixels($pixels, $stride, 0)
	$dibStream = [System.IO.MemoryStream]::new()
	$dibWriter = [System.IO.BinaryWriter]::new($dibStream)
	$maskStride = [int]([Math]::Ceiling($Size / 32.0) * 4)
	try {
		$dibWriter.Write([uint32]40)
		$dibWriter.Write([int32]$Size)
		$dibWriter.Write([int32]($Size * 2))
		$dibWriter.Write([uint16]1)
		$dibWriter.Write([uint16]32)
		$dibWriter.Write([uint32]0)
		$dibWriter.Write([uint32]($stride * $Size))
		$dibWriter.Write([int32]0)
		$dibWriter.Write([int32]0)
		$dibWriter.Write([uint32]0)
		$dibWriter.Write([uint32]0)
		for ($y = $Size - 1; $y -ge 0; $y--) {
			for ($x = 0; $x -lt $Size; $x++) {
				$offset = ($y * $stride) + ($x * 4)
				$alpha = [int]$pixels[$offset + 3]
				for ($channel = 0; $channel -lt 3; $channel++) {
					$value = [int]$pixels[$offset + $channel]
					$straight = if ($alpha -eq 0) { 0 } else { [Math]::Min(255, [Math]::Round(($value * 255.0) / $alpha)) }
					$dibWriter.Write([byte]$straight)
				}
				$dibWriter.Write([byte]$alpha)
			}
		}
		$dibWriter.Write([byte[]]::new($maskStride * $Size))
		$dibWriter.Flush()
		$dibBytes = $dibStream.ToArray()
	}
	finally {
		$dibWriter.Dispose()
		$dibStream.Dispose()
	}
	return [pscustomobject]@{ Png = $pngBytes; Dib = $dibBytes }
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
	New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}

$images = @($sizes | ForEach-Object {
	$image = New-AgentIconImage $_
	[pscustomobject]@{ Size = $_; Bytes = $image.Dib; Preview = $image.Png }
})
$fileStream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = [System.IO.BinaryWriter]::new($fileStream)
try {
	$writer.Write([uint16]0)
	$writer.Write([uint16]1)
	$writer.Write([uint16]$images.Count)
	$offset = 6 + (16 * $images.Count)
	foreach ($image in $images) {
		$dimension = if ($image.Size -eq 256) { 0 } else { $image.Size }
		$writer.Write([byte]$dimension)
		$writer.Write([byte]$dimension)
		$writer.Write([byte]0)
		$writer.Write([byte]0)
		$writer.Write([uint16]1)
		$writer.Write([uint16]32)
		$writer.Write([uint32]$image.Bytes.Length)
		$writer.Write([uint32]$offset)
		$offset += $image.Bytes.Length
	}
	foreach ($image in $images) {
		$writer.Write($image.Bytes)
	}
}
finally {
	$writer.Dispose()
	$fileStream.Dispose()
}

[System.IO.File]::WriteAllBytes($PreviewPath, ($images | Where-Object Size -eq 256).Preview)
Write-Host "Built Forge agent icon: $OutputPath"

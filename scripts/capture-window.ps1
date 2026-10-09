# Screenshots the window of a given VS Code executable (the tour's own copy, never the user's
# VS Code), optionally resizing it first so every shot has the same size. With -Focus it brings that
# window to the front instead, for a step that needs VS Code focused.
#   powershell -File capture-window.ps1 -Exe <Code.exe> -Out <file.png> [-Width 1440 -Height 900]
#   powershell -File capture-window.ps1 -Exe <Code.exe> -Focus
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Out = "",
  [int]$Width = 0,
  [int]$Height = 0,
  [switch]$Focus
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TourWindow {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
# Per-monitor aware (-4): window sizes and captures are in real pixels on any monitor, whatever its scaling.
[TourWindow]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

$full = [System.IO.Path]::GetFullPath($Exe)
$process = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.Path -and [System.IO.Path]::GetFullPath($_.Path) -eq $full
} | Select-Object -First 1
if (-not $process) { throw "No window found for $full" }
$handle = $process.MainWindowHandle

if ($Focus) {
  # Windows lets a background process bring a window forward only right after a key press, so
  # press and release Alt first.
  [TourWindow]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [TourWindow]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [TourWindow]::SetForegroundWindow($handle) | Out-Null
  exit 0
}
if (-not $Out) { throw "Give -Out <file.png>, or -Focus" }

if ($Width -gt 0 -and $Height -gt 0) {
  # Sizes are given in logical pixels; the window works in physical ones.
  $scale = [TourWindow]::GetDpiForWindow($handle) / 96.0
  $wantW = [int]($Width * $scale)
  $wantH = [int]($Height * $scale)
  $now = New-Object TourWindow+RECT
  [TourWindow]::GetWindowRect($handle, [ref]$now) | Out-Null
  if (($now.Right - $now.Left) -ne $wantW -or ($now.Bottom - $now.Top) -ne $wantH -or $now.Left -ne 20 -or $now.Top -ne 20) {
    [TourWindow]::ShowWindow($handle, 9) | Out-Null # restore from maximised or minimised
    [TourWindow]::SetWindowPos($handle, [IntPtr]::Zero, 20, 20, $wantW, $wantH, 0x0004) | Out-Null
    Start-Sleep -Milliseconds 800 # let VS Code lay out at the new size
  }
}

$rect = New-Object TourWindow+RECT
[TourWindow]::GetWindowRect($handle, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap $w, $h
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
# 2 = PW_RENDERFULLCONTENT: captures GPU-drawn (Electron) content, even behind other windows.
[TourWindow]::PrintWindow($handle, $hdc, 2) | Out-Null
$graphics.ReleaseHdc($hdc)
$graphics.Dispose()
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
Write-Output "$w x $h"

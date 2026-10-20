# Agent Dock tray icon for Windows using NotifyIcon
# IPC: stdin JSON commands, stdout JSON events
param(
  [string]$IconPath,
  [string]$Tooltip = "Agent Dock"
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class WinDpiAwareness {
  public static IntPtr PerMonitorAwareV2 { get { return new IntPtr(-4); } }
  public static IntPtr PerMonitorAware { get { return new IntPtr(-3); } }

  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

  [DllImport("user32.dll")]
  public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);

  [DllImport("shcore.dll")]
  public static extern int SetProcessDpiAwareness(int value);

  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
"@

function Enable-HighDpiAwareness {
  $contexts = @(
    [WinDpiAwareness]::PerMonitorAwareV2,
    [WinDpiAwareness]::PerMonitorAware
  )

  foreach ($context in $contexts) {
    try {
      if ([WinDpiAwareness]::SetProcessDpiAwarenessContext($context)) { break }
    } catch {}
  }

  try { [WinDpiAwareness]::SetProcessDpiAwareness(2) | Out-Null } catch {}
  try { [WinDpiAwareness]::SetProcessDPIAware() | Out-Null } catch {}

  foreach ($context in $contexts) {
    try {
      $previous = [WinDpiAwareness]::SetThreadDpiAwarenessContext($context)
      if ($previous -ne [IntPtr]::Zero) { break }
    } catch {}
  }
}

Enable-HighDpiAwareness

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
if ($IconPath -and (Test-Path $IconPath)) {
  $script:notifyIcon.Icon = New-Object System.Drawing.Icon($IconPath)
} else {
  $script:notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}

if ($Tooltip.Length -gt 63) { $Tooltip = $Tooltip.Substring(0, 63) }
$script:notifyIcon.Text = $Tooltip
$script:notifyIcon.Visible = $true

# Clicking notification balloon also opens dashboard
$script:notifyIcon.Add_BalloonTipClicked({
  Write-Event @{ type = "click_icon" }
})

# Show subtle startup notification to register in Windows 11 taskbar
try {
  $script:notifyIcon.BalloonTipTitle = "Agent Dock"
  $script:notifyIcon.BalloonTipText = "Aktif di background. Klik ikon untuk membuka dashboard."
  $script:notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $script:notifyIcon.ShowBalloonTip(3000)
} catch {}

$script:menu = New-Object System.Windows.Forms.ContextMenuStrip
$script:notifyIcon.ContextMenuStrip = $script:menu
$script:items = @()

function Write-Event($obj) {
  $json = $obj | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

# Left click or double click on tray icon opens the dashboard
$script:notifyIcon.Add_MouseClick({
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    Write-Event @{ type = "click_icon" }
  }
})

$script:notifyIcon.Add_DoubleClick({
  param($sender, $e)
  Write-Event @{ type = "click_icon" }
})

function Add-MenuItem($index, $title, $enabled, $isBold = $false) {
  if ($title -eq "-") {
    $sep = New-Object System.Windows.Forms.ToolStripSeparator
    $script:menu.Items.Add($sep) | Out-Null
    $script:items += $sep
    return
  }

  $item = New-Object System.Windows.Forms.ToolStripMenuItem
  $item.Text = $title
  $item.Enabled = [bool]$enabled
  if ($isBold) {
    $item.Font = New-Object System.Drawing.Font($item.Font, [System.Drawing.FontStyle]::Bold)
  }
  $idx = $index
  $item.Add_Click({ Write-Event @{ type = "click_item"; index = $idx } }.GetNewClosure())
  $script:menu.Items.Add($item) | Out-Null
  $script:items += $item
}

function Update-MenuItem($index, $title, $enabled) {
  if ($index -lt $script:items.Count) {
    $target = $script:items[$index]
    if ($target -is [System.Windows.Forms.ToolStripMenuItem]) {
      if ($null -ne $title) { $target.Text = $title }
      if ($null -ne $enabled) { $target.Enabled = [bool]$enabled }
    }
  }
}

function Set-Tooltip($text) {
  if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
  $script:notifyIcon.Text = $text
}

function Show-Balloon($title, $text, $timeout = 3000) {
  $script:notifyIcon.BalloonTipTitle = $title
  $script:notifyIcon.BalloonTipText = $text
  $script:notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $script:notifyIcon.ShowBalloonTip($timeout)
}

# Background reader thread polls stdin via timer on UI thread
$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 100
$script:timer.Add_Tick({
  try {
    while ([Console]::In.Peek() -ne -1) {
      $line = [Console]::In.ReadLine()
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      $cmd = $line | ConvertFrom-Json
      switch ($cmd.action) {
        "add-item"    { Add-MenuItem $cmd.index $cmd.title $cmd.enabled $cmd.isBold }
        "update-item" { Update-MenuItem $cmd.index $cmd.title $cmd.enabled }
        "set-tooltip" { Set-Tooltip $cmd.text }
        "balloon"     { Show-Balloon $cmd.title $cmd.text $cmd.timeout }
        "ready"       { Write-Event @{ type = "ready" } }
        "kill"        {
          $script:notifyIcon.Visible = $false
          $script:notifyIcon.Dispose()
          [System.Windows.Forms.Application]::Exit()
        }
      }
    }
  } catch {
    Write-Event @{ type = "error"; message = $_.Exception.Message }
  }
})
$script:timer.Start()

Write-Event @{ type = "started" }
[System.Windows.Forms.Application]::Run()

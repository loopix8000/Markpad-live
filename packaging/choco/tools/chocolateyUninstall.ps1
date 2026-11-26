$ErrorActionPreference = 'Stop'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"
Uninstall-BinFile -Name 'markpad-live'
Remove-Item "$( [Environment]::GetFolderPath('Desktop') )\Markpad Live.lnk" -ErrorAction SilentlyContinue
Remove-Item "$( [Environment]::GetFolderPath('Programs') )\Markpad Live.lnk" -ErrorAction SilentlyContinue

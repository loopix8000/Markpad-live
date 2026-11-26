$ErrorActionPreference = 'Stop'
$toolsDir   = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"
Install-BinFile -Name 'markpad-live' -Path "$toolsDir\markpad-live.exe"
Install-ChocolateyShortcut -ShortcutFilePath "$( [Environment]::GetFolderPath('Desktop') )\Markpad Live.lnk" -TargetPath "$toolsDir\markpad-live.exe"
Install-ChocolateyShortcut -ShortcutFilePath "$( [Environment]::GetFolderPath('Programs') )\Markpad Live.lnk" -TargetPath "$toolsDir\markpad-live.exe"

param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$ExpectedHash,
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][int]$ParentProcessId,
  [Parameter(Mandatory=$true)][string]$LogFile
)
$ErrorActionPreference = 'Stop'
try {
  $billingProcess = Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue
  if ($billingProcess) {
    if (-not $billingProcess.WaitForExit(120000)) { throw 'Billing did not close. The update was cancelled.' }
  }
  $actualHash = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash
  if ($actualHash -ne $ExpectedHash) { throw 'The installer failed its integrity check.' }
  $updateProcess = Start-Process -FilePath $Installer -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($updateProcess.ExitCode -ne 0) { throw "The installer returned exit code $($updateProcess.ExitCode)." }
  Add-Content -LiteralPath $LogFile -Value "$(Get-Date -Format o) Update installed successfully."
  Start-Process -FilePath $Executable -WindowStyle Hidden
} catch {
  Add-Content -LiteralPath $LogFile -Value "$(Get-Date -Format o) $($_.Exception.Message)"
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("$($_.Exception.Message)`n`nYour billing data has not been deleted.`nSee $LogFile", 'Finance Billing update') | Out-Null
}

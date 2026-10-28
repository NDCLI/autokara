[CmdletBinding()]
param(
  [string]$PythonPath,
  [string]$EnvironmentPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$requirements = Join-Path $repoRoot 'runtime\windows-python312-cpu-requirements.lock.txt'

if (-not $EnvironmentPath) {
  $EnvironmentPath = Join-Path $repoRoot '.venv-kara'
}

function Get-PythonVersion([string]$Executable) {
  $output = & $Executable -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])'
  if ($LASTEXITCODE -ne 0) { throw "Không chạy được Python: $Executable" }
  return ($output | Select-Object -Last 1).Trim()
}

if (-not $PythonPath) {
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if ($launcher) {
    $candidate = & $launcher.Source -3.12 -c 'import sys; print(sys.executable)' 2>$null
    if ($LASTEXITCODE -eq 0 -and $candidate) {
      $PythonPath = ($candidate | Select-Object -Last 1).Trim()
    }
  }

  if (-not $PythonPath) {
    $python312 = Get-Command python3.12 -ErrorAction SilentlyContinue
    if ($python312) { $PythonPath = $python312.Source }
  }

  if (-not $PythonPath) {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
      $candidateVersion = Get-PythonVersion $python.Source
      if ($candidateVersion.StartsWith('3.12.')) { $PythonPath = $python.Source }
    }
  }
}

if (-not $PythonPath -or -not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
  throw "Không tìm thấy Python 3.12. Hãy cài Python 3.12 song song với bản hiện có, sau đó chạy lại script. Python 3.15 hiện chưa nằm trong runtime được hỗ trợ của Kara Studio."
}

$pythonVersion = Get-PythonVersion $PythonPath
if (-not $pythonVersion.StartsWith('3.12.')) {
  throw "Runtime đã khóa và kiểm chứng trên Python 3.12; interpreter được chọn là $pythonVersion ($PythonPath). Hãy chạy -PythonPath với python.exe 3.12."
}

if (-not (Test-Path -LiteralPath $requirements -PathType Leaf)) {
  throw "Không tìm thấy dependency lock file: $requirements"
}

$venvPython = Join-Path $EnvironmentPath 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
  Write-Host "Tạo môi trường Python 3.12 tại $EnvironmentPath"
  & $PythonPath -m venv $EnvironmentPath
  if ($LASTEXITCODE -ne 0) { throw 'Không tạo được môi trường Python ảo.' }
}

$venvVersion = Get-PythonVersion $venvPython
if (-not $venvVersion.StartsWith('3.12.')) {
  throw "Môi trường đã tồn tại nhưng dùng Python $venvVersion. Xóa hoặc đổi -EnvironmentPath rồi chạy lại."
}

Write-Host 'Cài Faster-Whisper và các dependency đã khóa…'
& $venvPython -m pip install --disable-pip-version-check -r $requirements
if ($LASTEXITCODE -ne 0) { throw 'Cài dependency thất bại. Xem lỗi pip ở phía trên rồi thử lại.' }

Write-Host ''
Write-Host 'Runtime local đã sẵn sàng.' -ForegroundColor Green
Write-Host "Python: $venvPython"
Write-Host 'Trong Kara Studio: Cấu hình nhận dạng → Python executable → chọn đường dẫn trên → Kiểm tra runtime.'

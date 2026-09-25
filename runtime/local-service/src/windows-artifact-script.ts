// Shared by the Node/Electron verifier and the dependency-free PowerShell
// bootstrap. Keep OS trust and publisher matching identical at both entrances.
export const WINDOWS_ARTIFACT_SIGNATURE_FUNCTION = String.raw`
function Assert-OpenMeldArtifactSignature([string]$Path, [string]$Publisher) {
  Import-Module -Name (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
  $path = [IO.Path]::GetFullPath($Path)
  $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $path -ErrorAction Stop
  if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or !$signature.SignerCertificate -or $signature.Path -ine $path) { throw 'OpenMeld update signature is not valid for this file.' }
  $certificate = $signature.SignerCertificate
  $matches = if ($Publisher.Contains('=')) { $certificate.Subject -ceq $Publisher } else { $certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ceq $Publisher }
  if (!$matches) { throw 'OpenMeld update publisher does not match this installation.' }
}
`;

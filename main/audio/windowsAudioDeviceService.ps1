param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("list", "set")]
  [string]$Command,
  [string]$DeviceId
)

$ErrorActionPreference = "Stop"

function Import-NAudio {
  $searchPaths = @(
    (Join-Path $PSScriptRoot "vendor\\NAudio.Core.dll"),
    "C:\Program Files\Logi\LogiPluginService\NAudio.Core.dll"
  )

  $corePath = $searchPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $corePath) {
    throw "NAudio.Core.dll was not found. Device enumeration is unavailable."
  }

  $wasapiPath = $corePath -replace "NAudio\.Core\.dll$", "NAudio.Wasapi.dll"
  if (-not (Test-Path $wasapiPath)) {
    throw "NAudio.Wasapi.dll was not found next to NAudio.Core.dll."
  }

  Add-Type -Path $corePath
  Add-Type -Path $wasapiPath
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public enum ERole
{
    eConsole,
    eMultimedia,
    eCommunications,
    ERole_enum_count
}

[ComImport]
[Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
class PolicyConfigClient
{
}

[Guid("F8679F50-850A-41CF-9C72-430F290290C8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig
{
    int GetMixFormat(string wszDeviceId, IntPtr format);
    int GetDeviceFormat(string wszDeviceId, int defaultFormat, IntPtr format);
    int ResetDeviceFormat(string wszDeviceId);
    int SetDeviceFormat(string wszDeviceId, IntPtr endpointFormat, IntPtr mixFormat);
    int GetProcessingPeriod(string wszDeviceId, int defaultPeriod, IntPtr processingPeriod);
    int SetProcessingPeriod(string wszDeviceId, IntPtr processingPeriod);
    int GetShareMode(string wszDeviceId, IntPtr mode);
    int SetShareMode(string wszDeviceId, IntPtr mode);
    int GetPropertyValue(string wszDeviceId, IntPtr key, IntPtr value);
    int SetPropertyValue(string wszDeviceId, IntPtr key, IntPtr value);
    int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string wszDeviceId, ERole role);
    int SetEndpointVisibility(string wszDeviceId, int visible);
}

public static class PolicyConfigBridge
{
    public static void SetDefaultRenderDevice(string deviceId)
    {
        if (string.IsNullOrWhiteSpace(deviceId))
        {
            throw new ArgumentException("Device ID is required.", "deviceId");
        }

        IPolicyConfig policyConfig = (IPolicyConfig)(new PolicyConfigClient());
        Marshal.ThrowExceptionForHR(policyConfig.SetDefaultEndpoint(deviceId, ERole.eConsole));
        Marshal.ThrowExceptionForHR(policyConfig.SetDefaultEndpoint(deviceId, ERole.eMultimedia));
        Marshal.ThrowExceptionForHR(policyConfig.SetDefaultEndpoint(deviceId, ERole.eCommunications));
    }
}
"@

switch ($Command) {
  "list" {
    Import-NAudio
    $enumerator = New-Object NAudio.CoreAudioApi.MMDeviceEnumerator
    $defaultDevice = $enumerator.GetDefaultAudioEndpoint(
      [NAudio.CoreAudioApi.DataFlow]::Render,
      [NAudio.CoreAudioApi.Role]::Multimedia
    )
    $devices = $enumerator.EnumerateAudioEndPoints(
      [NAudio.CoreAudioApi.DataFlow]::Render,
      [NAudio.CoreAudioApi.DeviceState]::Active
    )

    $devices |
      ForEach-Object {
        [PSCustomObject]@{
          Id = $_.ID
          Name = $_.FriendlyName
          IsDefault = $_.ID -eq $defaultDevice.ID
        }
      } |
      ConvertTo-Json -Depth 3 -Compress
  }
  "set" {
    if ([string]::IsNullOrWhiteSpace($DeviceId)) {
      throw "DeviceId is required when using the 'set' command."
    }

    [PolicyConfigBridge]::SetDefaultRenderDevice($DeviceId)
  }
}

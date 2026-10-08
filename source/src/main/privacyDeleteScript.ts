/**
 * Windows-only, no-follow profile deletion helper.
 *
 * The caller must validate the external pending marker and the profile path
 * before launching Windows PowerShell with this script. The script receives
 * the already-canonical profile path and the Node lstat identity through
 * XINHAI_ERASE_ROOT, XINHAI_ERASE_INO and XINHAI_ERASE_DEV.
 *
 * It intentionally emits no output. A non-zero PowerShell exit code means
 * that no successful deletion result may be recorded by the caller.
 */
export const privacyDeleteScript = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class XinhaiPrivacyDeleteNative
{
    public const uint DELETE = 0x00010000;
    public const uint FILE_READ_ATTRIBUTES = 0x00000080;
    public const uint FILE_WRITE_ATTRIBUTES = 0x00000100;
    public const uint FILE_SHARE_READ = 0x00000001;
    public const uint OPEN_EXISTING = 3;
    public const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    public const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    public const uint FILE_ATTRIBUTE_READONLY = 0x00000001;
    public const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    public const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    public const int FileBasicInfo = 0;
    public const int FileDispositionInfo = 4;

    [StructLayout(LayoutKind.Sequential)]
    public struct NativeFileTime
    {
        public uint Low;
        public uint High;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ByHandleFileInformation
    {
        public uint FileAttributes;
        public NativeFileTime CreationTime;
        public NativeFileTime LastAccessTime;
        public NativeFileTime LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct FileBasicInformation
    {
        public long CreationTime;
        public long LastAccessTime;
        public long LastWriteTime;
        public long ChangeTime;
        public uint FileAttributes;
        public uint Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct FileDispositionInformation
    {
        public int DeleteFile;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle file,
        out ByHandleFileInformation information);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(
        SafeFileHandle file,
        int fileInformationClass,
        IntPtr fileInformation,
        uint bufferSize);

    public static SafeFileHandle OpenNoFollow(string fileName)
    {
        SafeFileHandle handle = CreateFileW(
            fileName,
            DELETE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES,
            FILE_SHARE_READ,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            IntPtr.Zero);
        if (handle == null || handle.IsInvalid)
        {
            int error = Marshal.GetLastWin32Error();
            if (handle != null) handle.Dispose();
            throw new Win32Exception(error, "CreateFileW failed");
        }
        return handle;
    }

    public static ByHandleFileInformation Information(SafeFileHandle handle)
    {
        ByHandleFileInformation information;
        if (!GetFileInformationByHandle(handle, out information))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "GetFileInformationByHandle failed");
        return information;
    }

    public static ulong FileIndex(ByHandleFileInformation information)
    {
        return ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow;
    }

    public static ulong FileSize(ByHandleFileInformation information)
    {
        return ((ulong)information.FileSizeHigh << 32) | information.FileSizeLow;
    }

    public static void ClearReadOnly(SafeFileHandle handle, ByHandleFileInformation information)
    {
        if ((information.FileAttributes & FILE_ATTRIBUTE_READONLY) == 0) return;
        if (information.NumberOfLinks > 1) throw new IOException("Refusing to change attributes of a readonly hardlink");
        FileBasicInformation basic = new FileBasicInformation {
            CreationTime = -1,
            LastAccessTime = -1,
            LastWriteTime = -1,
            ChangeTime = -1,
            FileAttributes = information.FileAttributes & ~FILE_ATTRIBUTE_READONLY,
            Reserved = 0
        };
        int size = Marshal.SizeOf(typeof(FileBasicInformation));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(basic, buffer, false);
            if (!SetFileInformationByHandle(handle, FileBasicInfo, buffer, (uint)size))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SetFileInformationByHandle(FileBasicInfo) failed");
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    public static void MarkDelete(SafeFileHandle handle)
    {
        FileDispositionInformation disposition = new FileDispositionInformation { DeleteFile = 1 };
        int size = Marshal.SizeOf(typeof(FileDispositionInformation));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(disposition, buffer, false);
            if (!SetFileInformationByHandle(handle, FileDispositionInfo, buffer, (uint)size))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SetFileInformationByHandle(FileDispositionInfo) failed");
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
}
'@

    $rootText = [Environment]::GetEnvironmentVariable('XINHAI_ERASE_ROOT')
    $inoText = [Environment]::GetEnvironmentVariable('XINHAI_ERASE_INO')
    $devText = [Environment]::GetEnvironmentVariable('XINHAI_ERASE_DEV')
    if ([string]::IsNullOrWhiteSpace($rootText) -or [string]::IsNullOrWhiteSpace($inoText) -or [string]::IsNullOrWhiteSpace($devText)) { throw 'missing erase identity' }
    if ($rootText.IndexOf([char]0) -ge 0 -or $rootText.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) { throw 'invalid erase path' }
    if (-not [IO.Path]::IsPathRooted($rootText)) { throw 'erase path must be absolute' }

    $rootFull = [IO.Path]::GetFullPath($rootText)
    $rootTrimmed = $rootFull.TrimEnd('\')
    $rootName = [IO.Path]::GetFileName($rootTrimmed)
    $volumeRoot = [IO.Path]::GetPathRoot($rootTrimmed)
    if ($rootName -cne 'xinhai-studio' -or [string]::IsNullOrEmpty($volumeRoot) -or $rootTrimmed -eq $volumeRoot.TrimEnd('\')) { throw 'erase root is outside the commercial profile scope' }
    if ($inoText -notmatch '^[0-9]+$' -or $devText -notmatch '^[0-9]+$') { throw 'invalid erase identity' }
    [UInt64]$expectedIno = 0
    [UInt64]$expectedDev = 0
    if (-not [UInt64]::TryParse($inoText, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$expectedIno)) { throw 'invalid erase inode' }
    if (-not [UInt64]::TryParse($devText, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$expectedDev)) { throw 'invalid erase volume' }
    if ($expectedIno -eq 0 -or $expectedDev -eq 0) { throw 'empty erase identity' }

    $script:lockPath = [IO.Path]::Combine($rootTrimmed, 'lockfile')
    $script:lockHandle = $null
    $script:rootHandle = $null

    function Remove-HandleEntry {
        param([Parameter(Mandatory = $true)][string]$Path)
        $handle = [XinhaiPrivacyDeleteNative]::OpenNoFollow($Path)
        try {
            $information = [XinhaiPrivacyDeleteNative]::Information($handle)
            [XinhaiPrivacyDeleteNative]::ClearReadOnly($handle, $information)
            if (($information.FileAttributes -band [XinhaiPrivacyDeleteNative]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) {
                [XinhaiPrivacyDeleteNative]::MarkDelete($handle)
                return
            }
            if (($information.FileAttributes -band [XinhaiPrivacyDeleteNative]::FILE_ATTRIBUTE_DIRECTORY) -ne 0) {
                $children = @([IO.Directory]::EnumerateFileSystemEntries($Path))
                foreach ($child in $children) {
                    if ([string]::Equals($child, $script:lockPath, [StringComparison]::OrdinalIgnoreCase)) { continue }
                    Remove-HandleEntry -Path $child
                }
                [XinhaiPrivacyDeleteNative]::MarkDelete($handle)
                return
            }
            [XinhaiPrivacyDeleteNative]::MarkDelete($handle)
        }
        finally { $handle.Dispose() }
    }

    # Probe lockfile before acquiring the root handle. An active old Electron
    # process normally holds this file with incompatible sharing and therefore
    # causes OpenNoFollow to fail before any deletion is attempted.
    try {
        $script:lockHandle = [XinhaiPrivacyDeleteNative]::OpenNoFollow($script:lockPath)
        $script:lockInformation = [XinhaiPrivacyDeleteNative]::Information($script:lockHandle)
        if (($script:lockInformation.FileAttributes -band [XinhaiPrivacyDeleteNative]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            ($script:lockInformation.FileAttributes -band [XinhaiPrivacyDeleteNative]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
            [XinhaiPrivacyDeleteNative]::FileSize($script:lockInformation) -ne 0) { throw 'invalid profile lockfile' }
    }
    catch {
        if ($null -ne $script:lockHandle) { $script:lockHandle.Dispose(); $script:lockHandle = $null }
        $lockError = $_.Exception
        while ($null -ne $lockError.InnerException) { $lockError = $lockError.InnerException }
        if ($lockError -is [System.ComponentModel.Win32Exception] -and $lockError.NativeErrorCode -in @(2, 3)) { }
        else { throw }
    }

    $script:rootHandle = [XinhaiPrivacyDeleteNative]::OpenNoFollow($rootTrimmed)
    try {
        $rootInformation = [XinhaiPrivacyDeleteNative]::Information($script:rootHandle)
        if (($rootInformation.FileAttributes -band [XinhaiPrivacyDeleteNative]::FILE_ATTRIBUTE_DIRECTORY) -eq 0 -or
            ($rootInformation.FileAttributes -band [XinhaiPrivacyDeleteNative]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) { throw 'erase root is not a normal directory' }
        if ([XinhaiPrivacyDeleteNative]::FileIndex($rootInformation) -ne $expectedIno -or [UInt64]$rootInformation.VolumeSerialNumber -ne $expectedDev) { throw 'erase root identity changed' }

        $children = @([IO.Directory]::EnumerateFileSystemEntries($rootTrimmed))
        foreach ($child in $children) {
            if ([string]::Equals($child, $script:lockPath, [StringComparison]::OrdinalIgnoreCase)) { continue }
            Remove-HandleEntry -Path $child
        }
        if ($null -ne $script:lockHandle) {
            [XinhaiPrivacyDeleteNative]::ClearReadOnly($script:lockHandle, $script:lockInformation)
            [XinhaiPrivacyDeleteNative]::MarkDelete($script:lockHandle)
            $script:lockHandle.Dispose()
            $script:lockHandle = $null
        }
        [XinhaiPrivacyDeleteNative]::MarkDelete($script:rootHandle)
    }
    finally {
        if ($null -ne $script:rootHandle) { $script:rootHandle.Dispose(); $script:rootHandle = $null }
        if ($null -ne $script:lockHandle) { $script:lockHandle.Dispose(); $script:lockHandle = $null }
    }
    exit 0
}
catch {
    exit 1
}
`

export const PRIVACY_DELETE_SCRIPT = privacyDeleteScript
export default privacyDeleteScript

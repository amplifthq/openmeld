using System;
using System.ComponentModel;
using System.Globalization;
using System.Text;
using System.Text.Json;

// The caller validates windowsProcessJobRequestSchema. This private process
// boundary carries no cloud authority and never emits the request or argv.
static class Program {
  const string RequestEnvironment = "OPENMELD_NATIVE_JOB_REQUEST";
  const string DrainReceipt = "openmeld-windows-job-drained-v1";

  static int Main() {
    string phase = "decode_request";
    try {
      string encoded = Environment.GetEnvironmentVariable(RequestEnvironment);
      Environment.SetEnvironmentVariable(RequestEnvironment, null);
      if (encoded == null || encoded.Length > 32000)
        throw new ArgumentException("Invalid native request envelope");
      using JsonDocument document = JsonDocument.Parse(
        Encoding.UTF8.GetString(Convert.FromBase64String(encoded)),
        new JsonDocumentOptions { MaxDepth = 8 });
      JsonElement request = document.RootElement;
      string operation = Text(request, "operation");
      if (operation == "identity") {
        phase = "read_identity";
        int pid = request.GetProperty("pid").GetInt32();
        if (pid <= 0) throw new ArgumentException("Invalid process ID");
        Console.Write(OpenMeldProcessJobV1.ReadIdentity(pid));
        return 0;
      }
      string name = Text(request, "jobName");
      const string prefix = "Local\\OpenMeld-Process-";
      if (!name.StartsWith(prefix, StringComparison.Ordinal) ||
          !Guid.TryParseExact(name.Substring(prefix.Length), "D", out _))
        throw new ArgumentException("Invalid native Job identity");
      if (operation == "drain") {
        phase = "drain_job";
        OpenMeldProcessJobV1.VerifyDrained(name);
        Console.Write(DrainReceipt);
        return 0;
      }
      if (operation != "launch") throw new ArgumentException("Unknown native operation");
      phase = "launch_job";
      return OpenMeldProcessJobV1.Run(name, Text(request, "executable"),
        Text(request, "commandLine"), Text(request, "workingDirectory"),
        request.GetProperty("ownerPid").GetInt32(), Text(request, "ownerStartedAt"));
    } catch (Exception error) {
      string code = error is Win32Exception native
        ? native.NativeErrorCode.ToString(CultureInfo.InvariantCulture)
        : error.GetType().Name;
      Console.Error.WriteLine("openmeld.windows_process.failed: " + code + " (" + phase + ")");
      return 125;
    }
  }

  static string Text(JsonElement request, string key) {
    string value = request.GetProperty(key).GetString();
    if (string.IsNullOrEmpty(value) || value.IndexOf('\0') >= 0)
      throw new ArgumentException("Invalid native request field");
    return value;
  }
}

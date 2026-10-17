// Local process fixture for the updater transaction test. It never uses real user paths.
using System;
using System.IO;
using System.Collections.Generic;
using System.Threading;
using System.Web.Script.Serialization;

public static class RecoveryFixture {
  static JavaScriptSerializer json = new JavaScriptSerializer();
  static Dictionary<string, object> Read(string filename) {
    return (Dictionary<string, object>)json.DeserializeObject(File.ReadAllText(filename));
  }
  public static int Main(string[] args) {
    try {
      if (Array.IndexOf(args, "/S") >= 0) {
        string install = null;
        foreach (string arg in args) if (arg.StartsWith("/D=")) install = arg.Substring(3);
        if (install == null) return 3;
        File.WriteAllText(Path.Combine(install, "version.txt"), "new-program");
        return 0;
      }
      string requestPath = null;
      foreach (string arg in args) if (arg.StartsWith("--source-update-health=")) requestPath = arg.Substring(23);
      if (requestPath == null) return 0;
      var request = Read(requestPath);
      var plugins = new Dictionary<string, object>();
      foreach (object item in (object[])request["plugins"]) {
        var plugin = (Dictionary<string, object>)item;
        plugins.Add((string)plugin["name"], plugin["version"]);
      }
      File.WriteAllText(Path.Combine((string)request["userDataPath"], "settings.json"), "{\"schema\":2}");
      var receipt = new Dictionary<string, object>();
      receipt.Add("token", request["token"]);
      receipt.Add("version", (string)request["phase"] == "installed-final" ? "injected-failure" : request["version"]);
      receipt.Add("commit", request["commit"]);
      receipt.Add("appId", "com.deepseek.dsh");
      receipt.Add("pluginVersions", plugins);
      receipt.Add("profileLoaded", true); receipt.Add("pluginsLoaded", true); receipt.Add("schedulesDisabled", true);
      if ((string)request["phase"] == "installed-final") {
        string writerMarker = Environment.GetEnvironmentVariable("DSH_FIXTURE_RECOVERY_WRITER_MARKER");
        if (!String.IsNullOrEmpty(writerMarker)) File.WriteAllText(writerMarker, "fixture writer becomes active after promotion");
        if (Environment.GetEnvironmentVariable("DSH_FIXTURE_RECOVERY_JOURNAL_FAILURE") == "1") {
          string journal = Path.Combine(Path.GetDirectoryName((string)request["receiptPath"]), "transaction.json");
          File.Move(journal, journal + ".before-fixture-fault");
          Directory.CreateDirectory(journal);
        }
      }
      string destination = (string)request["receiptPath"];
      File.WriteAllText(destination + ".fixture", json.Serialize(receipt));
      File.Move(destination + ".fixture", destination);
      DateTime deadline = DateTime.UtcNow.AddSeconds(30);
      while (!File.Exists((string)request["releasePath"])) {
        if (DateTime.UtcNow > deadline) return 4;
        Thread.Sleep(20);
      }
      return 0;
    } catch (Exception error) { Console.Error.WriteLine(error); return 2; }
  }
}

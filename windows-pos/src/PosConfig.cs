using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace SarfliPos
{
    /// <summary>
    /// Settings stored in %APPDATA%\Sarfli POS\config (plain key=value lines).
    /// The token is encrypted with DPAPI (current Windows user only).
    /// </summary>
    public sealed class PosConfig
    {
        public const string DefaultServer = "https://sarfli.com";
        private const string ApiPath = "/api/pos/v1";
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Sarfli POS token v1");

        public string ApiBase { get; set; }
        public string Token { get; set; }
        public string TerminalName { get; set; }

        public bool IsPaired { get { return !string.IsNullOrEmpty(Token) && !string.IsNullOrEmpty(ApiBase); } }

        public static string Folder
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Sarfli POS");
            }
        }

        public static string FilePath { get { return Path.Combine(Folder, "config"); } }

        /// <summary>Turns "sarfli.com", "https://sarfli.com/" or a full API URL into the API base URL.</summary>
        public static string NormalizeApiBase(string server)
        {
            string s = (server ?? "").Trim();
            if (s.Length == 0) s = DefaultServer;
            if (s.IndexOf("://", StringComparison.Ordinal) < 0) s = "https://" + s;
            s = s.TrimEnd('/');
            if (!s.EndsWith(ApiPath, StringComparison.OrdinalIgnoreCase)) s += ApiPath;
            return s;
        }

        /// <summary>Server URL as shown to the user (API base without the /api/pos/v1 suffix).</summary>
        public static string ServerFromApiBase(string apiBase)
        {
            if (string.IsNullOrEmpty(apiBase)) return DefaultServer;
            return apiBase.EndsWith(ApiPath, StringComparison.OrdinalIgnoreCase)
                ? apiBase.Substring(0, apiBase.Length - ApiPath.Length)
                : apiBase;
        }

        public static PosConfig Load()
        {
            try
            {
                if (!File.Exists(FilePath)) return null;
                var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (string line in File.ReadAllLines(FilePath, Encoding.UTF8))
                {
                    int eq = line.IndexOf('=');
                    if (eq > 0) values[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
                }

                var c = new PosConfig();
                string v;
                if (values.TryGetValue("apiBase", out v)) c.ApiBase = v;
                if (values.TryGetValue("terminalName", out v)) c.TerminalName = v;
                if (values.TryGetValue("token", out v) && v.Length > 0)
                {
                    try
                    {
                        byte[] plain = ProtectedData.Unprotect(Convert.FromBase64String(v), Entropy,
                            DataProtectionScope.CurrentUser);
                        c.Token = Encoding.UTF8.GetString(plain);
                    }
                    catch (Exception)
                    {
                        c.Token = null; // Other Windows user or corrupted: pair again.
                    }
                }
                return c;
            }
            catch (Exception)
            {
                return null;
            }
        }

        public void Save()
        {
            Directory.CreateDirectory(Folder);
            var sb = new StringBuilder();
            sb.Append("apiBase=").Append(ApiBase ?? "").Append("\r\n");
            sb.Append("terminalName=").Append((TerminalName ?? "").Replace("\r", " ").Replace("\n", " ")).Append("\r\n");
            if (!string.IsNullOrEmpty(Token))
            {
                byte[] enc = ProtectedData.Protect(Encoding.UTF8.GetBytes(Token), Entropy,
                    DataProtectionScope.CurrentUser);
                sb.Append("token=").Append(Convert.ToBase64String(enc)).Append("\r\n");
            }
            File.WriteAllText(FilePath, sb.ToString(), new UTF8Encoding(false));
        }

        /// <summary>Forgets the token but keeps the server URL for the next pairing.</summary>
        public void ClearToken()
        {
            Token = null;
            TerminalName = null;
            try { Save(); } catch (Exception) { }
        }
    }
}
